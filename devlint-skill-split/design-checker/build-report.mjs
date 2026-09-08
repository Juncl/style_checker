#!/usr/bin/env node
/**
 * build-report.mjs —— 报告生成脚本（design-checker 唯一脚本）
 *
 * 🔴 落盘 + 报告 + 清理全部由本脚本完成，AI 只经 stdin 递交数据（不自己写文件、不建目录）：
 *
 *   检查模式（stdin，主线）：
 *     node build-report.mjs [--out-dir <绝对目录>] <<'JSON'  { ...issues 数据... }  JSON
 *     → 脚本自动：建工作目录 ~/.octo-uxlint/design-check/<领域key>-<时间戳>/
 *       写 check-<时间戳>.json + check-<时间戳>.md + 清理固定根下 7 天前产物
 *     → stdout：报告路径 + JSON 存档路径 + 工作目录 + 问题统计
 *
 *   修复模式（stdin，主线）：
 *     node build-report.mjs --fix --work-dir <检查工作目录> [--out-dir <绝对目录>] <<'JSON'  { ...fix 数据... }  JSON
 *     → fix-<时间戳>.json 写入检查工作目录（--work-dir 从检查 stdout 原样透传）
 *       fix-<时间戳>.md 落 --out-dir（用户指定过时）或检查工作目录
 *
 *   兼容旧文件输入（兜底）：
 *     node build-report.mjs <issues.json> [--out-dir <绝对目录>]
 *     node build-report.mjs --fix <fix-result.json> [--out-dir <绝对目录>]
 *     （报告固定落 ~/.octo-uxlint/design-check/ 下，位置永不漂移）
 *
 *   规范规则粗筛（只读，规范文件 > 3 个时检查第 1 遍先跑）：
 *     node build-report.mjs --scan-spec <领域key>
 *     → 扫描 specFiles/<领域key>/ 全部可读文本文件（README.md 任意层级跳过），
 *       输出疑似规则行清单（文件 + 行号 + 原文行），数值/颜色精确召回 + 关键词兜底召回，宁多勿漏
 *     → 纯只读：不读 stdin、不落盘、不触发 7 天清理；
 *       用行级候选清单替代逐字通读全文，对抗规范过多导致的注意力稀释（AI 按清单分批精读）
 *
 * 🔴 报告目录规则（目录控制权在脚本，AI 只负责把用户指定目录整理成合格格式传入）：
 *   固定根（DEFAULT_ROOT）——mac：~/.octo-uxlint/design-check/；Windows：%USERPROFILE%\.octo-uxlint\design-check\
 *   - --out-dir <绝对目录>：仅当用户指定过报告保存目录时由 AI 传入（~ 已展开、相对已转绝对；
 *     mac 如 /Users/<name>/reports；Windows 如 C:\Users\<name>\reports）；
 *     脚本对 ~/ 、~\ 前缀和相对路径做最后兜底归一。指定时 md 报告落该目录（不存在自动创建，不过期）
 *   - 未指定 --out-dir 时：md 报告默认落固定根下（与 JSON 存档同一工作子文件夹，7 天自动过期）
 *   - JSON 存档始终落固定根的工作子文件夹（供修复阶段 --work-dir 透传使用）
 *   - 7 天过期只作用于固定根：每次运行删除固定根下 mtime 超 7 天的工作子文件夹；
 *     用户指定目录中的报告不参与清理，由用户自行管理
 * AI 只经 stdin 递交数据、从 stdout 读全路径汇报给用户。
 * 输入兼容纯 JSON / Markdown 内嵌 ```json 代码块；md 报告必出（0 问题 / 0 修复条目同样生成）。
 * 零外部依赖，仅 Node.js 标准库；.mjs 后缀保证 ESM 解析，不依赖 package.json。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs'
import { join, dirname, resolve, basename, sep, relative } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 🔴 产物固定根：用户主目录下，脚本硬编码（不依赖 AI 落盘位置，报告位置永不漂移）
const DEFAULT_ROOT = join(homedir(), '.octo-uxlint', 'design-check')

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

/** 用户指定报告目录归一：AI 负责传入绝对目录（~ 已展开、相对已转绝对），此处做最后兜底（~ 前缀展开 + 相对路径按 cwd 转绝对） */
function normalizeOutDir(p) {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return resolve(p)
}

