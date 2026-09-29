const data = require('../../data/index')
const vocab = require('../../utils/vocab')
const notes = require('../../utils/notes')

const FILTERS = [
  { k: 'all', t: '全部' },
  { k: 'word', t: '单词' },
  { k: 'phrase', t: '短语·习语' }
]

Page({
  data: { filters: [], filter: 'all', list: [], total: 0, sheet: { show: false, items: [] }, toast: '' },

  onShow() {
    this.tabBar(true)
    this.render()
  },

  onHide() {
    this.hideToast()
  },

  tabBar(visible) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ selected: 1, hidden: !visible })
  },

  render() {
    // 素材删了或者词条改名了，对应的收藏就不显示，也不报错
    const items = vocab.list().map(v => {
      const m = data.get(v.material)
      const n = m && m.notes[v.note]
      if (!n) return null
      return {
        key: v.material + ':' + v.note,
        material: v.material,
        note: v.note,
        head: n.head,
        typeLabel: notes.TYPE[n.type],
        isWord: n.type === 'word',
        context: n.context,
        src: `${m.title} · 第 ${notes.firstCue(m, v.note) + 1} 句`
      }
    }).filter(Boolean)
    const counts = { all: items.length, word: items.filter(x => x.isWord).length }
    counts.phrase = items.length - counts.word
    const f = this.data.filter
    this.setData({
      total: items.length,
      filters: FILTERS.map(x => ({ k: x.k, t: x.t, n: counts[x.k] })),
      list: items.filter(x => f === 'all' || (f === 'word') === x.isWord)
    })
  },

  onFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.k })
    this.render()
  },

  onOpen(e) {
    const { material, note } = e.currentTarget.dataset
    const m = data.get(material)
    this.tabBar(false)
    this.setData({ sheet: { show: true, items: [notes.noteView(m, note, notes.firstCue(m, note))] } })
  },

  onSheetClose() {
    this.setData({ 'sheet.show': false })
    this.tabBar(true)
  },

  onSheetSave(e) {
    const { material, id } = e.detail
    const saved = vocab.toggle(material, id)
    this.setData({ 'sheet.items[0].saved': saved })
    this.render()
    wx.showToast({ title: saved ? '已加入生词本' : '已移出生词本', icon: 'none' })
  },

  onSheetGoSource(e) {
    const { material, cue } = e.detail
    this.onSheetClose()
    wx.navigateTo({ url: `/pages/player/index?id=${material}&cue=${cue}` })
  },

  onUnstar(e) {
    const { material, note } = e.currentTarget.dataset
    this.removed = vocab.remove(material, note)
    this.render()
    this.setData({ toast: '已移出生词本' })
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => this.hideToast(), 3200)
  },

  onUndo() {
    vocab.restore(this.removed)
    this.removed = null
    this.hideToast()
    this.render()
  },

  hideToast() {
    clearTimeout(this.toastTimer)
    if (this.data.toast) this.setData({ toast: '' })
  }
})
