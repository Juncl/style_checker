/**
 * Web 开发侧 DOM 采集
 *
 * 依赖本目录 puppeteer.js 通道，在页面上下文中执行采集逻辑，
 * 返回 web.json 格式的 DOM 树（供 server parseWeb 消费）。
 *
 * 采集逻辑迁移自 Octo-DomExport 谷歌插件的 mainExportInContent 函数，
 * 适配 puppeteer page.evaluate 执行环境（去掉 Blob 下载，直接 return 数据）。
 *
 * 使用方式：
 *   import { collectWebDom } from './getWebDom.js'
 *   const { devJsonPath, devImagePath } = await collectWebDom(url)
 *   // 自定义尺寸：
 *   const result = await collectWebDom(url, { viewport: { width: 1440, height: 900 } })
 *
 * 采集结果自动写入 {工程目录}/.devlint/ 下，返回文件路径供 ui_style_check 衔接。
 */

import { run } from './puppeteer.js'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { config } from '../../config.js'

/**
 * 在浏览器上下文执行的 DOM 采集函数
 *
 * 完整迁移插件 mainExportInContent + getElementData 逻辑：
 *   1. DPI 修正（测试元素测量 1px border 实际渲染值）
 *   2. 递归遍历 DOM 树（getElementData）
 *   3. 过滤隐藏元素 / 不可视元素
 *   4. 提取节点结构 + 计算样式
 *   5. iframe 同域递归 / 跨域标记
 *   6. 构造 viewport 根节点
 *
 * 返回 web.json 格式的 DOM 树，字段结构与现有 case 数据完全一致
 */
