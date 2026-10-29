/**
 * ai-img-check 公共工具
 *
 * - timestamp / getOutputDir：时间戳与落盘目录
 *
 * 配置（.devlint 目录名）复用 src/lib/config.js。
 * 检查过程全靠 VLM agent 输出，只有 htmlBuilder 生成 HTML 时请求接口。
 */

import { mkdirSync } from 'fs'
import { join } from 'path'
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
