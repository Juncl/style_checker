/**
 * Pixso 设计稿数据采集
 *
 * 依赖本目录 puppeteer.js 通道，在 Pixso 页面上下文中执行采集逻辑，
 * 返回 design.json 格式的设计稿数据（供 server parseDesign 消费）。
 *
 * 使用方式：
 *   import { collectPixData } from './getPixData.js'
 *   const { domData, screenshotBuffer } = await collectPixData(url)
 */

import { run } from './puppeteer.js'

/**
 * 在浏览器上下文执行的 Pixso 数据采集函数
 *
 * TODO: 将现有谷歌插件采集逻辑迁移至此
 *       现有逻辑负责：从 Pixso 页面中提取设计稿节点树数据
 */
const COLLECT_FN = () => {
  // TODO: 迁移现有 Pixso 采集逻辑
  return null
}

/**
 * 采集 Pixso 设计稿数据 + 截图
 * @param {string} url - Pixso 页面地址
 * @param {Object} options - 透传给 puppeteer.run 的选项（viewport / waitUntil 等）
 * @returns {Promise<{ domData: Object, screenshotBuffer: Buffer }>}
 */
export async function collectPixData(url, options = {}) {
  return run(url, { ...options, collectFn: COLLECT_FN })
}
