// 全局播放器：整个小程序只有一个音频。播放页、首页、迷你播放条都订阅它的状态，
// 所以离开播放页后还能继续播放。
//
// 事件（subscribe 的回调收到 type, state）：
//   load  换了素材       state  播放/暂停/倍速/循环/加载中变了
//   cue   当前句变了     time   播放位置变了（播放中约每 100ms 一次）
//   ended 播完了         close  关掉了播放器
const data = require('../data/index')
const progress = require('./progress')
const settings = require('./settings')
const audioSource = require('./audio-source')

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const SAVE_EVERY = 3000 // 播放中最多每 3 秒写一次进度
const LOAD_TIMEOUT = 8000 // 有些机型地址 404 时不触发 onError，超时就换下一个地址
const TICK = 100 // 播放中每 100ms 检查一次位置
// 很多字幕的句子首尾相连（上一句结束就是下一句开始），位置又是隔一段时间才检查一次，
// 所以单句循环、重听一句都提前一点点判断句尾，免得漏进下一句。提前量要大于检查间隔
const END_EARLY = 0.15

// 对外可读的状态。不要在外面直接改，用下面的方法
const S = { id: null, mat: null, cue: -1, t: 0, playing: false, loading: false, rate: 1, loop: false }

const listeners = []
let ctx = null
let srcs = []
let srcIx = -1
let started = false // 当前地址是否已经真正开始播放过
let startAt = 0
let wantPlay = false
let failed = false
let switching = false // 换素材、换地址、关闭时调用了 stop，忽略随后的 onStop/onPause
let rateSwitching = false
let stopAt = null
let seekGuard = 0
let lastSave = 0
let timer = null
let loadTimer = null
let rateTimer = null

function state() {
  return S
}

function subscribe(fn) {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i >= 0) listeners.splice(i, 1)
  }
}

function emit(type) {
  listeners.slice().forEach(fn => {
    try {
      fn(type, S)
    } catch (e) {
      console.error('播放器订阅回调出错', e)
    }
  })
}

function ensure() {
  if (ctx) return ctx
  const saved = settings.get().rate
  S.rate = RATES.indexOf(saved) >= 0 ? saved : 1
  ctx = wx.createInnerAudioContext()
  ctx.onPlay(() => {
    clearLoad()
    switching = false
    rateSwitching = false
    if (!started) {
      started = true
      // startTime 在部分机型上不生效，第一次开始播放时再跳一次
      if (startAt > 0.5 && Math.abs(ctx.currentTime - startAt) > 1) {
        seekGuard = Date.now() + 600
        ctx.seek(startAt)
      }
      // 开始播放后清掉 startTime，否则播完再播时部分机型会先从头快进到这个位置
      ctx.startTime = 0
    }
    S.loading = false
    setPlaying(true)
  })
  ctx.onPause(() => {
    if (rateSwitching) return resumeAfterRate()
    if (!switching) setPlaying(false)
  })
  ctx.onStop(() => {
    if (!switching) setPlaying(false)
  })
  ctx.onEnded(() => {
    setPlaying(false)
    if (!S.mat) return
    progress.complete(S.id, S.mat.cues.length)
    // 播完回到开头，暂停着等下一次播放
    stopAt = null
    started = false
    startAt = 0
    ctx.startTime = 0
    S.t = 0
    setCue(0)
    emit('time')
    emit('ended')
  })
  ctx.onCanplay(() => {
    clearLoad()
    const s = srcs[srcIx]
    if (s && s.cacheable) audioSource.saveToCache(S.id, s.url)
  })
  ctx.onError(err => {
    clearLoad()
    console.warn('音频加载失败', srcs[srcIx], err)
    useSource(srcIx + 1, wantPlay)
  })
  ctx.onSeeked(() => { seekGuard = 0 })
  ctx.onTimeUpdate(tick)
  wx.onAppHide(() => save())
  return ctx
}

function setPlaying(p) {
  if (S.playing === p) return
  S.playing = p
  if (p) {
    startTick()
  } else {
    stopTick()
    save()
  }
  wx.setKeepScreenOn({ keepScreenOn: p })
  emit('state')
}

function startTick() {
  stopTick()
  timer = setInterval(tick, TICK)
}

function stopTick() {
  if (timer) clearInterval(timer)
  timer = null
}

function clearLoad() {
  if (loadTimer) clearTimeout(loadTimer)
  loadTimer = null
}

function watchLoad() {
  clearLoad()
  loadTimer = setTimeout(() => {
    if (started) return
    console.warn('音频加载超时', srcs[srcIx])
    switching = true
    ctx.stop()
    useSource(srcIx + 1, true)
  }, LOAD_TIMEOUT)
}

function useSource(i, play) {
  if (i >= srcs.length) {
    failed = true
    S.loading = false
    setPlaying(false)
    emit('state')
    wx.showModal({
      title: '音频加载失败',
      content: srcs.length ? '检查网络后点播放重试。' : '还没有配置音频地址：在 miniprogram/config.js 里填写 GitHub 仓库链接。',
      showCancel: false
    })
    return
  }
  failed = false
  srcIx = i
  wantPlay = play
  const t = started ? S.t : startAt
  started = false
  startAt = t
  seekGuard = Date.now() + 600
  ctx.startTime = t
  ctx.src = srcs[i].url
  ctx.playbackRate = S.rate // 有些机型换地址后倍速会被重置
  if (play) {
    S.loading = true
    emit('state')
    ctx.play()
    watchLoad()
  }
}

