function time(t) {
  t = Math.max(0, t || 0)
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return m + ':' + (s < 10 ? '0' : '') + s
}

// 把波形峰值压缩成 n 根柱子，取每组的最大值
function bars(peaks, n) {
  const out = []
  const step = peaks.length / n
  for (let i = 0; i < n; i++) {
    let mx = 0
    for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) mx = Math.max(mx, peaks[j])
    out.push(Math.round(mx * 100))
  }
  return out
}

// ISO 时间 → 「9月29日」，不是今年的加上年份
function date(iso) {
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}年${md}`
}

module.exports = { time, bars, date }
