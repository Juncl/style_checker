/**
 * ai-img-check server 兜底方案（备选，暂未启用）
 *
 * ⚠️ 本模块为备选方案，当前 SKILL.md 和 bin 入口均未接入。
 *    当 agent 非 VLM（无法直接看对话中的图）时，才需要此方案：
 *    用户提供两张图片的本地文件路径 → skill 读文件转 base64 → 调 server VLM。
 *    有用户提出需求时再在 bin/cmdAiImgCheck 中接入 --mode server 分支。
 *
 * 未经启用前的保留理由：实现已完整且经验证，避免日后重复开发；
 * 接入方式：bin 顶部加 `import { aiImgCheck } from '../lib/serverCheck.js'`，
 *          cmdAiImgCheck 里恢复 --mode server 分支（调 aiImgCheck({ designImage, devImage, prompt })）。
 *
 * 流程：
 *   aiImgCheck() 读两张图片 → base64 → POST server /img/checker（流式）
 *   → 读完整 SSE 流累积 content → 拿到 Markdown 报告
 *   → POST server /img/checker/diff 解析为结构化 diff
 *   → 落盘完整 Markdown → 返回 preview
 *
 * 用流式而非非流式：非流式要等 VLM 完整生成才返回首字节（60-150s），
 * 容易撞 fetch/bash 超时；流式首字节几秒即到，连接持续有数据不会超时。
 * 不设 fetch 硬超时，由 bash 工具 timeout 兜底（SKILL.md 指导 AI 设 300000ms）。
 */

import { existsSync } from 'fs'
import { config } from '../src/lib/config.js'
import { fileToBase64DataUrl, parseDiffReport, finalizeReport } from './shared.js'

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
 * 执行视觉检查（server 兜底）
 *
 * @param {Object} params
 * @param {string} params.designImage — 设计稿截图本地路径
 * @param {string} params.devImage — 开发侧截图本地路径
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

  // 2. 调 server /img/checker/diff 解析 Markdown 为结构化 diff
  const diffReport = await parseDiffReport(markdown)
  return finalizeReport(markdown, diffReport)
}
