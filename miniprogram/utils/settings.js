const store = require('./store')

const KEY = 'settings:v1'
const DEFAULTS = { subtitleMode: 'bi', rate: 1, tipDismissed: false }

function get() {
  return Object.assign({}, DEFAULTS, store.get(KEY, {}))
}

function set(patch) {
  store.set(KEY, Object.assign(get(), patch))
}

module.exports = { get, set }
