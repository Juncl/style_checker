/**
 * ArkUI Step 1: 原始 $children 树 → UnifiedNode 树
 *
 * 职责：只做"结构转换 + 字段统一"，不做任何过滤或剪枝。
 * 输出的树包含所有原始节点（哪怕是 hidden / opacity=0 / 越界 / 框架节点），
 * 由后续 step2 pruneTree 统一处理。
 *
 * 每个树节点形状（UnifiedNode + 调试用的下划线字段）：
 *   {
 *     id, source: 'arkui', type, rawType, name, path,
 *     rect, normRect, visible, style, textContent?,
 *     children: [],
 *     _frameworkType: bool,        // root/Navigation/NavBar/... 等框架节点
 *     _spanType: bool,             // Span
 *     _blankType: bool,            // Blank
 *     _attrs: object,              // 原始 $attrs，供 step2/3 使用
 *     _rectRaw: object | null,     // 原始 $rect 解析结果（物理像素 + 单位）
 *   }
 */

import {
  parseVp,
  normalizeArkuiFontWeight,
  normalizeTextAlign,
  parseBorderRadius,
  parsePadding,
  parseArkuiRect,
  toVpRect,
} from '../../utils/unitUtils.js'
import { normalizeArkuiColor, isTransparent } from '../../utils/colorUtils.js'

const TEXT_TYPES = new Set(['Text'])
const FRAMEWORK_TYPES = new Set([
  'root', 'JsView', 'Navigation', 'NavBar', 'NavigationContent',
  'Divider', 'ScrollBar', 'NavBarContent', 'NavigationMenu',
  '__Common__', 'TitleBar', 'ToolBar', 'BackButton',
])
const SPAN_TYPES = new Set(['Span'])

/**
 * @param {object} arkuiJson 原始 arkui.json
 * @returns {{ canvasWidthVp, canvasHeightVp, resolution, root }} root 为树根
 */
export function buildArkuiTree(arkuiJson) {
  const content = arkuiJson?.content || {}
  const resolution = parseFloat(content['$resolution']) || 3.5
  const canvasWidthPx = parseFloat(content['width']) || 1316
  const canvasHeightPx = parseFloat(content['height']) || 2832
  const canvasWidthVp = canvasWidthPx / resolution
  const canvasHeightVp = canvasHeightPx / resolution

  const root = walk(content, resolution, canvasWidthVp, canvasHeightVp, [0])

  return { canvasWidthVp, canvasHeightVp, resolution, root }
}

// clipRadius：最近一层 clip=true 祖先的 borderRadius，DFS 向下传播
// compType：最近一层语义组件祖先的类型标记（如 'titlebar'），DFS 向下传播给所有后代
function walk(node, resolution, canvasW, canvasH, path, clipRadius = null, compType = null) {
  const type = node['$type'] || ''
  const attrs = node['$attrs'] || {}
  const rectRaw = parseArkuiRect(node['$rect'])
  const vpRect = rectRaw ? toVpRect(rectRaw, resolution) : null

  const style = extractArkuiStyle(type, attrs, resolution, vpRect)

  // 当前节点是否产生新的 clip 上下文：clip=true 且自身有非零 borderRadius
  const isClip = attrs.clip === 'true' || attrs.clip === true
  const styleBrNonZero = style.borderRadius && Object.values(style.borderRadius).some(v => v > 0)
  const nextClipRadius = (isClip && styleBrNonZero) ? style.borderRadius : clipRadius

  // Image 节点：自身无圆角时，继承最近 clip 祖先的 borderRadius
  if (type === 'Image' && !styleBrNonZero && nextClipRadius) {
    style.borderRadius = { ...nextClipRadius }
  }

  // TitleBar 节点本身不写 compType，但向其后代传播 'titlebar'
  const nextCompType = type === 'TitleBar' ? 'titlebar' : compType

  const unified = {
    id: String(node['$ID'] ?? `arkui:${path.join('.')}`),
    source: 'arkui',
    type: TEXT_TYPES.has(type) ? 'text' : 'container',
    rawType: String(type || '').toLowerCase(),
    name: type,
    path,
    rect: vpRect
      ? { x: vpRect.x, y: vpRect.y, w: vpRect.w, h: vpRect.h }
      : { x: 0, y: 0, w: 0, h: 0 },
    normRect: vpRect
      ? {
        x: vpRect.x / canvasW,
        y: vpRect.y / canvasH,
        w: vpRect.w / canvasW,
        h: vpRect.h / canvasH,
      }
      : { x: 0, y: 0, w: 0, h: 0 },
    visible: true,
    style,
    children: [],
    _frameworkType: FRAMEWORK_TYPES.has(type) || type === 'root',
    _spanType: SPAN_TYPES.has(type),
    _blankType: type === 'Blank',
    _attrs: attrs,
    _rectRaw: rectRaw,
  }

  if (compType) unified.compType = compType

  const text = getArkuiTextContent(attrs)
  if (text) unified.textContent = text

  const children = node['$children'] || []
  for (let i = 0; i < children.length; i++) {
    if (nextClipRadius) {
      const childRectRaw = parseArkuiRect(children[i]['$rect'])
      const childVpRect = childRectRaw ? toVpRect(childRectRaw, resolution) : null
      if (vpRect && childVpRect && clipRectsMatch(vpRect, childVpRect)) {
        unified.children.push(walk(children[i], resolution, canvasW, canvasH, [...path, i], nextClipRadius, nextCompType))
        continue
      }
    }
    unified.children.push(walk(children[i], resolution, canvasW, canvasH, [...path, i], null, nextCompType))
  }

  // Button / TextInput：拆分出虚拟文本子节点（便于与设计侧匹配）
  const splitText = maybeBuildSplitTextChild(unified, type, attrs, vpRect, resolution, canvasW, canvasH, path)
  if (splitText) {
    if (nextCompType) splitText.compType = nextCompType
    unified.children.push(splitText)
  }

  return unified
}

