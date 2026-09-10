/**
 * 报告生成模块
 *
 * 【职责】
 * 检查/修复报告的渲染、存档与固定根清理。bin/design-checker.mjs 解析完参数后
 * 调用本模块的 runCheck / runFix 完成落盘（🔴 AI 只递交数据，不写任何产物文件；
 * 报告命名固定 check-/fix-<时间戳>，与递交文件名无关）。
 *
 * 【报告目录规则】（目录控制权在本模块，AI 只负责把用户指定目录整理成合格格式传入）
 *   固定根（config.REPORT_ROOT）——mac：~/.octo-uxlint/design-check/；Windows：%USERPROFILE%\.octo-uxlint\design-check\
 *   - --out-dir <绝对目录>：仅当用户指定过报告保存目录时传入；md 报告落该目录（不过期，用户自管）
 *   - 未指定时：md 报告默认落固定根下（与 JSON 存档同一工作子文件夹，REPORT_MAX_AGE_DAYS 天自动过期）
 *   - JSON 存档始终落固定根的工作子文件夹（供修复阶段 --work-dir 透传使用）
 *
 * 【编码健壮性】（Windows 兼容）：stdin / 输入 JSON / 规范文件统一解码——UTF-16 BOM → 严格 UTF-8 →
 * GBK 兜底（自动转码，stderr 提示）；md 报告以 UTF-8 带 BOM 写入（记事本/Excel 双击不乱，
 * JSON 存档无 BOM）；领域 key 允许中文等 unicode 字母数字（目录名保留，仅剔除路径非法字符）。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs'
import { join, dirname, resolve, basename, sep } from 'path'
import { homedir } from 'os'
import { config } from './config.js'

// ── 通用工具 ────────────────────────────────────────────

/** 时间戳：月日时分秒 */
export function timestamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** 人类可读时间戳 */
export function readableTimestamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 用户指定报告目录归一：AI 负责传入绝对目录（~ 已展开、相对已转绝对），此处做最后兜底（~ 前缀展开 + 相对路径按 cwd 转绝对） */
export function normalizeOutDir(p) {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return resolve(p)
}

/** 清理固定根下超过指定天数的工作子文件夹；尽力而为，失败静默不影响主流程 */
export function pruneOldRuns(maxAgeDays = config.REPORT_MAX_AGE_DAYS) {
  try {
    if (!existsSync(config.REPORT_ROOT)) return
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    for (const name of readdirSync(config.REPORT_ROOT)) {
      const p = join(config.REPORT_ROOT, name)
      try {
        const st = statSync(p)
        if (st.isDirectory() && st.mtimeMs < cutoff) rmSync(p, { recursive: true, force: true })
      } catch {}
    }
  } catch {}
}

/** 报告文件名：与输入文件名解耦，固定 check-/fix- 前缀 + 时间戳（递交什么文件进来都不影响产物命名） */

/** JSON 语法错误信息增强：定位错误行号 + 该行原文 */
function describeSyntaxError(text, message) {
  const m = String(message).match(/position (\d+)/i)
  if (!m) return message
  const pos = Number(m[1])
  const before = text.slice(0, pos)
  const line = before.split(/\r?\n/).length
  const lineText = text.split(/\r?\n/)[line - 1] || ''
  return `${message}（第 ${line} 行：${lineText.trim().slice(0, 80) || '<空行>'}）`
}

const CHECK_REQUIRED = ['severity', 'rule', 'file', 'element', 'current', 'expected', 'specFile', 'specQuote', 'suggestion']
const FIX_REQUIRED = ['severity', 'rule', 'file', 'element', 'action', 'status']
const SEVERITIES = new Set(['error', 'warning', 'missing', 'extra', 'info'])
const FIX_STATUSES = new Set(['fixed', 'skipped', 'failed'])

/**
 * 校验检查数据（issueData），返回错误数组（空数组 = 通过）。
 * 一次性列出全部问题，便于 AI 一轮修正，避免反复碰壁。
 */
