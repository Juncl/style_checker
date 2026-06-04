/**
 * 对比 ArkUI JSON 与 ArkUI Dump 两种格式解析后的节点数量。
 *
 * 用法：
 *   node scripts/compareDumpVsJson.js [caseId]
 *
 * 默认 caseId=case12。
 *
 * 依赖：server 已在 localhost:3012 启动。
 * 调用接口：
 *   GET /api/debug/parse/<caseId>?platform=hmPhone        (JSON 路径)
 *   GET /api/debug/parse/<caseId>?platform=hmPhone-dump   (Dump 路径)
 *
 * 输出：
 *   - 两侧 arkuiNodes / designNodes 数量
 *   - arkui 节点 type / rawType 分布
 *   - 文本节点内容集合差异
 */

const SERVER = 'http://localhost:3012'

const caseId = process.argv[2] || 'case12'

async function fetchParsed(platform) {
  let res
  try {
    res = await fetch(`${SERVER}/api/debug/parse/${caseId}?platform=${platform}`)
  } catch {
    console.error(`❌ 无法连接 server (${SERVER})，先 cd server && npm run dev`)
    process.exit(1)
  }
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}))
    console.error(`❌ 解析失败 (platform=${platform})：${error || res.statusText}`)
    process.exit(1)
  }
  return res.json()
}

function typeHistogram(nodes) {
  const m = new Map()
  for (const n of nodes) {
    const k = n.type || '(none)'
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

function rawTypeHistogram(nodes) {
  const m = new Map()
  for (const n of nodes) {
    const k = n.rawType || '(none)'
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

function printHist(title, hist, max = 999) {
  console.log(`  -- ${title} --`)
  for (const [k, v] of hist.slice(0, max)) console.log(`     ${String(k).padEnd(20)} ${v}`)
}

async function main() {
  console.log(`Case: ${caseId}`)
  console.log(`Server: ${SERVER}`)

  const [jsonRes, dumpRes] = await Promise.all([
    fetchParsed('hmPhone'),
    fetchParsed('hmPhone-dump'),
  ])

  console.log('\n========== 节点数量对比 ==========')
  console.log(`                 designNodes     arkuiNodes`)
  console.log(`  hmPhone (JSON)   ${String(jsonRes.designNodes.length).padEnd(12)}    ${jsonRes.arkuiNodes.length}`)
  console.log(`  hmPhone-dump     ${String(dumpRes.designNodes.length).padEnd(12)}    ${dumpRes.arkuiNodes.length}`)
  console.log(`  差值             ${String(dumpRes.designNodes.length - jsonRes.designNodes.length).padEnd(12)}    ${dumpRes.arkuiNodes.length - jsonRes.arkuiNodes.length}`)
  console.log(`  画布 (vp)        JSON=${jsonRes.canvasWidthVp.toFixed(1)}x${jsonRes.canvasHeightVp.toFixed(1)}   Dump=${dumpRes.canvasWidthVp.toFixed(1)}x${dumpRes.canvasHeightVp.toFixed(1)}`)

  // ── arkui 节点类型 / rawType 分布 ─────────────────────────────────────────
  console.log('\n========== ArkUI 节点 type / rawType 分布 ==========')
  console.log('\n[JSON 路径]')
  printHist('type', typeHistogram(jsonRes.arkuiNodes))
  printHist('rawType (top 20)', rawTypeHistogram(jsonRes.arkuiNodes), 20)

  console.log('\n[Dump 路径]')
  printHist('type', typeHistogram(dumpRes.arkuiNodes))
  printHist('rawType (top 20)', rawTypeHistogram(dumpRes.arkuiNodes), 20)

  // ── rawType 差异 ───────────────────────────────────────────────────────────
  const jsonRawMap = new Map(rawTypeHistogram(jsonRes.arkuiNodes))
  const dumpRawMap = new Map(rawTypeHistogram(dumpRes.arkuiNodes))
  const allRaw = new Set([...jsonRawMap.keys(), ...dumpRawMap.keys()])
  console.log('\n========== ArkUI rawType 差异 (Dump - JSON) ==========')
  const diffRows = [...allRaw].map(k => ({
    k,
    j: jsonRawMap.get(k) || 0,
    d: dumpRawMap.get(k) || 0,
    diff: (dumpRawMap.get(k) || 0) - (jsonRawMap.get(k) || 0),
  })).filter(r => r.diff !== 0).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
  if (!diffRows.length) {
    console.log('  ✅ rawType 完全一致')
  } else {
    console.log(`  rawType              JSON   Dump   Diff`)
    for (const r of diffRows) {
      const sign = r.diff > 0 ? '+' : ''
      console.log(`  ${r.k.padEnd(20)} ${String(r.j).padEnd(6)} ${String(r.d).padEnd(6)} ${sign}${r.diff}`)
    }
  }

  // ── 文本节点内容对比 ──────────────────────────────────────────────────────
  const jsonTexts = jsonRes.arkuiNodes.filter(n => n.type === 'text').map(n => (n.textContent || '').trim()).filter(Boolean)
  const dumpTexts = dumpRes.arkuiNodes.filter(n => n.type === 'text').map(n => (n.textContent || '').trim()).filter(Boolean)
  const jsonBag = countBag(jsonTexts)
  const dumpBag = countBag(dumpTexts)

  console.log('\n========== ArkUI 文本节点 textContent 对比 ==========')
  console.log(`  JSON 文本节点 = ${jsonTexts.length}，唯一文本 = ${jsonBag.size}`)
  console.log(`  Dump 文本节点 = ${dumpTexts.length}，唯一文本 = ${dumpBag.size}`)

  const diff = bagDiff(jsonBag, dumpBag)
  if (!diff.onlyA.length && !diff.onlyB.length && !diff.countDiff.length) {
    console.log('  ✅ 文本节点集合完全一致')
  } else {
    if (diff.onlyA.length) {
      console.log(`  -- 仅 JSON 出现 (${diff.onlyA.length}) --`)
      for (const t of diff.onlyA.slice(0, 30)) console.log(`     ${JSON.stringify(t)}`)
      if (diff.onlyA.length > 30) console.log(`     ... 还有 ${diff.onlyA.length - 30} 条`)
    }
    if (diff.onlyB.length) {
      console.log(`  -- 仅 Dump 出现 (${diff.onlyB.length}) --`)
      for (const t of diff.onlyB.slice(0, 30)) console.log(`     ${JSON.stringify(t)}`)
      if (diff.onlyB.length > 30) console.log(`     ... 还有 ${diff.onlyB.length - 30} 条`)
    }
    if (diff.countDiff.length) {
      console.log(`  -- 计数不一致 (${diff.countDiff.length}) --`)
      for (const r of diff.countDiff.slice(0, 30)) {
        console.log(`     ${JSON.stringify(r.text)}  JSON=${r.a}  Dump=${r.b}`)
      }
    }
  }
}

function countBag(arr) {
  const m = new Map()
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1)
  return m
}

function bagDiff(a, b) {
  const onlyA = [], onlyB = [], countDiff = []
  for (const [k, v] of a) {
    if (!b.has(k)) onlyA.push(k)
    else if (b.get(k) !== v) countDiff.push({ text: k, a: v, b: b.get(k) })
  }
  for (const k of b.keys()) if (!a.has(k)) onlyB.push(k)
  return { onlyA, onlyB, countDiff }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
