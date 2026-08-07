import { mkdirSync } from 'fs'
import { join } from 'path'
import { config } from '../config.js'

/**
 * 会话目录管理
 *
 * 目的：让同一次 UI 一致性检查任务中的多个独立采集工具
 *   （collect_arkui / collect_web / collect_design）以及 ui_style_check
 *   生成的 devlint_result.md 都落到同一个动态子文件夹中，
 *   文件夹名格式为 .devlint/20260806_164959（年月日_时分秒）。
 *
 * 机制：MCP 进程模块作用域内维护 currentSessionDir
 *   - 首次任意采集工具调用 → 生成时间戳子文件夹并缓存
 *   - 后续采集工具调用 → 复用同一文件夹（同一轮采集归组）
 *   - ui_style_check 完成后调用 resetSession() → 置空，下次采集开新文件夹
 *   - 超时兜底（SESSION_TIMEOUT）：若距上次使用超过 30 分钟，视为新会话，
 *     避免常驻进程跨对话串台（MCP 进程可能在多次对话间常驻存活）
 */

// 会话超时：超过 30 分钟未使用，视为新会话
const SESSION_TIMEOUT = 30 * 60 * 1000

// 当前会话目录（模块作用域，MCP 进程内单例）
let currentDir = null
// 当前会话时间戳字符串（与 currentDir 同步，供报告文件名复用）
let currentTimestamp = null
// 上次使用时间戳（ms）
let lastUsedAt = 0
// 当前会话用户信息（由 collect_design 写入，ui_style_check 读取用于打点）
let currentUserInfo = null

/**
 * 生成会话文件夹时间戳：年月日_时分秒
 * 形如 20260806_164959
 */
function sessionTimestamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/**
 * 获取当前会话目录，不存在或已超时则新建
 *
 * 调用方：collect_arkui / collect_web / collect_design / generateReport
 * @returns {string} 会话子文件夹绝对路径
 */
export function getSessionDir() {
  const now = Date.now()

  // 复用未超时的当前会话
  if (currentDir && now - lastUsedAt < SESSION_TIMEOUT) {
    lastUsedAt = now
    return currentDir
  }

  // 新建会话子文件夹：.devlint/<年月日_时分秒>
  currentTimestamp = sessionTimestamp()
  currentDir = join(process.cwd(), config.DIR_NAME, currentTimestamp)
  mkdirSync(currentDir, { recursive: true })
  lastUsedAt = now
  return currentDir
}

/**
 * 获取当前会话的时间戳字符串
 *
 * 与会话目录名保持一致（同一轮采集/检查共用），
 * 供报告文件名拼接使用（如 devlint_result_20260806_164959.md）。
 * 若当前无活跃会话（如被显式传入 dir 的报告调用），即时生成新时间戳。
 * @returns {string} 形如 20260806_164959
 */
export function getSessionTimestamp() {
  if (currentTimestamp && Date.now() - lastUsedAt < SESSION_TIMEOUT) {
    return currentTimestamp
  }
  return sessionTimestamp()
}

/**
 * 重置会话目录
 *
 * ui_style_check 成功生成报告后调用，标记本轮检查结束，
 * 下次采集工具调用时自动开启新的会话文件夹。
 */
export function resetSession() {
  currentDir = null
  currentTimestamp = null
  lastUsedAt = 0
  currentUserInfo = null
}

/**
 * 写入当前会话的用户信息
 *
 * 由 collect_design（getPixData）在采集时获取到 userInfo 后调用，
 * 供后续 ui_style_check 打点使用。
 * @param {Object} info - 用户信息对象
 */
export function setUserInfo(info) {
  if (typeof info === 'string') {
    try { info = JSON.parse(info) } catch { info = null }
  }
  currentUserInfo = info || null
}

/**
 * 读取当前会话的用户信息
 * @returns {Object|null}
 */
export function getUserInfo() {
  return currentUserInfo
}
