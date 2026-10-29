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
export function parseDiffJson(content) {
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

export const SEVERITY = {
  error:      { label: '🔴 明显',     sort: 0 },
  warning:    { label: '🟡 轻微',     sort: 1 },
  missing:    { label: '⚪ 缺失',     sort: 2 },
  extra:      { label: '⚪ 多余',     sort: 3 },
  maybe_high: { label: '🟠 可能·大',  sort: 4 },
  maybe_low:  { label: '🟤 可能·小',  sort: 5 },
}

/** 英文 property → 中文标签（与报告模板 ISSUE_LABELS 对齐） */
const PROPERTY_LABELS = {
  fontSize: '字号', fontFamily: '字体', fontWeight: '字重',
  fontColor: '字色', backgroundColor: '填充',
  borderColor: '描边颜色', borderWidth: '描边宽度', borderRadius: '圆角',
  shadow: '阴影', blur: '模糊', backdropBlur: '模糊',
  opacity: '不透明度', padding: '内边距', itemSpacing: '间距',
  size: '尺寸', position: '位置',
  missing: '缺失', extra: '多余', other: '其他',
}

export function propertyLabel(property) {
  return PROPERTY_LABELS[property] || property || '—'
}

/** 格式化表格单元格的值 */
function formatVal(v) {
  if (v === null || v === undefined) return '-'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Markdown 表格单元格转义：| 和换行 */
function escapeCell(str) {
  return String(str == null ? '' : str)
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
}

/** 生成人类可读的时间戳 */
export function readableTimestamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 生成完整 Markdown 报告（按开发侧节点分组，与 devlint-mcp report.js 格式对齐）
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

  // 按开发侧节点分组（textContent + arkuiName 作为节点标识）
  const byDevNode = new Map()
  for (const d of diffs) {
    const nodeKey = `${d.textContent || ''}|${d.arkuiName || ''}`
    if (!byDevNode.has(nodeKey)) {
      byDevNode.set(nodeKey, {
        nodeName: (d.textContent || d.arkuiName) || '(未命名)',
        devClassName: d.arkuiName || null,
        textContent: d.textContent || null,
        issues: [],
      })
    }
    byDevNode.get(nodeKey).issues.push({
      property: d.property,
      description: propertyLabel(d.property),
      expected: d.designValue,
      actual: d.arkuiValue,
    })
  }

  const nodes = Array.from(byDevNode.values())

  // 统计
  const errorCount = diffs.filter(d => d.severity === 'error').length
  const warningCount = diffs.filter(d => d.severity === 'warning').length
  const otherCount = diffs.length - errorCount - warningCount

  const lines = []

  lines.push('# UI 还原检查报告')
  lines.push('')
  lines.push(`- 还原度：${level}（${score} / 100）`)
  lines.push(`- 问题节点数：${nodes.length}`)
  let statLine = `- 差异项总数：${diffs.length}（error ${errorCount}，warning ${warningCount}`
  if (otherCount > 0) statLine += `，其他 ${otherCount}`
  statLine += '）'
  lines.push(statLine)
  lines.push(`- 生成时间：${readableTimestamp()}`)
  lines.push('')
  if (summary) {
    lines.push(`> ${summary}`)
    lines.push('')
  }
  lines.push('> 本报告以修改代码为目的，按开发侧节点维度组织，每个节点列出需修改的属性及目标值。')
  lines.push('> 定位代码时优先使用「组件类型」，结合位置信息快速定位。')
  lines.push('')
  lines.push('---')
  lines.push('')

  nodes.forEach((node, i) => {
    lines.push(`## ${i + 1}. ${node.nodeName}`)
    lines.push('')
    if (node.textContent && node.devClassName) {
      lines.push(`> 组件类型：\`${node.devClassName}\``)
    } else if (node.devClassName) {
      lines.push(`> 组件类型：\`${node.devClassName}\``)
    }
    lines.push('')

    if (node.issues && node.issues.length > 0) {
      lines.push('| 属性 | 描述 | 设计值 | 开发值 | 修改建议 |')
      lines.push('|------|------|--------|--------|----------|')
      node.issues.forEach((issue) => {
        const suggest = `将 ${issue.property} 从 \`${formatVal(issue.actual)}\` 改为 \`${formatVal(issue.expected)}\``
        lines.push(`| ${issue.property || ''} | ${issue.description || ''} | ${formatVal(issue.expected)} | ${formatVal(issue.actual)} | ${suggest} |`)
      })
    } else {
      lines.push('（无具体差异项）')
    }
    lines.push('')
    lines.push('---')
    lines.push('')
  })

  return lines.join('\n')
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
