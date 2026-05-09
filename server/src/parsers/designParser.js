/**
 * Design JSON 解析器
 * 将 Figma 导出的 design.json 转换为统一中间表示 UnifiedNode[]
 */

import { normalizeDesignColor } from '../utils/colorUtils.js'
import {
  normalizeDesignFontWeight,
  parseDesignBorderRadius,
  parseDesignPadding,
} from '../utils/unitUtils.js'

// 需要提取的节点类型
const VISUAL_TYPES = new Set(['TEXT', 'FRAME', 'RECTANGLE', 'ELLIPSE', 'GROUP', 'VECTOR', 'BOOLEAN_OPERATION'])
const TEXT_TYPE = 'TEXT'
const CONTAINER_TYPES = new Set(['FRAME', 'GROUP'])

/**
 * 从 design.json 中提取所有视觉节点
 * @param {object} designJson
 * @returns {{ canvasWidth: number, canvasHeight: number, nodes: UnifiedNode[] }}
 */
export function parseDesign(designJson) {
  const nodes = designJson.data || []
  const booleanOperationPaths = nodes
    .filter(n => n.type === 'BOOLEAN_OPERATION' && Array.isArray(n.path))
    .map(n => n.path)
  const zeroOpacityPaths = nodes
    .filter(n => hasZeroOpacity(n.style?.opacity) && Array.isArray(n.path))
    .map(n => n.path)

  // 根节点（path=[0]）提供画布尺寸
  const rootNode = nodes.find(n => n.path.length === 1)
  const canvasWidth  = rootNode?.rect?.w || 360
  const canvasHeight = rootNode?.rect?.h || 792
  const outOfBoundsPaths = nodes
    .filter(n => Array.isArray(n.path) && isOutOfBoundsRect(n.rect, canvasWidth, canvasHeight))
    .map(n => n.path)
  const semanticAssetPaths = nodes
    .filter(n => shouldCollapseSemanticAsset(n, nodes, canvasWidth, canvasHeight))
    .map(n => n.path)

  const unified = []

  for (let paintIndex = 0; paintIndex < nodes.length; paintIndex++) {
    const node = nodes[paintIndex]
    if (!VISUAL_TYPES.has(node.type)) continue
    if (node.type === TEXT_TYPE && !hasTextContent(node.content)) continue
    const pruneReason = getDesignSubtreePruneReason(node, {
      semanticAssetPaths,
      booleanOperationPaths,
      zeroOpacityPaths,
      outOfBoundsPaths,
    })
    if (pruneReason) continue

    const semanticAsset = shouldCollapseSemanticAsset(node, nodes, canvasWidth, canvasHeight)
    const src = semanticAsset ? selectSemanticRepresentative(node, nodes) : node

    const rect = src.rect || {}
    const style = src.style || {}
    const layout = src.layout || {}

    // HM Symbol 文本节点在设计侧表现为 TEXT，但本质是矢量图标，需作为 container/symbolglyph 处理
    const hmSymbol = src.type === TEXT_TYPE && isHmSymbolNode(src)

    const unifiedNode = {
      id:     src.guid,
      source: 'design',
      type:   hmSymbol ? 'container' : mapNodeType(src.type),
      rawType: hmSymbol ? 'symbolglyph' : String(src.type || '').toLowerCase(),
      name:   src.name || '',
      path:   src.path,
      paintIndex,
      rect: {
        x: rect.x ?? 0,
        y: rect.y ?? 0,
        w: rect.w ?? 0,
        h: rect.h ?? 0,
      },
      // 归一化坐标（0-1）：横向按宽度，纵向按高度，避免不同高宽比页面产生 y 轴漂移。
      normRect: {
        x: (rect.x ?? 0) / canvasWidth,
        y: (rect.y ?? 0) / canvasHeight,
        w: (rect.w ?? 0) / canvasWidth,
        h: (rect.h ?? 0) / canvasHeight,
      },
      visible: src.state?.visible !== false,
      style: extractDesignStyle(src.type, style, layout, { hmSymbol }),
    }

    if (semanticAsset) {
      unifiedNode.semanticAsset = true
      unifiedNode.style.semanticAsset = assetKind(node)
    }

    // HM Symbol 节点不携带文字内容，普通 TEXT 节点才设置 textContent
    if (node.type === TEXT_TYPE && !hmSymbol) {
      unifiedNode.textContent = node.content || ''
    }

    unified.push(unifiedNode)
  }

  return { canvasWidth, canvasHeight, nodes: unified }
}

