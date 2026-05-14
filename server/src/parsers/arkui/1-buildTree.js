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
  '__Common__', 'TitleBar', 'ToolBar', 'TabBar', 'BackButton',
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

function walk(node, resolution, canvasW, canvasH, path) {
  const type = node['$type'] || ''
  const attrs = node['$attrs'] || {}
  const rectRaw = parseArkuiRect(node['$rect'])
  const vpRect = rectRaw ? toVpRect(rectRaw, resolution) : null

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
    style: extractArkuiStyle(type, attrs, resolution, vpRect),
    children: [],
    _frameworkType: FRAMEWORK_TYPES.has(type) || type === 'root',
    _spanType: SPAN_TYPES.has(type),
    _blankType: type === 'Blank',
    _attrs: attrs,
    _rectRaw: rectRaw,
  }

  const text = getArkuiTextContent(attrs)
  if (text) unified.textContent = text

  const children = node['$children'] || []
  for (let i = 0; i < children.length; i++) {
    unified.children.push(walk(children[i], resolution, canvasW, canvasH, [...path, i]))
  }

  return unified
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

  return s
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
