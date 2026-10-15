/**
 * design-checker 网页采集 puppeteer 通道
 *
 * 【来源】参考 devlint-mcp/lib/collectData/getWebDom/puppeteer.js 及其依赖的
 * utils/tools.js 相关函数重写——skill 自有源码，不依赖 mcp 工程，build 不做拷贝。
 *
 * 【相对 mcp 版的精简】
 * - 去掉截图（Page.captureScreenshot）、CDP 设备仿真（emulateDevice）与视口/分辨率
 *   设置——采集只需页面资源（HTML/CSS/JS 文件），与渲染尺寸无关
 * - 去掉设计侧 profile（getDesignProfileDir）等采集无关函数
 * - 对外仅导出 run()（collectWeb 经动态 import 惰性加载，本地文件检查模式不触发，
 *   不拉起 puppeteer-core 依赖）
 * - 新增有头模式"采集中请勿关闭"提示条（injectCollectBanner，防用户误关窗口）
 *
 * 【保留的核心能力】（与 mcp 版逻辑等价）
 * - profile 三级回退：显式 userDataDir > 持久 profile（~/.octo-uxlint/chrome-profile，
 *   已初始化则复用登录态）> 克隆日常 Chrome（冷启动，找不到则空白 profile）
 * - 登录态闭环：close 前导出全量 cookie（会话 cookie 补远期"转正"）+ localStorage 到
 *   ~/.octo-uxlint/auth-snapshots/<hostname>.json，下次启动前注入，登录态文件级持久
 * - 登录页检测 + 有头降级：无头模式检测到重定向 / 导航失败等 → 自动降级有头
 *   （同一持久 profile），用户在弹出窗口手动登录后继续采集，登录态写回下次免登
 */

import puppeteer from 'puppeteer-core'
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, cpSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { platform, homedir, tmpdir } from 'os'

// ── Chrome 探测与 profile 管理 ──────────────────────────

