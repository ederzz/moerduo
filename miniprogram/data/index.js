// 由 scripts/material.py build 生成，不要手改
const list = [
  require('./materials/trade-war-with-canada-escalates.js'),
]

module.exports = {
  list,
  get: id => list.find(m => m.id === id)
}
