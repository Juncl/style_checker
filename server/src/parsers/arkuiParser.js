/**
 * ArkUI JSON 解析器
 * 将鸿蒙 ArkUI 组件树转换为统一中间表示 UnifiedNode[]
 */

import { normalizeArkuiColor, isTransparent } from '../utils/colorUtils.js'
import {
  parseVp,
  normalizeArkuiFontWeight,
  normalizeTextAlign,
  parseBorderRadius,
  parsePadding,
  parseArkuiRect,
  toVpRect,
} from '../utils/unitUtils.js'

// 只有 Text 归为 'text'，其余统一进入 'container'
const TEXT_TYPES = new Set(['Text'])

// 过滤掉的纯框架节点
const FRAMEWORK_TYPES = new Set(['root', 'JsView', 'Navigation', 'NavBar', 'NavigationContent', 'Divider', 'ScrollBar', 'NavBarContent', 'NavigationMenu', '__Common__', 'TitleBar', 'ToolBar', 'TabBar', 'BackButton'])

// Span 节点无独立布局 rect（继承父 Text），跳过节点但仍遍历子节点
const SPAN_TYPES = new Set(['Span'])

/**
 * 从 arkui.json 提取视觉节点
 * @returns {{ canvasWidthVp: number, resolution: number, nodes: UnifiedNode[] }}
 */
export function parseArkui(arkuiJson) {
  const content = arkuiJson.content || {}
  const resolution = parseFloat(content['$resolution']) || 3.5
  const canvasWidthPx  = parseFloat(content['width'])  || 1316
  const canvasHeightPx = parseFloat(content['height']) || 2832
  const canvasWidthVp  = canvasWidthPx / resolution
  const canvasHeightVp = canvasHeightPx / resolution

  const nodes = []
  traverseTree(content, resolution, canvasWidthVp, canvasHeightVp, nodes, true, [0], false)

  return { canvasWidthVp, canvasHeightVp, resolution, nodes }
}

function traverseTree(node, resolution, canvasWidthVp, canvasHeightVp, result, inheritedVisible = true, path = [0], hiddenFrameworkAncestor = false) {
  const type = node['$type'] || ''
  const attrs = node['$attrs'] || {}
  const frameworkNode = FRAMEWORK_TYPES.has(type) || type === 'root'
  const rectRaw = parseArkuiRect(node['$rect'])
  const vpRect = rectRaw ? toVpRect(rectRaw, resolution) : null
  const pruneReason = getArkuiSubtreePruneReason(type, attrs, vpRect, canvasWidthVp, canvasHeightVp)
  const selfSkipReason = getArkuiSelfSkipReason(type, attrs, vpRect, canvasWidthVp)
  const ownVisible =
    attrs.visibility !== 'Visibility.None' &&
    !pruneReason
  const nodeVisible = inheritedVisible && ownVisible
  const childInheritedVisible = inheritedVisible && (frameworkNode ? true : ownVisible)
  const childHiddenFrameworkAncestor = hiddenFrameworkAncestor || (frameworkNode && !ownVisible)

  // Hidden / fully transparent nodes prune the whole subtree from matching input.
  if (pruneReason) return

  // Blank 只是布局占位，不参与可视化节点、选择和匹配。
  if (type === 'Blank') {
    for (let i = 0; i < (node['$children'] || []).length; i++) {
      const child = node['$children'][i]
      traverseTree(child, resolution, canvasWidthVp, canvasHeightVp, result, childInheritedVisible, [...path, i], childHiddenFrameworkAncestor)
    }
    return
  }

  if (!FRAMEWORK_TYPES.has(type) && type !== 'root' && !SPAN_TYPES.has(type)) {
    if (!rectRaw || !vpRect) {
      // 递归子节点再跳过本节点
      const children = node['$children'] || []
      for (let i = 0; i < children.length; i++) {
        traverseTree(children[i], resolution, canvasWidthVp, canvasHeightVp, result, childInheritedVisible, [...path, i], childHiddenFrameworkAncestor)
      }
      return
    }

    // 过滤不可见 / 零尺寸节点
    const hasSize = vpRect.w > 0 && vpRect.h > 0

    if (nodeVisible && hasSize && isContentfulVisualNode(type, attrs) && !selfSkipReason) {
      const unified = buildUnifiedNode(node, type, attrs, vpRect, canvasWidthVp, canvasHeightVp, resolution)
      unified.path = path
      unified.hiddenFrameworkAncestor = hiddenFrameworkAncestor
      unified.paintIndex = result.length
      result.push(unified)
    }
  }

  for (let i = 0; i < (node['$children'] || []).length; i++) {
    const child = node['$children'][i]
    traverseTree(child, resolution, canvasWidthVp, canvasHeightVp, result, childInheritedVisible, [...path, i], childHiddenFrameworkAncestor)
  }
}

function getArkuiSubtreePruneReason(type, attrs, rect, canvasWidthVp, canvasHeightVp) {
  const rules = [
    attrs.visibility === 'Visibility.Hidden' ? 'visibility-hidden' : null,
    hasZeroOpacity(attrs.opacity) ? 'opacity-zero' : null,
    isArkuiSpecialPrunedType(type) ? 'special-component' : null,
    isOutOfBoundsRect(rect, canvasWidthVp, canvasHeightVp) ? 'out-of-bounds' : null,
  ]
  return rules.find(Boolean) || null
}