/**
 * 对 Button / TextInput 节点拆分出一个虚拟 Text 子节点
 * - Button: $attrs.label 存在 → 用 label 作为内容，默认居中对齐
 * - TextInput: $attrs.text 或 placeholder 存在 → 用 text || placeholder 作为内容，遵循 textAlign
 */
function maybeBuildSplitTextChild(parentUnified, type, attrs, vpRect, resolution, canvasW, canvasH, path) {
  if (!vpRect || vpRect.w <= 0 || vpRect.h <= 0) return null

  let content = ''
  let textAlign = 'center'
  let fontSize = null
  let fontWeight = null
  let fontColor = null
  let fontFamily = null

  if (type === 'Button') {
    if (!attrs.label) return null
    content = String(attrs.label)
    fontSize = parseVp(attrs.fontSize)
    fontWeight = attrs.fontWeight
    fontColor = attrs.fontColor
    fontFamily = attrs.fontFamily
    textAlign = 'center'
  } else if (type === 'TextInput') {
    const textVal = attrs.text
    const placeholder = attrs.placeholder
    const hasText = textVal !== undefined && textVal !== null && String(textVal).length > 0
    const hasPlaceholder = placeholder !== undefined && placeholder !== null && String(placeholder).length > 0
    if (!hasText && !hasPlaceholder) return null
    content = hasText ? String(textVal) : String(placeholder)
    fontSize = parseVp(attrs.fontSize)
    fontWeight = attrs.fontWeight
    fontColor = hasText ? attrs.fontColor : (attrs.placeholderColor || attrs.fontColor)
    fontFamily = attrs.fontFamily
    textAlign = normalizeArkuiTextAlignRaw(attrs.textAlign) || 'start'
  } else {
    return null
  }

  if (!content || !fontSize || fontSize <= 0) return null

  const textRect = computeTextRect(vpRect, content, fontSize, textAlign, attrs.padding)

  const childPath = [...path, parentUnified.children.length]
  const childStyle = {
    width: textRect.w,
    height: textRect.h,
    fontSize,
  }
  const fw = normalizeArkuiFontWeight(fontWeight)
  if (fw !== null) childStyle.fontWeight = fw
  if (fontColor) childStyle.fontColor = normalizeArkuiColor(fontColor)
  if (fontFamily) childStyle.fontFamily = fontFamily
  childStyle.textAlign = normalizeTextAlign(textAlign === 'center' ? 'TextAlign.Center' : textAlign === 'end' ? 'TextAlign.End' : 'TextAlign.Start')

  return {
    id: `${parentUnified.id}:t`,
    source: 'arkui',
    type: 'text',
    rawType: 'text',
    name: 'Text',
    path: childPath,
    rect: { x: textRect.x, y: textRect.y, w: textRect.w, h: textRect.h },
    normRect: {
      x: textRect.x / canvasW,
      y: textRect.y / canvasH,
      w: textRect.w / canvasW,
      h: textRect.h / canvasH,
    },
    visible: true,
    style: childStyle,
    textContent: content,
    children: [],
    _frameworkType: false,
    _spanType: false,
    _blankType: false,
    _attrs: { content, fontSize: String(fontSize), fontColor, fontFamily, textAlign },
    _rectRaw: { x: textRect.x * resolution, y: textRect.y * resolution, w: textRect.w * resolution, h: textRect.h * resolution },
    _splitFromParent: true,
  }
}

