const data = require('../../data/index')
const progress = require('../../utils/progress')
const settings = require('../../utils/settings')
const vocab = require('../../utils/vocab')
const notes = require('../../utils/notes')
const audioSource = require('../../utils/audio-source')
const fmt = require('../../utils/format')

const RATES = [1, 0.75, 0.5, 1.25]
const MODES = [{ k: 'bi', t: '双语' }, { k: 'en', t: '英文' }, { k: 'blind', t: '盲听' }]
const SAVE_EVERY = 3000 // 播放中最多每 3 秒写一次进度
const LOAD_TIMEOUT = 8000 // 有些机型地址 404 时不触发 onError，超时就换下一个地址

function rateText(r) {
  return (r % 0.5 ? r.toFixed(2) : r.toFixed(1)) + '×'
}

function round1(x) {
  return Math.round(x * 10) / 10
}

// 字幕列表里一句的显示数据。a：这个词有释义；ap：词后面的空格也在同一条释义里（高亮连成一片）
function cueView(c, i) {
  return {
    i,
    ts: fmt.time(c.start),
    lead: c.lead || '',
    zh: c.zh,
    on: false,
    rev: false,
    sel: null,
    toks: c.tokens.map((t, k) => ({
      w: t.w,
      p: t.p,
      a: c.anns.some(x => x.s <= k && k <= x.e),
      ap: c.anns.some(x => x.s <= k && k + 1 <= x.e)
    }))
  }
}

