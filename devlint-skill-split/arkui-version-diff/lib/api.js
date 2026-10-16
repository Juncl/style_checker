/**
 * 服务调用
 *
 * - runVersionCompare: POST <serverUrl>/version/compare，两个版本文件 → 对比结果 JSON
 * - fetchHtmlReport:   POST <serverUrl>/report/html，结果 JSON + 截图 → 可视化 HTML 字符串
 *   （复用检查服务现有报告能力，报告内"设计侧"= base 旧版本、"开发侧"= target 新版本）
 *
 * serverUrl 即 config.CHECK_SERVER_URL（src/lib/config.js），由 bin 统一传入。
 * 失败时抛出带状态码的 Error，由 CLI 统一输出到 stderr。
 */

import { readFileSync } from 'fs'

/** 读取本地文件为上传 Blob（按扩展名推断 MIME） */
export function fileToBlob(filePath) {
  const buffer = readFileSync(filePath)
  const ext = filePath.toLowerCase().split('.').pop()
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
  return new Blob([buffer], { type: mime })
}

/**
 * 执行版本对比
 *
 * @param {{ basePath: string, targetPath: string, baseImagePath?: string, targetImagePath?: string, serverUrl: string }} input
 * @returns {Promise<object>} server 返回的对比结果
 */
export async function runVersionCompare(input) {
  const { basePath, targetPath, baseImagePath, targetImagePath, serverUrl } = input

  const form = new FormData()
  form.append('baseJson', fileToBlob(basePath), 'base.json')
  form.append('targetJson', fileToBlob(targetPath), 'target.json')
  if (baseImagePath) {
    form.append('baseImage', fileToBlob(baseImagePath), 'base.png')
  }
  if (targetImagePath) {
    form.append('targetImage', fileToBlob(targetImagePath), 'target.png')
  }

  let res
  try {
    res = await fetch(`${serverUrl}/version/compare`, {
      method: 'POST',
      body: form,
    })
  } catch (err) {
    throw new Error(`检查服务不可达 (${serverUrl}): ${err.message}，请确认服务已启动`)
  }

  if (!res.ok) {
    const errText = await res.text()
    let msg = errText
    try {
      msg = JSON.parse(errText).error || errText
    } catch { /* 非 JSON 错误体，原样展示 */ }
    throw new Error(`版本对比请求失败 (${res.status}): ${msg}`)
  }

  return res.json()
}

/**
 * 生成可视化 HTML 报告（复用检查服务现有报告接口）
 *
 * @param {{ result: object, baseImage?: { buffer: Buffer, name?: string }, targetImage?: { buffer: Buffer, name?: string }, serverUrl: string }} input
 * @returns {Promise<string>} 完整 HTML 字符串
 */
export async function fetchHtmlReport(input) {
  const { result, baseImage, targetImage, serverUrl } = input

  const form = new FormData()
  form.append('result', new Blob([JSON.stringify(result)], { type: 'application/json' }), 'result.json')
  if (baseImage?.buffer) {
    form.append('designImage', new Blob([baseImage.buffer], { type: 'image/png' }), baseImage.name || 'design.png')
  }
  if (targetImage?.buffer) {
    form.append('devImage', new Blob([targetImage.buffer], { type: 'image/png' }), targetImage.name || 'arkui.png')
  }

  let res
  try {
    res = await fetch(`${serverUrl}/report/html`, {
      method: 'POST',
      body: form,
    })
  } catch (err) {
    throw new Error(`报告服务不可达 (${serverUrl}): ${err.message}，请确认服务已启动`)
  }

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`HTML 报告生成失败 (${res.status}): ${errText.slice(0, 200)}`)
  }

  return res.text()
}
