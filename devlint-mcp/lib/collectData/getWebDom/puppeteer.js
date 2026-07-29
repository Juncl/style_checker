import puppeteer from 'puppeteer-core'
import { getChromePath, getChromeUserDataDir, cloneChromeProfile, cleanupTempProfile } from '../../utils/tools.js'

const CHROME_PATH = getChromePath()

const DEFAULT_LAUNCH_OPTIONS = {
  headless: true,
  ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
}

const DEFAULT_VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 2 }

const DEFAULT_RENDER_WAIT = 8000

const DEFAULT_DEBUG_PORT = 9222

/** 有头模式等待用户登录的最大时长（ms） */
const HEADED_LOGIN_TIMEOUT = 120000

/**
 * 启动无头浏览器实例（默认模式）
 *
 * 默认克隆用户日常 Chrome profile（cookie + localStorage + sessionStorage），
 * 无头模式下即可复用登录态，适合需登录的页面。
 * 找不到用户 profile 时退化为空白 profile（仅适合无登录限制的页面）。
 *
 * @param {Object} options - puppeteer launch 选项，覆盖默认值
 *   - headless: true 默认无头，调试时传 false
 *   - userDataDir: 指定 user-data-dir，优先级高于自动克隆
 * @returns {Promise<{ browser: import('puppeteer').Browser, connected: false, tempProfileDir: string|null }>}
 */
export async function launch(options = {}) {
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
  } else {
    const srcUserDataDir = getChromeUserDataDir()
    if (srcUserDataDir) {
      tempProfileDir = cloneChromeProfile(srcUserDataDir)
      args.push(`--user-data-dir=${tempProfileDir}`)
    }
  }

  const browser = await puppeteer.launch({ ...DEFAULT_LAUNCH_OPTIONS, args, ...options })
  return { browser, connected: false, tempProfileDir }
}

/**
 * 连接到用户已打开的 Chrome 浏览器（connect 模式）
 *
 * 当前已停用，保留代码备将来恢复。
 *
 * 适用于需登录的页面。用户自行启动 Chrome 并登录，puppeteer 连接该浏览器采集。
 * 连接模式只断开不断开浏览器，不影响用户已有窗口和登录状态。
 *
 * 用户启动 Chrome 命令：
 *   macOS:  /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 *   Windows: chrome.exe --remote-debugging-port=9222
 * 注意：Chrome 默认只监听 127.0.0.1（IPv4），本工具用 127.0.0.1 连接以兼容 Windows 下 localhost 解析为 ::1 的问题。
 *
 * @param {Object} options
 *   - browserWSEndpoint: WebSocket 调试地址，默认自动从 localhost:9222 获取
 * @returns {Promise<{ browser: import('puppeteer').Browser, connected: true }>}
 */
// export async function connect(options = {}) {
//   let { browserWSEndpoint } = options
//
//   // 未指定地址时，自动从默认端口获取
//   if (!browserWSEndpoint) {
//     let res
//     try {
//       res = await fetch(`http://127.0.0.1:${DEFAULT_DEBUG_PORT}/json/version`)
//     } catch (e) {
//       const err = new Error(
//         `无法连接到 Chrome 调试端口 9222（${e.message}）。\n` +
//         '最常见原因：已有 Chrome 实例在运行，导致带调试端口启动的 Chrome 只是转发了窗口就退出了，调试端口根本没开。\n\n' +
//         '请按以下步骤操作：\n' +
//         '1. 完全关闭所有 Chrome 窗口，并确认任务管理器中没有残留的 chrome.exe 进程；\n' +
//         '2. 用独立 user-data-dir 重新启动（不影响日常 Chrome，避免实例冲突）：\n' +
//         '   Windows: chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\\temp\\chrome-debug"\n' +
//         '   macOS:   /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug\n' +
//         '3. 在新开的 Chrome 窗口中完成目标页面的登录；\n' +
//         '4. 重新调用 collect_web 采集。\n\n' +
//         '注意：使用独立 user-data-dir 时是全新 profile，需要重新登录目标站点。'
//       )
//       err.code = 'CONNECT_FAILED'
//       throw err
//     }
//
//     if (!res.ok) {
//       throw new Error(`Chrome 调试端口返回异常状态码 ${res.status}：${res.statusText}`)
//     }
//
//     const data = await res.json()
//     browserWSEndpoint = data.webSocketDebuggerUrl
//   }
//
//   try {
//     const browser = await puppeteer.connect({ browserWSEndpoint })
//     return { browser, connected: true }
//   } catch (e) {
//     throw new Error(`puppeteer.connect 失败（${e.message}），browserWSEndpoint: ${browserWSEndpoint}`)
//   }
// }

/**
 * 打开页面并导航到指定 URL
 *
 * @param {import('puppeteer').Browser} browser
 * @param {string} url - 目标页面地址
 * @param {Object} options
 *   - viewport: { width, height, deviceScaleFactor } 视口尺寸，默认 1920×1080
 *   - waitUntil: 页面加载策略，默认 networkidle0
 *   - timeout: 超时毫秒，默认 30000
 * @returns {Promise<import('puppeteer').Page>}
 */