Page({
  data: {
    modes: MODES,
    mode: 'bi',
    tip: false,
    counter: '',
    cues: [],
    scrollTop: 0,
    anim: false,
    follow: true,
    playing: false,
    rateText: '1.0×',
    loop: false,
    peaks: [],
    playedW: 0,
    curL: 0,
    curW: 0,
    tNow: '0:00',
    tDur: '0:00',
    sheet: { show: false, items: [], active: 0, unknown: null, navText: '', canPrev: false, canNext: false }
  },

  onLoad(q) {
    const mat = data.get(q.id)
    if (!mat) {
      wx.showToast({ title: '找不到这份素材', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }
    this.mat = mat
    this.cue = -1
    this.selCue = null
    this.revealed = {}
    this.lastSave = 0
    this.lastT = 0
    this.stopAt = null
    this.seekGuard = 0

    const s = settings.get()
    this.rateIx = Math.max(0, RATES.indexOf(s.rate))
    wx.setNavigationBarTitle({ title: mat.title })

    const st = progress.status(mat.id, mat.cues.length)
    const startCue = q.cue != null ? Math.min(+q.cue, mat.cues.length - 1) : st.state === 'learning' ? st.cue : 0
    this.setData({
      mode: s.subtitleMode,
      tip: !s.tipDismissed,
      rateText: rateText(RATES[this.rateIx]),
      cues: mat.cues.map(cueView),
      peaks: mat.peaks.map(p => Math.round(p * 100)),
      tDur: fmt.time(mat.duration)
    }, () => {
      this.setCue(startCue, true)
      this.draw(mat.cues[startCue].start)
      this.measure(() => {
        this.scrollToCue(this.cue)
        setTimeout(() => this.setData({ anim: true }), 300)
      })
    })
    this.initAudio(mat.cues[startCue].start, q.autoplay !== '0')
  },

  onHide() {
    this.saveProgress()
  },

  onUnload() {
    this.saveProgress()
    this.stopTick()
    this.clearLoadTimer()
    if (this.ctx) this.ctx.destroy()
    wx.setKeepScreenOn({ keepScreenOn: false })
  },

  /* ---------- 音频 ---------- */

  initAudio(startAt, autoplay) {
    const ctx = wx.createInnerAudioContext()
    this.ctx = ctx
    this.srcs = audioSource.sources(this.mat.id)
    this.started = false
    this.startAt = startAt
    ctx.playbackRate = RATES[this.rateIx]

    ctx.onPlay(() => {
      this.clearLoadTimer()
      if (!this.started) {
        this.started = true
        // startTime 在部分机型上不生效，第一次开始播放时再跳一次
        if (this.startAt > 0.5 && Math.abs(ctx.currentTime - this.startAt) > 1) {
          this.seekGuard = Date.now() + 600
          ctx.seek(this.startAt)
        }
      }
      this.setData({ playing: true })
      this.startTick()
      wx.setKeepScreenOn({ keepScreenOn: true })
    })
    ctx.onPause(() => this.onStopped())
    ctx.onStop(() => this.onStopped())
    ctx.onEnded(() => {
      this.onStopped()
      progress.complete(this.mat.id, this.mat.cues.length)
      wx.showToast({ title: '听完了，已标记为学完', icon: 'none' })
    })
    ctx.onCanplay(() => {
      this.clearLoadTimer()
      const s = this.srcs[this.srcIx]
      if (s && s.cacheable) audioSource.saveToCache(this.mat.id, s.url)
    })
    ctx.onError(err => {
      this.clearLoadTimer()
      console.warn('音频加载失败', this.srcs[this.srcIx], err)
      this.useSource(this.srcIx + 1, this.wantPlay)
    })
    ctx.onSeeked(() => { this.seekGuard = 0 })
    ctx.onTimeUpdate(() => this.tick())

    this.useSource(0, autoplay)
  },

  useSource(i, play) {
    if (i >= this.srcs.length) {
      this.failed = true
      this.setData({ playing: false })
      wx.showModal({
        title: '音频加载失败',
        content: this.srcs.length ? '检查网络后点播放重试。' : '还没有配置音频地址：在 miniprogram/config.js 里填写 GitHub 仓库链接。',
        showCancel: false
      })
      return
    }
    this.failed = false
    this.srcIx = i
    this.wantPlay = play
    const t = this.started ? this.lastT : this.startAt
    this.started = false
    this.startAt = t
    this.seekGuard = Date.now() + 600
    this.ctx.startTime = t
    this.ctx.src = this.srcs[i].url
    if (play) {
      this.ctx.play()
      this.watchLoad()
    }
  },

  watchLoad() {
    this.clearLoadTimer()
    this.loadTimer = setTimeout(() => {
      if (this.started) return
      console.warn('音频加载超时', this.srcs[this.srcIx])
      this.ctx.stop()
      this.useSource(this.srcIx + 1, true)
    }, LOAD_TIMEOUT)
  },

  clearLoadTimer() {
    if (this.loadTimer) clearTimeout(this.loadTimer)
    this.loadTimer = null
  },

  play() {
    if (this.failed) {
      this.useSource(0, true)
      return
    }
    this.ctx.play()
    if (!this.started) this.watchLoad()
  },

  onStopped() {
    this.setData({ playing: false })
    this.stopTick()
    this.saveProgress()
    wx.setKeepScreenOn({ keepScreenOn: false })
  },

  startTick() {
    this.stopTick()
    this.timer = setInterval(() => this.tick(), 150)
  },

  stopTick() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  },

  tick() {
    if (!this.started || Date.now() < this.seekGuard) return
    const t = this.ctx.currentTime
    this.lastT = t
    if (this.stopAt != null && t >= this.stopAt) {
      this.stopAt = null
      this.ctx.pause()
      return
    }
    if (this.data.loop && this.cue >= 0) {
      const c = this.mat.cues[this.cue]
      if (t >= c.end + 0.08) {
        this.seek(c.start)
        return
      }
    }
    this.setCue(this.findCue(t))
    this.draw(t)
    if (Date.now() - this.lastSave > SAVE_EVERY) this.saveProgress()
  },

  seek(t) {
    t = Math.min(Math.max(0, t), this.mat.duration - 0.05)
    if (this.started) {
      this.seekGuard = Date.now() + 500
      this.ctx.seek(t)
    } else {
      this.startAt = t
      this.ctx.startTime = t
    }
    this.lastT = t
    this.setCue(this.findCue(t))
    this.draw(t)
  },

  seekCue(i) {
    i = Math.max(0, Math.min(this.mat.cues.length - 1, i))
    this.stopAt = null
    if (!this.data.follow) this.setData({ follow: true })
    this.seek(this.mat.cues[i].start)
  },

  findCue(t) {
    const cues = this.mat.cues
    let i = 0
    for (let k = 0; k < cues.length; k++) if (cues[k].start <= t + 0.05) i = k
    return i
  },

  setCue(i, force) {
    if (i === this.cue && !force) return
    const up = {}
    if (this.cue >= 0 && this.cue !== i) up[`cues[${this.cue}].on`] = false
    up[`cues[${i}].on`] = true
    const c = this.mat.cues[i]
    const d = this.mat.duration
    up.counter = `第 ${i + 1} / ${this.mat.cues.length} 句`
    up.curL = round1(c.start / d * 100)
    up.curW = Math.max(0.5, round1((c.end - c.start) / d * 100))
    this.cue = i
    this.setData(up)
    if (this.data.follow) this.scrollToCue(i)
  },

  draw(t) {
    const w = round1(t / this.mat.duration * 100)
    const now = fmt.time(t)
    if (w !== this.data.playedW || now !== this.data.tNow) this.setData({ playedW: w, tNow: now })
  },

  saveProgress() {
    if (!this.mat || this.cue < 0) return
    progress.record(this.mat.id, this.cue, this.mat.cues.length)
    this.lastSave = Date.now()
  },

  /* ---------- 字幕列表滚动 ---------- */

  measure(cb) {
    wx.createSelectorQuery()
      .select('#cues').boundingClientRect()
      .select('#cues').scrollOffset()
      .selectAll('.cue').boundingClientRect()
      .select('#wave').boundingClientRect()
      .exec(res => {
        const [sv, off, rects, wave] = res
        if (!sv || !rects || !rects.length) return
        this.viewH = sv.height
        this.tops = rects.map(r => r.top - sv.top + off.scrollTop)
        this.waveRect = wave
        if (cb) cb()
      })
  },

  scrollToCue(i) {
    if (!this.tops || i < 0) return
    const top = Math.max(0, this.tops[i] - this.viewH * 0.22)
    // scroll-top 值不变时不会滚动，所以每次加一点点偏移
    this.flip = !this.flip
    this.setData({ scrollTop: top + (this.flip ? 0.5 : 0) })
  },

  onTouchStart(e) {
    this.touchY = e.touches[0].clientY
  },

  onUserScroll(e) {
    if (this.data.follow && Math.abs(e.touches[0].clientY - this.touchY) > 10) this.setData({ follow: false })
  },

  onFollow() {
    this.setData({ follow: true })
    this.scrollToCue(this.cue)
  },

  /* ---------- 字幕点击 ---------- */

  reveal(i) {
    this.revealed[i] = true
    this.setData({ [`cues[${i}].rev`]: true })
  },

  onCueTap(e) {
    const i = e.currentTarget.dataset.i
    if (this.data.mode === 'blind' && !this.data.cues[i].rev) return this.reveal(i)
    this.seekCue(i)
    this.play()
  },

  onWordTap(e) {
    const { c, k } = e.currentTarget.dataset
    if (this.data.mode === 'blind' && !this.data.cues[c].rev) return this.reveal(c)
    const ids = notes.idsAt(this.mat, c, k)
    if (ids.length) this.openNotes(ids.map(id => notes.noteView(this.mat, id, c)), 0)
    else this.openUnknown(c, k)
  },

  /* ---------- 释义弹层 ---------- */

  pauseForSheet() {
    if (this.data.sheet.show) return
    this.resume = this.data.playing
    if (this.data.playing) this.ctx.pause()
  },

  navState(item) {
    const order = this.mat.order
    const ix = order.findIndex(o => o.id === item.id)
    return { navText: `${ix + 1} / ${order.length}`, canPrev: ix > 0, canNext: ix < order.length - 1 }
  },

  markSel(cue, s, e) {
    const up = {}
    if (this.selCue != null) up[`cues[${this.selCue}].sel`] = null
    if (cue != null) up[`cues[${cue}].sel`] = { s, e }
    this.selCue = cue
    this.setData(up)
  },

  markNote(item) {
    const a = notes.span(this.mat, item.cue, item.id)
    this.markSel(item.cue, a.s, a.e)
  },

  openNotes(items, active) {
    this.pauseForSheet()
    this.setData({ sheet: Object.assign({ show: true, items, active, unknown: null }, this.navState(items[active])) })
    this.markNote(items[active])
  },

  openUnknown(c, k) {
    this.pauseForSheet()
    this.setData({ sheet: { show: true, items: [], active: 0, unknown: notes.unknownView(this.mat, c, k), navText: '', canPrev: false, canNext: false } })
    this.markSel(c, k, k)
  },

  onSheetClose() {
    this.setData({ 'sheet.show': false })
    this.markSel(null)
    if (this.resume) {
      this.stopAt = null
      this.play()
    }
    this.resume = false
  },

  onSheetTab(e) {
    const active = e.detail.index
    const item = this.data.sheet.items[active]
    this.setData(Object.assign({ 'sheet.active': active }, this.prefixed(this.navState(item))))
    this.markNote(item)
  },

  prefixed(obj) {
    const out = {}
    Object.keys(obj).forEach(k => { out['sheet.' + k] = obj[k] })
    return out
  },

  stepNote(d) {
    const cur = this.data.sheet.items[this.data.sheet.active]
    const order = this.mat.order
    const o = order[order.findIndex(x => x.id === cur.id) + d]
    if (!o) return
    const item = notes.noteView(this.mat, o.id, o.cue)
    this.setData(Object.assign({ 'sheet.items': [item], 'sheet.active': 0 }, this.prefixed(this.navState(item))))
    this.markNote(item)
  },

  onSheetPrev() {
    this.stepNote(-1)
  },

  onSheetNext() {
    this.stepNote(1)
  },

  onSheetReplay(e) {
    const c = this.mat.cues[e.detail.cue]
    this.resume = false
    this.seek(c.start)
    this.stopAt = c.end
    this.play()
  },

  onSheetSave(e) {
    const { material, id } = e.detail
    const saved = vocab.toggle(material, id)
    const ix = this.data.sheet.items.findIndex(x => x.id === id)
    this.setData({ [`sheet.items[${ix}].saved`]: saved })
    wx.showToast({ title: saved ? '已加入生词本' : '已移出生词本', icon: 'none' })
  },

  /* ---------- 控制栏 ---------- */

  onPlayTap() {
    if (this.data.playing) {
      this.ctx.pause()
    } else {
      this.stopAt = null
      this.play()
    }
  },

  onPrev() {
    const c = this.mat.cues[this.cue]
    this.seekCue(this.lastT - c.start > 1.2 ? this.cue : this.cue - 1)
  },

  onNext() {
    this.seekCue(this.cue + 1)
  },

  onLoop() {
    const loop = !this.data.loop
    this.setData({ loop })
    wx.showToast({ title: loop ? '单句循环已开启' : '单句循环已关闭', icon: 'none' })
  },

  onRate() {
    this.rateIx = (this.rateIx + 1) % RATES.length
    const r = RATES[this.rateIx]
    this.ctx.playbackRate = r
    settings.set({ rate: r })
    this.setData({ rateText: rateText(r) })
  },

  onMode(e) {
    const mode = e.currentTarget.dataset.m
    if (mode === this.data.mode) return
    settings.set({ subtitleMode: mode })
    const up = { mode }
    Object.keys(this.revealed).forEach(i => { up[`cues[${i}].rev`] = false })
    this.revealed = {}
    this.setData(up, () => this.measure(() => { if (this.data.follow) this.scrollToCue(this.cue) }))
  },

  onTipOk() {
    settings.set({ tipDismissed: true })
    this.setData({ tip: false }, () => this.measure())
  },

  onWave(e) {
    if (!this.waveRect) return
    const now = Date.now()
    if (e.type === 'touchmove' && now - (this.lastWave || 0) < 80) return
    this.lastWave = now
    const x = e.touches[0].clientX
    const ratio = Math.min(1, Math.max(0, (x - this.waveRect.left) / this.waveRect.width))
    this.stopAt = null
    if (!this.data.follow) this.setData({ follow: true })
    this.seek(ratio * this.mat.duration)
  }
})
