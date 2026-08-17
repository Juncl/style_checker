/**
 * ai-img-check：视觉检查（skill 独有逻辑，配置复用 mcp config）
 *
 * 读两张图片 → base64 → POST server /img/checker（流式）
 * → 读完整 SSE 流累积 content → 拿到 Markdown 报告
 * → POST server /img/checker/diff 解析为结构化 diff
 * → 落盘完整 Markdown → 返回 preview
 *
 * 用流式而非非流式：非流式要等 VLM 完整生成才返回首字节（60-150s），
 * 容易撞 fetch/bash 超时；流式首字节几秒即到，连接持续有数据不会超时。
 * 不设 fetch 硬超时，由 bash 工具 timeout 兜底（SKILL.md 指导 AI 设 300000ms）。
 *
 * 配置（server 地址 / .devlint 目录名 / 内外网切换）复用 src/lib/config.js，
 * 与 ui-style-check 等命令共用同一份配置，内外网只需改 config.js 的 CHECK_ENV 一处。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, extname } from 'path'
import { config } from '../src/lib/config.js'

/**
 * 生成时间戳：月日时分秒
 */
function timestamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/**
 * 读取图片文件为 base64 data URL，按扩展名设置 MIME 类型
 */
function fileToBase64DataUrl(filePath) {
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
 * 解析 SSE 流文本，累积 delta.content 为完整 Markdown
 *
 * SSE 帧格式（server pipe 透传 VLM API）：
 *   data: {"choices":[{"delta":{"content":"..."}}]}
 *   data: {"choices":[{"delta":{"reasoning_content":"..."}}]}
 *   data: [DONE]
 *
 * 只累积 content（正文），忽略 reasoning（思考过程）。
 * content 中可能含  标签，交给 server /img/checker/diff 清理。
 */
function parseSSEContent(raw) {
  let content = ''
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice(5).trim()
    if (data === '[DONE]') break
    try {
      const json = JSON.parse(data)
      const delta = json.choices?.[0]?.delta
      if (delta?.content) content += delta.content
    } catch {}
  }
  return content
}

/**
 * 落盘目录：<cwd>/.devlint/
 * ai-img-check 是独立命令，不参与 collect + ui-style-check 的 session 归组，
 * 直接落在 .devlint/ 根目录下。
 */
function getOutputDir() {
  const dir = join(process.cwd(), config.DIR_NAME)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 执行视觉检查
 *
 * @param {Object} params
 * @param {string} params.designImage — 设计稿截图路径
 * @param {string} params.devImage — 开发侧截图路径
 * @param {string} [params.prompt] — 补充说明，默认"请对比这两张图的 UI 还原差异"
 * @returns {Promise<Object>} { overallLevel, score, stats, diffs, totalDiffs, reportPath }
 */
export async function aiImgCheck({ designImage, devImage, prompt }) {
  // 校验文件存在
  for (const [label, path] of [
    ['设计稿截图', designImage],
    ['开发侧截图', devImage],
  ]) {
    if (!existsSync(path)) {
      throw new Error(`${label}文件不存在: ${path}`)
    }
  }

  const userText = prompt || '请对比这两张图的 UI 还原差异'

  const messages = [{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: fileToBase64DataUrl(designImage) } },
      { type: 'image_url', image_url: { url: fileToBase64DataUrl(devImage) } },
      { type: 'input_text', text: userText },
    ],
  }]

  // 1. 调 server /img/checker（流式），server 内部完成图片比对并流式返回 Markdown 报告
  //    流式模式首字节几秒即到（模型边生成边吐），避免非流式总时长超时；
  //    不设 fetch 硬超时，由 bash 工具 timeout（SKILL.md 指导 AI 设 300000）兜底。
  const checkRes = await fetch(`${config.CHECK_SERVER_URL}/img/checker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, stream: true }),
  })

  if (!checkRes.ok) {
    const errText = await checkRes.text()
    throw new Error(`视觉检查请求失败 (${checkRes.status}): ${errText}`)
  }

  // 读取完整 SSE 流并累积 content（正文 Markdown）
  const raw = await checkRes.text()
  const markdown = parseSSEContent(raw)
  if (!markdown) {
    throw new Error('视觉检查未返回有效内容')
  }

  // 2. 调 server /img/checker/diff 解析 Markdown 为结构化 diff JSON
  let diffReport
  const diffRes = await fetch(`${config.CHECK_SERVER_URL}/img/checker/diff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown }),
  })

  if (diffRes.ok) {
    diffReport = await diffRes.json()
  } else {
    diffReport = { markdown, diffs: [], stats: {}, overallLevel: null, score: null }
  }

  // 3. 落盘完整 Markdown 报告
  const dir = getOutputDir()
  const reportPath = join(dir, `ai_img_check_${timestamp()}.md`)
  writeFileSync(reportPath, markdown, 'utf-8')

  // 4. 返回 preview（前 10 条 diff，避免上下文过长）
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
