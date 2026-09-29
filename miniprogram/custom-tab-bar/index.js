Component({
  data: {
    selected: 0,
    hidden: false,
    list: [
      { path: '/pages/home/index', text: '材料', icon: 'headphones' },
      { path: '/pages/vocab/index', text: '生词本', icon: 'bookmark' }
    ]
  },
  methods: {
    go(e) {
      const i = e.currentTarget.dataset.i
      if (i !== this.data.selected) wx.switchTab({ url: this.data.list[i].path })
    }
  }
})
