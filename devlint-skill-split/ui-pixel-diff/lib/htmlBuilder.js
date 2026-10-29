/**
 * ai-img-check HTML 报告生成器
 *
 * 当用户提供图片本地路径时，将 AI 输出的 diff JSON 转换为报告格式，
 * 生成可视化 HTML 报告（与 devlint-mcp 报告一致）。
 *
 * 流程：
 *   buildHtmlReport({ diffFile, designImage, devImage })
 *   → 读 diff JSON → 转换为报告 result 格式
 *   → 读图片文件 → 组装 multipart
 *   → 请求 HTML 报告 → 拿到 HTML 字符串
 *   → 落盘到 .devlint/ → 返回 { reportPath, totalDiffs, overallLevel, score }
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import { timestamp, getOutputDir } from './shared.js'
import { parseDiffJson, propertyLabel } from './mdBuilder.js'
import { config } from '../src/lib/config.js'

/**
 * 读取文件为 Blob，支持图片和 JSON
 */
function fileToBlob(filePath, fallbackType = 'application/json') {
  const buf = readFileSync(filePath)
  const ext = extname(filePath).toLowerCase()
  const type =
    ext === '.png' ? 'image/png' :
    (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' :
    fallbackType
  return new Blob([buf], { type })
}

/**
 * 将 AI 输出的 diff JSON 转换为报告 result 格式
 *
 * AI 输出的 diff 字段：severity, textContent, arkuiName, property, designValue, arkuiValue, confidence,
 *                       designRect, arkuiRect（归一化坐标，用于画布节点高亮）
 *
 * severity 映射：AI 有 6 级（error/warning/maybe_high/maybe_low/missing/extra），
 * 报告模板只有 2 级（error=精准检查 / warning=模糊比对）。
 * error/maybe_high/missing/extra → error（精准）；warning/maybe_low → warning（模糊）。
 *
 * 从 diffs 的 designRect/arkuiRect 去重构建 allDesignNodes/allArkuiNodes/pairs/canvas，
 * 使 HTML 报告的画布节点高亮、跨侧联动、序号徽标等功能可用。
 * 组件层级链（path）仍不可用（AI 无法输出节点树），属预期限制。
 */

/** 将归一化坐标序列化为去重 key */
function rectKey(rect) {
  if (!rect) return null
  return `${rect.x},${rect.y},${rect.w},${rect.h}`
}

/** AI severity → 报告 severity 映射 */
const SEVERITY_MAP = {
  error: 'error',
  maybe_high: 'error',
  missing: 'error',
  extra: 'error',
  warning: 'warning',
  maybe_low: 'warning',
}

function wrapAiResult(diffData) {
  const diffs = (diffData.diffs || []).map((d) => ({
    severity: SEVERITY_MAP[d.severity] || 'error',
    property: d.property || 'other',
    description: propertyLabel(d.property),
    textContent: d.textContent || '',
    arkuiName: d.arkuiName || '',
    designValue: d.designValue ?? null,
    arkuiValue: d.arkuiValue ?? null,
    confidence: d.confidence || 'medium',
    designRect: d.designRect || null,
    arkuiRect: d.arkuiRect || null,
    // nodeId 基于坐标去重：同一元素多条 diff（坐标相同）共用一个 id
    designNodeId: d.designRect ? `ai-d-${rectKey(d.designRect)}` : null,
    arkuiNodeId: d.arkuiRect ? `ai-a-${rectKey(d.arkuiRect)}` : null,
  }))

  // 从 diffs 的坐标去重构建节点列表 + 匹配对映射
  const allDesignNodes = []
  const allArkuiNodes = []
  const pairs = []
  const seenDesign = new Set()
  const seenArkui = new Set()

  for (const d of diffs) {
    if (d.designNodeId && d.designRect && !seenDesign.has(d.designNodeId)) {
      seenDesign.add(d.designNodeId)
      allDesignNodes.push({
        id: d.designNodeId,
        name: d.textContent || d.arkuiName || '',
        type: d.textContent ? 'text' : 'container',
        textContent: d.textContent || null,
        rect: d.designRect,
      })
    }
    if (d.arkuiNodeId && d.arkuiRect && !seenArkui.has(d.arkuiNodeId)) {
      seenArkui.add(d.arkuiNodeId)
      allArkuiNodes.push({
        id: d.arkuiNodeId,
        name: d.textContent || d.arkuiName || '',
        type: d.textContent ? 'text' : 'container',
        textContent: d.textContent || null,
        rect: d.arkuiRect,
      })
    }
    if (d.designNodeId && d.arkuiNodeId) {
      pairs.push({ design: { id: d.designNodeId }, arkui: { id: d.arkuiNodeId } })
    }
  }

  return {
    platform: 'unknown',
    diffs,
    allArkuiNodes,
    allDesignNodes,
    pairs,
    canvas: {
      arkui: { w: 1, h: 1 },
      design: { w: 1, h: 1 },
    },
    stats: {},
  }
}

/**
 * 生成 HTML 报告
 *
 * @param {Object} params
 * @param {string} params.diffFile — agent 输出的 diff JSON 文件
 * @param {string} [params.designImage] — 设计稿截图路径（可选）
 * @param {string} [params.devImage] — 开发实现截图路径（可选）
 * @returns {Promise<Object>} { reportPath, totalDiffs, overallLevel, score }
 */
export async function buildHtmlReport({ diffFile, designImage, devImage }) {
  if (!diffFile) throw new Error('缺少参数: diff JSON 文件路径')
  if (!existsSync(diffFile)) throw new Error(`diff JSON 文件不存在: ${diffFile}`)

  const raw = readFileSync(diffFile, 'utf-8')
  const diffData = parseDiffJson(raw)

  const result = wrapAiResult(diffData)

  const form = new FormData()
  form.append('result', new Blob([JSON.stringify(result)], { type: 'application/json' }), 'result.json')

  if (designImage) {
    if (!existsSync(designImage)) throw new Error(`设计稿截图不存在: ${designImage}`)
    form.append('designImage', fileToBlob(designImage, 'image/png'), 'design.png')
  }
  if (devImage) {
    if (!existsSync(devImage)) throw new Error(`开发实现截图不存在: ${devImage}`)
    form.append('devImage', fileToBlob(devImage, 'image/png'), 'arkui.png')
  }

  const res = await fetch(`${config.CHECK_SERVER_URL}/report/html`, {
    method: 'POST',
    body: form,
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`HTML 报告生成失败 (${res.status}): ${errText}`)
  }

  const html = await res.text()

  const dir = getOutputDir()
  const reportPath = join(dir, `ai_img_check_${timestamp()}.html`)
  writeFileSync(reportPath, html, 'utf-8')

  return {
    reportPath,
    totalDiffs: (diffData.diffs || []).length,
    overallLevel: diffData.overallLevel || null,
    score: diffData.score ?? null,
  }
}