/** Chrome 可执行路径：环境变量 CHROME_PATH > 跨平台自动查找 > null */
function getChromePath() {
  const envPath = process.env.CHROME_PATH
  if (envPath && existsSync(envPath)) return envPath

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

const CHROME_PATH = getChromePath()

/** 用户日常 Chrome profile 目录（各平台默认路径，用于冷启动时克隆登录态） */
function getChromeUserDataDir() {
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

/** 工具专用持久化 Chrome profile 目录（登录态仓库）：~/.octo-uxlint/chrome-profile。
 *  无头 / 有头共用同一目录形成登录态自愈闭环：有头登录一次 → 登录态落盘 →
 *  无头复用 → cookie 过期 → 无头检测到登录页 → 降级有头重登 → 新登录态写回。
 *  换账号 / 清空登录态：删除该目录即可 */
function getPersistProfileDir() {
  const dir = join(homedir(), '.octo-uxlint', 'chrome-profile')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 持久 profile 是否已初始化（存在 Default 子目录且非空，避免空目录误判为可用登录态） */
function isPersistProfileReady() {
  try {
    const defaultDir = join(getPersistProfileDir(), 'Default')
    return existsSync(defaultDir) && readdirSync(defaultDir).length > 0
  } catch {
    return false
  }
}

/** 需要复制的登录态文件（Default 子目录下）：单文件 + 目录（递归）。
 *  不复制 IndexedDB（可能几百 MB~几 GB，鉴权场景极少依赖） */
const ROOT_LOGIN_FILES = ['Local State']
const PROFILE_LOGIN_FILES = [
  'Cookies', 'Login Data', 'Login Data For Account',
  'Web Data', 'Preferences', 'History',
]
const PROFILE_LOGIN_DIRS = [
  'Local Storage',    // localStorage（LevelDB）
  'Session Storage',  // sessionStorage（LevelDB）
]

/** 克隆用户日常 Chrome profile 的登录态到临时目录（cookie + localStorage +
 *  sessionStorage），用副本启动浏览器，既复用登录态又不影响用户日常使用 */
function cloneChromeProfile(srcUserDataDir) {
  const tmpProfileDir = join(tmpdir(), `chrome-debug-${Date.now()}`)
  const defaultProfile = join(srcUserDataDir, 'Default')

  mkdirSync(tmpProfileDir, { recursive: true })

  for (const f of ROOT_LOGIN_FILES) {
    const src = join(srcUserDataDir, f)
    if (existsSync(src)) {
      try { copyFileSync(src, join(tmpProfileDir, f)) } catch {}
    }
  }

  if (existsSync(defaultProfile)) {
    const dstProfile = join(tmpProfileDir, 'Default')
    mkdirSync(dstProfile, { recursive: true })

    for (const f of PROFILE_LOGIN_FILES) {
      const src = join(defaultProfile, f)
      if (existsSync(src)) {
        try { copyFileSync(src, join(dstProfile, f)) } catch {}
      }
    }

    for (const d of PROFILE_LOGIN_DIRS) {
      const src = join(defaultProfile, d)
      if (existsSync(src)) {
        try { cpSync(src, join(dstProfile, d), { recursive: true }) } catch {}
      }
    }
  }

  return tmpProfileDir
}

/** 清理临时 profile 目录 */
function cleanupTempProfile(dir) {
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
}

/** 清理持久 profile 中可再生的大体积缓存目录（登录态不受影响），防目录膨胀 */
const PROFILE_CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'Service Worker', 'Media Cache']
function cleanupProfileCaches() {
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

// ── 登录态快照（auth snapshot）────────────────────────
// 目的：解决"会话 cookie / sessionStorage 站点每次采集都要重新登录"的问题。
// close 前导出 cookie + localStorage 到 JSON，下次启动后注入，登录态文件级持久。
// 存储：~/.octo-uxlint/auth-snapshots/<hostname>.json

/** 快照目录 */
function getAuthSnapshotDir() {
  const dir = join(homedir(), '.octo-uxlint', 'auth-snapshots')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 快照文件路径（按 hostname 一站一文件） */
function getAuthSnapshotPath(url) {
  const host = new URL(url).hostname
  return join(getAuthSnapshotDir(), `${host}.json`)
}

/** 快照有效期（ms），默认 7 天 */
const AUTH_SNAPSHOT_TTL = 7 * 24 * 60 * 60 * 1000

/** 读取快照（存在且未过期）：{ cookies: [], localStorage: {}, savedAt: number } | null */
function loadAuthSnapshot(url) {
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

/** 写入快照（cookie 数组 + localStorage 键值对象） */
function saveAuthSnapshot(url, cookies, localStorageData) {
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

// ── 浏览器通道 ──────────────────────────────────────────

const DEFAULT_LAUNCH_OPTIONS = {
  headless: true,
  ignoreHTTPSErrors: true,
  ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
}

/** 页面渲染等待时间(ms) */
const DEFAULT_RENDER_WAIT = 8000

/** 有头模式等待用户操作的最大时长（ms） */
const HEADED_LOGIN_TIMEOUT = 180000

/**
 * 有头模式的页面提示条：顶部固定横幅"采集中请勿关闭"，防止用户误关浏览器窗口导致
 * 采集失败。经 evaluateOnNewDocument 注册——每次导航（含登录跳转链的每一页）自动
 * 重新注入。
 * 🔴 产物纯净约定：横幅 id = '__devlint_collect_banner__'，collectFn 序列化
 * outerHTML 前须按此 id 移除该元素（见 collectWeb.js 的 pageAssetsCollector）；
 * 函数经序列化在页面执行，🔴 不可引用外部常量，id 字面量与此处保持一致
 */
function injectCollectBanner() {
  const BANNER_ID = '__devlint_collect_banner__'
  const insert = () => {
    if (document.getElementById(BANNER_ID) || !document.body) return
    const el = document.createElement('div')
    el.id = BANNER_ID
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;box-sizing:border-box;padding:10px 16px;text-align:center;font-size:14px;font-weight:600;color:#fff;background:rgba(250,173,20,.92);pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;'
    el.textContent = '⏳ 正在采集中，请勿关闭此页面或浏览器窗口，采集完成后将自动关闭'
    document.body.appendChild(el)
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', insert, { once: true })
  } else {
    insert()
  }
}

/** 无 Chrome 时的统一报错（含 env 配置指引） */
function requireChromePath() {
  throw new Error(
    '未找到 Chrome 浏览器。请通过 env 配置 CHROME_PATH 指定 Chrome 可执行文件路径，' +
    '例如：{ "env": { "CHROME_PATH": "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe" } }'
  )
}

/** 带重试的浏览器启动：前一个实例关闭后 SingletonLock 释放可能有延迟，失败后间隔 1 秒重试 */
async function launchWithRetry(launchOptions, retries = 3) {
  let lastErr = null
  for (let i = 0; i < retries; i++) {
    try {
      return await puppeteer.launch(launchOptions)
    } catch (err) {
      lastErr = err
      if (i < retries - 1) {
        console.error(`[浏览器启动失败] ${err.message}，1秒后重试（${i + 1}/${retries - 1}）...`)
        await new Promise(r => setTimeout(r, 1000))
      }
    }
  }
  throw new Error(
    `浏览器启动失败（已重试 ${retries} 次）：${lastErr.message}。` +
    '若之前弹出的浏览器窗口仍在，请先关闭后重试。'
  )
}

/**
 * 启动无头浏览器实例（默认模式）
 * profile 三级回退：① options.userDataDir 显式指定 ② 持久 profile 已初始化则复用
 * ③ 克隆用户日常 Chrome（找不到则空白 profile）
 * @returns {Promise<{ browser: Browser, tempProfileDir: string|null }>}
 *   tempProfileDir 为 null 表示使用持久/外部 profile，关闭时不做清理
 */
async function launch(options = {}) {
  if (!CHROME_PATH) requireChromePath()

  let tempProfileDir = null
  const args = [...DEFAULT_LAUNCH_OPTIONS.args]

  if (options.userDataDir) {
    args.push(`--user-data-dir=${options.userDataDir}`)
    delete options.userDataDir
  } else if (isPersistProfileReady()) {
    args.push(`--user-data-dir=${getPersistProfileDir()}`)
  } else {
    const srcUserDataDir = getChromeUserDataDir()
    if (srcUserDataDir) {
      tempProfileDir = cloneChromeProfile(srcUserDataDir)
      args.push(`--user-data-dir=${tempProfileDir}`)
    }
  }

  const browser = await puppeteer.launch({ ...DEFAULT_LAUNCH_OPTIONS, args, ...options })
  return { browser, tempProfileDir }
}

/** 关闭浏览器并清理临时 profile */
async function close(browser, tempProfileDir = null) {
  if (!browser) return
  await browser.close()
  if (tempProfileDir) cleanupTempProfile(tempProfileDir)
}

// ── 登录态快照：导出 / 注入 ──────────────────────────

/** 会话 cookie 补的远期有效期（自导出时刻起 +7 天，ms） */
const SNAPSHOT_COOKIE_EXTEND_MS = 7 * 24 * 60 * 60 * 1000

/** close 前导出全量登录态快照（cookie 含 SSO 跳转链各域，会话 cookie 补远期"转正"） */
async function exportAuthSnapshot(browser, page, url) {
  try {
    const cdp = await page.createCDPSession()
    const { cookies } = await cdp.send('Storage.getCookies')
    await cdp.detach()
    const patched = (cookies || []).map(c => ({
      ...c,
      expires: (c.expires && c.expires > 0)
        ? c.expires
        : Math.floor((Date.now() + SNAPSHOT_COOKIE_EXTEND_MS) / 1000),
    }))

    let localStorageData = {}
    try {
      localStorageData = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))
    } catch {}

    saveAuthSnapshot(url, patched, localStorageData)
    console.error(`[登录态快照] 已保存 ${patched.length} 条 cookie（含 SSO 域）+ ${Object.keys(localStorageData).length} 条 localStorage`)
  } catch (err) {
    console.error(`[登录态快照] 导出失败（不影响本次采集）：${err.message}`)
  }
}

/** 启动浏览器后、导航前注入登录态快照（无快照时静默跳过） */
async function injectAuthSnapshot(browser, url) {
  const snap = loadAuthSnapshot(url)
  if (!snap || !snap.cookies?.length) return
  try {
    // 只挑 setCookies 接受的输入字段（getCookies 返回的 size/session 等输出字段部分版本会报协议错误）
    const cookies = snap.cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    }))
    const pages = await browser.pages()
    const cdp = await pages[0].target().createCDPSession()
    await cdp.send('Storage.setCookies', { cookies })
    await cdp.detach()
    console.error(`[登录态快照] 已注入 ${cookies.length} 条 cookie（保存于 ${new Date(snap.savedAt).toLocaleString()}）`)
  } catch (err) {
    console.error(`[登录态快照] 注入失败（继续走原流程）：${err.message}`)
  }
}

/** 关闭浏览器并做登录态收尾：① close 前导出快照 ② close 后清理 profile 缓存目录 */
async function closeWithSnapshot(browser, page, url, tempProfileDir = null) {
  if (!browser) return
  if (page && url) {
    await exportAuthSnapshot(browser, page, url)
  }
  await browser.close()
  if (tempProfileDir) cleanupTempProfile(tempProfileDir)
  cleanupProfileCaches()
}

// ── 登录页检测 ──────────────────────────────────────────

/** 登录页 hostname 子域名特征前缀 */
const LOGIN_HOST_PREFIXES = ['login.', 'signin.', 'sign-in.', 'sso.', 'passport.', 'idp.', 'auth.']

/** 登录页 pathname 特征片段 */
const LOGIN_PATH_SEGMENTS = ['/login', '/signin', '/sign-in', '/sign_in', '/signon', '/sso', '/oauth', '/passport', '/idp', '/authorize', '/auth/']

/** 综合 hostname 子域名特征 + pathname 路径片段判断是否为登录页地址 */
function isLoginUrl(urlStr) {
  if (!urlStr) return false
  try {
    const u = new URL(urlStr)
    const host = u.hostname.toLowerCase()
    const path = (u.pathname + u.search).toLowerCase()
    if (LOGIN_HOST_PREFIXES.some(h => host.startsWith(h) || host.includes('.' + h))) return true
    if (LOGIN_PATH_SEGMENTS.some(p => path.includes(p))) return true
    return false
  } catch {
    const lower = urlStr.toLowerCase()
    return LOGIN_PATH_SEGMENTS.some(p => lower.includes(p))
  }
}

/** 判断是否发生了重定向（origin 或 pathname 变化即视为跳转） */
function isRedirected(originalUrl, finalUrl) {
  if (!originalUrl || !finalUrl) return false
  try {
    const a = new URL(originalUrl)
    const b = new URL(finalUrl)
    return a.origin !== b.origin || a.pathname !== b.pathname
  } catch {
    return finalUrl !== originalUrl
  }
}

/** 判断当前页面是否需要用户手动操作（登录页 / 浏览器错误页 / 空白页）。
 *  🔴 目的导向（区别于 mcp 的"URL 必须与目标一致"判定）：只要页面离开"需人工
 *  介入"状态即视为完成——SSO 登录后无论回到目标页还是站点首页都能继续采集 */
function needsManualAction(urlStr) {
  if (!urlStr) return true
  if (urlStr.startsWith('chrome-error')) return true
  if (urlStr === 'about:blank') return true
  return isLoginUrl(urlStr)
}

/** 检测当前页面是否被登录拦截。
 *  🔴 目的导向收紧（区别于 mcp 的 DOM 采集）：重定向 ≠ 登录拦截——站点正常跳转
 *  （补尾斜杠 / locale 前缀 / 302 到新 path）时最终页可直接采集，不降级有头；
 *  只有"发生重定向且落点命中登录页特征"才视为被登录拦截 */
async function detectLoginPage(page, originalUrl) {
  const finalUrl = page.url()
  const redirected = isRedirected(originalUrl, finalUrl)
  const loginLike = redirected && isLoginUrl(finalUrl)
  console.error(`[detectLoginPage] originalUrl=${originalUrl}`)
  console.error(`[detectLoginPage] finalUrl=${finalUrl}`)
  console.error(`[detectLoginPage] redirected=${redirected}, loginLike=${loginLike}`)

  if (loginLike) {
    return {
      isLogin: true,
      reason: `页面被重定向到登录页：${originalUrl} → ${finalUrl}`,
      finalUrl,
    }
  }

  return { isLogin: false, reason: '', finalUrl }
}

/**
 * 有头模式采集（降级方案）：专用持久 profile 启动有头 Chrome，用户在弹出窗口中
 * 手动操作（登录、跳过证书拦截等），检测到到达目标页面后自动采集。
 * 登录态由 Chrome 原生写入持久 profile，后续无头采集自动复用。
 * 页面顶部自动注入"采集中请勿关闭"提示条（injectCollectBanner），防用户误关窗口。
 * @param {string} url - 目标页面地址
 * @param {Object} options - 采集选项（collectFn / waitUntil / timeout / waitForRender）
 * @returns {Promise<{ domData: Object|null }>}
 */
async function runHeadedWithProfile(url, options = {}) {
  const {
    collectFn,
    waitUntil,
    timeout,
    waitForRender = DEFAULT_RENDER_WAIT,
  } = options

  if (!CHROME_PATH) requireChromePath()

  const browser = await launchWithRetry({
    executablePath: CHROME_PATH,
    headless: false,
    ignoreHTTPSErrors: true,
    userDataDir: getPersistProfileDir(),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized', '--ignore-certificate-errors'],
    defaultViewport: null,
  })
  let closed = false

  try {
    const page = await browser.newPage()
    // 有头模式同样注入快照（若上次留有有效登录态，弹窗里直接是已登录状态）
    await injectAuthSnapshot(browser, url)
    // 提示条：每次导航自动注入"采集中请勿关闭"横幅（🔴 collectFn 采集前按约定 id 移除）
    await page.evaluateOnNewDocument(injectCollectBanner)

    // 导航失败不抛错（如证书拦截、超时等），让用户在窗口中手动操作
    try {
      await page.goto(url, {
        waitUntil: waitUntil || 'domcontentloaded',
        timeout: timeout || 60000,
      })
    } catch (navErr) {
      console.error(`[有头-导航失败] ${navErr.message}，等待用户手动操作浏览器...`)
    }

    // 等待页面重定向稳定（URL 连续 3 秒不变才算稳定，最多等 20 秒）
    let lastUrl = page.url()
    let stableTime = 0
    const waitStart = Date.now()
    while (Date.now() - waitStart < 20000) {
      await new Promise(r => setTimeout(r, 1000))
      const currentUrl = page.url()
      if (currentUrl === lastUrl) {
        stableTime += 1000
        if (stableTime >= 3000) break
      } else {
        stableTime = 0
        lastUrl = currentUrl
      }
    }
    console.error(`[有头-URL稳定后] page.url()=${page.url()} 等待耗时=${Date.now() - waitStart}ms`)

    // 页面仍处于需人工介入状态（登录页/证书错误页/空白页）→ 等待用户处理；
    // 完成 = 页面离开该状态（登录后无论回到目标页还是站点首页都算，见 needsManualAction）
    if (needsManualAction(page.url())) {
      console.error(`[有头-等待用户操作] 当前URL=${page.url()}（登录/错误页），等待用户处理...`)
      const start = Date.now()
      while (Date.now() - start < HEADED_LOGIN_TIMEOUT) {
        await new Promise(r => setTimeout(r, 2000))
        // 连续 3 次（每次间隔 2 秒）确认页面已离开需人工介入状态
        if (!needsManualAction(page.url())) {
          await new Promise(r => setTimeout(r, 2000))
          if (!needsManualAction(page.url())) {
            await new Promise(r => setTimeout(r, 2000))
            if (!needsManualAction(page.url())) {
              break
            }
          }
        }
      }
      if (Date.now() - start >= HEADED_LOGIN_TIMEOUT) {
        const err = new Error(
          `等待用户操作超时（${HEADED_LOGIN_TIMEOUT / 1000}秒），请确认已在弹出的浏览器窗口中完成操作后重试。`
        )
        err.code = 'LOGIN_TIMEOUT'
        throw err
      }
    }

    if (waitForRender > 0) {
      await new Promise(r => setTimeout(r, waitForRender))
    }

    const domData = collectFn ? await page.evaluate(collectFn) : null

    // 有头登录成功采集完成 → 导出快照（会话 cookie 转正），下次无头免登
    await closeWithSnapshot(browser, page, url)
    closed = true
    return { domData }
  } finally {
    if (!closed) {
      try { await browser.close() } catch {}
      cleanupProfileCaches()
    }
  }
}

/**
 * 完整采集流程（通道层唯一对外入口，collectWeb 动态 import 调用）
 *
 * 1. headless=true（默认）：无头模式，profile 三级回退 + 导航前注入登录态快照；
 *    无头阶段任何失败（导航超时、自签名证书拦截、网络错误、检测到登录页等）
 *    → 自动降级有头模式（同一持久 profile，用户手动登录后登录态落盘，下次免登）
 * 2. headless=false：直接有头模式（持久 profile），弹出浏览器窗口让用户操作后采集
 *
 * @param {string} url - 目标页面地址
 * @param {Object} options
 *   - collectFn: 在页面上下文执行的采集函数（🔴 自包含，不可引用闭包变量），签名: () => Object
 *   - waitUntil: 页面加载策略，默认 domcontentloaded
 *   - timeout: 页面导航超时，默认 60000
 *   - waitForRender: 渲染等待时间(ms)，默认 8000
 *   - headless: 是否无头模式，默认 true
 *   - launchOptions: puppeteer.launch 额外选项（如 userDataDir）
 * @returns {Promise<{ domData: Object|null }>} collectFn 的返回值（可序列化数据）
 */
export async function run(url, options = {}) {
  const {
    collectFn,
    waitUntil,
    timeout,
    waitForRender = DEFAULT_RENDER_WAIT,
    headless = true,
    launchOptions,
  } = options

  // headless=false → 直接走有头模式
  if (headless === false) {
    return await runHeadedWithProfile(url, options)
  }

  // 无头模式（profile 三级回退复用登录态）；任何失败 → 自动降级有头模式
  const { browser, tempProfileDir } = await launch(launchOptions)
  let closed = false
  try {
    const page = await browser.newPage()
    // 导航前注入登录态快照（会话 cookie 站点免重登的关键）
    await injectAuthSnapshot(browser, url)
    await page.goto(url, {
      waitUntil: waitUntil || 'domcontentloaded',
      timeout: timeout || 60000,
    })
    // 等待页面重定向稳定（URL 连续 3 秒不变才算稳定，最多等 20 秒）
    let lastUrl = page.url()
    let stableTime = 0
    const waitStart = Date.now()
    while (Date.now() - waitStart < 20000) {
      await new Promise(r => setTimeout(r, 1000))
      const currentUrl = page.url()
      if (currentUrl === lastUrl) {
        stableTime += 1000
        if (stableTime >= 3000) break
      } else {
        stableTime = 0
        lastUrl = currentUrl
      }
    }
    console.error(`[URL稳定后] page.url()=${page.url()} 等待耗时=${Date.now() - waitStart}ms`)
    const loginCheck = await detectLoginPage(page, url)
    if (loginCheck.isLogin) {
      // 无头检测到登录页 → 关闭无头，降级有头让用户手动登录
      console.error('[无头采集失败] 原因：检测到登录页，自动降级有头模式')
      await closeWithSnapshot(browser, page, url, tempProfileDir)
      closed = true
      return await runHeadedWithProfile(url, options)
    }
    const domData = collectFn ? await page.evaluate(collectFn) : null
    // 采集成功，close 前导出登录态快照（服务端续期后的最新 cookie 一并存档）
    await closeWithSnapshot(browser, page, url, tempProfileDir)
    closed = true
    return { domData }
  } catch (headlessErr) {
    // 无头采集失败（导航超时、自签名证书拦截、网络错误等）→ 自动降级有头模式
    console.error(`[无头采集失败] 原因：${headlessErr.message}，自动降级有头模式`)
    if (!closed) {
      try { await close(browser, tempProfileDir) } catch {}
      closed = true
    }
    return await runHeadedWithProfile(url, options)
  } finally {
    if (!closed) {
      try { await close(browser, tempProfileDir) } catch {}
    }
  }
}
