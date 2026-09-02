import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, cpSync, rmSync, statSync } from 'fs'
import { extname, join } from 'path'
import { platform, homedir, tmpdir } from 'os'

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
 * 获取工具专用持久化 Chrome profile 目录（登录态仓库）
 *
 * 固定放用户主目录下（跨项目共享、不随工作目录迁移）：
 *   ~/.octo-uxlint/chrome-profile
 *
 * 无头 / 有头模式共用同一目录，形成登录态自愈闭环：
 *   - 有头登录一次 → Chrome 原生写入登录态（cookie / localStorage）
 *   - 无头读取同一目录复用登录态
 *   - cookie 过期 → 无头检测到登录页 → 降级有头重登 → 新登录态写回本目录
 *
 * 换账号 / 清空登录态：删除该目录即可。
 *
 * @returns {string} 持久 profile 目录绝对路径（自动创建）
 */
export function getPersistProfileDir() {
  const dir = join(homedir(), '.octo-uxlint', 'chrome-profile')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 判断持久 profile 是否已初始化（存在 Default 子目录且非空）
 *
 * 仅当 Chrome 在目录里生成过 profile 结构（Default 非空）才算已初始化，
 * 避免把刚创建的空目录误判为可用登录态。
 *
 * @returns {boolean}
 */
export function isPersistProfileReady() {
  try {
    const defaultDir = join(getPersistProfileDir(), 'Default')
    return existsSync(defaultDir) && readdirSync(defaultDir).length > 0
  } catch {
    return false
  }
}

/**
 * 获取设计侧（设计稿采集）专用持久化 Chrome profile 目录
 *
 *   ~/.octo-uxlint/design-profile
 *
 * 与开发侧 chrome-profile 分开的原因：采集是并发的（开发侧 + 设计侧同时跑），
 * 同一 userDataDir 无法被两个 Chrome 进程同时使用（SingletonLock 冲突、
 * localStorage LevelDB 锁互斥）。两侧各自独立 profile，天然并发安全。
 *
 * 设计侧登录是固定 URL + 持久 cookie：登录一次长期有效，分开的代价可忽略。
 *
 * @returns {string} profile 目录绝对路径（自动创建）
 */
export function getDesignProfileDir() {
  const dir = join(homedir(), '.octo-uxlint', 'design-profile')
  mkdirSync(dir, { recursive: true })
  return dir
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

// ── 登录态快照（auth snapshot）──────────────────────
// 目的：解决"会话 cookie / sessionStorage 站点每次采集都要重新登录"的问题。
// 原理：browser.close() 前把 cookie + localStorage 导出到 JSON 文件，
//       下次启动浏览器后注入回去，登录态变成文件级持久，不受浏览器会话生命周期影响。
// 存储：~/.octo-uxlint/auth-snapshots/<hostname>.json
//  - cookies: CDP Storage.getCookies 导出的全量 cookie（含 SSO 跳转链各域），
//    会话 cookie（无 expires）补远期有效期后写入，"转正"为持久 cookie
//  - localStorage: 按页面对应域导出的键值对
//  - savedAt: 保存时间，注入时可做过期控制（默认 7 天）

/** 快照目录 */
export function getAuthSnapshotDir() {
  const dir = join(homedir(), '.octo-uxlint', 'auth-snapshots')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 快照文件路径（按 hostname 一站一文件） */
export function getAuthSnapshotPath(url) {
  const host = new URL(url).hostname
  return join(getAuthSnapshotDir(), `${host}.json`)
}

/** 快照有效期（ms），默认 7 天 */
const AUTH_SNAPSHOT_TTL = 7 * 24 * 60 * 60 * 1000

/**
 * 读取快照（存在且未过期）
 * @returns {Object|null} { cookies: [], localStorage: {}, savedAt: number }
 */
export function loadAuthSnapshot(url) {
  try {
    const file = getAuthSnapshotPath(url)
    if (!existsSync(file)) return null
    const snap = JSON.parse(readFileSync(file, 'utf-8'))
    if (!snap || typeof snap !== 'object') return null
    if (Date.now() - (snap.savedAt || 0) > AUTH_SNAPSHOT_TTL) return null
    return snap
  } catch {
    return null
  }
}

/**
 * 写入快照
 * @param {string} url - 目标页 URL（取 hostname 作文件名）
 * @param {Array} cookies - CDP Storage.getCookies 返回的 cookie 数组
 * @param {Object} localStorage - 页面 localStorage 键值对象
 */
export function saveAuthSnapshot(url, cookies, localStorageData) {
  try {
    const snap = {
      version: 1,
      savedAt: Date.now(),
      cookies: cookies || [],
      localStorage: localStorageData || {},
    }
    writeFileSync(getAuthSnapshotPath(url), JSON.stringify(snap), 'utf-8')
  } catch (err) {
    console.error(`[快照保存失败] ${err.message}`)
  }
}

/**
 * 清理持久 profile 中可再生的大体积缓存目录（登录态不受影响）
 * 每次 close 后调用，防止 chrome-profile 无限膨胀
 */
const PROFILE_CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'Service Worker', 'Media Cache']
export function cleanupProfileCaches() {
  try {
    const profileDefault = join(getPersistProfileDir(), 'Default')
    if (!existsSync(profileDefault)) return
    for (const d of PROFILE_CACHE_DIRS) {
      const target = join(profileDefault, d)
      if (existsSync(target) && statSync(target).isDirectory()) {
        rmSync(target, { recursive: true, force: true })
      }
    }
  } catch {}
}
