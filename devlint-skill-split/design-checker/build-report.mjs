#!/usr/bin/env node
/**
 * build-report.mjs —— 报告生成脚本（design-checker 唯一脚本）
 *
 * 两种模式：
 *   node build-report.mjs <issues.json>            检查报告（issue JSON → Markdown）
 *   node build-report.mjs --fix <fix-result.json>  修复报告（fix-result JSON → Markdown）
 *
 * 输入 JSON 兼容：纯 JSON / Markdown 内嵌 ```json 代码块。
 * 报告生成到输入 JSON 所在目录（流程约定：.octo-uxlint/design-check/<领域key>-<时间戳>/），stdout 输出报告路径 + 摘要。
 * 零外部依赖，仅 Node.js 标准库；.mjs 后缀保证 ESM 解析，不依赖 package.json。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname, resolve, basename } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── 通用工具 ────────────────────────────────────────────

/** 时间戳：月日时分秒 */
function timestamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** 人类可读时间戳 */
function readableTimestamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 报告目录：输入 JSON 所在目录（一次检查/修复的全部产物聚在同一子文件夹） */
function getOutputDir(jsonFile) {
  const dir = resolve(dirname(jsonFile))
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 报告文件名：前缀沿用输入 JSON 主干名去掉末尾时间戳段（issues-xxx.json → issues-<新时间戳>.md），同次产物前缀配对、时间戳各取各的 */
function getReportPath(jsonFile, outDir) {
  const stem = basename(jsonFile).replace(/\.[^.]+$/, '')
  const prefix = stem.replace(/-\d+$/, '') || 'report'
  return join(outDir, `${prefix}-${timestamp()}.md`)
}

/** Markdown 表格单元格转义：| 和换行 */
function escapeCell(str) {
  return String(str == null ? '' : str)
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
}

/** 从文件内容解析 JSON（兼容纯 JSON / ```json 代码块） */
function parseJson(content) {
  const text = String(content).trim()

  try {
    return JSON.parse(text)
  } catch {}

  const m = text.match(/```json\s*([\s\S]*?)```/)
  if (m) {
    try {
      return JSON.parse(m[1].trim())
    } catch {}
  }

  const m2 = text.match(/```\s*([\s\S]*?)```/)
  if (m2) {
    try {
      return JSON.parse(m2[1].trim())
    } catch {}
  }

  throw new Error('无法从文件中解析 JSON，请确认内容是纯 JSON 或包含 json 代码块')
}

// ── 模式一：检查报告 ────────────────────────────────────

const SEVERITY = {
  error:   { label: '🔴 违规', sort: 0 },
  warning: { label: '🟡 疑似', sort: 1 },
  missing: { label: '⚪ 缺失', sort: 2 },
  extra:   { label: '⚪ 额外', sort: 3 },
}

/** 规范来源单元格：specFile + specQuote（优先），兼容旧 spec 字段 */
function specCell(d) {
  if (d.specFile) {
    const quote = d.specQuote ? `「${d.specQuote}」` : ''
    return `${d.specFile}${quote}`
  }
  return d.spec ?? '—'
}

/** 按严重级别统计 issue 数（未知 severity 兜底按 error） */
function countSeverity(issues) {
  const c = { error: 0, warning: 0, missing: 0, extra: 0 }
  for (const d of issues) {
    c[SEVERITY[d.severity] ? d.severity : 'error']++
  }
  return c
}

/** 问题统计行：服务于修复范围决策（全部/只修 error/自定义），不做评分评级 */
function statsLine(issues) {
  const c = countSeverity(issues)
  return `**问题统计：共 ${issues.length} 处 —— 违规 ${c.error} / 疑似 ${c.warning} / 缺失 ${c.missing} / 额外 ${c.extra}**`
}

function generateCheckReport(issueData) {
  const issues = issueData.issues || []
  const summary = issueData.summary || ''

  if (!issues.length) {
    return `# 设计规范检查报告

${statsLine(issues)}

${summary || 'HTML 实现符合设计规范，未发现问题。'}

_生成时间：${readableTimestamp()}_
`
  }

  const numbered = issues
    .map((d, i) => ({ ...d, _sev: SEVERITY[d.severity] || SEVERITY.error, _orig: i }))
    .sort((a, b) => a._sev.sort - b._sev.sort || a._orig - b._orig)
    .map((d, i) => ({ ...d, _idx: i + 1 }))

  const rows = numbered.map(d => {
    const sev = SEVERITY[d.severity] || SEVERITY.error
    return `| ${d._idx} | ${sev.label} | ${escapeCell(d.rule)} | ${escapeCell(d.element)} | ${escapeCell(d.current ?? '—')} | ${escapeCell(d.expected ?? '—')} | ${escapeCell(specCell(d))} | ${escapeCell(d.suggestion)} |`
  }).join('\n')

  return `# 设计规范检查报告

${statsLine(issues)}

${summary}

## 问题清单（共 ${issues.length} 处）

| # | 级别 | 规范条目 | 元素 | 当前值 | 期望值 | 规范来源 | 修改建议 |
|---|------|----------|------|--------|--------|----------|----------|
${rows}

_生成时间：${readableTimestamp()}_
`
}

async function buildCheckReport(jsonFile) {
  const issueData = parseJson(readFileSync(jsonFile, 'utf-8'))

  const md = generateCheckReport(issueData)
  const reportPath = getReportPath(jsonFile, getOutputDir(jsonFile))
  writeFileSync(reportPath, md, 'utf-8')

  const issues = issueData.issues || []
  return {
    reportPath,
    totalIssues: issues.length,
    sevCounts: countSeverity(issues),
  }
}

// ── 模式二：修复报告 ────────────────────────────────────

const FIX_STATUS = {
  fixed:   { label: '✅ 已修复', sort: 0 },
  failed:  { label: '❌ 失败',   sort: 1 },
  skipped: { label: '⏭️ 跳过',   sort: 2 },
}

const RECHECK = {
  passed: '✅ 通过',
  failed: '❌ 未通过',
}

function generateFixReport(fixData) {
  const fixes = fixData.fixes || []
  const sourceFile = fixData.sourceFile || '—'
  // 兼容：fixedFiles 数组（多文件副本）或旧版 fixedFile 字符串
  const fixedFiles = fixData.fixedFiles || (fixData.fixedFile ? [fixData.fixedFile] : [])

  const count = {
    fixed: fixes.filter(f => f.status === 'fixed').length,
    failed: fixes.filter(f => f.status === 'failed').length,
    skipped: fixes.filter(f => f.status === 'skipped').length,
    recheckPassed: fixes.filter(f => f.status === 'fixed' && f.recheck === 'passed').length,
    recheckFailed: fixes.filter(f => f.status === 'fixed' && f.recheck === 'failed').length,
  }

  if (!fixes.length) {
    return `# 设计规范修复报告

**源文件**：${sourceFile}
**修复副本**：${fixedFiles.length ? fixedFiles.join('、') : '—'}

无可执行的修复条目。

_生成时间：${readableTimestamp()}_
`
  }

  const numbered = fixes
    .map((d, i) => ({ ...d, _st: FIX_STATUS[d.status] || FIX_STATUS.failed, _orig: i }))
    .sort((a, b) => a._st.sort - b._st.sort || a._orig - b._orig)
    .map((d, i) => ({ ...d, _idx: i + 1 }))

  const rows = numbered.map(d => {
    const sev = SEVERITY[d.severity] || SEVERITY.error
    const st = FIX_STATUS[d.status] || FIX_STATUS.failed
    const rc = d.status === 'fixed' ? (RECHECK[d.recheck] || '—') : '—'
    return `| ${d._idx} | ${sev.label} | ${escapeCell(d.rule)} | ${escapeCell(d.file || '—')} | ${escapeCell(d.element)} | ${escapeCell(d.action)} | ${escapeCell(specCell(d))} | ${st.label} | ${rc} |`
  }).join('\n')

  // 需要关注的条目：failed / 复查未通过 / skipped（有 note 的单独列出）
  const notes = numbered
    .filter(d => d.status === 'failed' || d.recheck === 'failed' || (d.note && d.status !== 'fixed'))
    .map(d => {
      const st = FIX_STATUS[d.status] || FIX_STATUS.failed
      return `- **#${d._idx} ${escapeCell(d.rule)}（${escapeCell(d.element)}）** ${st.label}${d.recheck === 'failed' ? '，复查未通过' : ''}：${escapeCell(d.note || '未注明原因')}`
    })
    .join('\n')

  return `# 设计规范修复报告

**源文件**：${sourceFile}（未修改）
**修复副本**：${fixedFiles.join('、')}

**修复结果**：修复 ${count.fixed} 处（复查通过 ${count.recheckPassed} / 未通过 ${count.recheckFailed}）、失败 ${count.failed} 处、跳过 ${count.skipped} 处

## 修复清单（共 ${fixes.length} 条）

| # | 级别 | 规范条目 | 修复文件 | 元素 | 修复动作 | 规范依据 | 状态 | 复查 |
|---|------|----------|----------|------|----------|----------|------|------|
${rows}
${notes ? `
## 需要关注的条目

${notes}
` : ''}
_生成时间：${readableTimestamp()}_
`
}

async function buildFixReport(jsonFile) {
  const fixData = parseJson(readFileSync(jsonFile, 'utf-8'))

  const md = generateFixReport(fixData)
  const reportPath = getReportPath(jsonFile, getOutputDir(jsonFile))
  writeFileSync(reportPath, md, 'utf-8')

  const fixes = fixData.fixes || []
  return {
    reportPath,
    totalFixes: fixes.length,
    fixed: fixes.filter(f => f.status === 'fixed').length,
    failed: fixes.filter(f => f.status === 'failed').length,
    skipped: fixes.filter(f => f.status === 'skipped').length,
  }
}

// ── 主入口 ──────────────────────────────────────────────

function usage() {
  console.log(`build-report.mjs —— design-checker 报告生成

用法:
  node ${join(__dirname, 'build-report.mjs')} <issues.json>            生成检查报告
  node ${join(__dirname, 'build-report.mjs')} --fix <fix-result.json>  生成修复报告

说明:
  输入 JSON 兼容纯 JSON 或 Markdown 内嵌 json 代码块
  报告生成到输入 JSON 所在目录（流程约定：.octo-uxlint/design-check/<领域key>-<时间戳>/）
  详细流程见 ${join(__dirname, 'SKILL.md')}`)
}

async function main() {
  const argv = process.argv.slice(2)
  const isFix = argv[0] === '--fix'
  const jsonFile = isFix ? argv[1] : argv[0]

  if (!jsonFile || argv.includes('-h') || argv.includes('--help')) {
    usage()
    process.exit(jsonFile ? 0 : 1)
  }
  if (!existsSync(jsonFile)) {
    console.error(`✗ JSON 文件不存在: ${jsonFile}`)
    process.exit(1)
  }

  try {
    if (isFix) {
      const r = await buildFixReport(jsonFile)
      console.log(`✓ 修复报告已生成: ${r.reportPath}`)
      console.log(`修复 ${r.fixed} / 失败 ${r.failed} / 跳过 ${r.skipped}，共 ${r.totalFixes} 条`)
    } else {
      const r = await buildCheckReport(jsonFile)
      const c = r.sevCounts
      console.log(`✓ 报告已生成: ${r.reportPath}`)
      console.log(`共 ${r.totalIssues} 处问题（error ${c.error} / warning ${c.warning} / missing ${c.missing} / extra ${c.extra}）`)
    }
  } catch (err) {
    console.error(`✗ ${err.message}`)
    process.exit(1)
  }
}

main()
