/**
 * 设计稿 JSON 加载（Blob 形式，供上传检查接口）
 *
 * 从 utils/tools.js 迁移而来：loadDesignJsonAsBlob 只有 server.js（collect_design →
 * ui_style_check 链路）使用，且依赖本目录 dsl2to1.js，放在 getPixData 目录
 * 让依赖收敛在功能文件夹内部，design-system-checker 等下游打包不再被牵连。
 */

import { readFileSync } from 'fs'
import { detectDslVersion, convertDsl2To1 } from './dsl2to1.js'

/**
 * 读取设计稿 JSON 并转成 Blob
 * 自动识别 DSL 版本：1.0 直接用，2.0 先转 1.0，非 dsl 抛异常中断
 */
export function loadDesignJsonAsBlob(designJsonPath) {
  const raw = readFileSync(designJsonPath, 'utf-8')
  let obj
  try {
    obj = JSON.parse(raw)
  } catch {
    throw new Error('设计稿 JSON 解析失败，请检查文件内容是否为合法 JSON')
  }

  const version = detectDslVersion(obj)
  if (version === '非dsl') {
    throw new Error('设计稿 JSON 不是有效的格式，无法进行检查')
  }

  const finalObj = version === '2.0' ? convertDsl2To1(obj).data : obj
  return new Blob([JSON.stringify(finalObj)], { type: 'application/json' })
}
