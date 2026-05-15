// 临时调试脚本：验证 Pass 4.5 list-index 改造对 case1 的影响
import { readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

import { parseDesign } from '../src/parsers/design/index.js'
import { parseArkui }  from '../src/parsers/arkui/index.js'
import { matchNodes }  from '../src/matchers/nodeMatcher.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const caseDir = resolve(__dirname, '../../case/case1')

const designJson = JSON.parse(readFileSync(join(caseDir, 'design.json'), 'utf-8'))
const arkuiJson  = JSON.parse(readFileSync(join(caseDir, 'arkui.json'),  'utf-8'))

const [d, a] = await Promise.all([
  parseDesign(designJson, { imageBuffer: readFileSync(join(caseDir, 'design.png')) }),
  parseArkui(arkuiJson,   { imageBuffer: readFileSync(join(caseDir, 'arkui.png')) }),
])

// 解析后 ArkUI 侧所有 Column 节点（看 1880/1894/1901 是否保留）
console.log('=== 解析后 ArkUI 侧 Column 节点 ===')
const cols = a.nodes.filter(n => String(n.rawType || '').toLowerCase() === 'column')
for (const c of cols) {
  const r = c.normRect
  console.log(`  id=${c.id}  normRect=(${r.x.toFixed(3)},${r.y.toFixed(3)},${r.w.toFixed(3)}x${r.h.toFixed(3)})`)
}

// 解析后设计侧目标节点
console.log('\n=== 解析后 Design 14:2253 / 14:2255 ===')
for (const guid of ['14:2253', '14:2255']) {
  const n = d.nodes.find(x => x.id === guid)
  if (n) {
    const r = n.normRect
    console.log(`  guid=${guid}  rawType=${n.rawType}  normRect=(${r.x.toFixed(3)},${r.y.toFixed(3)},${r.w.toFixed(3)}x${r.h.toFixed(3)})`)
  } else {
    console.log(`  guid=${guid}  【已被解析流水线剔除】`)
  }
}

const result = matchNodes(d.nodes, a.nodes, { primarySource: 'arkui' })

console.log('\n=== case1 关键节点匹配结果 ===')
const focus = ['14:2253', '14:2255']
for (const guid of focus) {
  const pair = result.pairs.find(p => p.design.id === guid)
  if (pair) {
    console.log(`  ${guid} → ArkUI ${pair.arkui.id} (${pair.arkui.rawType}) | ${pair.matchType} | ${pair.confidence} | iou=${pair.iou}`)
  } else {
    console.log(`  ${guid} → 未匹配`)
  }
}

// ArkUI 侧 1884/1899/1901
console.log('\n=== ArkUI 1884/1899/1901 匹配结果 ===')
for (const id of ['1884', '1899', '1901']) {
  const pair = result.pairs.find(p => String(p.arkui.id) === id)
  if (pair) {
    console.log(`  ArkUI ${id} → Design ${pair.design.id} (${pair.design.name}) | ${pair.matchType}`)
  } else {
    console.log(`  ArkUI ${id} → 未匹配`)
  }
}

// 14:2254/14:2256/1880/1894 是否出现在结果里
console.log('\n=== 14:2254 / 14:2256 / 1880 / 1894 是否被任何 pair 匹配 ===')
for (const guid of ['14:2254', '14:2256']) {
  const p = result.pairs.find(x => x.design.id === guid)
  console.log(`  Design ${guid} → ${p ? `ArkUI ${p.arkui.id} | ${p.matchType}` : '未匹配'}`)
}
for (const id of ['1880', '1894']) {
  const p = result.pairs.find(x => String(x.arkui.id) === id)
  console.log(`  ArkUI ${id} → ${p ? `Design ${p.design.id} | ${p.matchType}` : '未匹配'}`)
}

// matchType 分布
console.log('\n=== matchType 分布 ===')
const typeCount = {}
for (const p of result.pairs) typeCount[p.matchType] = (typeCount[p.matchType] || 0) + 1
for (const [t, n] of Object.entries(typeCount).sort((a,b)=>b[1]-a[1])) console.log(`  ${t}: ${n}`)

// 任何 list-index 匹配对
const listPairs = result.pairs.filter(p => p.matchType === 'list-index')
console.log(`\n=== list-index 匹配对总数：${listPairs.length} ===`)
for (const p of listPairs) {
  console.log(`  ${p.design.id} ↔ ${p.arkui.id}`)
}

console.log('\n=== 匹配总数 ===')
console.log('total pairs:', result.pairs.length)
console.log('unmatched design:', result.unmatchedDesign.length)
console.log('unmatched arkui:', result.unmatchedArkui.length)