function getArkuiSelfSkipReason(type, attrs, rect, canvasWidthVp) {
  const normalizedType = String(type || '').toLowerCase()
  const selfSkipTypes = new Set([
    'jsview',
    'stack',
    'column',
    'row',
    'list',
    'listitem',
    'group',
    '__common__',
    'gridcol',
    'gridrow',
    'blank',
    'spacer',
  ])
  const bgColor = String(attrs.backgroundColor || '').trim()
  const rules = [
    selfSkipTypes.has(normalizedType) && (!bgColor || bgColor.startsWith('#00')) ? 'transparent-layout-node' : null,
    rect && rect.w > canvasWidthVp * 3 ? 'too-wide' : null,
  ]
  return rules.find(Boolean) || null
}

function isArkuiSpecialPrunedType(type) {
  const normalized = String(type || '').toLowerCase()
  return normalized === 'leftarrow' || normalized === 'rightarrow'
}

function isOutOfBoundsRect(rect, canvasWidthVp, canvasHeightVp) {
  if (!rect) return false
  return rect.x > canvasWidthVp ||
    rect.y > canvasHeightVp ||
    rect.x + rect.w <= 0 ||
    rect.y + rect.h <= 0
}

function buildUnifiedNode(node, type, attrs, vpRect, canvasWidthVp, canvasHeightVp, resolution) {
  const nodeType = getNodeCategory(type, attrs)

  const unified = {
    id:     String(node['$ID'] ?? Math.random()),
    source: 'arkui',
    type:   nodeType,
    rawType: String(type || '').toLowerCase(),
    name:   type,
    paintIndex: null,
    rect: {
      x: vpRect.x,
      y: vpRect.y,
      w: vpRect.w,
      h: vpRect.h,
    },
    normRect: {
      x: vpRect.x / canvasWidthVp,
      y: vpRect.y / canvasHeightVp,
      w: vpRect.w / canvasWidthVp,
      h: vpRect.h / canvasHeightVp,
    },
    visible: true,
    style: extractArkuiStyle(type, attrs, resolution, vpRect),
  }

  // 文字内容
  const content = getArkuiTextContent(attrs)
  if (content) unified.textContent = content

  return unified
}

function getNodeCategory(type, attrs) {
  if (TEXT_TYPES.has(type)) return 'text'
  return 'container'
}

function isContentfulVisualNode(type, attrs) {
  if (!TEXT_TYPES.has(type)) return true
  return String(getArkuiTextContent(attrs)).trim().length > 0
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

  // 尺寸信息（优先从 attrs.size 获取，否则用 vpRect 计算）
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

  // 圆角规范化（用 size 尺寸）
  if (attrs.borderRadius && typeof attrs.borderRadius === 'object') {
    const br = parseBorderRadius(attrs.borderRadius)
    if (br && Object.values(br).some(v => v > 0)) {
      if (sizeWidth !== null && sizeHeight !== null && sizeWidth > 0 && sizeHeight > 0) {
        const maxBr = Math.min(sizeWidth, sizeHeight) / 2
        s.borderRadius = {
          topLeft:     Math.min(br.topLeft,     maxBr),
          topRight:    Math.min(br.topRight,    maxBr),
          bottomRight: Math.min(br.bottomRight, maxBr),
          bottomLeft:  Math.min(br.bottomLeft,  maxBr),
        }
      } else {
        s.borderRadius = br
      }
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

  // 背景模糊
  const backdropBlur = parseFloat(attrs.backdropBlur)
  if (!isNaN(backdropBlur) && backdropBlur > 0) {
    s.backdropBlur = backdropBlur
  }

  // 前景模糊
  const blur = parseFloat(attrs.blur)
  if (!isNaN(blur) && blur > 0) {
    s.blur = blur
  }

  // 投影
  if (attrs.shadow && typeof attrs.shadow === 'object') {
    const sh = attrs.shadow
    const radius = parseFloat(sh.radius)
    if (!isNaN(radius) && radius > 0) {
      s.shadow = {
        radius:  radius,
        color:   normalizeArkuiColor(sh.color),
        offsetX: parseFloat(sh.offsetX) || 0,
        offsetY: parseFloat(sh.offsetY) || 0,
      }
    }
  }

  // 内边距
  const padding = parsePadding(attrs.padding)
  if (padding && Object.values(padding).some(v => v > 0)) {
    s.padding = padding
  }

  // 外边距
  const margin = parsePadding(attrs.margin)
  if (margin && Object.values(margin).some(v => v !== 0)) {
    s.margin = margin
  }

  // 子元素间距 (Row / Column / Flex)
  if (['Row', 'Column', 'Flex'].includes(type) && attrs.space !== undefined) {
    const space = parseVp(attrs.space)
    if (space !== null && space > 0) s.itemSpacing = space
  }

  // ===== 文字相关 =====
  if (TEXT_TYPES.has(type)) {
    const declaredFontSize = parseVp(attrs.fontSize)

    const fw = normalizeArkuiFontWeight(attrs.fontWeight)
    if (fw !== null) s.fontWeight = fw

    const fc = attrs.fontColor
    if (fc) s.fontColor = normalizeArkuiColor(fc)

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

function hasZeroOpacity(value) {
  if (value === undefined || value === null || value === '') return false
  const opacity = Number(value)
  return Number.isFinite(opacity) && opacity <= 0
}