const COLLECT_FN = () => {
  let _id = 0

  // ── DPI 修正 ──────────────────────────────────────
  // 创建测试元素测量 1px border 的实际渲染值，修正系统 DPR 缩放导致的像素偏差
  const _testEl = document.createElement('div')
  _testEl.style.cssText = 'border:1px solid black;position:absolute;visibility:hidden;'
  document.body.appendChild(_testEl)
  const _testStyle = window.getComputedStyle(_testEl)
  const fixRatio = 1 / (parseFloat(_testStyle.borderTopWidth) || 1)
  document.body.removeChild(_testEl)

  // ── 辅助函数 ──────────────────────────────────────

  /** 移除 CSS 值中的 px 单位，返回数值 */
  function removePxUnit(value) {
    if (!value) return 0
    const n = parseFloat(value)
    return isNaN(n) ? 0 : n
  }

  /** 将 RGB/RGBA/hex 颜色转换为 #AARRGGBB 格式（8位，前两位 alpha） */
  function toARGBHex(color) {
    if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') {
      return '#00000000'
    }
    // rgba(r, g, b, a) 或 rgb(r, g, b)
    const rgbaMatch = color.match(/rgba?\(\s*([^)]+)\s*\)/i)
    if (rgbaMatch) {
      const parts = rgbaMatch[1].split(',').map(s => parseFloat(s.trim()))
      const r = Math.round(parts[0])
      const g = Math.round(parts[1])
      const b = Math.round(parts[2])
      const a = parts.length === 4 ? Math.round(parts[3] * 255) : 255
      const hex = n => n.toString(16).padStart(2, '0').toUpperCase()
      return `#${hex(a)}${hex(r)}${hex(g)}${hex(b)}`
    }
    // #rgb / #rrggbb
    const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
    if (hexMatch) {
      let h = hexMatch[1]
      if (h.length === 3) h = h.split('').map(c => c + c).join('')
      return '#FF' + h.toUpperCase()
    }
    return '#00000000'
  }

  /** 字重归一化：normal→400, bold→700, 数字字符串→数字 */
  function normalizeFontWeight(value) {
    if (value === 'normal') return 400
    if (value === 'bold') return 700
    const n = parseInt(value)
    return isNaN(n) ? 400 : n
  }

  // ── 核心递归：getElementData ──────────────────────

  /**
   * 递归遍历 DOM 元素，提取节点结构 + 计算样式
   * @param {Element} node - DOM 元素节点
   * @param {number} offsetX - 累计 x 偏移（iframe 内元素需要加上 iframe 位置）
   * @param {number} offsetY - 累计 y 偏移
   * @returns {Object|null} 节点数据对象，被过滤则返回 null
   */
  function getElementData(node, offsetX, offsetY) {
    // 只处理元素节点
    if (node.nodeType !== Node.ELEMENT_NODE) return null

    const computed = window.getComputedStyle(node)

    // 过滤隐藏元素
    if (computed.display === 'none' || computed.visibility === 'hidden') return null

    const rect = node.getBoundingClientRect()

    // 可视区域判断：元素与视口相交才采集
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= vh || rect.left >= vw) {
      return null
    }

    // 坐标（含 iframe 偏移）
    const x = Math.round(rect.x + offsetX)
    const y = Math.round(rect.y + offsetY)
    const w = Math.round(rect.width)
    const h = Math.round(rect.height)

    // 判断文本 vs 容器：叶子元素（无子元素）且有文本内容 → text
    const hasElementChildren = node.children.length > 0
    const textContent = node.textContent ? node.textContent.trim() : ''
    const isText = !hasElementChildren && textContent.length > 0

    const id = ++_id
    const type = isText ? 'text' : node.tagName.toLowerCase()

    // 公共字段（text 和 container 都有）
    const data = {
      id,
      name: id,
      type,
      className: typeof node.className === 'string' ? node.className : '',
      rect: { w, h, x, y },
      size: { w, h, x, y },
      w, h, x, y,
      display: computed.display,
      position: computed.position,
      padding: computed.padding,
      margin: computed.margin,
      opacity: parseFloat(computed.opacity),
      textAlign: computed.textAlign,
    }

    if (isText) {
      // 文本节点额外字段
      data.content = textContent
      data.fontSize = removePxUnit(computed.fontSize)
      data.fontFamily = computed.fontFamily
      data.fontWeight = normalizeFontWeight(computed.fontWeight)
      data.fontColor = toARGBHex(computed.color)
      data.children = []
    } else {
      // 容器节点额外字段
      data.backgroundColor = toARGBHex(computed.backgroundColor)
      data.borderRadius = removePxUnit(computed.borderTopLeftRadius)

      // 边框（DPI 修正后）
      const borderWidth = Math.round(removePxUnit(computed.borderTopWidth) * fixRatio * 10) / 10
      data.borderWidth = borderWidth
      data.borderStyle = computed.borderTopStyle
      data.borderColor = borderWidth > 0 ? toARGBHex(computed.borderTopColor) : ''

      // 阴影（有值才加）
      if (computed.boxShadow && computed.boxShadow !== 'none') {
        data.boxShadow = computed.boxShadow
      }
      if (computed.textShadow && computed.textShadow !== 'none') {
        data.textShadow = computed.textShadow
      }

      // 模糊（有值才加）
      const hasFilter = computed.filter && computed.filter !== 'none'
      const hasBackdropFilter = computed.backdropFilter && computed.backdropFilter !== 'none'
      if (hasFilter || hasBackdropFilter) {
        data.blur = {}
        if (hasFilter) data.blur.filter = computed.filter
        if (hasBackdropFilter) data.blur.backdropFilter = computed.backdropFilter
      }

      // 递归子元素
      data.children = []
      for (const child of node.children) {
        const childData = getElementData(child, offsetX, offsetY)
        if (childData) data.children.push(childData)
      }

      // iframe 处理：同域递归（传入 iframe 坐标偏移），跨域标记
      if (node.tagName === 'IFRAME') {
        try {
          const iframeDoc = node.contentDocument || (node.contentWindow && node.contentWindow.document)
          if (iframeDoc && iframeDoc.body) {
            const offX = offsetX + Math.round(rect.x)
            const offY = offsetY + Math.round(rect.y)
            for (const child of iframeDoc.body.children) {
              const childData = getElementData(child, offX, offY)
              if (childData) data.children.push(childData)
            }
          }
        } catch (e) {
          data.info = 'Cross-origin iframe - Access Denied'
        }
      }
    }

    return data
  }

  // ── 根节点构造（viewport）──────────────────────────
  const vw = window.innerWidth
  const vh = window.innerHeight

  return {
    id: ++_id,
    deviceType: 'web',
    name: 'viewport',
    type: 'container',
    rect: { w: vw, h: vh, x: 0, y: 0 },
    size: { w: vw, h: vh, x: 0, y: 0 },
    w: vw, h: vh, x: 0, y: 0,
    children: Array.from(document.body.children)
      .map(el => getElementData(el, 0, 0))
      .filter(Boolean),
  }
}

/**
 * 生成时间戳文件名：web_月-日-时分
 */
function timestamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/**
 * 采集 Web 页面 DOM 数据 + 截图，写入 .devlint/ 目录
 *
 * @param {string} url - 目标页面地址
 * @param {Object} options
 *   - viewport: { width, height, deviceScaleFactor } 视口尺寸，默认 1920×1080
 *   - waitUntil: 页面加载策略，默认 networkidle0
 *   - timeout: 页面导航超时，默认 30000
 *   - waitForRender: 渲染等待时间(ms)，默认 3000
 *   - needScreenshot: 是否截图，默认 true
 *   - launchOptions: puppeteer.launch 额外选项（如 headless: false 调试）
 *   - browserWSEndpoint: connect 模式 WebSocket 地址，传入则连接用户已打开的 Chrome
 * @returns {Promise<{ devJsonPath: string, devImagePath: string|null }>}
 */
export async function collectWebDom(url, options = {}) {
  const { domData, screenshotBuffer } = await run(url, { ...options, collectFn: COLLECT_FN })

  const dir = join(process.cwd(), config.DIR_NAME)
  mkdirSync(dir, { recursive: true })

  const ts = timestamp()
  const devJsonPath = join(dir, `web_${ts}.json`)
  const devImagePath = screenshotBuffer ? join(dir, `web_${ts}.png`) : null

  writeFileSync(devJsonPath, JSON.stringify(domData, null, 2))
  if (devImagePath) writeFileSync(devImagePath, screenshotBuffer)

  return { devJsonPath, devImagePath }
}
