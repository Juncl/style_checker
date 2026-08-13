/**
 * 设计规范一致性检查 - 入口函数
 *
 * 【职责】
 * 1. puppeteer 打开 html 文件或 web 链接（含登录检测、无头降级有头等完整流程）
 * 2. specCheck 注入浏览器上下文执行，直接访问 document
 * 3. 返回报告 JSON
 */

import { run } from '../getWebDom/puppeteer.js'
import { specCheck } from './specCheck.js'
import { existsSync } from 'fs'
import { resolve, isAbsolute } from 'path'

/**
 * 设计规范一致性检查入口函数
 *
 * @param {string} source - 检查目标，本地 html 文件路径或 web 页面 URL
 * @param {string} specName - 规范名称（用户输入，如 "Octo"）
 * @param {Object} [options] - 采集选项
 *   - viewport: { width, height, deviceScaleFactor }
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

  // puppeteer 打开页面，specCheck 在浏览器内执行，直接访问 document
  const { domData: report } = await run(targetUrl, {
    collectFn: specCheck,
    evaluateArgs: [specName],
    needScreenshot: false,
    headless: options.headless !== undefined ? options.headless : true,
    viewport: options.viewport,
  })

  return report
}
