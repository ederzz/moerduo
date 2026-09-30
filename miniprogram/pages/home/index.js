const data = require('../../data/index')
const player = require('../../utils/player')
const progress = require('../../utils/progress')
const audioSource = require('../../utils/audio-source')
const fmt = require('../../utils/format')

const FILTERS = [
  { k: 'all', t: '全部' },
  { k: 'learning', t: '在学' },
  { k: 'new', t: '未开始' },
  { k: 'done', t: '已学完' }
]

Page({
  data: { cont: null, filters: [], filter: 'all', list: [], total: 0, mini: false },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ selected: 0, hidden: false })
    // 播放器的句子、播放状态变了就重新渲染；播放位置每秒变很多次，只更新卡片上的剩余时间
    if (!this.unsub) {
      this.unsub = player.subscribe(type => {
        if (type === 'time') this.updateLeft()
        else this.render()
      })
    }
    this.render()
  },

  onHide() {
    if (this.unsub) this.unsub()
    this.unsub = null
  },

  render() {
    const ps = player.state()
    const all = data.list.map(m => {
      const st = progress.status(m.id, m.cues.length)
      const active = ps.id === m.id
      // 正在播的素材，进度按当前句实时算（存储里的进度最多每 3 秒写一次）
      if (active && st.state !== 'done') {
        st.state = 'learning'
        st.pct = Math.max(st.pct, Math.round((ps.cue + 1) / m.cues.length * 100))
      }
      const tileLit = Math.round(12 * st.pct / 100)
      return {
        id: m.id,
        title: m.title,
        titleZh: m.titleZh,
        tag: m.tags[0] || '',
        level: m.level,
        dur: fmt.time(m.duration),
        added: fmt.date(m.addedAt),
        cueCount: m.cues.length,
        noteCount: Object.keys(m.notes).length,
        offline: audioSource.isCached(m.id),
        active,
        playing: active && ps.playing,
        st,
        tile: fmt.bars(m.peaks, 12).map((h, i) => ({ h, on: i < tileLit }))
      }
    })

    // 顶部卡片：播放器里有素材就显示它（正在播放 / 已暂停）；
    // 没有的话显示在学的里面最近听的一份，再没有就推荐第一份没开始的
    let pick = ps.id ? all.find(x => x.id === ps.id) : null
    if (!pick) {
      const learning = all.filter(x => x.st.state === 'learning').sort((a, b) => b.st.updatedAt - a.st.updatedAt)
      pick = learning[0] || all.find(x => x.st.state === 'new')
    }
    let cont = null
    if (pick) {
      const m = data.get(pick.id)
      const live = pick.active
      const cue = live ? ps.cue : pick.st.cue
      const pos = live ? ps.t : m.cues[cue].start
      const lit = Math.round(48 * (live ? pos / m.duration : pick.st.pct / 100))
      cont = {
        id: pick.id,
        title: pick.title,
        titleZh: pick.titleZh,
        live,
        playing: live && ps.playing,
        label: live ? (ps.playing ? '正在播放' : '已暂停') : pick.st.state === 'new' ? '开始听' : '继续听',
        cueNo: cue + 1,
        cueCount: pick.cueCount,
        left: fmt.time(m.duration - pos),
        bars: fmt.bars(m.peaks, 48).map((h, i) => ({ h, on: i < lit }))
      }
    }

    const counts = { all: all.length, learning: 0, new: 0, done: 0 }
    all.forEach(x => { counts[x.st.state]++ })
    const f = this.data.filter
    this.setData({
      cont,
      total: all.length,
      filters: FILTERS.map(x => ({ k: x.k, t: x.t, n: counts[x.k] })),
      list: all.filter(x => f === 'all' || x.st.state === f)
    })
  },

  updateLeft() {
    const ps = player.state()
    const c = this.data.cont
    if (!c || !c.live || ps.id !== c.id) return
    const left = fmt.time(ps.mat.duration - ps.t)
    if (left !== c.left) this.setData({ 'cont.left': left })
  },

  onFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.k })
    this.render()
  },

  onOpen(e) {
    wx.navigateTo({ url: '/pages/player/index?id=' + e.currentTarget.dataset.id })
  },

  // 点卡片空白处：进播放页，正在播的素材不改变播放状态
  onContOpen() {
    const c = this.data.cont
    wx.navigateTo({ url: `/pages/player/index?id=${c.id}` + (c.live ? '&autoplay=0' : '') })
  },

  // 卡片上的按钮：正在播的就暂停/继续，没在播的就打开并开始播
  onContPlay() {
    const c = this.data.cont
    if (c.live) player.toggle()
    else wx.navigateTo({ url: '/pages/player/index?id=' + c.id })
  },

  onMini(e) {
    this.setData({ mini: e.detail.show })
  }
})
