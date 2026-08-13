/**
 * 设计规范一致性检查 - 入口函数
 *
 * 【职责】
 * 1. puppeteer 打开 html 文件或 web 链接（含登录检测、无头降级有头等完整流程）
 * 2. 拿到 document.body.outerHTML
 * 3. body + specName 丢进 specCheck（内网实现，外网空逻辑占位）
 * 4. 返回报告 JSON
 */

import { run } from '../../utils/puppeteer.js'
import { specCheck } from './specCheck.js'
import { existsSync } from 'fs'
import { resolve, isAbsolute } from 'path'

/**
 * 在浏览器上下文获取 document.body.outerHTML
 */
const collectBodyHtml = () => document.body.outerHTML

/**
 * 设计规范一致性检查入口函数
 *
 * @param {string} source - 检查目标，本地 html 文件路径或 web 页面 URL
 * @param {string} specName - 规范名称（用户输入，如 "Octo"）
 * @param {Object} [options] - 采集选项
 *   - headless: 是否无头模式，默认 true
 * @returns {Promise<Object>} 报告 JSON
 */
export async function uxCheck(source, specName, options = {}) {
  // 判断 source 类型：URL 还是本地 html 文件
  const isUrl = /^https?:\/\//i.test(source)
  let targetUrl

  if (isUrl) {
    targetUrl = source
  } else {
    if (!existsSync(source)) {
      throw new Error(`文件不存在: ${source}`)
    }
    const absPath = isAbsolute(source) ? source : resolve(process.cwd(), source)
    targetUrl = 'file://' + absPath
  }

  // puppeteer 打开页面，拿 document.body.outerHTML
  const { domData: bodyHtml } = await run(targetUrl, {
    collectFn: collectBodyHtml,
    headless: options.headless !== undefined ? options.headless : true,
  })

  // 丢进检查方法（内网实现，外网空逻辑占位）
  const report = await specCheck(bodyHtml, specName)

  return report
}
