// 释义弹层用的数据
const vocab = require('./vocab')

const TYPE = { word: '单词', phrasal: '短语动词', phrase: '短语', idiom: '习语', proper: '专有名词' }

// 原句拆成 [{ t, hl }]，s..e 这几个词高亮（中间的空格和标点一起高亮）
function sentenceRuns(cue, s, e) {
  const runs = []
  const push = (t, hl) => {
    if (!t) return
    const last = runs[runs.length - 1]
    if (last && last.hl === hl) last.t += t
    else runs.push({ t, hl })
  }
  push(cue.lead || '', false)
  cue.tokens.forEach((tok, j) => {
    push(tok.w, j >= s && j <= e)
    push(tok.p, j >= s && j < e)
  })
  return runs
}

// 点第 cueIdx 句第 k 个词时命中的词条 id，长的（短语）排前面
function idsAt(mat, cueIdx, k) {
  const ids = []
  mat.cues[cueIdx].anns
    .filter(a => a.s <= k && k <= a.e)
    .sort((x, y) => (y.e - y.s) - (x.e - x.s))
    .forEach(a => { if (ids.indexOf(a.id) < 0) ids.push(a.id) })
  return ids
}

function span(mat, cueIdx, id) {
  return mat.cues[cueIdx].anns.find(a => a.id === id) || { s: 0, e: -1 }
}

function noteView(mat, id, cueIdx) {
  const n = mat.notes[id]
  const c = mat.cues[cueIdx]
  const a = span(mat, cueIdx, id)
  return {
    id,
    material: mat.id,
    head: n.head,
    typeLabel: TYPE[n.type] || '',
    isWord: n.type === 'word' || n.type === 'proper',
    pos: n.pos,
    ipa: n.ipa,
    context: n.context,
    sections: n.sections,
    sentence: sentenceRuns(c, a.s, a.e),
    zh: c.zh,
    cue: cueIdx,
    cueNo: cueIdx + 1,
    saved: vocab.has(mat.id, id)
  }
}

function unknownView(mat, cueIdx, k) {
  const c = mat.cues[cueIdx]
  return { word: c.tokens[k].w, sentence: sentenceRuns(c, k, k), zh: c.zh, cue: cueIdx, cueNo: cueIdx + 1 }
}

// 词条第一次出现在第几句
function firstCue(mat, id) {
  const o = mat.order.find(x => x.id === id)
  return o ? o.cue : 0
}

module.exports = { TYPE, idsAt, span, noteView, unknownView, firstCue }
