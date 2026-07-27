import { existsSync, readFileSync } from 'fs'
import { extname } from 'path'
import { platform } from 'os'

/**
 * 获取 Chrome 可执行路径
 * 优先级：环境变量 CHROME_PATH > 跨平台自动查找 > null（回退自带 Chromium）
 */
export function getChromePath() {
  // 用户通过 env 自定义浏览器路径
  const envPath = process.env.CHROME_PATH
  if (envPath && existsSync(envPath)) return envPath

  // 跨平台自动查找
  const candidates = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ],
    win32: [
      `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    ],
  }

  const list = candidates[platform()] || []
  for (const p of list) {
    if (p && existsSync(p)) return p
  }
  return null
}

/**
 * 读取文件为 Blob，支持 JSON 和图片
 */
export function fileToBlob(filePath, fallbackType = 'application/json') {
  const buf = readFileSync(filePath)
  const ext = extname(filePath).toLowerCase()
  const type =
    ext === '.png' ? 'image/png' :
    ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
    fallbackType
  return new Blob([buf], { type })
}

/**
 * 生成时间戳：月日时分秒
 */
export function timestamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}