function mapNodeType(type) {
  if (type === 'TEXT') return 'text'
  return 'container'
}

function isHmSymbolNode(node) {
  const t = node.style?.text?.[0]
  return !!t && /hm\s*symbol/i.test(t.fontFamily || '')
}

function extractDesignStyle(nodeType, style, layout, options = {}) {
  const { hmSymbol = false } = options
  const result = {}

  // 不透明度
  if (style.opacity !== undefined) {
    result.opacity = style.opacity
  }

  // 填充
  if (Array.isArray(style.background)) {
    const solidBg = style.background.find(b => b.type === 'SOLID')
    if (solidBg?.color) {
      result.backgroundColor = normalizeDesignColor(solidBg.color)
    }
  }

  // 圆角
  if (Array.isArray(style.borderRadius) && style.borderRadius.some(v => v > 0)) {
    result.borderRadius = parseDesignBorderRadius(style.borderRadius)
  }

  // 描边（border 字段为列表）
  const borders = Array.isArray(style.border) ? style.border : (style.border ? [style.border] : [])
  if (borders.length > 0 && borders[0].width > 0) {
    const b = borders[0]
    result.border = {
      color: normalizeDesignColor(b.color),
      width: b.width ?? 0,
      style: b.style || 'solid',
    }
  }

  // 背景模糊
  if (Array.isArray(style.blur)) {
    const bgBlur = style.blur.find(b => b.type === 'background')
    const filterBlur = style.blur.find(b => b.type === 'filter')
    if (bgBlur) result.backdropBlur = bgBlur.blur
    if (filterBlur) result.blur = filterBlur.blur
  }

  // 投影
  if (Array.isArray(style.shadows) && style.shadows.length > 0) {
    const s = style.shadows[0]
    result.shadow = {
      color:   normalizeDesignColor(s.color),
      radius:  s.blur ?? 0,
      offsetX: s.x ?? 0,
      offsetY: s.y ?? 0,
    }
  }

  // 文字样式
  if (nodeType === TEXT_TYPE && Array.isArray(style.text) && style.text.length > 0) {
    const t = style.text[0]
    if (hmSymbol) {
      // HM Symbol 本质是矢量图标：颜色作为填充色，不设置文字相关属性
      if (Array.isArray(t.data)) {
        const solidFill = t.data.find(d => d.type === 'SOLID')
        if (solidFill?.color) {
          result.backgroundColor = normalizeDesignColor(solidFill.color)
        }
      }
    } else {
      result.textAlign = style.textAlign || 'left'
      result.fontSize = t.fontSize ?? null
      result.fontWeight = normalizeDesignFontWeight(t.fontWeight)
      result.fontFamily = t.fontFamily || null
      result.lineHeight = typeof t.lineHeight === 'number' && t.lineHeight !== 1
        ? t.lineHeight
        : null
      result.letterSpacing = t.letterSpacing ?? null

      // 文字颜色：取第一段的第一个 SOLID fill
      if (Array.isArray(t.data)) {
        const solidFill = t.data.find(d => d.type === 'SOLID')
        if (solidFill?.color) {
          result.fontColor = normalizeDesignColor(solidFill.color)
        }
      }
    }
  }

  // 容器内边距
  if (CONTAINER_TYPES.has(nodeType)) {
    const container = layout.container || {}
    if (Array.isArray(container.padding)) {
      result.padding = parseDesignPadding(container.padding)
    }
    // 子元素间距
    const primary = container.axis?.primary || {}
    if (primary.spacing !== undefined) {
      result.itemSpacing = primary.spacing
    }
  }

  return result
}

function isDescendantOfAnyPath(path, ancestorPaths) {
  if (!Array.isArray(path)) return false
  return ancestorPaths.some(ancestor => isDescendantPath(path, ancestor))
}

function isSelfOrDescendantOfAnyPath(path, ancestorPaths) {
  if (!Array.isArray(path)) return false
  return ancestorPaths.some(ancestor => isSamePath(path, ancestor) || isDescendantPath(path, ancestor))
}

function isDescendantPath(path, ancestor) {
  if (!Array.isArray(ancestor) || path.length <= ancestor.length) return false
  for (let i = 0; i < ancestor.length; i++) {
    if (path[i] !== ancestor[i]) return false
  }
  return true
}

function isSamePath(path, other) {
  return Array.isArray(other) && path.length === other.length &&
    path.every((part, idx) => part === other[idx])
}

function hasZeroOpacity(value) {
  if (value === undefined || value === null || value === '') return false
  const opacity = Number(value)
  return Number.isFinite(opacity) && opacity <= 0
}

