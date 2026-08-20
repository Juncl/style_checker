/**
 * ai-img-check 公共工具
 *
 * - timestamp / getOutputDir：时间戳与落盘目录
 * - fileToBase64DataUrl：读图片转 base64（htmlBuilder / serverCheck 共用）
 * - parseDiffReport / finalizeReport：server 兜底方案（serverCheck.js）专用，备选暂未启用
 *
 * 配置（server 地址 / .devlint 目录名）复用 src/lib/config.js。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, extname } from 'path'
import { config } from '../src/lib/config.js'

/**
 * 生成时间戳：月日时分秒
 */
export function timestamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/**
 * 落盘目录：<cwd>/.devlint/
 * ai-img-check 是独立命令，不参与 collect + ui-style-check 的 session 归组，
 * 直接落在 .devlint/ 根目录下。
 */
export function getOutputDir() {
  const dir = join(process.cwd(), config.DIR_NAME)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 读取图片文件为 base64 data URL，按扩展名设置 MIME 类型
 */
export function fileToBase64DataUrl(filePath) {
  const buf = readFileSync(filePath)
  const ext = extname(filePath).toLowerCase()
  const mime =
    ext === '.png' ? 'image/png' :
    (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' :
    ext === '.webp' ? 'image/webp' :
    ext === '.bmp' ? 'image/bmp' :
    'image/png'
  return `data:${mime};base64,${buf.toString('base64')}`
}

/**
 * 调 server /img/checker/diff 解析 Markdown 为结构化 diff JSON
 *
 * server 兜底方案（serverCheck.js）专用，备选暂未启用。
 * server 不可达时降级为空 diffs + 原始 markdown，不硬崩。
 *
 * @param {string} markdown — 完整 Markdown 报告
 * @returns {Promise<Object>} diffReport（含 diffs / stats / overallLevel / score / markdown）
 */
export async function parseDiffReport(markdown) {
  const diffRes = await fetch(`${config.CHECK_SERVER_URL}/img/checker/diff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown }),
  })

  if (diffRes.ok) {
    return await diffRes.json()
  }
  return { markdown, diffs: [], stats: {}, overallLevel: null, score: null }
}

/**
 * 落盘完整 Markdown 报告，并返回 preview（前 10 条 diff，避免上下文过长）
 *
 * @param {string} markdown — 完整 Markdown 报告
 * @param {Object} diffReport — parseDiffReport 的返回值
 * @returns {{ overallLevel, score, stats, diffs, totalDiffs, reportPath }}
 */
export function finalizeReport(markdown, diffReport) {
  const dir = getOutputDir()
  const reportPath = join(dir, `ai_img_check_${timestamp()}.md`)
  writeFileSync(reportPath, markdown, 'utf-8')

  const MAX_PREVIEW = 10
  const diffs = diffReport.diffs || []
  return {
    overallLevel: diffReport.overallLevel || null,
    score: diffReport.score ?? null,
    stats: diffReport.stats || {},
    diffs: diffs.slice(0, MAX_PREVIEW),
    totalDiffs: diffs.length,
    reportPath,
  }
}