/** 报告目录（文件模式兜底用）：--out-dir 指定目录（用户指定优先，不过期）；未指定时固定落 DEFAULT_ROOT（~/.octo-uxlint/design-check/）下——输入 JSON 已在该根下则与其同目录（同一工作子文件夹），JSON 在别处则以父目录名归位到该根下 */
function getOutputDir(jsonFile, outDir) {
  if (outDir) {
    const dir = normalizeOutDir(outDir)
    mkdirSync(dir, { recursive: true })
    return dir
  }
  const jsonDir = resolve(dirname(jsonFile))
  const dir = jsonDir.startsWith(DEFAULT_ROOT + sep) ? jsonDir : join(DEFAULT_ROOT, basename(jsonDir))
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 清理固定根下超过 7 天的工作子文件夹（只保留近 7 天的检查/修复产物）；尽力而为，失败静默不影响主流程 */
function pruneOldRuns(maxAgeDays = 7) {
  try {
    if (!existsSync(DEFAULT_ROOT)) return
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    for (const name of readdirSync(DEFAULT_ROOT)) {
      const p = join(DEFAULT_ROOT, name)
      try {
        const st = statSync(p)
        if (st.isDirectory() && st.mtimeMs < cutoff) rmSync(p, { recursive: true, force: true })
      } catch {}
    }
  } catch {}
}

/** 报告文件名：前缀沿用输入 JSON 主干名去掉末尾时间戳段（issues-xxx.json → issues-<新时间戳>.md），同次产物前缀配对、时间戳各取各的 */
function getReportPath(jsonFile, dir) {
  const stem = basename(jsonFile).replace(/\.[^.]+$/, '')
  const prefix = stem.replace(/-\d+$/, '') || 'report'
  return join(dir, `${prefix}-${timestamp()}.md`)
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

/** 读 stdin 全文（stdin 模式：AI 经 heredoc 递交数据） */
function readStdin() {
  return new Promise((resolve, reject) => {
    let s = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', c => { s += c })
    process.stdin.on('end', () => resolve(s))
    process.stdin.on('error', reject)
  })
}

/** 领域 key 合法化（防路径穿越，仅允许字母数字下划线点横线） */
function safeDomain(d) {
  const s = String(d || '').trim().replace(/[^A-Za-z0-9_.-]/g, '_')
  return s || 'default'
}

// ── 模式一：检查报告 ────────────────────────────────────

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
 * 检查模式统一入口。
 * stdin 模式（主线）：脚本建工作目录 + 落盘 check JSON + 生成报告，AI 不写任何文件。
 * 文件模式（兜底）：JSON 已在盘上（AI 落盘偏差场景），报告按固定根归位，不重写 JSON。
 */
async function runCheck(data, { outDir, hasFile, jsonFile }) {
  const issues = data.issues || []

  if (hasFile) {
    const md = generateCheckReport(data)
    const reportPath = getReportPath(jsonFile, getOutputDir(jsonFile, outDir))
    writeFileSync(reportPath, md, 'utf-8')
    return { reportPath, jsonPath: null, workDir: null, totalIssues: issues.length, sevCounts: countSeverity(issues) }
  }

  const ts = timestamp()
  const workDir = join(DEFAULT_ROOT, `${safeDomain(data.specDomain)}-${ts}`)
  mkdirSync(workDir, { recursive: true })

  const jsonPath = join(workDir, `check-${ts}.json`)
  writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8')

  // md 报告：--out-dir 用户指定目录（不过期）> 固定根工作目录（与 JSON 同目录，7 天过期）
  const md = generateCheckReport(data)
  const reportDir = outDir ? normalizeOutDir(outDir) : workDir
  mkdirSync(reportDir, { recursive: true })
  const reportPath = join(reportDir, `check-${ts}.md`)
  writeFileSync(reportPath, md, 'utf-8')

  return { reportPath, jsonPath, workDir, totalIssues: issues.length, sevCounts: countSeverity(issues) }
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

/**
 * 修复模式统一入口。
 * stdin 模式（主线）：fix JSON + 修复报告写入 --work-dir 指定的检查工作目录。
 * 文件模式（兜底）：JSON 已在盘上，报告按固定根归位，不重写 JSON。
 */
async function runFix(data, { workDir, outDir, hasFile, jsonFile }) {
  const fixes = data.fixes || []
  const count = {
    fixed: fixes.filter(f => f.status === 'fixed').length,
    failed: fixes.filter(f => f.status === 'failed').length,
    skipped: fixes.filter(f => f.status === 'skipped').length,
  }

  if (hasFile) {
    const md = generateFixReport(data)
    const reportPath = getReportPath(jsonFile, getOutputDir(jsonFile, outDir))
    writeFileSync(reportPath, md, 'utf-8')
    return { reportPath, jsonPath: null, ...count, totalFixes: fixes.length }
  }

  const ts = timestamp()
  mkdirSync(workDir, { recursive: true })

  const jsonPath = join(workDir, `fix-${ts}.json`)
  writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8')

  // md 报告：--out-dir 用户指定目录（与检查报告同目录，不过期）> 检查工作目录（与 JSON 同目录，7 天过期）
  const md = generateFixReport(data)
  const reportDir = outDir ? normalizeOutDir(outDir) : workDir
  mkdirSync(reportDir, { recursive: true })
  const reportPath = join(reportDir, `fix-${ts}.md`)
  writeFileSync(reportPath, md, 'utf-8')

  return { reportPath, jsonPath, ...count, totalFixes: fixes.length }
}

// ── 模式三：规范规则粗筛（--scan-spec，纯只读，不落盘） ──

/** 疑似规则行召回——数值/颜色模式（精确信号，直接命中） */
const RULE_VALUE_PATTERNS = [
  /#[0-9a-fA-F]{3,8}\b/,                      // hex 颜色（#0067D1 / #FFF）
  /\brgba?\s*\(/i,                             // rgb() / rgba()
  /\bhsla?\s*\(/i,                             // hsl() / hsla()
  /\b\d+(?:\.\d+)?\s*(?:px|dp|vp|pt|rpx)\b/i,  // 绝对尺寸（32px / 4dp / 12vp）
  /\b\d+(?:\.\d+)?\s*(?:rem|em)\b/i,           // 相对尺寸（0.5rem / 2em）
  /\b\d+(?:\.\d+)?\s*%/,                       // 百分比（50%）
]

/** 疑似规则行召回——规范关键词（定性规则兜底；宁多勿漏，AI 精审剔除） */
const RULE_KEYWORD_RE = /(字号|字体|字重|行高|颜色|色彩|主色|背景|边框|描边|圆角|间距|边距|留白|内边距|外边距|高度|宽度|尺寸|大小|阴影|透明度|渐变|光晕|悬停|按下|禁用|选中|置灰|font|color|radius|spacing|border|shadow|opacity|height|width|padding|margin|size|weight|hover|active|focus|disabled)/i

/** 判定某行是否为疑似规则行 */
function isRuleCandidateLine(line) {
  const s = line.trim()
  if (!s || s.length < 3) return false
  if (RULE_VALUE_PATTERNS.some(re => re.test(s))) return true
  return RULE_KEYWORD_RE.test(s)
}

/** 递归列出领域下全部规范文件（任意层级嵌套；README.md 任意层级跳过；排序保证输出稳定） */
function listSpecFiles(domainDir) {
  const out = []
  const walk = dir => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'README.md') continue
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(domainDir)
  return out
}

/** 规则粗筛：扫描 specFiles/<领域>/ 全部可读文本文件，输出疑似规则行清单（文件+行号+原文行）。纯只读：不落盘、不触发 7 天清理 */
function runScanSpec(domain) {
  const root = join(__dirname, 'specFiles')
  const domainDir = join(root, safeDomain(domain))
  if (!existsSync(domainDir)) {
    console.error(`✗ 领域目录不存在: ${domainDir}（可用领域见 specFiles/index.md）`)
    process.exit(1)
  }
  const files = listSpecFiles(domainDir)
  if (!files.length) {
    console.log(`领域 ${domain} 下无规范文件（README.md 不计），请先放入规范文件`)
    return
  }
  const chunks = []
  let total = 0
  for (const f of files) {
    const rel = relative(root, f)
    let content
    try {
      content = readFileSync(f, 'utf-8')
    } catch {
      chunks.push(`== ${rel} ==（不可读，跳过）`)
      continue
    }
    if (content.includes('\u0000')) {
      chunks.push(`== ${rel} ==（疑似二进制，跳过）`)
      continue
    }
    const hits = []
    content.split(/\r?\n/).forEach((line, i) => {
      if (!isRuleCandidateLine(line)) return
      const text = line.trim().replace(/\s+/g, ' ')
      hits.push(`  L${String(i + 1).padStart(4)}  ${text.length > 160 ? text.slice(0, 160) + '…' : text}`)
    })
    total += hits.length
    chunks.push(`== ${rel}（${hits.length} 条候选）==\n${hits.join('\n') || '  （无候选行）'}`)
  }
  console.log(chunks.join('\n\n'))
  console.log(`\n统计：${files.length} 个文件、共 ${total} 条候选行`)
  console.log('（粗筛宁多勿漏；按此清单分批精读原文核对——每批 3-5 个文件，每批读完立即产出 issues 草稿，不逐字通读全文）')
}

// ── 主入口 ──────────────────────────────────────────────

function usage() {
  console.log(`build-report.mjs —— design-checker 报告生成（落盘 + 报告 + 清理全由脚本完成，AI 只经 stdin 递交数据）

用法（推荐，stdin 递交）:
  node ${join(__dirname, 'build-report.mjs')} [--out-dir <绝对目录>] <<'JSON'
  { "summary": "...", "sourceFile": "...", "specDomain": "<领域key>", "issues": [...] }
  JSON
  → 脚本自动：建工作目录 ${DEFAULT_ROOT}/<领域key>-<时间戳>/、写 check JSON、生成 md 报告、清理固定根下 7 天前产物
  → stdout：报告路径 + JSON 存档路径 + 工作目录 + 问题统计

  node ${join(__dirname, 'build-report.mjs')} --fix --work-dir <检查工作目录> [--out-dir <绝对目录>] <<'JSON'
  { "sourceFile": "...", "copyMode": "...", "fixedFiles": [...], "fixes": [...] }
  JSON
  → fix JSON 写入检查工作目录（--work-dir 从检查 stdout 的"工作目录"原样透传）；
    fix 报告落 --out-dir（用户指定过时）或检查工作目录

兼容旧文件输入（兜底）:
  node ${join(__dirname, 'build-report.mjs')} <issues.json> [--out-dir <绝对目录>]
  node ${join(__dirname, 'build-report.mjs')} --fix <fix-result.json> [--out-dir <绝对目录>]
  （报告固定落 ${DEFAULT_ROOT} 下，位置永不漂移）

规范规则粗筛（只读；规范文件 > 3 个时，检查第 1 遍先跑此命令替代逐字通读）:
  node ${join(__dirname, 'build-report.mjs')} --scan-spec <领域key>
  → 扫描 specFiles/<领域key>/ 全部可读文本文件，输出疑似规则行清单（文件 + 行号 + 原文行）
  → 纯只读：不落盘、不触发 7 天清理；AI 按清单分批精读原文（每批 3-5 个文件、每批即时产出 issues 草稿）

参数:
  --out-dir <目录>    报告保存目录（🔴 仅用户指定过时由 AI 传入；必须是绝对目录——
                      mac: /Users/<name>/reports；Windows: C:\\Users\\<name>\\reports；
                      ~/ 、~\\ 前缀由脚本兜底展开；目录不存在自动创建）
  --work-dir <目录>   修复模式：检查工作目录（检查 stdout 已返回，原样透传）
  --scan-spec <key>   规范规则粗筛：扫描 specFiles/<key>/ 输出疑似规则行清单（纯只读，用后即退）

说明:
  报告目录规则：--out-dir 指定时 md 报告落该目录（不过期，由用户自行管理）；
  未指定时默认落固定根 ${DEFAULT_ROOT} 下（与 JSON 存档同一工作子文件夹）
  JSON 存档始终落固定根的工作子文件夹（供修复阶段 --work-dir 透传使用）
  7 天过期只作用于固定根：每次运行自动清理固定根下 mtime 超 7 天的工作子文件夹；
  用户指定目录中的报告不参与清理
  输入兼容纯 JSON 或 Markdown 内嵌 json 代码块
  md 报告必出：0 问题 / 0 修复条目同样生成简化报告
  详细流程见 ${join(__dirname, 'SKILL.md')}`)
}

async function main() {
  const argv = process.argv.slice(2)

  // 解析 --out-dir <目录> / --work-dir <目录> / --scan-spec <领域key>（参数位置不限）
  let outDir = null
  let workDir = null
  let scanDomain = null
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out-dir') {
      outDir = argv[++i]
      if (!outDir || outDir.startsWith('-')) {
        console.error('✗ --out-dir 需要跟一个目录参数')
        process.exit(1)
      }
    } else if (argv[i] === '--work-dir') {
      workDir = argv[++i]
      if (!workDir || workDir.startsWith('-')) {
        console.error('✗ --work-dir 需要跟一个目录参数')
        process.exit(1)
      }
    } else if (argv[i] === '--scan-spec') {
      scanDomain = argv[++i]
      if (!scanDomain || scanDomain.startsWith('-')) {
        console.error('✗ --scan-spec 需要跟一个领域 key 参数')
        process.exit(1)
      }
    } else {
      rest.push(argv[i])
    }
  }

  const isFix = rest[0] === '--fix'
  const jsonFile = isFix ? rest[1] : rest[0]
  const hasFile = Boolean(jsonFile)

  if (argv.includes('-h') || argv.includes('--help')) {
    usage()
    process.exit(hasFile ? 0 : 1)
  }

  // 规范粗筛模式：纯只读扫描，输出候选清单后退出（不读 stdin、不落盘、不触发 7 天清理）
  if (scanDomain) {
    runScanSpec(scanDomain)
    process.exit(0)
  }

  // 输入来源：位置参数文件（旧模式兜底）> stdin（主线：AI 只递交数据，不落盘）
  let raw = ''
  if (hasFile) {
    if (!existsSync(jsonFile)) {
      console.error(`✗ JSON 文件不存在: ${jsonFile}`)
      process.exit(1)
    }
    raw = readFileSync(jsonFile, 'utf-8')
  } else {
    if (process.stdin.isTTY) {
      usage()
      process.exit(1)
    }
    raw = await readStdin()
  }

  let data
  try {
    data = parseJson(raw)
  } catch (err) {
    console.error(`✗ ${err.message}`)
    process.exit(1)
  }

  // 清理固定根下超过 7 天的历史产物（只保留近 7 天；尽力而为，不影响主流程）
  pruneOldRuns()

  try {
    if (isFix) {
      // 修复模式：workDir 优先级 --work-dir 参数 > 数据内 workDir 字段 > （文件模式）JSON 所在目录
      const wd = workDir || data.workDir || (hasFile ? dirname(resolve(jsonFile)) : null)
      if (!wd) {
        console.error('✗ 修复模式（stdin）需要 --work-dir <检查工作目录>（检查 stdout 已返回，原样透传即可）')
        process.exit(1)
      }
      const r = await runFix(data, { workDir: resolve(wd), outDir, hasFile, jsonFile })
      console.log(`✓ 修复报告已生成: ${r.reportPath}`)
      if (r.jsonPath) console.log(`✓ 修复数据已存档: ${r.jsonPath}`)
      console.log(`修复 ${r.fixed} / 失败 ${r.failed} / 跳过 ${r.skipped}，共 ${r.totalFixes} 条`)
    } else {
      const r = await runCheck(data, { outDir, hasFile, jsonFile })
      console.log(`✓ 报告已生成: ${r.reportPath}`)
      if (r.jsonPath) console.log(`✓ 检查数据已存档: ${r.jsonPath}`)
      if (r.workDir) console.log(`工作目录: ${r.workDir}`)
      const c = r.sevCounts
      console.log(`共 ${r.totalIssues} 处问题（error ${c.error} / warning ${c.warning} / missing ${c.missing} / extra ${c.extra} / info ${c.info}）`)
    }
  } catch (err) {
    console.error(`✗ ${err.message}`)
    process.exit(1)
  }
}

main()
