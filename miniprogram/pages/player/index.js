// 播放页：只负责显示和操作，音频本身在 utils/player.js 里，离开这个页面也会继续播放
const data = require('../../data/index')
const player = require('../../utils/player')
const settings = require('../../utils/settings')
const vocab = require('../../utils/vocab')
const notes = require('../../utils/notes')
const fmt = require('../../utils/format')

const MODES = [{ k: 'bi', t: '双语' }, { k: 'en', t: '英文' }, { k: 'blind', t: '盲听' }]

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
    loading: false,
    rateText: '1.0×',
    rate: 1,
    rates: player.RATES.map(v => ({ v, t: rateText(v) })),
    ratePanel: false,
    loop: false,
    peaks: [],
    playedW: 0,
    curL: 0,
    curW: 0,
    tNow: '0:00',
    tDur: '0:00',
    sheet: { show: false, items: [], active: 0, unknown: null, navText: '', canPrev: false, canNext: false }
  },

  // 打开方式：?id=素材&cue=第几句（从 0 开始，可选）&autoplay=0（不自动播放，可选）
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
    const s = settings.get()
    wx.setNavigationBarTitle({ title: mat.title })
    this.setData({
      mode: s.subtitleMode,
      tip: !s.tipDismissed,
      cues: mat.cues.map(cueView),
      peaks: mat.peaks.map(p => Math.round(p * 100)),
      tDur: fmt.time(mat.duration)
    }, () => {
      this.unsub = player.subscribe((type, st) => this.onPlayer(type, st))
      const opts = { autoplay: q.autoplay !== '0' }
      if (q.cue != null) opts.cue = +q.cue
      player.open(mat.id, opts)
      this.sync()
      this.measure(() => {
        this.scrollToCue(this.cue)
        setTimeout(() => this.setData({ anim: true }), 300)
      })
    })
  },

  onUnload() {
    // 不停止播放：回到首页后迷你播放条接着显示
    if (this.unsub) this.unsub()
  },

  /* ---------- 同步全局播放器的状态 ---------- */

  sync() {
    const st = player.state()
    if (st.id !== this.mat.id) return
    this.setCue(st.cue, true)
    this.draw(st.t)
    this.syncState(st)
  },

  syncState(st) {
    this.setData({ playing: st.playing, loading: st.loading, loop: st.loop, rate: st.rate, rateText: rateText(st.rate) })
  },

  onPlayer(type, st) {
    if (st.id !== this.mat.id) {
      if (this.data.playing) this.setData({ playing: false })
      return
    }
    if (type === 'cue') this.setCue(st.cue)
    else if (type === 'time') this.draw(st.t)
    else if (type === 'state' || type === 'load') this.syncState(st)
    else if (type === 'ended') wx.showToast({ title: '听完了，已标记为学完', icon: 'none' })
  },

  setCue(i, force) {
    if (i < 0 || (i === this.cue && !force)) return
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

  refollow() {
    if (!this.data.follow) this.setData({ follow: true })
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
    this.refollow()
    player.seekCue(i)
    player.play()
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
    this.resume = player.state().playing
    if (this.resume) player.pause()
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
    if (this.resume) player.play()
    this.resume = false
  },

  prefixed(obj) {
    const out = {}
    Object.keys(obj).forEach(k => { out['sheet.' + k] = obj[k] })
    return out
  },

  onSheetTab(e) {
    const active = e.detail.index
    const item = this.data.sheet.items[active]
    this.setData(Object.assign({ 'sheet.active': active }, this.prefixed(this.navState(item))))
    this.markNote(item)
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
    this.resume = false
    player.playCueOnce(e.detail.cue)
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
    player.toggle()
  },

  onPrev() {
    this.refollow()
    player.prev()
  },

  onNext() {
    this.refollow()
    player.next()
  },

  onLoop() {
    const loop = !player.state().loop
    player.setLoop(loop)
    wx.showToast({ title: loop ? '单句循环已开启' : '单句循环已关闭', icon: 'none' })
  },

  onRate() {
    this.setData({ ratePanel: !this.data.ratePanel })
  },

  onRateClose() {
    this.setData({ ratePanel: false })
  },

  onRatePick(e) {
    this.setData({ ratePanel: false })
    player.setRate(e.currentTarget.dataset.v)
  },

  noop() {},

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
    this.refollow()
    player.seek(ratio * this.mat.duration)
  }
})