function findCue(t) {
  const cues = S.mat.cues
  let i = 0
  for (let k = 0; k < cues.length; k++) if (cues[k].start <= t + 0.05) i = k
  return i
}

function setCue(i, force) {
  if (i === S.cue && !force) return
  S.cue = i
  emit('cue')
  if (S.playing && Date.now() - lastSave > SAVE_EVERY) save()
}

function tick() {
  if (!S.mat || !started || Date.now() < seekGuard) return
  const t = ctx.currentTime
  S.t = t
  if (stopAt != null && t >= stopAt - END_EARLY) {
    stopAt = null
    ctx.pause()
    return
  }
  if (S.loop && S.cue >= 0) {
    const c = S.mat.cues[S.cue]
    if (t >= c.end - END_EARLY) {
      seek(c.start)
      return
    }
  } else {
    // 循环时当前句保持不变，只有手动跳转（seek）才会换句
    setCue(findCue(t))
  }
  emit('time')
  if (Date.now() - lastSave > SAVE_EVERY) save()
}

function save() {
  if (!S.mat || S.cue < 0) return
  progress.record(S.id, S.cue, S.mat.cues.length)
  lastSave = Date.now()
}

function stopCurrent() {
  save()
  clearLoad()
  switching = true
  ctx.stop()
  S.playing = false
  S.loading = false
  stopTick()
  wx.setKeepScreenOn({ keepScreenOn: false })
}

// 打开一份素材。已经是当前素材时不重新加载：给了 cue 就跳过去，autoplay 时暂停中的会接着播
function open(id, opts = {}) {
  ensure()
  const mat = data.get(id)
  if (!mat) return false
  if (S.id === id) {
    if (opts.cue != null) seekCue(opts.cue)
    if (opts.autoplay && !S.playing) play()
    return true
  }
  if (S.id) stopCurrent()
  const st = progress.status(id, mat.cues.length)
  const cue = opts.cue != null ? Math.min(+opts.cue, mat.cues.length - 1) : st.state === 'learning' ? st.cue : 0
  S.id = id
  S.mat = mat
  S.loop = false
  S.t = mat.cues[cue].start
  srcs = audioSource.sources(id)
  srcIx = -1
  started = false
  startAt = S.t
  failed = false
  stopAt = null
  setCue(cue, true)
  emit('load')
  useSource(0, !!opts.autoplay)
  return true
}

function play() {
  if (!S.id) return
  stopAt = null
  if (failed) return useSource(0, true)
  wantPlay = true
  ctx.play()
  if (!started) {
    S.loading = true
    emit('state')
    watchLoad()
  }
}

function pause() {
  if (ctx && S.playing) ctx.pause()
}

function toggle() {
  if (S.playing) pause()
  else play()
}

function seek(t) {
  if (!S.mat) return
  t = Math.min(Math.max(0, t), S.mat.duration - 0.05)
  stopAt = null
  if (started) {
    seekGuard = Date.now() + 500
    ctx.seek(t)
  } else {
    startAt = t
    ctx.startTime = t
  }
  S.t = t
  setCue(findCue(t))
  emit('time')
}

function seekCue(i) {
  if (!S.mat) return
  i = Math.max(0, Math.min(S.mat.cues.length - 1, i))
  seek(S.mat.cues[i].start)
}

function prev() {
  const c = S.mat.cues[S.cue]
  seekCue(S.t - c.start > 1.2 ? S.cue : S.cue - 1)
}

function next() {
  seekCue(S.cue + 1)
}

// 从第 i 句开头播到这句结束
function playCueOnce(i) {
  const c = S.mat.cues[i]
  seek(c.start)
  play()
  stopAt = c.end
}

function setLoop(v) {
  S.loop = v
  emit('state')
}

// 播放中改倍速，有些机型要暂停后重新播放才生效：等真正暂停了（onPause）再用新倍速接着播
function setRate(r) {
  if (RATES.indexOf(r) < 0 || r === S.rate) return
  ensure()
  S.rate = r
  settings.set({ rate: r })
  ctx.playbackRate = r
  emit('state')
  if (S.playing) {
    rateSwitching = true
    ctx.pause()
    clearTimeout(rateTimer)
    rateTimer = setTimeout(resumeAfterRate, 500) // 兜底：没收到 onPause 也接着播
  }
}

function resumeAfterRate() {
  if (!rateSwitching) return
  clearTimeout(rateTimer)
  rateSwitching = false
  ctx.playbackRate = S.rate
  ctx.play()
}

// 关掉播放器：停止、保存进度，迷你播放条消失
function close() {
  if (!S.id) return
  stopCurrent()
  S.id = null
  S.mat = null
  S.cue = -1
  S.t = 0
  emit('state')
  emit('close')
}

// 一句的英文原文，迷你播放条用
function cueText(c) {
  return (c.lead || '') + c.tokens.map(t => t.w + t.p).join('')
}

module.exports = {
  RATES, state, subscribe, open, play, pause, toggle, seek, seekCue, prev, next,
  playCueOnce, setLoop, setRate, close, cueText
}
