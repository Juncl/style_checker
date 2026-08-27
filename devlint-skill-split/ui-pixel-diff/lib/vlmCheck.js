/**
 * ai-img-check 模式 A：VLM agent 自检
 *
 * 图片已在对话上下文中，agent 直接看图，不依赖 server。
 *
 *   getImgCheckPrompt()  取回 system prompt（引导 agent 输出简短总结 + 差异 JSON）
 *   agent 看对话中的两张图 + prompt → 输出简短总结 + diff JSON
 *   agent 把 JSON 写文件后调 ai-img-check --mode build 整理成 Markdown 差异报告
 *
 * 完整流程见 SKILL.md 主线。
 */

import { IMG_CHECKER_SYSTEM_PROMPT } from './imgCheckPrompt.js'

/**
 * 取回 AI 图图对比的 system prompt
 *
 * @returns {{ mode:'prompt', prompt:string, hint:string }}
 */
export function getImgCheckPrompt() {
  return {
    mode: 'prompt',
    prompt: IMG_CHECKER_SYSTEM_PROMPT,
    hint: '用户已确认哪张是设计稿、哪张是开发实现后，看这两张截图，按 prompt 输出简短总结 + 差异 JSON，把 JSON 写文件后调 ai-img-check --mode build 整理成 Markdown 差异报告，打开 md 文件即可查看',
  }
}