export async function openPage(browser, url, options = {}) {
  const page = await browser.newPage()
  const vp = { ...DEFAULT_VIEWPORT, ...options.viewport }
  await page.setViewport({
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: vp.deviceScaleFactor || 1,
  })
  await page.goto(url, {
    waitUntil: options.waitUntil || 'networkidle0',
    timeout: options.timeout || 30000,
  })
  return page
}

/**
 * CDP 设备仿真（对齐插件行为）
 * 用 Chrome DevTools Protocol 精确控制设备仿真参数，
 * 与插件 chrome.debugger.sendCommand('Emulation.setDeviceMetricsOverride') 等价。
 *
 * 关键参数（与插件一致）：
 *   - mobile: true       激活独立渲染层，截图边界清晰
 *   - forceViewport: true 强制视口为指定尺寸
 *   - dontSetVisibleSize: false 让 CDP 改变窗口物理尺寸（headless 下截图区域正确）
 *
 * @param {import('puppeteer').Page} page
 * @param {Object} options
 *   - width: 画布宽度，默认 1920
 *   - height: 画布高度，默认 1080
 *   - deviceScaleFactor: 截图质量倍率，默认 2（1x/2x/3x）
 * @returns {Promise<import('puppeteer').CDPSession>} CDP session（用于后续截图）
 */
export async function emulateDevice(page, options = {}) {
  const vp = { ...DEFAULT_VIEWPORT, ...options }
  const client = await page.createCDPSession()
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: vp.deviceScaleFactor || 1,
    mobile: true,
    dontSetVisibleSize: false,
    forceViewport: true,
  })
  return client
}

/**
 * 在页面上下文中执行函数（核心通道能力）
 * fn 运行在浏览器内，可访问 document / window
 * 用于注入采集逻辑
 *
 * @param {import('puppeteer').Page} page
 * @param {Function} fn - 在浏览器中执行的函数
 * @param {...any} args - 传递给 fn 的参数
 * @returns {Promise<any>} fn 的返回值（可序列化数据）
 */
export async function evalInPage(page, fn, ...args) {
  return page.evaluate(fn, ...args)
}

/**
 * 通过 CDP 截取页面截图，返回 PNG Buffer
 * 对齐插件逻辑：用 Page.captureScreenshot（fromSurface + captureBeyondViewport:false）
 * 截图尺寸与 emulateDevice 设定的视口 + deviceScaleFactor 一致
 *
 * @param {import('puppeteer').CDPSession} client - emulateDevice 返回的 CDP session
 * @returns {Promise<Buffer>}
 */
export async function screenshot(client) {
  const { data } = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  return Buffer.from(data, 'base64')
}

/**
 * 关闭/断开浏览器，并清理临时 profile
 * - launch 模式：close() 关闭整个浏览器，清理克隆的临时 profile
 * - connect 模式：disconnect() 只断开连接，不影响用户浏览器
 *
 * @param {import('puppeteer').Browser} browser
 * @param {boolean} connected - 是否为 connect 模式
 * @param {string|null} tempProfileDir - launch 模式下克隆的临时 profile 目录
 */
export async function close(browser, connected = false, tempProfileDir = null) {
  if (!browser) return
  if (connected) {
    browser.disconnect()
  } else {
    await browser.close()
  }
  if (tempProfileDir) cleanupTempProfile(tempProfileDir)
}

// ── 登录页检测 ──────────────────────────────────────
// 部分页面需登录才能访问，未登录时会被自动重定向到登录页。
// 此时采集到的 DOM/截图并非目标页面数据，需要识别并降级到有头模式让用户手动登录。

/** 登录页 hostname 子域名特征前缀 */
const LOGIN_HOST_PREFIXES = ['login.', 'signin.', 'sign-in.', 'sso.', 'passport.', 'idp.', 'auth.']

/** 登录页 pathname 特征片段 */
const LOGIN_PATH_SEGMENTS = ['/login', '/signin', '/sign-in', '/sign_in', '/signon', '/sso', '/oauth', '/passport', '/idp', '/authorize', '/auth/']

/**
 * 判断 URL 是否为登录页地址
 * 综合 hostname 子域名特征 + pathname 路径片段判断
 */
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

/**
 * 判断是否发生了重定向（origin 或 pathname 变化即视为跳转）
 */
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
 *
 * 判定规则：
 * 发生重定向（origin 或 pathname 变化）→ 登录页
 *
 * @param {import('puppeteer').Page} page
 * @param {string} originalUrl - 用户传入的目标 URL
 * @returns {Promise<{ isLogin: boolean, reason: string, finalUrl: string }>}
 */
