/**
 * Puppeteer 通道（设计规范检查专用）
 *
 * 与 getWebDom/puppeteer.js 的区别：
 * - 不做 emulateDevice（不修改页面尺寸，保留页面原始视口）
 * - 不截图，只采集 collectFn 返回的数据
 * - 其余流程（登录检测、无头降级有头、profile 克隆等）完全一致
 */

import puppeteer from 'puppeteer-core'
import {
  getChromePath, getChromeUserDataDir, cloneChromeProfile, cleanupTempProfile,
  getPersistProfileDir, isPersistProfileReady,
} from './tools.js'

const CHROME_PATH = getChromePath()

const DEFAULT_LAUNCH_OPTIONS = {
  headless: true,
  ignoreHTTPSErrors: true,
  ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
}

const DEFAULT_RENDER_WAIT = 8000

/** 有头模式等待用户操作的最大时长（ms） */
const HEADED_LOGIN_TIMEOUT = 120000

/**
 * 在页面上下文中执行函数
 */
async function evalInPage(page, fn) {
  return page.evaluate(fn)
}

// ── 浏览器启动 / 关闭 ──────────────────────────────

/**
 * 带重试的浏览器启动
 *
 * 无头与有头共用同一持久 profile（~/.octo-uxlint/chrome-profile），
 * 前一个实例关闭后 SingletonLock 释放可能有延迟，立即启动会偶发锁冲突，
 * 因此失败后间隔 1 秒重试。
 */
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
 * 启动无头浏览器实例（克隆用户 Chrome profile 复用登录态）
 *
 * profile 选择三级回退：
 *   1. options.userDataDir 显式指定 → 用它（优先级最高）
 *   2. 持久 profile（~/.octo-uxlint/chrome-profile）已初始化 → 直接复用。
 *      无头/有头共用同一目录，用户登录过一次后登录态永远最新，
 *      且每次采集服务端续期的新 cookie 也会写回，无需任何同步动作
 *   3. 都没有 → 克隆用户日常 Chrome profile（冷启动）
 */
