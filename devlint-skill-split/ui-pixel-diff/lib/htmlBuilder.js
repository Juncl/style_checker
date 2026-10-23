/**
 * ai-img-check HTML 报告生成器
 *
 * 当用户提供图片本地路径时，将 AI 输出的 diff JSON 转换为 server 兼容的 result 格式，
 * 调用 server /report/html 接口生成可视化 HTML 报告（与 devlint-mcp 报告一致）。
 *
 * 流程：
 *   buildHtmlReport({ diffFile, designImage, devImage })
 *   → 读 diff JSON → 转换为 server result 格式
 *   → 读图片文件 → 组装 multipart
 *   → POST server /report/html → 拿到 HTML 字符串
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
 * 将 AI 输出的 diff JSON 转换为 server /report/html 兼容的 result 格式
 *
 * AI 输出的 diff 字段：severity, textContent, arkuiName, property, designValue, arkuiValue, confidence
 * server 期望的 diff 字段：同上 + designNodeId, arkuiNodeId（AI 无法提供，留空）
 *
 * server 的 generateHtmlReport 会对 allArkuiNodes/allDesignNodes 做 path 映射，
 * AI 无法提供节点树，所以这些数组留空，HTML 报告中组件层级链/画布节点联动等
 * 功能不可用，但差异清单表格、截图对比、分组筛选等核心功能正常。
 */
function wrapAiResult(diffData) {
  const diffs = (diffData.diffs || []).map((d, i) => ({
    severity: d.severity || 'error',
    property: d.property || 'other',
    description: propertyLabel(d.property),
    textContent: d.textContent || '',
    arkuiName: d.arkuiName || '',
    designValue: d.designValue ?? null,
    arkuiValue: d.arkuiValue ?? null,
    confidence: d.confidence || 'medium',
    designNodeId: '',
    arkuiNodeId: '',
  }))

  return {
    platform: 'unknown',
    diffs,
    allArkuiNodes: [],
    allDesignNodes: [],
    pairs: [],
    canvas: null,
    stats: {},
  }
}

/**
 * 生成 HTML 报告（调用 server /report/html）
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
    throw new Error(`server /report/html 请求失败 (${res.status}): ${errText}`)
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
