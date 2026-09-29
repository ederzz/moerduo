// 学习进度，格式见 docs/04-学习状态.md。只存发生过的事，状态在 status() 里算出来
const store = require('./store')

const KEY = 'progress:v1'

function all() {
  return store.get(KEY, {})
}

function get(id) {
  return all()[id] || null
}

// 返回 { state: 'new' | 'learning' | 'done', pct, cue, updatedAt }
function status(id, cueCount) {
  const p = get(id)
  if (!p) return { state: 'new', pct: 0, cue: 0, updatedAt: 0 }
  const last = Math.max(0, Math.min(p.lastCue, cueCount - 1))
  if (p.completedAt) return { state: 'done', pct: 100, cue: last, updatedAt: p.updatedAt }
  const max = Math.max(0, Math.min(p.maxCue, cueCount - 1))
  return { state: 'learning', pct: Math.round((max + 1) / cueCount * 100), cue: last, updatedAt: p.updatedAt }
}

function entry(map, id, cueCount) {
  const p = map[id] || { lastCue: 0, maxCue: -1, cueCount, completedAt: null, updatedAt: 0 }
  if (p.cueCount !== cueCount) {
    // 素材改过、句数变了：把进度限制在新的范围内
    p.lastCue = Math.min(p.lastCue, cueCount - 1)
    p.maxCue = Math.min(p.maxCue, cueCount - 1)
    p.cueCount = cueCount
  }
  map[id] = p
  return p
}

function record(id, cue, cueCount) {
  const map = all()
  const p = entry(map, id, cueCount)
  p.lastCue = cue
  p.maxCue = Math.max(p.maxCue, cue)
  p.updatedAt = Date.now()
  store.set(KEY, map)
}

function complete(id, cueCount) {
  const map = all()
  const p = entry(map, id, cueCount)
  p.maxCue = cueCount - 1
  p.completedAt = p.completedAt || Date.now()
  p.updatedAt = Date.now()
  store.set(KEY, map)
}

module.exports = { status, record, complete }
