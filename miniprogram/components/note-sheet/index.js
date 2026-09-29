// 释义弹层。页面传入要显示的词条，操作通过事件交给页面处理：
// close / tab / prev / next / replay / gosrc / save
Component({
  properties: {
    show: { type: Boolean, value: false },
    items: { type: Array, value: [] }, // notes.noteView() 的结果，多个时顶部显示标签
    active: { type: Number, value: 0 },
    unknown: { type: Object, value: null }, // 点了没有释义的词时：notes.unknownView() 的结果
    ctx: { type: String, value: 'player' }, // player：可以重听、切换上下一个；vocab：去原文听
    navText: { type: String, value: '' },
    canPrev: { type: Boolean, value: false },
    canNext: { type: Boolean, value: false }
  },
  data: { cur: null, scrollTop: 0 },
  observers: {
    'items, active': function (items, active) {
      this.setData({ cur: items[active] || null, scrollTop: this.data.scrollTop ? 0 : 0.1 })
    }
  },
  methods: {
    noop() {},
    close() { this.triggerEvent('close') },
    onTab(e) { this.triggerEvent('tab', { index: e.currentTarget.dataset.i }) },
    onPrev() { if (this.data.canPrev) this.triggerEvent('prev') },
    onNext() { if (this.data.canNext) this.triggerEvent('next') },
    onReplay() {
      const x = this.data.cur || this.data.unknown
      this.triggerEvent('replay', { cue: x.cue })
    },
    onGoSource() {
      const x = this.data.cur
      this.triggerEvent('gosrc', { material: x.material, cue: x.cue })
    },
    onSave() {
      const x = this.data.cur
      this.triggerEvent('save', { material: x.material, id: x.id })
    }
  }
})