export async function detectLoginPage(page, originalUrl) {
  const finalUrl = page.url()
  const redirected = isRedirected(originalUrl, finalUrl)
  console.error(`[detectLoginPage] originalUrl=${originalUrl}`)
  console.error(`[detectLoginPage] finalUrl=${finalUrl}`)
  console.error(`[detectLoginPage] redirected=${redirected}`)

  // 重定向了 → 被拦截到登录页
  if (redirected) {
    return {
      isLogin: true,
      reason: `页面被重定向：${originalUrl} → ${finalUrl}`,
      finalUrl,
    }
  }

  return { isLogin: false, reason: '', finalUrl }
}

/**
 * 有头模式采集（降级方案）
 *
 * 直接启动有头 Chrome（空白 profile，不克隆、不影响日常 Chrome），
 * 用户在弹出的窗口中手动登录，工具检测到登录完成后自动采集。
 *
 * 适用于：
 * - 无头模式克隆 profile 后仍检测到登录页
 *
 * @param {string} url - 目标页面地址
 * @param {Object} options - 采集选项（collectFn / viewport / waitUntil / timeout / waitForRender / needScreenshot）
 * @returns {Promise<{ domData: Object|null, screenshotBuffer: Buffer|null }>}
 */
async function runHeadedWithProfile(url, options = {}) {
  const {
    collectFn,
    viewport,
    waitUntil,
    timeout,
    waitForRender = DEFAULT_RENDER_WAIT,
    needScreenshot = true,
  } = options

  if (!CHROME_PATH) {
    throw new Error(
      '未找到 Chrome 浏览器。请通过 env 配置 CHROME_PATH 指定 Chrome 可执行文件路径，' +
      '例如：{ "env": { "CHROME_PATH": "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe" } }'
    )
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
    defaultViewport: null,
  })

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
    console.error(`[有头-URL稳定后] page.url()=${page.url()} 等待耗时=${Date.now() - waitStart}ms`)

    // 检测是否为登录页
    const loginCheck = await detectLoginPage(page, url)

    if (loginCheck.isLogin) {
      const start = Date.now()
      while (Date.now() - start < HEADED_LOGIN_TIMEOUT) {
        await new Promise(r => setTimeout(r, 2000))
        // 连续 3 次（每次间隔 2 秒）URL 都和目标一致，才算真正登录成功
        // 防止页面跳转中途 URL 短暂经过目标 URL 导致误判
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
          `等待登录超时（${HEADED_LOGIN_TIMEOUT / 1000}秒），请确认已在弹出的浏览器窗口中完成登录后重试。`
        )
        err.code = 'LOGIN_TIMEOUT'
        throw err
      }
    }

    if (waitForRender > 0) {
      await new Promise(r => setTimeout(r, waitForRender))
    }

    // 有头模式下用 CDP 仿真设置采集视口 + 截图
    const vp = { ...DEFAULT_VIEWPORT, ...viewport }
    const client = await emulateDevice(page, vp)
    const domData = collectFn ? await evalInPage(page, collectFn) : null
    const screenshotBuffer = needScreenshot ? await screenshot(client) : null

    return { domData, screenshotBuffer }
  } finally {
    await browser.close()
  }
}

/**
 * 完整采集流程（通道层封装）
 *
 * 流程：无头模式（克隆用户 profile）→ 检测登录页 → 降级有头（弹窗等用户登录）
 *
 * @param {string} url - 目标页面地址
 * @param {Object} options
 *   - collectFn: 在页面上下文执行的采集函数，签名: () => Object
 *   - viewport: { width, height, deviceScaleFactor } 视口尺寸，默认 1920×1080
 *   - waitUntil: 页面加载策略，默认 domcontentloaded
 *   - timeout: 页面导航超时，默认 60000
 *   - waitForRender: 渲染等待时间(ms)，默认 8000
 *   - needScreenshot: 是否截图，默认 true
 *   - launchOptions: puppeteer.launch 额外选项（如 headless: false、userDataDir）
 * @returns {Promise<{ domData: Object|null, screenshotBuffer: Buffer|null }>}
 */
export async function run(url, options = {}) {
  const {
    collectFn,
    viewport,
    waitUntil,
    timeout,
    waitForRender = DEFAULT_RENDER_WAIT,
    needScreenshot = true,
    launchOptions,
  } = options

  // 无头模式（克隆用户 profile 复用登录态）
  const { browser, connected, tempProfileDir } = await launch(launchOptions)
  let closed = false
  try {
    const page = await browser.newPage()
    const client = await emulateDevice(page, viewport)
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
      await close(browser, connected, tempProfileDir)
      closed = true
      return await runHeadedWithProfile(url, options)
    }
    const domData = collectFn ? await evalInPage(page, collectFn) : null
    const screenshotBuffer = needScreenshot ? await screenshot(client) : null
    return { domData, screenshotBuffer }
  } finally {
    if (!closed) {
      try { await close(browser, connected, tempProfileDir) } catch {}
    }
  }
}
