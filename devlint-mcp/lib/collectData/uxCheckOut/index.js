/**
 * 设计规范一致性检查 - 入口函数
 *
 * 【职责】
 * 1. puppeteer 打开 html 文件或 web 链接（含登录检测、无头降级有头等完整流程）
 * 2. 采集 DOM 树 JSON（含计算样式，不过滤视口外节点）
 * 3. domData + specFilePaths 丢进 specCheck（POST 合规检查接口）
 * 4. 返回报告 JSON
 */

import { run } from '../../utils/puppeteer.js'
import { collectDomTree } from './collectDom.js'
import { specCheck } from './specCheck.js'
import { existsSync } from 'fs'
import { resolve, isAbsolute } from 'path'

/**
 * 设计规范一致性检查入口函数
 *
 * @param {string} source - 检查目标，本地 html 文件路径或 web 页面 URL
 * @param {string[]} specFilePaths - 规则文件路径数组（来自 list_design_specs 的 filePaths）
 * @param {Object} [options] - 采集选项
 *   - headless: 是否无头模式，默认 true
 * @returns {Promise<Object>} 报告 JSON
 */
export async function uxCheck(source, specFilePaths, options = {}) {
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

  // POST 合规检查接口
  const report = await specCheck(domData, specFilePaths)

  return report
}