/**
 * 估算文本宽度（vp）：中文字符按 fontSize 算，其他字符按 fontSize*0.55 算
 */
function estimateTextWidth(content, fontSize) {
  let w = 0
  for (const ch of String(content)) {
    if (/[一-龥　-〿＀-￯]/.test(ch)) {
      w += fontSize
    } else {
      w += fontSize * 0.55
    }
  }
  return w
}

/**
 * 计算文本子节点在父节点内的 rect（vp 单位、绝对坐标）
 * - 文本垂直居中
 * - 水平方向按 textAlign 对齐，考虑 padding（如有）
 */
function computeTextRect(parentRect, content, fontSize, textAlign, paddingRaw) {
  const padding = parsePadding(paddingRaw) || { top: 0, right: 0, bottom: 0, left: 0 }
  const innerLeft = parentRect.x + (padding.left || 0)
  const innerRight = parentRect.x + parentRect.w - (padding.right || 0)
  const innerWidth = Math.max(0, innerRight - innerLeft)

  const textWidth = Math.min(estimateTextWidth(content, fontSize), innerWidth || parentRect.w)
  const textHeight = fontSize

  let x = innerLeft
  if (textAlign === 'center') {
    x = innerLeft + (innerWidth - textWidth) / 2
  } else if (textAlign === 'end' || textAlign === 'right') {
    x = innerRight - textWidth
  }
  const y = parentRect.y + (parentRect.h - textHeight) / 2

  return { x, y, w: textWidth, h: textHeight }
}

/**
 * 从 ArkUI 的 textAlign 枚举提取出简化值（start / center / end）
 * 注：normalizeTextAlign 输出的是 left/center/right，这里只用作内部判断
 */
function normalizeArkuiTextAlignRaw(value) {
  if (!value) return null
  const v = String(value)
  if (v.includes('Center')) return 'center'
  if (v.includes('End') || v.includes('Right')) return 'end'
  if (v.includes('Start') || v.includes('Left')) return 'start'
  return null
}

function getArkuiTextContent(attrs) {
  return attrs.content || attrs.accessibilityText || ''
}

