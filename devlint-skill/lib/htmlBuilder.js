/**
 * ai-img-check HTML 标注图生成器
 *
 * 接收 agent 输出的差异 JSON → 生成带占位符的 HTML 模板文件
 * （红框/黄框/蓝框叠在图片位置上 + 差异清单表格已填充）。
 *
 * 图片位置用占位符标记，agent 需要自行把图片数据填入占位符位置，
 * 生成最终的带图标注视图 HTML。skill 不接触图片数据，不指导 agent 如何获取图片。
 *
 * 流程：
 *   buildHtmlReport({ diffFile })
 *   → 读 diff JSON（兼容纯 JSON 或 Markdown 内嵌 JSON 代码块）
 *   → 生成 HTML 模板（图片位置为占位符）→ 落盘到 .devlint/
 *   → 返回 { templatePath, totalDiffs, overallLevel, score, designPlaceholder, devPlaceholder }
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { timestamp, getOutputDir } from './shared.js'

// 图片占位符，agent 替换为图片数据
const DESIGN_IMAGE_PLACEHOLDER = '__DESIGN_IMAGE_BASE64__'
const DEV_IMAGE_PLACEHOLDER = '__DEV_IMAGE_BASE64__'

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

/**
 * 生成一个图上标注框的 HTML
 * @param {number} idx — 序号（1 起）
 * @param {Object} rect — { x, y, w, h } 归一化坐标
 * @param {string} severity — error/warning/missing/extra
 */
function boxHtml(idx, rect, severity) {
  if (!rect) return ''
  const s = SEVERITY_STYLE[severity] || SEVERITY_STYLE.error
  const left = (rect.x * 100).toFixed(2)
  const top = (rect.y * 100).toFixed(2)
  const width = (rect.w * 100).toFixed(2)
  const height = (rect.h * 100).toFixed(2)
  const dashed = (severity === 'missing' || severity === 'extra') ? 'border-style:dashed;' : ''
  return `      <div class="box" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%;border-color:${s.color};background:${s.bg};${dashed}">
        <span class="box-label" style="background:${s.color}">${idx}</span>
      </div>`
}

/**
 * 生成差异清单表格行
 */