export function validateCheckData(data) {
  const errs = []
  if (!data || typeof data !== 'object') return ['顶层必须是 JSON 对象']
  for (const f of ['summary', 'sourceFile', 'specDomain']) {
    if (!String(data[f] || '').trim()) errs.push(`顶层缺必填字段 ${f}`)
  }
  const issues = data.issues
  if (!Array.isArray(issues)) return [...errs, 'issues 必须是数组（0 问题写 []）']
  issues.forEach((d, i) => {
    if (!d || typeof d !== 'object') {
      errs.push(`issues[${i}] 必须是对象`)
      return
    }
    const missing = CHECK_REQUIRED.filter(f => d[f] === undefined || d[f] === null || String(d[f]).trim() === '')
    if (missing.length) errs.push(`issues[${i}]（${d.rule || d.element || '?'}）缺字段：${missing.join('、')}`)
    if (d.severity && !SEVERITIES.has(d.severity)) errs.push(`issues[${i}].severity 非法：${d.severity}（只能是 error/warning/missing/extra/info）`)
  })
  return errs
}

/**
 * 校验修复数据（fixData），返回错误数组（空数组 = 通过）。
 */
export function validateFixData(data) {
  const errs = []
  if (!data || typeof data !== 'object') return ['顶层必须是 JSON 对象']
  for (const f of ['sourceFile', 'copyMode']) {
    if (!String(data[f] || '').trim()) errs.push(`顶层缺必填字段 ${f}`)
  }
  const fixes = data.fixes
  if (!Array.isArray(fixes)) return [...errs, 'fixes 必须是数组（无可执行条目写 []）']
  fixes.forEach((d, i) => {
    if (!d || typeof d !== 'object') {
      errs.push(`fixes[${i}] 必须是对象`)
      return
    }
    const missing = FIX_REQUIRED.filter(f => d[f] === undefined || d[f] === null || String(d[f]).trim() === '')
    if (missing.length) errs.push(`fixes[${i}]（${d.rule || d.element || '?'}）缺字段：${missing.join('、')}`)
    if (d.status && !FIX_STATUSES.has(d.status)) errs.push(`fixes[${i}].status 非法：${d.status}（只能是 fixed/skipped/failed）`)
    if (d.specFile && !d.specQuote) errs.push(`fixes[${i}] 有 specFile 但缺 specQuote`)
  })
  return errs
}

/** Markdown 表格单元格转义：| 和换行 */
function escapeCell(str) {
  return String(str == null ? '' : str)
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
}

/** 写 md 报告：UTF-8 带 BOM（Windows 记事本/Excel 双击打开不乱码；mac/linux 编辑器与 md 渲染器自动忽略 BOM；JSON 存档保持无 BOM） */
function writeReportFile(path, md) {
  writeFileSync(path, '\ufeff' + md, 'utf-8')
}

/** 从文件内容解析 JSON（兼容纯 JSON / ```json 代码块）；语法错附带行号与原文，便于一轮修正 */
export function parseJson(content) {
  const text = String(content).trim()

  const tryParse = (s) => {
    try {
      return JSON.parse(s)
    } catch (err) {
      throw new Error(describeSyntaxError(s, err.message))
    }
  }

  try {
    return tryParse(text)
  } catch (err) {
    const m = text.match(/```json\s*([\s\S]*?)```/)
    if (m) return tryParse(m[1].trim())
    const m2 = text.match(/```\s*([\s\S]*?)```/)
    if (m2) return tryParse(m2[1].trim())
    throw err
  }
}

/** 读 stdin 全文为 Buffer（stdin 模式：AI 经 heredoc 递交数据；编码统一交 decodeTextBuffer 兜底） */
export function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = []
    process.stdin.on('data', c => { chunks.push(c) })
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)))
    process.stdin.on('error', reject)
  })
}

