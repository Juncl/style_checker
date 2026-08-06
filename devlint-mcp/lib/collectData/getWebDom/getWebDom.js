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
 * 采集结果自动写入配置目录下，返回文件路径供 ui_style_check 衔接。
 */

import { run } from './puppeteer.js'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { timestamp } from '../../utils/tools.js'
import { getSessionDir } from '../../utils/session.js'

/**
 * 在浏览器上下文执行的 DOM 采集函数
 *
 * 完整迁移插件 mainExportInContent + getElementData 逻辑：
 *   1. 探测真实的dpr（测试元素测量 1px border 实际渲染值）
 *   2. 递归遍历 DOM 树（getElementData）
 *   3. 过滤隐藏元素 / 不可视元素
 *   4. 提取节点结构 + 计算样式
 *   5. iframe 同域递归 / 跨域标记
 *   6. 构造 viewport 根节点
 *
 * 返回 web.json 格式的 DOM 树，字段结构与现有 case 数据完全一致
 */
const exportDOMTree = () => {
  // 初始化 ID 计数器
  let currentId = 5;


  // 探测真实的dpr
  const testDiv = document.createElement('div');
  testDiv.style.border = '1px solid transparent';
  testDiv.style.position = 'absolute';
  testDiv.style.visibility = 'hidden';
  document.body.appendChild(testDiv);
  const computedW = parseFloat(window.getComputedStyle(testDiv).borderBottomWidth);
  document.body.removeChild(testDiv);
  // 如果 1px 变成了 0.667px， 那么 fixRatio 就是 1 / 0.667 = 1.5
  // 如果本来就是 1px，那么 fixRatio 就是 1
  let fixRatio = computedW > 0 ? (1 / computedW) : 1;
  fixRatio = Number(fixRatio.toFixed(2));

  // 获取当前视口的尺寸
  const vWidth = window.innerWidth || document.documentElement.clientWidth;
  const vHeight = window.innerHeight || document.documentElement.clientHeight;

  // ── 辅助函数 ──────────────────────────────────────

  /** 移除 CSS 值中的 px 单位，返回数值 */
  function removePxUnit(value) {
    if (!value || typeof value !== 'string') {
      return value;
    }

    // 使用正则表达式匹配数字部分（包括小数点）
    const match = value.match(/^(\d+\.?\d*)/);

    if (match) {
      return parseFloat(match[1]);
    }
    return value
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

  // /** 字重归一化：normal→400, bold→700, 数字字符串→数字 */
  // function normalizeFontWeight(value) {
  //   if (value === 'normal') return 400
  //   if (value === 'bold') return 700
  //   const n = parseInt(value)
  //   return isNaN(n) ? 400 : n
  // }

  // ── 核心递归：getElementData ──────────────────────

  /**
   * 递归遍历 DOM 元素，提取节点结构 + 计算样式
   * @param {Element} node - DOM 元素节点
   * @param {number} offsetX - 累计 x 偏移（iframe 内元素需要加上 iframe 位置）
   * @param {number} offsetY - 累计 y 偏移
   * @returns {Object|null} 节点数据对象，被过滤则返回 null
   */
  function getElementData(node, offsetX = 0, offsetY = 0) {

    if (node.nodeType !== Node.ELEMENT_NODE) return null

    const rawRect = node.getBoundingClientRect();
    const rect = {
      left: rawRect.left || 0,
      top: rawRect.top || 0,
      width: rawRect.width || 0,
      height: rawRect.height || 0,
      right: rawRect.right || (rawRect.left + rawRect.width) || 0,
      bottom: rawRect.bottom || (rawRect.top + rawRect.height) || 0
    };
    const style = window.getComputedStyle(node);

    // 只检查是否在视口范围内，不检查宽高 （避免父元素尺寸为0导致子元素被过滤）
    const isVisible = (
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= vHeight &&
      rect.left <= vWidth
    );

    // 如果节点本身不在视口内（且不是body）， 则跳过
    if (!isVisible && node !== document.body) {
      return null;
    }

    // 过滤掉透明度为 0 或 display: none 的节点（可选）
    if (style.display === 'none' || style.visibility === 'hidden') {
      return null;
    }

    // 获取文本逻辑
    const textContent = Array.from(node.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0)
      .map(n => n.textContent.trim())
      .join(' ');

    const isText = textContent.length > 0;
    const tagName = node.tagName.toLowerCase();

    // 坐标直接取视口相对位置，不加 scroll 偏移
    const absoluteTop = Math.round(rect.top + offsetY);
    const absoluteLeft = Math.round(rect.left + offsetX);

    const id = currentId++;

    const data = {
      id: id,
      name: id,
      type: isText ? "text" : tagName,
      className: node.className || "",
      rect: {
        w: rect.width,
        h: rect.height,
        x: absoluteLeft,
        y: absoluteTop
      },
      size: {
        w: rect.width,
        h: rect.height,
        x: absoluteLeft,
        y: absoluteTop
      },
      w: rect.width,
      h: rect.height,
      x: absoluteLeft,
      y: absoluteTop,
      display: style.display,
      position: style.position,
      padding: style.padding,
      margin: style.margin,
      opacity: Number(style.opacity),
      textAlign: style.textAlign,
      backgroundColor: toARGBHex(style.backgroundColor),
      borderRadius: style.borderRadius, // 原数据不转换
      borderWidth: Number((removePxUnit(style.borderWidth) * fixRatio).toFixed(1)),
      borderStyle: style.borderStyle,
      borderColor: (Number((removePxUnit(style.borderWidth) * fixRatio).toFixed(1))) ? toARGBHex(style.borderColor) : undefined,
      boxShadow: (style.boxShadow && style.boxShadow !== "none") ? style.boxShadow : undefined,
      textShadow: (style.textShadow && style.textShadow !== "none") ? style.textShadow : undefined
    };

    if ((style.filter && style.filter !== "none") || (style.backdropFilter && style.backdropFilter !== "none")) {
      data.blur = {
        filter: (style.filter && style.filter !== "none") ? style.filter : undefined,
        backdropFilter: (style.backdropFilter && style.backdropFilter !== "none") ? style.backdropFilter : undefined,
      }
    }

    if (isText) {
      data.content = textContent;
      data.fontSize = removePxUnit(style.fontSize);
      data.fontFamily = style.fontFamily;
      data.fontWeight = Number(style.fontWeight);
      data.fontColor = toARGBHex(style.color);
    }

    // 处理子节点
    let children = Array.from(node.children);
    let childData = [];

    // 特殊逻辑：如果是 iframe，尝试进入其内部
    if (tagName === 'iframe') {
      try {
        const iframeDoc = node.contentDocument || node.contentWindow.document;
        if (iframeDoc && iframeDoc.body) {
          // 核心逻辑：进入iframe时，累加当前iframe的绝对位置作为子节点的偏移基准
          // 注意：iframe 内部可能有边框和内边距，这里简单处理累加坐标
          childData = Array.from(iframeDoc.body.children)
            .map(child => getElementData(child, absoluteLeft, absoluteTop))
            .filter(c => c !== null);
        }
      } catch (e) {
        data.info = "Cross-origin iframe - Access Denied"
      }
    } else {
      childData = children
        .map(child => getElementData(child, offsetX, offsetY))
        .filter(c => c !== null);
    }

    data.children = childData;
    return data;
  }

  // ── 根节点构造（viewport）──────────────────────────
  const root = {
    id: 3,
    deviceType: "web",
    name: "viewport",
    type: "container",
    rect: { 
      w: vWidth, 
      h: vHeight, 
      x: 0, 
      y: 0 
    },
    size: { 
      w: vWidth, 
      h: vHeight, 
      x: 0, 
      y: 0 
    },
    w: vWidth, 
    h: vHeight, 
    x: 0, 
    y: 0,
    children: [getElementData(document.body)]
  };


  return root;
}

/**
 * 采集 Web 页面 DOM 数据 + 截图，写入配置目录
 *
 * @param {string} url - 目标页面地址
 * @param {Object} options
 *   - viewport: { width, height, deviceScaleFactor } 视口尺寸，默认 1920×1080
 *   - waitUntil: 页面加载策略，默认 networkidle0
 *   - timeout: 页面导航超时，默认 30000
 *   - waitForRender: 渲染等待时间(ms)，默认 3000
 *   - needScreenshot: 是否截图，默认 true
 *   - launchOptions: puppeteer.launch 额外选项（如 headless: false 调试）
 * @returns {Promise<{ devJsonPath: string, devImagePath: string|null }>}
 */
export async function collectWebDom(url, options = {}) {
  const { domData, screenshotBuffer } = await run(url, { ...options, collectFn: exportDOMTree })

  const dir = getSessionDir()

  const vp = options.viewport || {}
  const w = vp.width || 1920
  const h = vp.height || 1080
  const ts = timestamp()
  const devJsonPath = join(dir, `web_${w}x${h}_${ts}.json`)
  const devImagePath = screenshotBuffer ? join(dir, `web_${w}x${h}_${ts}.png`) : null

  writeFileSync(devJsonPath, JSON.stringify(domData))
  if (devImagePath) writeFileSync(devImagePath, screenshotBuffer)

  return { devJsonPath, devImagePath }
}
