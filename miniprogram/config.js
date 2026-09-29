// 音频放在 GitHub 公开仓库，通过 jsDelivr CDN 访问
module.exports = {
  github: {
    // 仓库链接，直接粘贴，例如 https://github.com/yourname/moerduo 。必须是公开仓库，填好后真机才能播放
    repo: 'https://github.com/ederzz/moerduo',
    // 用 git tag，不要用分支名（jsDelivr 对分支有缓存延迟）。
    // 新增或更新音频后：打新 tag 推送，再改这里，重新上传体验版
    ref: 'v1'
  },
  // 第一个加载失败时依次尝试下一个
  cdnHosts: ['cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net'],
  // 只在开发者工具里使用：在仓库根目录运行 python3 -m http.server 8765，就能直接播放本地的 materials/
  devBase: 'http://127.0.0.1:8765/materials/'
}