/** 解码文本 Buffer（Windows 编码兜底）：UTF-16 BOM → 严格 UTF-8 → GBK（自动转码，stderr 提示）→ 宽松 UTF-8 兜底。覆盖 PowerShell UTF-16 重定向、GBK 控制台递交、ANSI/GBK 规范文件等场景 */
export function decodeTextBuffer(buf, label) {
  if (buf[0] === 0xFF && buf[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf)
  if (buf[0] === 0xFE && buf[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {}
  try {
    const s = new TextDecoder('gbk').decode(buf)
    console.error(`⚠ 检测到非 UTF-8 输入${label ? `（${label}）` : ''}，已按 GBK 自动转码；建议保存/递交为 UTF-8 以获得最佳兼容性`)
    return s
  } catch {}
  return new TextDecoder('utf-8').decode(buf)
}

/** 领域 key 合法化（防路径穿越：unicode 字母数字（含中文）与 _ . - 之外一律替换为 _；纯点位名兜底 default） */
export function safeDomain(d) {
  const s = String(d || '').trim().replace(/[^\p{L}\p{N}_.-]/gu, '_')
  if (s === '.' || s === '..') return 'default'
  return s || 'default'
}

// ── 检查报告 ────────────────────────────────────────────

const SEVERITY = {
  error:   { label: '🔴 违规', sort: 0 },
  warning: { label: '🟡 疑似', sort: 1 },
  missing: { label: '⚪ 缺失', sort: 2 },
  extra:   { label: '⚪ 额外', sort: 3 },
  info:    { label: '🔵 提示', sort: 4 },
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
  const c = { error: 0, warning: 0, missing: 0, extra: 0, info: 0 }
  for (const d of issues) {
    c[SEVERITY[d.severity] ? d.severity : 'error']++
  }
  return c
}

/** 问题统计行：服务于修复范围决策（全部/只修 error/自定义），不做评分评级 */
function statsLine(issues) {
  const c = countSeverity(issues)
  return `**问题统计：共 ${issues.length} 处 —— 违规 ${c.error} / 疑似 ${c.warning} / 缺失 ${c.missing} / 额外 ${c.extra} / 提示 ${c.info}**`
}

function generateCheckReport(issueData) {
  const issues = issueData.issues || []
  const summary = issueData.summary || ''

  // 顶层可选字段：检查对象 + 规范领域（报告头部展示，便于存档追溯；缺失时兼容旧 JSON）
  const metaLines = [
    issueData.sourceFile ? `**检查对象**：${issueData.sourceFile}` : '',
    issueData.specDomain ? `**规范领域**：${issueData.specDomain}` : '',
  ].filter(Boolean)
  const metaBlock = metaLines.length ? `${metaLines.join('\n')}\n\n` : ''

  if (!issues.length) {
    return `# 设计规范检查报告

${statsLine(issues)}

${metaBlock}${summary || '前端实现符合设计规范，未发现问题。'}

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

${metaBlock}${summary}

## 问题清单（共 ${issues.length} 处）

| # | 级别 | 规范条目 | 元素 | 当前值 | 期望值 | 规范来源 | 修改建议 |
|---|------|----------|------|--------|--------|----------|----------|
${rows}

_生成时间：${readableTimestamp()}_
`
}

/**
 * 检查模式统一入口（stdin / 文件递交同构）：
 * 建 <领域key>-<时间戳>/ 工作目录 → 落盘 check JSON → 生成 md 报告（--out-dir 用户目录 > 工作目录）。
 * AI 不写任何产物文件，报告命名固定 check-<时间戳>，与递交文件名无关。
 */
export async function runCheck(data, { outDir }) {
  const issues = data.issues || []

  const ts = timestamp()
  const workDir = join(config.REPORT_ROOT, `${safeDomain(data.specDomain)}-${ts}`)
  mkdirSync(workDir, { recursive: true })

  const jsonPath = join(workDir, `check-${ts}.json`)
  writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8')

  const md = generateCheckReport(data)
  const reportDir = outDir ? normalizeOutDir(outDir) : workDir
  mkdirSync(reportDir, { recursive: true })
  const reportPath = join(reportDir, `check-${ts}.md`)
  writeReportFile(reportPath, md)
  return { reportPath, jsonPath, workDir, totalIssues: issues.length, sevCounts: countSeverity(issues) }
}

// ── 修复报告 ────────────────────────────────────────────

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

/**
 * 修复模式统一入口（stdin / 文件递交同构）：
 * fix JSON + 修复报告写入 --work-dir 指定的检查工作目录（报告可经 --out-dir 改道用户目录）。
 * 报告命名固定 fix-<时间戳>，与递交文件名无关。
 */
export async function runFix(data, { workDir, outDir }) {
  const fixes = data.fixes || []
  const count = {
    fixed: fixes.filter(f => f.status === 'fixed').length,
    failed: fixes.filter(f => f.status === 'failed').length,
    skipped: fixes.filter(f => f.status === 'skipped').length,
  }

  const ts = timestamp()
  mkdirSync(workDir, { recursive: true })

  const jsonPath = join(workDir, `fix-${ts}.json`)
  writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8')

  // md 报告：--out-dir 用户指定目录（与检查报告同目录，不过期）> 检查工作目录（与 JSON 同目录，自动过期）
  const md = generateFixReport(data)
  const reportDir = outDir ? normalizeOutDir(outDir) : workDir
  mkdirSync(reportDir, { recursive: true })
  const reportPath = join(reportDir, `fix-${ts}.md`)
  writeReportFile(reportPath, md)

  return { reportPath, jsonPath, ...count, totalFixes: fixes.length }
}
