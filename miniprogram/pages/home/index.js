const data = require('../../data/index')
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
  data: { cont: null, filters: [], filter: 'all', list: [], total: 0 },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ selected: 0, hidden: false })
    this.render()
  },

  render() {
    const all = data.list.map(m => {
      const st = progress.status(m.id, m.cues.length)
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
        st,
        tile: fmt.bars(m.peaks, 12).map((h, i) => ({ h, on: i < tileLit }))
      }
    })

    // 列表顺序就是 data/index.js 的顺序：按处理时间排，新的在前
    // 继续听：在学的里面最近听的一份；没有就推荐第一份没开始的；全学完就不显示
    const learning = all.filter(x => x.st.state === 'learning').sort((a, b) => b.st.updatedAt - a.st.updatedAt)
    const pick = learning[0] || all.find(x => x.st.state === 'new')
    let cont = null
    if (pick) {
      const m = data.get(pick.id)
      const lit = Math.round(48 * pick.st.pct / 100)
      cont = {
        id: pick.id,
        title: pick.title,
        titleZh: pick.titleZh,
        isNew: pick.st.state === 'new',
        cueNo: pick.st.cue + 1,
        cueCount: pick.cueCount,
        left: fmt.time(m.duration - m.cues[pick.st.cue].start),
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

  onFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.k })
    this.render()
  },

  onOpen(e) {
    wx.navigateTo({ url: '/pages/player/index?id=' + e.currentTarget.dataset.id })
  }
})
