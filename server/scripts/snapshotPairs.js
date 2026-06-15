/**
 * snapshotPairs.js — 匹配结果基线快照 + 可选「对比基线」summary
 *
 * 作用：对指定 case 调用 server 的真实匹配流程，把当前算法跑出的 pairs + 指标落盘到
 *       test/<SNAPSHOT_DIR>/<platform>/<caseId>.json。
 *       若指定了 COMPARE_BASE，跑完再生成 summary.json：与基线逐 case 对比准确率/召回率/
 *       多余对的增减，并汇总与验证集的剩余差距。
 *
 * 依赖：server 必须已在 3012 端口运行（cd server && npm run dev）。本脚本不启动 server。
 *
 * 环境变量：
 *   SNAPSHOT_DIR  test 下的输出目录名，默认 matchNewTemp
 *   COMPARE_BASE  对比基线目录名（如 matchNewTemp），不设则不生成 summary
 *   PLATFORM      平台，默认 hmPhone
 *   SERVER        server 地址，默认 http://localhost:3012
 *
 * 用法：
 *   cd server
 *   node scripts/snapshotPairs.js                       # 默认刷新 matchNewTemp 基线（case1..12）
 *   SNAPSHOT_DIR=matchNewTemp-06-11-19-21 COMPARE_BASE=matchNewTemp node scripts/snapshotPairs.js
 *                                                       # 跑到带时间后缀的新目录并对比基线出 summary
 *   node scripts/snapshotPairs.js case6 case11          # 仅指定 case
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '../..')
const SERVER = process.env.SERVER || 'http://localhost:3012'
const PLATFORM = process.env.PLATFORM || 'hmPhone'
const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR || 'matchNewTemp'
const COMPARE_BASE = process.env.COMPARE_BASE || ''

const cases = process.argv.slice(2).length
  ? process.argv.slice(2)
  : Array.from({ length: 15 }, (_, i) => `case${i + 1}`)

const outDir = join(ROOT, 'test', SNAPSHOT_DIR, PLATFORM)

const label = n => {
  const t = (n.textContent || '').trim()
  return t ? JSON.stringify(t.slice(0, 20)) : `[${n.rawType || n.type}]`
}

const round4 = x => Math.round(x * 10000) / 10000
const fmt = d => (d == null ? 'n/a' : (d > 0 ? '+' : '') + d)

// 对照验证集（arkui.id -> 期望 design.id）计算指标
//   correct  命中且正确（TP）；wrong 配错；miss 漏匹配；redundant 多余对（arkui 不在验证集）
//   precision = correct / 产出总对数；recall = correct / 验证集期望对数
const computeMetrics = (pairs, validation) => {
  const v = validation || {}
  const validationTotal = Object.keys(v).length
  let correct = 0, wrong = 0
  for (const p of pairs) {
    const exp = v[p.arkui]
    if (exp === undefined) continue
    if (exp === p.design) correct++
    else wrong++
  }
  const redundant = pairs.length - correct - wrong
  const miss = validationTotal - correct - wrong
  return {
    validationTotal, correct, wrong, miss, redundant,
    precision: pairs.length ? round4(correct / pairs.length) : 0,
    recall: validationTotal ? round4(correct / validationTotal) : 0,
  }
}

// ── 健康检查（不通则提示用户手动启动，AI/脚本不代启）──────────────────────────
try {
  const h = await fetch(`${SERVER}/api/cases`)
  if (!h.ok) throw new Error('HTTP ' + h.status)
} catch (e) {
  console.error(`❌ 无法连接 server（${SERVER}）：${e.message}`)
  console.error('   请先手动启动：cd server && npm run dev')
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })

const collected = {}  // caseId -> metrics
let done = 0
for (const c of cases) {
  try {
    const res = await fetch(`${SERVER}/api/check/case/${c}?platform=${PLATFORM}`, { method: 'POST' })
    const r = await res.json()
    if (r.error) { console.log(`${c.padEnd(8)} ❌ ${r.error}`); continue }

    const pairs = r.pairs
      .map(p => ({
        design: p.design.id,
        arkui: p.arkui.id,
        matchType: p.matchType,
        confidence: p.confidence ?? null,
        topologyScore: p.topologyScore ?? null,
        iou: p.iou ?? null,
        designLabel: label(p.design),
        arkuiLabel: label(p.arkui),
      }))
      .sort((a, b) =>
        a.design < b.design ? -1 :
        a.design > b.design ? 1 :
        a.arkui < b.arkui ? -1 : 1
      )

    const metrics = computeMetrics(pairs, r.matchValidation)
    collected[c] = metrics

    writeFileSync(
      join(outDir, `${c}.json`),
      JSON.stringify({
        caseId: c, platform: PLATFORM,
        generatedAt: new Date().toISOString(),
        pairCount: pairs.length, metrics, pairs,
      }, null, 2)
    )
    done++
    console.log(`${c.padEnd(8)} ✓ ${pairs.length} pairs  准确率 ${metrics.precision}  召回率 ${metrics.recall}  多余 ${metrics.redundant}`)
  } catch (e) {
    console.log(`${c.padEnd(8)} ❌ ${e.message}`)
  }
}

console.log(`\n完成：${done}/${cases.length} 个 case 已写入 ${outDir}`)

// ── 对比基线，生成 summary.json ──────────────────────────────────────────────
if (COMPARE_BASE) {
  const baseDir = join(ROOT, 'test', COMPARE_BASE, PLATFORM)
  const readBase = c => {
    const p = join(baseDir, `${c}.json`)
    if (!existsSync(p)) return null
    try { return JSON.parse(readFileSync(p, 'utf8')).metrics } catch { return null }
  }

  const summaryCases = {}
  let n = 0, sumP = 0, sumR = 0, sumPBase = 0, sumRBase = 0
  let totCorrect = 0, totWrong = 0, totRedundant = 0, totMiss = 0, totCorrectBase = 0

  for (const c of cases) {
    const cur = collected[c]
    if (!cur) continue
    const base = readBase(c)
    summaryCases[c] = {
      precision: cur.precision,
      precisionDelta: base ? round4(cur.precision - base.precision) : null,
      recall: cur.recall,
      recallDelta: base ? round4(cur.recall - base.recall) : null,
      redundant: cur.redundant,
      redundantDelta: base ? cur.redundant - base.redundant : null,
      // 与验证集的剩余差距：配错 + 漏匹配
      gapToValidation: cur.wrong + cur.miss,
      correct: cur.correct,
      wrong: cur.wrong,
      miss: cur.miss,
      validationTotal: cur.validationTotal,
    }
    n++; sumP += cur.precision; sumR += cur.recall
    totCorrect += cur.correct; totWrong += cur.wrong; totRedundant += cur.redundant; totMiss += cur.miss
    if (base) { sumPBase += base.precision; sumRBase += base.recall; totCorrectBase += base.correct }
  }

  const overall = {
    cases: n,
    avgPrecision: round4(sumP / n),
    avgPrecisionDelta: round4((sumP - sumPBase) / n),
    avgRecall: round4(sumR / n),
    avgRecallDelta: round4((sumR - sumRBase) / n),
    totalCorrect: totCorrect,
    totalCorrectDelta: totCorrect - totCorrectBase,
    totalWrong: totWrong,
    totalRedundant: totRedundant,
    totalMiss: totMiss,
    totalGapToValidation: totWrong + totMiss,
  }

  writeFileSync(
    join(outDir, 'summary.json'),
    JSON.stringify({
      platform: PLATFORM,
      snapshotDir: SNAPSHOT_DIR,
      comparedAgainst: COMPARE_BASE,
      generatedAt: new Date().toISOString(),
      note: 'delta 为本次相对基线的变化：precision/recall 正=提高；redundant 负=多余对减少；gapToValidation=配错+漏匹配，越小越好',
      overall,
      cases: summaryCases,
    }, null, 2)
  )

  console.log(`\nsummary.json 已生成（对比基线 ${COMPARE_BASE}）：`)
  console.log(`  平均准确率 ${overall.avgPrecision} (${fmt(overall.avgPrecisionDelta)})   平均召回率 ${overall.avgRecall} (${fmt(overall.avgRecallDelta)})`)
  console.log(`  正确对总数 ${overall.totalCorrect} (${fmt(overall.totalCorrectDelta)})   与验证集差距(配错+漏) ${overall.totalGapToValidation}   多余对总数 ${overall.totalRedundant}`)
}