function getDesignSubtreePruneReason(node, { semanticAssetPaths, booleanOperationPaths, zeroOpacityPaths, outOfBoundsPaths }) {
  const rules = [
    isDescendantOfAnyPath(node.path, semanticAssetPaths) ? 'semantic-asset-descendant' : null,
    isDescendantOfAnyPath(node.path, booleanOperationPaths) ? 'boolean-operation-descendant' : null,
    hasZeroOpacity(node.style?.opacity) || isSelfOrDescendantOfAnyPath(node.path, zeroOpacityPaths)
      ? 'opacity-zero'
      : null,
    isDescendantOfAnyPath(node.path, outOfBoundsPaths) ? 'out-of-bounds' : null,
  ]
  return rules.find(Boolean) || null
}

function isOutOfBoundsRect(rect, canvasWidth, canvasHeight) {
  if (!rect) return false
  const x = Number(rect.x ?? 0)
  const y = Number(rect.y ?? 0)
  const w = Number(rect.w ?? 0)
  const h = Number(rect.h ?? 0)
  return x > canvasWidth ||
    y > canvasHeight ||
    x + w <= 0 ||
    y + h <= 0
}

function hasTextContent(value) {
  return String(value || '').trim().length > 0
}

function shouldCollapseSemanticAsset(node, allNodes, canvasWidth, canvasHeight) {
  if (!isSemanticAssetRoot(node)) return false
  if (hasTextDescendant(node, allNodes)) return false
  if (isLargeIllustrationContainer(node, allNodes, canvasWidth, canvasHeight)) return false
  return true
}

function isSemanticAssetRoot(node) {
  if (!node || !Array.isArray(node.path)) return false
  if (!['FRAME', 'GROUP', 'VECTOR', 'BOOLEAN_OPERATION'].includes(node.type)) return false
  const name = String(node.name || '').trim()
  if (!name) return false
  if (/^#?illustration\b/i.test(name) || /插画|illustration/i.test(name)) return true
  if (!/(^|[/_\s-])icon([/_\s-]|$)|(^|[/_\s-])ic_|图标/i.test(name)) return false
  const rect = node.rect || {}
  const w = rect.w ?? 0
  const h = rect.h ?? 0
  if (w < 4 || h < 4) return false
  if (w > 48 || h > 48) return false
  const ratio = Math.max(w / h, h / w)
  return ratio <= 4
}

function assetKind(node) {
  const name = String(node?.name || '')
  return /插画|illustration/i.test(name) ? 'illustration' : 'icon'
}

function isLargeIllustrationContainer(node, allNodes, canvasWidth, canvasHeight) {
  const name = String(node?.name || '')
  if (!/(^#?illustration\b|插画|illustration)/i.test(name)) return false
  const rect = node.rect || {}
  const canvasArea = Math.max(1, canvasWidth * canvasHeight)
  const areaRatio = ((rect.w || 0) * (rect.h || 0)) / canvasArea
  if (areaRatio < 0.55) return false
  const textDescendants = allNodes.filter(n =>
    n.type === TEXT_TYPE &&
    hasTextContent(n.content) &&
    isDescendantPath(n.path, node.path)
  )
  return textDescendants.length >= 3
}

function hasTextDescendant(node, allNodes) {
  return allNodes.some(n =>
    n.type === TEXT_TYPE &&
    hasTextContent(n.content) &&
    isDescendantPath(n.path, node.path)
  )
}

// 语义折叠代表节点选取：frame 折叠时，若存在与 frame 等大的非文本后代，
// 优先取有背景色的节点；frame 和子节点都有背景色时取子节点。
function selectSemanticRepresentative(frameNode, allRawNodes) {
  const frameW = frameNode.rect?.w ?? 0
  const frameH = frameNode.rect?.h ?? 0

  const sameSized = allRawNodes.filter(n => {
    if (n.type === TEXT_TYPE) return false
    if (!isDescendantPath(n.path, frameNode.path)) return false
    const w = n.rect?.w ?? 0
    const h = n.rect?.h ?? 0
    return Math.abs(w - frameW) <= 1 && Math.abs(h - frameH) <= 1
  })

  if (sameSized.length === 0) return frameNode

  const withBg = sameSized
    .filter(n => Array.isArray(n.style?.background) && n.style.background.some(b => b.type === 'SOLID' && b.color))
    .sort((a, b) => a.path.length - b.path.length)

  if (withBg.length === 0) return frameNode

  // 子节点有背景色 → 用子节点（含两者都有背景色的情形）
  return withBg[0]
}
