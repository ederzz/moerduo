App({
  onLaunch() {
    // iOS 静音键打开时也能出声
    wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: false })
  }
})