async function launch(options = {}) {
  if (!CHROME_PATH) {
    throw new Error(
      '未找到 Chrome 浏览器。请通过 env 配置 CHROME_PATH 指定 Chrome 可执行文件路径，' +
      '例如：{ "env": { "CHROME_PATH": "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe" } }'
    )
  }

  let tempProfileDir = null
  const args = [...DEFAULT_LAUNCH_OPTIONS.args]

  if (options.userDataDir) {
    args.push(`--user-data-dir=${options.userDataDir}`)
    delete options.userDataDir
  } else if (isPersistProfileReady()) {
    // 持久 profile 已初始化 → 直接复用（登录态自愈闭环的读取端）
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

/**
 * 关闭浏览器，并清理临时 profile
 */
async function close(browser, tempProfileDir = null) {
  if (!browser) return
  await browser.close()
  if (tempProfileDir) cleanupTempProfile(tempProfileDir)
}

// ── 登录页检测 ──────────────────────────────────────

const LOGIN_HOST_PREFIXES = ['login.', 'signin.', 'sign-in.', 'sso.', 'passport.', 'idp.', 'auth.']
const LOGIN_PATH_SEGMENTS = ['/login', '/signin', '/sign-in', '/sign_in', '/signon', '/sso', '/oauth', '/passport', '/idp', '/authorize', '/auth/']

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

/**
 * 检测当前页面是否被重定向到登录页
 */
async function detectLoginPage(page, originalUrl) {
  const finalUrl = page.url()
  const redirected = isRedirected(originalUrl, finalUrl)
  console.error(`[detectLoginPage] originalUrl=${originalUrl}`)
  console.error(`[detectLoginPage] finalUrl=${finalUrl}`)
  console.error(`[detectLoginPage] redirected=${redirected}`)

  if (redirected) {
    return {
      isLogin: true,
      reason: `页面被重定向：${originalUrl} → ${finalUrl}`,
      finalUrl,
    }
  }

  return { isLogin: false, reason: '', finalUrl }
}

// ── 有头模式（降级方案）──────────────────────────────

/**
 * 有头模式采集：弹出浏览器窗口，用户手动操作（登录、跳过证书等）后自动采集
 *
 * 使用专用持久 profile（~/.octo-uxlint/chrome-profile，不影响用户日常 Chrome）启动，
 * 登录完成后 Chrome 原生将登录态写入该 profile 持久保存，
 * 后续无头采集自动复用，无需重复登录；换账号删除该目录即可重置。
 */
async function runHeadedWithProfile(url, options = {}) {
  const {
    collectFn,
    waitUntil,
    timeout,
    waitForRender = DEFAULT_RENDER_WAIT,
  } = options

  if (!CHROME_PATH) {
    throw new Error(
      '未找到 Chrome 浏览器。请通过 env 配置 CHROME_PATH 指定 Chrome 可执行文件路径，' +
      '例如：{ "env": { "CHROME_PATH": "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe" } }'
    )
  }

  const browser = await launchWithRetry({
    executablePath: CHROME_PATH,
    headless: false,
    ignoreHTTPSErrors: true,
    userDataDir: getPersistProfileDir(),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized', '--ignore-certificate-errors'],
    defaultViewport: null,
  })

  try {
    const page = await browser.newPage()

    // 有头模式：导航失败不抛错（如证书拦截、超时等），让用户在窗口中手动操作
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

    // 有头模式：如果当前不在目标页面（被拦截到登录页/证书页/其他），等待用户手动操作
    if (isRedirected(url, page.url())) {
      console.error(`[有头-等待用户操作] 当前URL=${page.url()} 目标URL=${url}`)
      const start = Date.now()
      while (Date.now() - start < HEADED_LOGIN_TIMEOUT) {
        await new Promise(r => setTimeout(r, 2000))
        // 连续 3 次（每次间隔 2 秒）URL 都和目标一致，才算用户操作完成
        if (!isRedirected(url, page.url())) {
          await new Promise(r => setTimeout(r, 2000))
          if (!isRedirected(url, page.url())) {
            await new Promise(r => setTimeout(r, 2000))
            if (!isRedirected(url, page.url())) {
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

    const domData = collectFn ? await evalInPage(page, collectFn) : null
    return { domData }
  } finally {
    await browser.close()
  }
}

// ── 完整流程 ──────────────────────────────────────

/**
 * 打开页面并采集数据
 *
 * 流程：
 * 1. headless=true（默认）：无头模式，profile 三级回退：
 *    ① 显式 userDataDir → ② 持久 profile 已初始化则复用登录态 → ③ 克隆日常 Chrome（冷启动）
 *    无头阶段任何失败（导航超时、自签名证书拦截、网络错误、检测到登录页等）
 *    → 自动降级有头模式（同一持久 profile，用户手动登录后登录态落盘，下次免登）
 * 2. headless=false：直接有头模式（持久 profile），弹出浏览器窗口让用户操作后采集
 *
 * 与 getWebDom/puppeteer.js 的 run 区别：
 * - 不做 emulateDevice，保留页面原始视口
 * - 不截图，只返回 collectFn 采集的数据
 *
 * @param {string} url - 目标页面地址
 * @param {Object} options
 *   - collectFn: 在页面上下文执行的采集函数，签名: () => any
 *   - waitUntil: 页面加载策略，默认 domcontentloaded
 *   - timeout: 页面导航超时，默认 60000
 *   - waitForRender: 渲染等待时间(ms)，默认 8000
 *   - headless: 是否无头模式，默认 true
 *   - launchOptions: puppeteer.launch 额外选项
 * @returns {Promise<{ domData: any|null }>}
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

  // 无头模式（克隆用户 profile 复用登录态）
  // 无头阶段任何失败（导航超时、证书拦截、网络错误、检测到登录页等）→ 自动降级有头模式
  const { browser, tempProfileDir } = await launch(launchOptions)
  let closed = false
  try {
    const page = await browser.newPage()
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
      await close(browser, tempProfileDir)
      closed = true
      return await runHeadedWithProfile(url, options)
    }
    const domData = collectFn ? await evalInPage(page, collectFn) : null
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
