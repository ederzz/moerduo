// 本地存储的薄封装：读失败返回默认值，写失败只打日志，不影响使用
function get(key, fallback) {
  try {
    const v = wx.getStorageSync(key)
    return v === '' || v === undefined || v === null ? fallback : v
  } catch (e) {
    return fallback
  }
}

function set(key, value) {
  try {
    wx.setStorageSync(key, value)
  } catch (e) {
    console.warn('本地存储写入失败', key, e)
  }
}

module.exports = { get, set }
