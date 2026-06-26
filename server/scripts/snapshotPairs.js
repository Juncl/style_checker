/**
 * snapshotPairs.js — 匹配结果基线快照 + 对比 summary.md
 *
 * 作用：对指定 case 调用 server 的真实匹配流程，把当前算法跑出的 pairs + 指标落盘到
 *       test/<SNAPSHOT_DIR>/<platform>/<caseId>.json。
 *       自动与 test/matchNewTemp 基线对比，生成完整的 summary.md 报告。
 *
 * 依赖：server 必须已在 3012 端口运行（cd server && npm run dev）。本脚本不启动 server。
 *
 * 环境变量：
 *   SNAPSHOT_DIR  test 下的输出目录名，默认 matchNewTemp-<月-日-时-分>
 *   COMPARE_BASE  对比基线目录名，默认 matchNewTemp；设空跳过对比
 *   PLATFORM      平台，默认 hmPhone
 *   SERVER        server 地址，默认 http://localhost:3012
 *
 * 用法：
 *   cd server && node scripts/snapshotPairs.js          # 默认跑全量15case，带时间戳目录，对比 matchNewTemp
 *   node scripts/snapshotPairs.js case6 case11          # 仅指定 case
 *   COMPARE_BASE= node scripts/snapshotPairs.js         # 不对比基线
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '../..')
const SERVER = process.env.SERVER || 'http://localhost:3012'
const PLATFORM = process.env.PLATFORM || 'hmPhone'
const now = new Date()
const ts = `${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`
const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR || `matchNewTemp-${ts}`
const COMPARE_BASE = process.env.COMPARE_BASE === undefined ? 'matchNewTemp' : (process.env.COMPARE_BASE || '')

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
const cell = (val, delta) => delta == null || delta === 0 ? String(val) : `${val} (${fmt(delta)})`

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
const passStats = {}  // matchType -> { total, correct, wrong, redundant, cases: Set, wrongCases: Set, redundantCases: Set }
const caseProblems = {} // caseId -> { wrong: [], miss: [], redundant: [] }
const trackPass = (mt, status, caseId) => {
  if (!passStats[mt]) passStats[mt] = { total: 0, correct: 0, wrong: 0, redundant: 0, cases: new Set(), wrongCases: new Set(), redundantCases: new Set() }
  passStats[mt].total++
  passStats[mt].cases.add(caseId)
  if (status === 'correct') passStats[mt].correct++
  else if (status === 'wrong') { passStats[mt].wrong++; passStats[mt].wrongCases.add(caseId) }
  else { passStats[mt].redundant++; passStats[mt].redundantCases.add(caseId) }
}
const addProblem = (caseId, type, entry) => {
  if (!caseProblems[caseId]) caseProblems[caseId] = { wrong: [], miss: [], redundant: [] }
  caseProblems[caseId][type].push(entry)
}
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
        matchType: p.matchDetail?.type ?? p.matchType,
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

    // 按 matchType 统计 pass 分布 + 记录问题明细
    const v = r.matchValidation || {}
    for (const p of pairs) {
      const exp = v[p.arkui]
      const st = exp === undefined ? 'redundant' : exp === p.design ? 'correct' : 'wrong'
      trackPass(p.matchType, st, c)
      if (st === 'wrong') addProblem(c, 'wrong', { arkui: p.arkui, actual: p.design, expected: exp, matchType: p.matchType })
      else if (st === 'redundant') addProblem(c, 'redundant', { arkui: p.arkui, design: p.design, matchType: p.matchType })
    }
    // 缺失：验证集中有、pairs 中没有
    const pairedArkui = new Set(pairs.map(p => p.arkui))
    for (const [arkui, expDesign] of Object.entries(v)) {
      if (!pairedArkui.has(arkui)) addProblem(c, 'miss', { arkui, expected: expDesign })
    }

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
const summaryCases = {}
let overall = null
if (COMPARE_BASE) {
  const baseDir = join(ROOT, 'test', COMPARE_BASE, PLATFORM)
  const readBase = c => {
    const p = join(baseDir, `${c}.json`)
    if (!existsSync(p)) return null
    try { return JSON.parse(readFileSync(p, 'utf8')).metrics } catch { return null }
  }

  let n = 0, sumP = 0, sumR = 0, nBase = 0, sumPDelta = 0, sumRDelta = 0
  let totCorrect = 0, totWrong = 0, totRedundant = 0, totMiss = 0, totCorrectBase = 0
  let microBasePairs = 0, microBaseVal = 0, microCurPairs = 0, microCurCorrect = 0

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
      correct: cur.correct,
      correctDelta: base ? cur.correct - base.correct : null,
      wrong: cur.wrong,
      wrongDelta: base ? cur.wrong - base.wrong : null,
      miss: cur.miss,
      missDelta: base ? cur.miss - base.miss : null,
      validationTotal: cur.validationTotal,
      gapToValidation: cur.wrong + cur.miss,
    }
    n++; sumP += cur.precision; sumR += cur.recall
    totCorrect += cur.correct; totWrong += cur.wrong; totRedundant += cur.redundant; totMiss += cur.miss
    if (base) {
      nBase++; sumPDelta += cur.precision - base.precision; sumRDelta += cur.recall - base.recall; totCorrectBase += base.correct
      microBasePairs += base.correct + base.wrong + base.redundant
      microBaseVal += base.validationTotal
      microCurPairs += cur.correct + cur.wrong + cur.redundant
      microCurCorrect += cur.correct
    }
  }

  const totalPrecision = round4(totCorrect / (totCorrect + totWrong + totRedundant))
  const totalRecall = round4(totCorrect / (totCorrect + totMiss + totWrong))
  const totalPrecisionDelta = nBase ? round4(microCurCorrect / microCurPairs - totCorrectBase / microBasePairs) : null
  const totalRecallDelta = nBase ? round4(microCurCorrect / microBaseVal - totCorrectBase / microBaseVal) : null

  overall = {
    cases: n,
    avgPrecision: round4(sumP / n),
    avgPrecisionDelta: nBase ? round4(sumPDelta / nBase) : null,
    avgRecall: round4(sumR / n),
    avgRecallDelta: nBase ? round4(sumRDelta / nBase) : null,
    totalPrecision,
    totalRecall,
    totalPrecisionDelta,
    totalRecallDelta,
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
  console.log(`  总体准确率 ${overall.totalPrecision} (${fmt(overall.totalPrecisionDelta)})   总体召回率 ${overall.totalRecall} (${fmt(overall.totalRecallDelta)})`)
  console.log(`  正确对总数 ${overall.totalCorrect} (${fmt(overall.totalCorrectDelta)})   与验证集差距(配错+漏) ${overall.totalGapToValidation}   多余对总数 ${overall.totalRedundant}`)
}

// ── Pass 执行顺序（与 nodeMatcher.js 一致）───────────────────────────────────
const PASS_ORDER = [
  'text-锚点', 'text-con-包含',
  'text-时间槽', 'text-同行', 'text-角色',
  'text-con-方向x', 'text-con-方向y', 'text-con-列表',
  'text-区域优选', 'text-区域兜底',
  'con-交叠', 'con-视觉',
]
const PASS_NUMBER = {
  'text-锚点': 'Pass 1', 'text-con-包含': 'Pass 1.5',
  'text-时间槽': 'Pass 2.2', 'text-同行': 'Pass 2.3', 'text-角色': 'Pass 2.5',
  'text-con-方向x': 'Pass 3', 'text-con-方向y': 'Pass 3',
  'text-con-列表': 'Pass 3.5',
  'text-区域优选': 'Pass 4', 'text-区域兜底': 'Pass 4',
  'con-交叠': 'Pass 5.3', 'con-视觉': 'Pass 6',
}
const passOrderIdx = {}
PASS_ORDER.forEach((mt, i) => { passOrderIdx[mt] = i })

// ── 按 matchType 统计 pass 分布，写入 pass-stats.json ─────────────────────────
const passStatsArr = Object.entries(passStats)
  .map(([mt, s]) => ({
    matchType: mt,
    passNumber: PASS_NUMBER[mt] || '',
    total: s.total,
    correct: s.correct,
    wrong: s.wrong,
    redundant: s.redundant,
    precision: s.total ? round4(s.correct / s.total) : 0,
    caseCount: s.cases.size,
    cases: [...s.cases].sort().join(', '),
  }))
  .sort((a, b) => (passOrderIdx[a.matchType] ?? 999) - (passOrderIdx[b.matchType] ?? 999))

const totalPairs = passStatsArr.reduce((s, p) => s + p.total, 0)
const totalCorrect = passStatsArr.reduce((s, p) => s + p.correct, 0)
const totalWrong = passStatsArr.reduce((s, p) => s + p.wrong, 0)
const totalRedundant = passStatsArr.reduce((s, p) => s + p.redundant, 0)

writeFileSync(
  join(outDir, 'pass-stats.json'),
  JSON.stringify({ platform: PLATFORM, generatedAt: new Date().toISOString(), passes: passStatsArr, totals: { totalPairs, totalCorrect, totalWrong, totalRedundant } }, null, 2)
)

// ── 输出 pass 分析摘要到控制台 ────────────────────────────────────────────────
const zeroCorrect = passStatsArr.filter(p => p.correct === 0)
console.log(`\n── Pass 分布分析（按执行顺序）──`)
console.log(`正确对总数 ${totalCorrect} / 总对数 ${totalPairs}（${(totalCorrect/totalPairs*100).toFixed(2)}%）`)
if (zeroCorrect.length) {
  console.log(`⚠️ 完全无效 Pass（正确数=0）: ${zeroCorrect.map(p => `${p.passNumber} ${p.matchType}（${p.redundant}多余）`).join('、')}`)
}
const top3 = [...passStatsArr].sort((a, b) => b.correct - a.correct).slice(0, 3)
console.log(`主要贡献者: ${top3.map(p => `${p.passNumber} ${p.matchType} ${p.correct}对`).join('、')}`)

// ── 生成 summary.md ──────────────────────────────────────────────────────────
const writeSummaryMd = () => {
  const pct = (num, den) => den ? (num / den * 100).toFixed(2) + '%' : (num ? '—' : '0.00%')
  const deltaPct = (cur, base) => base == null ? '新增' : Math.abs(cur - base) < 0.0001 ? '0' : (cur > base ? '+' : '') + (((cur - base) * 100).toFixed(2)) + '%'
  const caseDelta = (c, field) => { const sc = summaryCases[c]; return sc ? deltaPct(sc[field], sc[field + 'Delta'] != null ? sc[field] - sc[field + 'Delta'] : null) : '—' }

  const mdCases = cases.filter(c => collected[c])
  const totalVal = mdCases.reduce((s, c) => s + (collected[c].validationTotal || 0), 0)

  const lines = []
  lines.push('# 全量 Case 匹配结果汇总（case1~15）', '')
  const nowLocal = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`
  lines.push(`> 生成时间：${nowLocal}`, '')
  lines.push(`> 快照目录：${SNAPSHOT_DIR}  |  对比基线：${COMPARE_BASE || '（无）'}`, '')
  lines.push('')

  // ── ① 汇总表格 ──
  lines.push('### ① 汇总表格', '')
  lines.push('| case | Pairs总数 | 验证集总数 | 正确数 | 配错数 | 缺失数 | 多余数 | 准确率 | 召回率 | Δ准确率 | Δ召回率 |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|')
  for (const c of mdCases) {
    const m = collected[c]
    const sc = summaryCases?.[c]
    lines.push(`| ${c} | ${m.correct + m.wrong + m.redundant} | ${m.validationTotal} | ${cell(m.correct, sc?.correctDelta)} | ${cell(m.wrong, sc?.wrongDelta)} | ${cell(m.miss, sc?.missDelta)} | ${cell(m.redundant, sc?.redundantDelta)} | ${pct(m.correct, m.correct + m.wrong + m.redundant)} | ${pct(m.correct, m.validationTotal)} | ${sc ? deltaPct(m.precision, sc.precision - (sc.precisionDelta ?? 0)) : '—'} | ${sc ? deltaPct(m.recall, sc.recall - (sc.recallDelta ?? 0)) : '—'} |`)
  }
  // 累计 delta 总量（放在合计行前，供合计行使用）
  let dCorrect = 0, dWrong = 0, dMiss = 0, dRedundant = 0, hasBase = false
  if (summaryCases) {
    for (const c of mdCases) {
      const sc = summaryCases[c]
      if (sc?.correctDelta != null) {
        hasBase = true
        dCorrect += sc.correctDelta
        dWrong += sc.wrongDelta
        dMiss += sc.missDelta
        dRedundant += sc.redundantDelta
      }
    }
  }
  const totalMiss = totalVal - totalCorrect
  lines.push(`| **合计** | **${totalPairs}** | **${totalVal}** | **${cell(totalCorrect, hasBase ? dCorrect : null)}** | **${cell(totalWrong, hasBase ? dWrong : null)}** | **${cell(totalMiss, hasBase ? dMiss : null)}** | **${cell(totalRedundant, hasBase ? dRedundant : null)}** | — | — | — | — |`)
  if (hasBase) {
    lines.push(`| **指标情况** | — | — | — | — | — | — | **${(overall.totalPrecision * 100).toFixed(2) + '%'}** | **${(overall.totalRecall * 100).toFixed(2) + '%'}** | **${deltaPct(overall.totalPrecision, overall.totalPrecision - overall.totalPrecisionDelta)}** | **${deltaPct(overall.totalRecall, overall.totalRecall - overall.totalRecallDelta)}** |`)
    lines.push('')
    lines.push(`正确数 ${fmt(dCorrect)}，配错数 ${fmt(dWrong)}，缺失数 ${fmt(dMiss)}，多余数 ${fmt(dRedundant)}`)
  }
  lines.push('')

  // ── ② 出错最多的 Pass ──
  lines.push('### ② 出错最多的 Pass', '')
  const wrongByMt = passStatsArr.filter(p => p.wrong > 0).sort((a, b) => b.wrong - a.wrong)
  const redundByMt = passStatsArr.filter(p => p.redundant > 0).sort((a, b) => b.redundant - a.redundant)

  lines.push('#### 配错分布（按 matchType）', '')
  lines.push('| matchType | 配错次数 | 涉及 case |')
  lines.push('|---|---|---|')
  for (const p of wrongByMt) {
    const casesList = [...passStats[p.matchType].wrongCases].sort().join(', ')
    lines.push(`| ${p.matchType} | ${p.wrong} | ${casesList} |`)
  }
  lines.push('')

  lines.push('#### 多余对分布（按 matchType）', '')
  lines.push('| matchType | 多余次数 | 涉及 case |')
  lines.push('|---|---|---|')
  for (const p of redundByMt) {
    const casesList = [...passStats[p.matchType].redundantCases].sort().join(', ')
    lines.push(`| ${p.matchType} | ${p.redundant} | ${casesList} |`)
  }
  lines.push('')

  // ── ③ 正确匹配的 Pass 分布 ──
  lines.push('### ③ 正确匹配的 Pass 分布（按 Pass 执行顺序）', '')
  lines.push('| Pass | matchType | 总对数 | 正确数 | 配错数 | 多余数 | 涉及case数 | 准确率 |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const p of passStatsArr) {
    const mark = p.correct === 0 ? '**0**' : String(p.correct)
    lines.push(`| ${p.passNumber} | ${p.matchType} | ${p.total} | ${mark} | ${p.wrong} | ${p.redundant} | ${p.caseCount} | ${pct(p.correct, p.total)} |`)
  }
  lines.push(`| **合计** | | **${totalPairs}** | **${totalCorrect}** | **${totalWrong}** | **${totalRedundant}** | | **${pct(totalCorrect, totalPairs)}** |`)
  lines.push('')

  if (zeroCorrect.length) {
    lines.push(`> ⚠️ **完全无效 Pass（正确数为 0）**：${zeroCorrect.map(p => `\`${p.matchType}\`（${p.passNumber}，多余${p.redundant}对）`).join('、')}，建议检查阈值或逻辑是否过于严格 / 实际场景未覆盖。`, '')
  }

  lines.push('**各 Pass 贡献占比：**', '')
  lines.push('| Pass | matchType | 占正确对比例 | 占配错对比例 | 占多余对比例 |')
  lines.push('|---|---|---|---|---|')
  for (const p of passStatsArr) {
    lines.push(`| ${p.passNumber} | ${p.matchType} | ${pct(p.correct, totalCorrect)} | ${pct(p.wrong, totalWrong)} | ${pct(p.redundant, totalRedundant)} |`)
  }
  lines.push('')

  const top3Correct = [...passStatsArr].sort((a, b) => b.correct - a.correct).slice(0, 3)
  const top3Pct = top3Correct.reduce((s, p) => s + p.correct, 0) / totalCorrect * 100
  let conclusion = `前三 Pass（${top3Correct.map(p => `${p.passNumber} \`${p.matchType}\``).join('、')}）贡献了 **${top3Pct.toFixed(2)}%** 的正确匹配，是匹配算法核心支柱。`
  if (zeroCorrect.length) {
    conclusion += `\`${zeroCorrect.map(p => p.matchType).join('`、`')}\` ${zeroCorrect.length > 1 ? '两个' : '一个'}兜底 Pass 完全无效，建议评审是否保留或重构。`
  }
  lines.push(conclusion, '')

  // ── ④ 优化建议 ──
  lines.push('### ④ 优化建议', '')
  const suggestions = []
  // Find cases with high miss counts
  const missRank = mdCases.map(c => ({ case: c, miss: collected[c].miss })).filter(x => x.miss > 0).sort((a, b) => b.miss - a.miss)
  if (missRank.length) {
    const worst = missRank[0]
    suggestions.push(`**${worst.case} 缺失 ${worst.miss} 个节点**：缺失较多，建议检查开发侧解析流程或该 case 特有结构是否被正确处理。 → 建议对比设计侧与开发侧节点列表，确认缺失节点是否在解析阶段被过滤。`)
  }
  // Cases with low precision
  const precRank = mdCases.map(c => ({ case: c, prec: collected[c].precision, redundant: collected[c].redundant })).filter(x => x.prec < 0.8).sort((a, b) => a.prec - b.prec)
  if (precRank.length) {
    const worst = precRank[0]
    suggestions.push(`**${worst.case} 准确率偏低（${(worst.prec * 100).toFixed(2)}%）**：多余对多达 ${worst.redundant} 个，产生大量假阳性。 → 建议收紧 Pass 3/Pass 4 的匹配阈值。`)
  }
  // Most redundant pass
  const topRedundMt = redundByMt[0]
  if (topRedundMt) {
    suggestions.push(`**${topRedundMt.matchType} 产生大量多余配对（${topRedundMt.redundant} 对）**：该 Pass 贡献了最多多余对，匹配条件过于宽松。 → 建议优化阈值或引入后置过滤。`)
  }
  // Zero-correct passes
  if (zeroCorrect.length) {
    suggestions.push(`**${zeroCorrect.map(p => p.matchType).join(' / ')} 完全无效**：正确数为 0，仅贡献多余对。 → 建议评估是否删除这两个 Pass，或检查其实现逻辑是否被前置 Pass 完全覆盖。`)
  }
  if (suggestions.length) {
    suggestions.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
  } else {
    lines.push('所有 case 匹配质量较高，无突出问题。')
  }
  lines.push('')

  // ── ⑤ 问题明细 ──
  lines.push('### ⑤ 问题明细', '')
  let hasProblems = false
  for (const c of mdCases) {
    const probs = caseProblems[c]
    if (!probs || (!probs.wrong.length && !probs.miss.length && !probs.redundant.length)) continue
    lines.push(`#### ${c}`, '')
    if (probs.wrong.length) {
      lines.push(`**配错（${probs.wrong.length}对）**`)
      lines.push('| arkuiId | 实际 designId | 期望 designId | matchType |')
      lines.push('|---|---|---|---|')
      for (const e of probs.wrong) lines.push(`| ${e.arkui} | ${e.actual} | ${e.expected} | ${e.matchType} |`)
      lines.push('')
    }
    if (probs.miss.length) {
      lines.push(`**缺失（${probs.miss.length}对）**`)
      lines.push('| arkuiId | 期望 designId |')
      lines.push('|---|---|')
      for (const e of probs.miss) lines.push(`| ${e.arkui} | ${e.expected} |`)
      lines.push('')
    }
    if (probs.redundant.length) {
      lines.push(`**多余（${probs.redundant.length}对）**`)
      lines.push('| arkuiId | 实际 designId | matchType |')
      lines.push('|---|---|---|')
      for (const e of probs.redundant) lines.push(`| ${e.arkui} | ${e.design} | ${e.matchType} |`)
      lines.push('')
    }
    hasProblems = true
  }
  if (!hasProblems) lines.push('所有 case 均无配错、缺失、多余问题。')

  writeFileSync(join(ROOT, 'test', SNAPSHOT_DIR, 'summary.md'), lines.join('\n'))
  console.log(`\nsummary.md 已生成（${SNAPSHOT_DIR}/summary.md）`)
}

// ── 仅在 COMPARE_BASE 非空时生成 summary.md ───────────────────────────────────
if (COMPARE_BASE) writeSummaryMd()