function tableRowHtml(idx, diff) {
  const s = SEVERITY_STYLE[diff.severity] || SEVERITY_STYLE.error
  return `      <tr>
        <td>${idx}</td>
        <td><span class="sev-tag" style="color:${s.color}">${s.label} ${s.name}</span></td>
        <td>${escapeHtml(diff.element || '')}</td>
        <td>${escapeHtml(diff.property || '')}</td>
        <td>${escapeHtml(diff.designValue || '—')}</td>
        <td>${escapeHtml(diff.arkuiValue || '—')}</td>
        <td>${escapeHtml(diff.suggestion || '')}</td>
      </tr>`
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const SEVERITY_STYLE = {
  error:   { color: '#FF4D4F', bg: 'rgba(255,77,79,0.12)',  label: '🔴', name: '明显' },
  warning: { color: '#FAAD14', bg: 'rgba(250,173,20,0.12)',  label: '🟡', name: '轻微' },
  missing: { color: '#0067D1', bg: 'rgba(0,103,209,0.08)',   label: '⚪', name: '缺失' },
  extra:   { color: '#0067D1', bg: 'rgba(0,103,209,0.08)',   label: '⚪', name: '多余' },
}

/**
 * 生成完整 HTML 模板（图片位置为占位符，差异标注框 + 表格已填充）
 */
function generateHtml({ diffData }) {
  const diffs = diffData.diffs || []
  const level = diffData.overallLevel || '—'
  const score = diffData.score ?? '—'
  const summary = escapeHtml(diffData.summary || '')

  // 为每条 diff 分配全局序号
  const numbered = diffs.map((d, i) => ({ ...d, _idx: i + 1 }))

  // 设计稿图上的框
  const designBoxes = numbered
    .filter(d => d.designRect)
    .map(d => boxHtml(d._idx, d.designRect, d.severity))
    .join('\n')

  // 开发侧图上的框
  const devBoxes = numbered
    .filter(d => d.arkuiRect)
    .map(d => boxHtml(d._idx, d.arkuiRect, d.severity))
    .join('\n')

  // 差异清单表格
  const tableRows = numbered
    .map(d => tableRowHtml(d._idx, d))
    .join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>UI 还原检查报告</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, "PingFang SC", sans-serif; margin: 0; padding: 24px; background: #F5F5F5; color: #191919; }
  h1 { font-size: 20px; font-weight: 700; margin: 0 0 16px; }
  .summary-bar { display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: #fff; border-radius: 8px; margin-bottom: 24px; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
  .level-badge { font-size: 14px; font-weight: 600; padding: 4px 12px; border-radius: 4px; }
  .level-high { background: rgba(82,196,26,0.12); color: #52C41A; }
  .level-mid  { background: rgba(250,173,20,0.12); color: #FAAD14; }
  .level-low  { background: rgba(255,77,79,0.12); color: #FF4D4F; }
  .score { font-size: 28px; font-weight: 700; }
  .score-unit { font-size: 14px; color: #777; }
  .summary-text { font-size: 14px; color: #555; flex: 1; }
  .images { display: flex; gap: 20px; margin-bottom: 24px; }
  .image-panel { flex: 1; min-width: 0; }
  .image-panel h3 { font-size: 14px; font-weight: 600; margin: 0 0 12px; color: #555; }
  .image-wrapper { position: relative; display: inline-block; max-width: 100%; }
  .image-wrapper img { display: block; max-width: 100%; height: auto; border-radius: 4px; border: 1px solid #D1D5DC; }
  .box { position: absolute; border: 2px solid; border-radius: 2px; pointer-events: none; }
  .box-label { position: absolute; top: -16px; left: -2px; font-size: 11px; font-weight: 600; color: #fff; padding: 1px 6px; border-radius: 3px 3px 3px 0; white-space: nowrap; }
  .diff-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
  .diff-table th { font-size: 12px; font-weight: 600; color: #555; background: #FAFAFA; padding: 10px 12px; text-align: left; border-bottom: 1px solid #E8E8E8; }
  .diff-table td { font-size: 13px; padding: 10px 12px; border-bottom: 1px solid #F0F0F0; }
  .diff-table tr:last-child td { border-bottom: none; }
  .diff-table tr:hover td { background: #FAFAFA; }
  .sev-tag { font-size: 12px; font-weight: 600; }
  .empty { padding: 40px; text-align: center; color: #999; font-size: 14px; }
</style>
</head>
<body>

<h1>UI 还原检查报告</h1>

<div class="summary-bar">
  <span class="level-badge ${score >= 80 ? 'level-high' : score >= 60 ? 'level-mid' : 'level-low'}">还原度 ${escapeHtml(String(level))}</span>
  <span class="score">${score}<span class="score-unit"> / 100</span></span>
  <span class="summary-text">${summary}</span>
</div>

<div class="images">
  <div class="image-panel">
    <h3>设计稿</h3>
    <div class="image-wrapper">
      <img src="${DESIGN_IMAGE_PLACEHOLDER}" alt="设计稿" />
${designBoxes}
    </div>
  </div>
  <div class="image-panel">
    <h3>开发实现</h3>
    <div class="image-wrapper">
      <img src="${DEV_IMAGE_PLACEHOLDER}" alt="开发实现" />
${devBoxes}
    </div>
  </div>
</div>

<table class="diff-table">
  <thead>
    <tr>
      <th>#</th>
      <th>级别</th>
      <th>元素</th>
      <th>属性</th>
      <th>设计侧</th>
      <th>开发做成</th>
      <th>修改建议</th>
    </tr>
  </thead>
  <tbody>
${tableRows || '    <tr><td colspan="7" class="empty">视觉上未发现明显还原偏差，还原度良好</td></tr>'}
  </tbody>
</table>

</body>
</html>`
}

/**
 * 生成 HTML 标注图模板（图片位置为占位符，agent 填入图片后得到最终 HTML）
 *
 * @param {Object} params
 * @param {string} params.diffFile — agent 输出的 diff JSON 文件
 * @returns {Promise<Object>} { templatePath, totalDiffs, overallLevel, score, designPlaceholder, devPlaceholder }
 */
export async function buildHtmlReport({ diffFile }) {
  // 校验 diff 文件
  if (!diffFile) throw new Error('缺少参数: diff JSON 文件路径')
  if (!existsSync(diffFile)) throw new Error(`diff JSON 文件不存在: ${diffFile}`)

  // 解析 diff JSON
  const raw = readFileSync(diffFile, 'utf-8')
  const diffData = parseDiffJson(raw)

  // 生成 HTML 模板（图片位置为占位符）
  const html = generateHtml({ diffData })

  // 落盘
  const dir = getOutputDir()
  const templatePath = join(dir, `ai_img_check_${timestamp()}.html`)
  writeFileSync(templatePath, html, 'utf-8')

  return {
    templatePath,
    totalDiffs: (diffData.diffs || []).length,
    overallLevel: diffData.overallLevel || null,
    score: diffData.score ?? null,
    designPlaceholder: DESIGN_IMAGE_PLACEHOLDER,
    devPlaceholder: DEV_IMAGE_PLACEHOLDER,
  }
}
