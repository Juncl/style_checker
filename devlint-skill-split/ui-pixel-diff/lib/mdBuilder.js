/**
 * ai-img-check Markdown 报告生成器
 *
 * 接收 agent 输出的差异 JSON → 整理成一份可读的 Markdown 差异报告
 * （还原度评分 + 总结 + 差异清单表格），落盘到 .devlint/。
 *
 * 不生成 HTML、不接触图片、不转 base64、没有图片占位符/填图步骤。
 * 报告就是纯文本 Markdown 文档，打开即看。
 *
 * 流程：
 *   buildMdReport({ diffFile })
 *   → 读 diff JSON（兼容纯 JSON 或 Markdown 内嵌 JSON 代码块）
 *   → 整理成 Markdown 报告 → 落盘到 .devlint/
 *   → 返回 { reportPath, totalDiffs, overallLevel, score }
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { timestamp, getOutputDir } from './shared.js'

/**
 * 从文件内容中解析 diff JSON
 * 兼容：纯 JSON 文件 / Markdown 内嵌 ```json 代码块
 */
function parseDiffJson(content) {
  const text = String(content).trim()

  // 尝试直接 parse
  try {
    return JSON.parse(text)
  } catch {}

  // 尝试从 ```json ... ``` 代码块提取
  const m = text.match(/```json\s*([\s\S]*?)```/)
  if (m) {
    try {
      return JSON.parse(m[1].trim())
    } catch {}
  }

  // 尝试从任意 ``` 代码块提取
  const m2 = text.match(/```\s*([\s\S]*?)```/)
  if (m2) {
    try {
      return JSON.parse(m2[1].trim())
    } catch {}
  }

  throw new Error('无法从文件中解析 diff JSON，请确认文件内容是纯 JSON 或包含 json 代码块')
}

const SEVERITY = {
  error:      { label: '🔴 明显',     sort: 0 },
  warning:    { label: '🟡 轻微',     sort: 1 },
  missing:    { label: '⚪ 缺失',     sort: 2 },
  extra:      { label: '⚪ 多余',     sort: 3 },
  maybe_high: { label: '🟠 可能·大',  sort: 4 },
  maybe_low:  { label: '🟤 可能·小',  sort: 5 },
}

/** Markdown 表格单元格转义：| 和换行 */
function escapeCell(str) {
  return String(str == null ? '' : str)
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
}

/** 生成人类可读的时间戳 */
function readableTimestamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 生成完整 Markdown 报告
 */
function generateMd({ diffData }) {
  const diffs = diffData.diffs || []
  const level = diffData.overallLevel || '—'
  const score = diffData.score ?? '—'
  const summary = diffData.summary || ''

  // 无差异
  if (!diffs.length) {
    return `# UI 还原检查报告

**还原度：${level}（${score} / 100）**

${summary || '视觉上未发现明显还原偏差，还原度良好。'}

_生成时间：${readableTimestamp()}_
`
  }

  // 按严重级别排序后编号（明显 → 轻微 → 缺失 → 多余）
  const numbered = diffs
    .map((d, i) => ({ ...d, _sev: SEVERITY[d.severity] || SEVERITY.error, _orig: i }))
    .sort((a, b) => a._sev.sort - b._sev.sort || a._orig - b._orig)
    .map((d, i) => ({ ...d, _idx: i + 1 }))

  const rows = numbered.map(d => {
    const sev = SEVERITY[d.severity] || SEVERITY.error
    return `| ${d._idx} | ${sev.label} | ${escapeCell(d.element)} | ${escapeCell(d.property)} | ${escapeCell(d.designValue ?? '—')} | ${escapeCell(d.arkuiValue ?? '—')} | ${escapeCell(d.suggestion)} |`
  }).join('\n')

  return `# UI 还原检查报告

**还原度：${level}（${score} / 100）**

${summary}

## 差异清单（共 ${diffs.length} 处）

| # | 级别 | 元素 | 属性 | 设计侧 | 开发侧 | 修改建议 |
|---|------|------|------|--------|--------|----------|
${rows}

_生成时间：${readableTimestamp()}_
`
}

/**
 * 生成 Markdown 报告
 *
 * @param {Object} params
 * @param {string} params.diffFile — agent 输出的 diff JSON 文件
 * @returns {Promise<Object>} { reportPath, totalDiffs, overallLevel, score }
 */
export async function buildMdReport({ diffFile }) {
  if (!diffFile) throw new Error('缺少参数: diff JSON 文件路径')
  if (!existsSync(diffFile)) throw new Error(`diff JSON 文件不存在: ${diffFile}`)

  const raw = readFileSync(diffFile, 'utf-8')
  const diffData = parseDiffJson(raw)

  const md = generateMd({ diffData })

  const dir = getOutputDir()
  const reportPath = join(dir, `ai_img_check_${timestamp()}.md`)
  writeFileSync(reportPath, md, 'utf-8')

  return {
    reportPath,
    totalDiffs: (diffData.diffs || []).length,
    overallLevel: diffData.overallLevel || null,
    score: diffData.score ?? null,
  }
}