function extractArkuiStyle(type, attrs, resolution, vpRect) {
  const s = {}

  // 不透明度
  if (attrs.opacity !== undefined && attrs.opacity !== null) {
    s.opacity = parseFloat(attrs.opacity)
  }

  // 填充（非透明才记录）
  const shapeFill = type === 'Circle' || type === 'Ellipse' || type === 'Rect'
    ? attrs.fill || attrs.foregroundColor
    : type === 'SymbolGlyph'
      ? attrs.fontColor
      : null
  const bgColor = shapeFill || attrs.backgroundColor
  if (bgColor && !isTransparent(bgColor)) {
    s.backgroundColor = normalizeArkuiColor(bgColor)
  }

  // 尺寸信息
  let sizeWidth = null
  let sizeHeight = null
  if (attrs.size && typeof attrs.size === 'object') {
    sizeWidth = parseVp(attrs.size.width)
    sizeHeight = parseVp(attrs.size.height)
  }
  if (sizeWidth === null || sizeWidth === undefined) {
    sizeWidth = vpRect ? Math.round(vpRect.w) : null
  }
  if (sizeHeight === null || sizeHeight === undefined) {
    sizeHeight = vpRect ? Math.round(vpRect.h) : null
  }
  if (sizeWidth !== null && sizeWidth > 0) s.width = sizeWidth
  if (sizeHeight !== null && sizeHeight > 0) s.height = sizeHeight

  // 圆角
  let brRaw = null
  if (attrs.borderRadius && typeof attrs.borderRadius === 'object') {
    brRaw = parseBorderRadius(attrs.borderRadius)
  } else if (typeof attrs.borderRadius === 'string') {
    const val = parseVp(attrs.borderRadius)
    if (val !== null && val > 0) {
      brRaw = { topLeft: val, topRight: val, bottomRight: val, bottomLeft: val }
    }
  }
  if (brRaw && Object.values(brRaw).some(v => v > 0)) {
    if (sizeWidth !== null && sizeHeight !== null && sizeWidth > 0 && sizeHeight > 0) {
      const maxBr = Math.min(sizeWidth, sizeHeight) / 2
      s.borderRadius = {
        topLeft:     Math.min(brRaw.topLeft,     maxBr),
        topRight:    Math.min(brRaw.topRight,    maxBr),
        bottomRight: Math.min(brRaw.bottomRight, maxBr),
        bottomLeft:  Math.min(brRaw.bottomLeft,  maxBr),
      }
    } else {
      s.borderRadius = brRaw
    }
  }

  // 描边
  const borderWidth = parseVp(attrs.borderWidth)
  if (borderWidth && borderWidth > 0) {
    s.border = {
      width: borderWidth,
      color: normalizeArkuiColor(attrs.borderColor),
      style: attrs.borderStyle || 'BorderStyle.Solid',
    }
  }

  // 模糊
  const backdropBlur = parseFloat(attrs.backdropBlur)
  if (!isNaN(backdropBlur) && backdropBlur > 0) s.backdropBlur = backdropBlur

  const blur = parseFloat(attrs.blur)
  if (!isNaN(blur) && blur > 0) s.blur = blur

  // 投影
  if (attrs.shadow && typeof attrs.shadow === 'object') {
    const sh = attrs.shadow
    const radius = parseFloat(sh.radius)
    if (!isNaN(radius) && radius > 0) {
      s.shadow = {
        radius,
        color:   normalizeArkuiColor(sh.color),
        offsetX: parseFloat(sh.offsetX) || 0,
        offsetY: parseFloat(sh.offsetY) || 0,
      }
    }
  }

  // 内/外边距
  const padding = parsePadding(attrs.padding)
  if (padding && Object.values(padding).some(v => v > 0)) s.padding = padding
  const margin = parsePadding(attrs.margin)
  if (margin && Object.values(margin).some(v => v !== 0)) s.margin = margin

  // 子元素间距
  if (['Row', 'Column', 'Flex'].includes(type) && attrs.space !== undefined) {
    const space = parseVp(attrs.space)
    if (space !== null && space > 0) s.itemSpacing = space
  }

  // 混合模式
  const blendMode = parseInt(attrs.blendMode, 10)
  if (!isNaN(blendMode) && blendMode !== 0) s.blendMode = blendMode

  // 文字相关
  if (TEXT_TYPES.has(type)) {
    const declaredFontSize = parseVp(attrs.fontSize)

    const fw = normalizeArkuiFontWeight(attrs.fontWeight)
    if (fw !== null) s.fontWeight = fw

    if (attrs.fontColor) s.fontColor = normalizeArkuiColor(attrs.fontColor)
    if (attrs.fontFamily) s.fontFamily = attrs.fontFamily

    const lh = parseVp(attrs.lineHeight)
    if (lh !== null && lh > 0) s.lineHeight = lh

    const ls = parseVp(attrs.letterSpacing)
    if (ls !== null) s.letterSpacing = ls

    if (attrs.textAlign) s.textAlign = normalizeTextAlign(attrs.textAlign)

    const actualFontSize = parseActualFontSize(attrs.actualFontSize, resolution)
    if (actualFontSize !== null) {
      s.actualFontSize = actualFontSize
      s.fontSize = actualFontSize
      if (declaredFontSize !== null) s.declaredFontSize = declaredFontSize
    } else if (declaredFontSize !== null) {
      s.fontSize = declaredFontSize
    }
  }

  // Image 节点的 backgroundColor 是加载失败时的占位色，图片正常渲染时不显示，不参与样式比对
  if (type === 'Image') {
    delete s.backgroundColor
  }

  return s
}

function clipRectsMatch(a, b) {
  if (!a || !b) return false
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 &&
    Math.abs(a.h - b.h) < 0.5
  )
}

function parseActualFontSize(value, resolution) {
  if (value === undefined || value === null || value === '') return null
  const m = String(value).match(/^(-?[\d.]+)(fp|vp|px)?$/)
  if (!m) return null
  const val = parseFloat(m[1])
  if (!Number.isFinite(val) || val <= 0) return null
  const unit = m[2] || 'vp'
  return unit === 'px' ? val / resolution : val
}
