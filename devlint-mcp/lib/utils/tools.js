import { existsSync, readFileSync, mkdirSync, copyFileSync, readdirSync, cpSync, rmSync } from 'fs'
import { extname, join } from 'path'
import { platform, homedir, tmpdir } from 'os'
import { detectDslVersion, convertDsl2To1 } from '../collectData/getPixData/dsl2to1.js'

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

/**
 * 获取用户日常 Chrome profile 目录（用于复用登录态）
 *
 * 各平台默认路径：
 *   - Windows: %LOCALAPPDATA%\Google\Chrome\User Data
 *   - macOS:   ~/Library/Application Support/Google/Chrome
 *   - Linux:   ~/.config/google-chrome
 *
 * @returns {string|null} profile 目录路径，不存在则返回 null
 */
export function getChromeUserDataDir() {
  const candidates = {
    darwin: [join(homedir(), 'Library/Application Support/Google/Chrome')],
    win32: [
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google/Chrome/User Data') : null,
    ],
    linux: [join(homedir(), '.config/google-chrome')],
  }

  const list = candidates[platform()] || []
  for (const p of list) {
    if (p && existsSync(p)) return p
  }
  return null
}

/**
 * 需要复制的登录态文件（位于 Default 子目录下）
 * - 单文件：cookie / 登录数据 / 偏好
 * - 目录（递归复制）：localStorage、Session Storage
 *
 * 注意：不复制 IndexedDB（可能几百 MB~几 GB，性能开销大，且鉴权场景极少依赖）
 */
const ROOT_LOGIN_FILES = ['Local State']
const PROFILE_LOGIN_FILES = [
  'Cookies', 'Login Data', 'Login Data For Account',
  'Web Data', 'Preferences', 'History',
]
const PROFILE_LOGIN_DIRS = [
  'Local Storage',    // localStorage（LevelDB）
  'Session Storage',  // sessionStorage（LevelDB）
]

/**
 * 复制用户 Chrome profile 的登录态文件到临时目录
 *
 * 复制 cookie + localStorage + sessionStorage + IndexedDB，
 * 用副本启动浏览器，既复用完整登录态又不影响用户日常使用。
 *
 * @param {string} srcUserDataDir - 用户日常 Chrome User Data 目录
 * @returns {string} 临时 user-data-dir 路径
 */
export function cloneChromeProfile(srcUserDataDir) {
  const tmpDir = join(tmpdir(), `chrome-debug-${Date.now()}`)
  const defaultProfile = join(srcUserDataDir, 'Default')

  mkdirSync(tmpDir, { recursive: true })

  // 复制根目录文件（Local State 等）
  for (const f of ROOT_LOGIN_FILES) {
    const src = join(srcUserDataDir, f)
    if (existsSync(src)) {
      try { copyFileSync(src, join(tmpDir, f)) } catch {}
    }
  }

  // 复制 Default profile 的登录态文件
  if (existsSync(defaultProfile)) {
    const dstProfile = join(tmpDir, 'Default')
    mkdirSync(dstProfile, { recursive: true })

    // 单文件
    for (const f of PROFILE_LOGIN_FILES) {
      const src = join(defaultProfile, f)
      if (existsSync(src)) {
        try { copyFileSync(src, join(dstProfile, f)) } catch {}
      }
    }

    // 目录（递归复制）
    for (const d of PROFILE_LOGIN_DIRS) {
      const src = join(defaultProfile, d)
      if (existsSync(src)) {
        try { cpSync(src, join(dstProfile, d), { recursive: true }) } catch {}
      }
    }
  }

  return tmpDir
}

/**
 * 清理临时 profile 目录
 */
export function cleanupTempProfile(dir) {
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
}

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
    throw new Error('设计稿 JSON 不是有效的 DSL 格式（缺少 manifest+data 或 meta+content），无法进行检查')
  }

  const finalObj = version === '2.0' ? convertDsl2To1(obj).data : obj
  return new Blob([JSON.stringify(finalObj)], { type: 'application/json' })
}
