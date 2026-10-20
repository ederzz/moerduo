// 迷你播放条：显示在首页和生词本底部，离开播放页后还能看到并控制正在播的素材。
// 显示或隐藏时触发 visible 事件，页面据此留出底部空间
const player = require('../../utils/player')

Component({
  data: { show: false, title: '', line: '', playing: false, loading: false, pct: 0 },

  lifetimes: {
    attached() { this.listen() },
    detached() { this.unlisten() }
  },

  // 页面被盖住（比如进了播放页）时不再更新，回来时再同步一次
  pageLifetimes: {
    show() { this.listen() },
    hide() { this.unlisten() }
  },

  methods: {
    listen() {
      if (this.unsub) return
      this.unsub = player.subscribe((type, st) => this.update(type, st))
      this.update('load', player.state())
    },

    unlisten() {
      if (this.unsub) this.unsub()
      this.unsub = null
    },

    update(type, st) {
      if (!st.id) {
        if (this.data.show) {
          this.setData({ show: false })
          this.triggerEvent('visible', { show: false })
        }
        return
      }
      const up = {}
      if (type !== 'time' || !this.data.show) {
        const c = st.mat.cues[st.cue]
        up.title = st.mat.title
        up.line = c ? player.cueText(c) : ''
        up.playing = st.playing
        up.loading = st.loading
        if (!this.data.show) {
          up.show = true
          this.triggerEvent('visible', { show: true })
        }
      }
      const pct = Math.round(st.t / st.mat.duration * 1000) / 10
      if (pct !== this.data.pct) up.pct = pct
      if (Object.keys(up).length) this.setData(up)
    },

    onOpen() {
      wx.navigateTo({ url: '/pages/player/index?id=' + player.state().id })
    },

    onToggle() {
      player.toggle()
    },

    onClose() {
      player.close()
    }
  }
})
