/**
 * 设计规范一致性检查 - 入口函数
 *
 * 【职责】
 * 1. puppeteer 打开 html 文件或 web 链接（含登录检测、无头降级有头等完整流程）
 * 2. 采集 DOM 树 JSON（含计算样式，不过滤视口外节点）
 * 3. domData + specName 丢进 specCheck（内网实现，外网空逻辑占位）
 * 4. 返回报告 JSON
 */

import { run } from '../../utils/puppeteer.js'
import { collectDomTree } from './collectDom.js'
import { specCheck } from './specCheck.js'
import { existsSync, writeFileSync } from 'fs'
import { resolve, isAbsolute, join } from 'path'
import { timestamp } from '../../utils/tools.js'
import { config } from '../../config.js'

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

  // puppeteer 打开页面，采集 DOM 树 JSON（不指定尺寸、不截图、不过滤视口外）
  const { domData } = await run(targetUrl, {
    collectFn: collectDomTree,
    headless: options.headless !== undefined ? options.headless : true,
  })

  // // 临时写入 .devlint 目录，便于调试
  // const dir = join(process.cwd(), config.DIR_NAME)
  // const domPath = join(dir, `uxcheck_dom_data_${timestamp()}.json`)
  // writeFileSync(domPath, JSON.stringify(domData), 'utf-8')

  // 丢进检查方法（内网实现，外网空逻辑占位）
  const report = await specCheck(domData, specName)

  return report
}
