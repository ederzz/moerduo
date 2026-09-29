// 生词本：只存「哪份素材的哪个词条」，释义内容从素材数据里读
const store = require('./store')

const KEY = 'vocab:v1'

function list() {
  return store.get(KEY, [])
}

function has(material, note) {
  return list().some(x => x.material === material && x.note === note)
}

function add(material, note) {
  const l = list().filter(x => !(x.material === material && x.note === note))
  l.unshift({ material, note, addedAt: Date.now() })
  store.set(KEY, l)
}

// 返回被删除的项和位置，用来撤销
function remove(material, note) {
  const l = list()
  const index = l.findIndex(x => x.material === material && x.note === note)
  if (index < 0) return null
  const [item] = l.splice(index, 1)
  store.set(KEY, l)
  return { item, index }
}

function restore(removed) {
  if (!removed) return
  const l = list()
  l.splice(removed.index, 0, removed.item)
  store.set(KEY, l)
}

// 返回切换后是否在生词本里
function toggle(material, note) {
  if (has(material, note)) {
    remove(material, note)
    return false
  }
  add(material, note)
  return true
}

module.exports = { list, has, toggle, remove, restore }
