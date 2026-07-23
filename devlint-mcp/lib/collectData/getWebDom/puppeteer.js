import puppeteer from 'puppeteer-core'
import { existsSync } from 'fs'
import { homedir, platform } from 'os'

/**
 * 获取 Chrome 可执行路径
 * 优先级：环境变量 PUPPETEER_CHROME_PATH > 跨平台自动查找 > null（回退自带 Chromium）
 */
function getChromePath() {
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

const CHROME_PATH = getChromePath()

const DEFAULT_LAUNCH_OPTIONS = {
  headless: true,
  ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
}

const DEFAULT_VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 2 }

const DEFAULT_RENDER_WAIT = 3000

const DEFAULT_DEBUG_PORT = 9222

/**
 * 启动无头浏览器实例（默认模式）
 *
 * 适用于无登录限制的页面。puppeteer 自建浏览器实例，采集完自动关闭。
 *
 * @param {Object} options - puppeteer launch 选项，覆盖默认值
 *   - headless: true 默认无头，调试时传 false
 * @returns {Promise<{ browser: import('puppeteer').Browser, connected: false }>}
 */
export async function launch(options = {}) {
  if (!CHROME_PATH) {
    throw new Error(
      '未找到 Chrome 浏览器。请通过 env 配置 CHROME_PATH 指定 Chrome 可执行文件路径，' +
      '例如：{ "env": { "CHROME_PATH": "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe" } }'
    )
  }
  const browser = await puppeteer.launch({ ...DEFAULT_LAUNCH_OPTIONS, ...options })
  return { browser, connected: false }
}

/**
 * 连接到用户已打开的 Chrome 浏览器（connect 模式）
 *
 * 适用于需登录的页面。用户自行启动 Chrome 并登录，puppeteer 连接该浏览器采集。
 * 连接模式只断开不断开浏览器，不影响用户已有窗口和登录状态。
 *
 * 用户启动 Chrome 命令：
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 *
 * @param {Object} options
 *   - browserWSEndpoint: WebSocket 调试地址，默认自动从 localhost:9222 获取
 * @returns {Promise<{ browser: import('puppeteer').Browser, connected: true }>}
 */
export async function connect(options = {}) {
  let { browserWSEndpoint } = options

  // 未指定地址时，自动从默认端口获取
  if (!browserWSEndpoint) {
    const res = await fetch(`http://localhost:${DEFAULT_DEBUG_PORT}/json/version`)
    const data = await res.json()
    browserWSEndpoint = data.webSocketDebuggerUrl
  }

  const browser = await puppeteer.connect({ browserWSEndpoint })
  return { browser, connected: true }
}

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
 * 关闭/断开浏览器
 * - launch 模式：close() 关闭整个浏览器
 * - connect 模式：disconnect() 只断开连接，不影响用户浏览器
 *
 * @param {import('puppeteer').Browser} browser
 * @param {boolean} connected - 是否为 connect 模式
 */
export async function close(browser, connected = false) {
  if (!browser) return
  if (connected) {
    browser.disconnect()
  } else {
    await browser.close()
  }
}

/**
 * 完整采集流程（通道层封装）
 *
 * 两种模式：
 *   1. 默认（launch）：无头浏览器，采集完自动关闭。适合无登录限制的页面。
 *   2. connect：连接用户已打开的 Chrome，适合需登录的页面。
 *      用户需先启动 Chrome（--remote-debugging-port=9222）并完成登录。
 *
 * 流程：获取浏览器 → CDP 设备仿真 → 导航 → 等待渲染 → 执行采集 → 截图 → 关闭/断开
 *
 * @param {string} url - 目标页面地址
 * @param {Object} options
 *   - collectFn: 在页面上下文执行的采集函数，签名: () => Object
 *   - viewport: { width, height, deviceScaleFactor } 视口尺寸，默认 1920×1080
 *   - waitUntil: 页面加载策略，默认 networkidle0
 *   - timeout: 页面导航超时，默认 30000
 *   - waitForRender: 渲染等待时间(ms)，默认 3000（对齐插件固定 3 秒）
 *   - needScreenshot: 是否截图，默认 true
 *   - launchOptions: puppeteer.launch 额外选项（如 headless: false）
 *   - browserWSEndpoint: connect 模式 WebSocket 地址
 *   - useConnect: 传 true 时走 connect 模式（browserWSEndpoint 为空则自动从 9222 获取）
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
    browserWSEndpoint,
    useConnect,
  } = options

  // connect 模式：传了 browserWSEndpoint 或显式 useConnect=true
  const shouldConnect = browserWSEndpoint !== undefined || useConnect === true
  const { browser, connected } = shouldConnect
    ? await connect({ browserWSEndpoint })
    : await launch(launchOptions)

  try {
    const page = await browser.newPage()

    const client = await emulateDevice(page, viewport)

    await page.goto(url, {
      waitUntil: waitUntil || 'networkidle0',
      timeout: timeout || 30000,
    })

    if (waitForRender > 0) {
      await new Promise(r => setTimeout(r, waitForRender))
    }

    const domData = collectFn ? await evalInPage(page, collectFn) : null

    const screenshotBuffer = needScreenshot ? await screenshot(client) : null

    return { domData, screenshotBuffer }
  } finally {
    await close(browser, connected)
  }
}
