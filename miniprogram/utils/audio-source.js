// 音频地址：本地缓存 → 开发者工具里的本地服务器 → jsDelivr 各个 CDN，按顺序尝试
const config = require('../config')
const store = require('./store')

const CACHE_KEY = 'audioCache:v1'
const fs = wx.getFileSystemManager()
const downloading = {}

function platform() {
  try {
    return (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()).platform
  } catch (e) {
    return ''
  }
}

function cachedPath(id) {
  const c = store.get(CACHE_KEY, {})[id]
  if (!c || c.version !== config.github.ref) return null
  try {
    fs.accessSync(c.path)
    return c.path
  } catch (e) {
    return null
  }
}

// 从仓库链接里取出用户名和仓库名，支持带 .git、末尾斜杠
function repoPath() {
  const m = /github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/.exec((config.github.repo || '').trim())
  return m ? m[1] + '/' + m[2] : ''
}

function isCached(id) {
  return !!cachedPath(id)
}

// 返回 [{ url, cacheable }]，cacheable 表示播放成功后要下载到本地
function sources(id) {
  const list = []
  const local = cachedPath(id)
  if (local) list.push({ url: local, cacheable: false })
  if (config.devBase && platform() === 'devtools') list.push({ url: config.devBase + id + '/audio.m4a', cacheable: false })
  const repo = repoPath()
  const ref = config.github.ref
  if (repo && ref) {
    config.cdnHosts.forEach(host => list.push({
      url: `https://${host}/gh/${repo}@${ref}/materials/${id}/audio.m4a`,
      cacheable: true
    }))
  }
  return list
}

// 后台下载到本地，下次离线可用。失败不影响在线播放（downloadFile 需要在小程序后台配置合法域名）
function saveToCache(id, url) {
  if (downloading[id] || cachedPath(id)) return
  downloading[id] = true
  const done = () => { delete downloading[id] }
  wx.downloadFile({
    url,
    success(res) {
      if (res.statusCode !== 200) return done()
      const filePath = `${wx.env.USER_DATA_PATH}/audio-${id}-${config.github.ref}.m4a`
      fs.saveFile({
        tempFilePath: res.tempFilePath,
        filePath,
        success() {
          const map = store.get(CACHE_KEY, {})
          const old = map[id]
          if (old && old.path !== filePath) fs.unlink({ filePath: old.path, fail() {} })
          map[id] = { path: filePath, version: config.github.ref, savedAt: Date.now() }
          store.set(CACHE_KEY, map)
          done()
        },
        fail(e) {
          console.warn('保存音频失败', e)
          done()
        }
      })
    },
    fail(e) {
      console.warn('下载音频失败', e)
      done()
    }
  })
}

module.exports = { sources, isCached, saveToCache }
