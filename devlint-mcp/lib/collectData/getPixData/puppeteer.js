import puppeteer from 'puppeteer'

const DEFAULT_CHROME_PATH =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const DEFAULT_LAUNCH_OPTIONS = {
  headless: true,
  executablePath: DEFAULT_CHROME_PATH,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
}

const DEFAULT_VIEWPORT = { width: 1920, height: 1080 }

/**
 * 启动浏览器实例
 * @param {Object} options - puppeteer launch 选项，覆盖默认值
 * @returns {Promise<import('puppeteer').Browser>}
 */
export async function launch(options = {}) {
  return puppeteer.launch({ ...DEFAULT_LAUNCH_OPTIONS, ...options })
}

/**
 * 打开页面并导航到指定 URL
 * @param {import('puppeteer').Browser} browser
 * @param {string} url - 目标页面地址
 * @param {Object} options
 *   - viewport: { width, height } 视口尺寸，默认 1920×1080
 *   - waitUntil: 页面加载策略，默认 networkidle0
 *   - timeout: 超时毫秒，默认 30000
 * @returns {Promise<import('puppeteer').Page>}
 */
export async function openPage(browser, url, options = {}) {
  const page = await browser.newPage()
  await page.setViewport({ ...DEFAULT_VIEWPORT, ...options.viewport })
  await page.goto(url, {
    waitUntil: options.waitUntil || 'networkidle0',
    timeout: options.timeout || 30000,
  })
  return page
}

/**
 * 在页面上下文中执行函数（核心通道能力）
 * fn 运行在浏览器内，可访问 document / window
 * 用于注入 Pixso 采集逻辑
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
 * 截取页面截图，返回 PNG Buffer
 * @param {import('puppeteer').Page} page
 * @param {Object} options - fullPage: 是否整页截图，默认 false（仅视口）
 * @returns {Promise<Buffer>}
 */
export async function screenshot(page, options = {}) {
  return page.screenshot({
    type: 'png',
    fullPage: options.fullPage ?? false,
    ...options,
  })
}

/**
 * 关闭浏览器，释放资源
 * @param {import('puppeteer').Browser} browser
 */
export async function close(browser) {
  if (browser) await browser.close()
}

/**
 * 基础采集流程（通道层封装）
 * 启动浏览器 → 打开页面 → 执行采集函数 → 截图 → 关闭
 *
 * 本函数只负责浏览器生命周期管理，不关心采集逻辑。
 * 具体采集逻辑由 getPixData.js 提供 collectFn。
 *
 * @param {string} url - 目标页面地址
 * @param {Object} options
 *   - collectFn: 在页面上下文执行的采集函数，签名: () => Object
 *   - viewport: 视口尺寸
 *   - waitUntil: 页面加载策略
 *   - timeout: 页面导航超时
 *   - needScreenshot: 是否截图，默认 true
 *   - launchOptions: 传给 puppeteer.launch 的额外选项
 * @returns {Promise<{ domData: Object, screenshotBuffer: Buffer|null }>}
 */
export async function run(url, options = {}) {
  const {
    collectFn,
    viewport,
    waitUntil,
    timeout,
    needScreenshot = true,
    launchOptions,
  } = options

  const browser = await launch(launchOptions)
  try {
    const page = await openPage(browser, url, { viewport, waitUntil, timeout })

    const domData = collectFn
      ? await evalInPage(page, collectFn)
      : null

    const screenshotBuffer = needScreenshot ? await screenshot(page) : null

    return { domData, screenshotBuffer }
  } finally {
    await close(browser)
  }
}
