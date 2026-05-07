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
  const semanticAssetPaths = nodes
    .filter(n => shouldCollapseSemanticAsset(n, nodes, canvasWidth, canvasHeight))
    .map(n => n.path)

  const unified = []

  for (let paintIndex = 0; paintIndex < nodes.length; paintIndex++) {
    const node = nodes[paintIndex]
    if (!VISUAL_TYPES.has(node.type)) continue
    if (node.type === TEXT_TYPE && !hasTextContent(node.content)) continue
    if (isDescendantOfAnyPath(node.path, semanticAssetPaths)) continue
    if (isDescendantOfAnyPath(node.path, booleanOperationPaths)) continue
    if (hasZeroOpacity(node.style?.opacity) || isSelfOrDescendantOfAnyPath(node.path, zeroOpacityPaths)) continue

    const rect = node.rect || {}
    const style = node.style || {}
    const layout = node.layout || {}

    const semanticAsset = shouldCollapseSemanticAsset(node, nodes, canvasWidth, canvasHeight)
    const unifiedNode = {
      id:     node.guid,
      source: 'design',
      type:   semanticAsset ? 'image' : mapNodeType(node.type, style),
      rawType: String(node.type || '').toLowerCase(),
      name:   node.name || '',
      path:   node.path,
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
      visible: node.state?.visible !== false,
      style: extractDesignStyle(node.type, style, layout),
    }

    if (semanticAsset) {
      unifiedNode.semanticAsset = true
      unifiedNode.style.semanticAsset = assetKind(node)
    }

    // 仅 TEXT 节点有文字内容
    if (node.type === TEXT_TYPE) {
      unifiedNode.textContent = node.content || ''
    }

    unified.push(unifiedNode)
  }

  addDesignIconUnions(unified, canvasWidth, canvasHeight)

  return { canvasWidth, canvasHeight, nodes: unified }
}

function mapNodeType(type, style) {
  if (type === 'TEXT') return 'text'
  if (CONTAINER_TYPES.has(type)) return 'container'
  if (type === 'RECTANGLE' || type === 'ELLIPSE') return 'shape'
  if (type === 'VECTOR' || type === 'BOOLEAN_OPERATION') return 'image'
  return 'other'
}

function extractDesignStyle(nodeType, style, layout) {
  const result = {}

  // 不透明度
  if (style.opacity !== undefined) {
    result.opacity = style.opacity
  }

  // 背景色 + 渐变
  if (Array.isArray(style.background)) {
    const solidBg = style.background.find(b => b.type === 'SOLID')
    if (solidBg?.color) {
      result.backgroundColor = normalizeDesignColor(solidBg.color)
    }
    const gradientBg = style.background.find(b =>
      b.type === 'GRADIENT_LINEAR' || b.type === 'GRADIENT_RADIAL' || b.type === 'GRADIENT_ANGULAR'
    )
    if (gradientBg) {
      result.gradient = {
        type: gradientBg.type === 'GRADIENT_LINEAR' ? 'linear'
             : gradientBg.type === 'GRADIENT_RADIAL' ? 'radial' : 'angular',
        angle: gradientBg.angle || 0,
        stops: Array.isArray(gradientBg.data) ? gradientBg.data.map(s => ({
          color:    normalizeDesignColor(s.color),
          position: parseFloat(s.position) / 100,
        })) : [],
      }
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

function addDesignIconUnions(nodes, canvasWidth, canvasHeight) {
  const byPath = new Map(nodes.map(n => [pathKey(n.path), n]))
  const pathImages = nodes.filter(n =>
    n.source === 'design' &&
    n.type === 'image' &&
    n.visible !== false &&
    isPathLikeLayer(n) &&
    n.rect.w > 0 &&
    n.rect.h > 0
  )
  const groups = new Map()

  for (const node of pathImages) {
    const parentPath = node.path?.slice(0, -1)
    if (!parentPath?.length) continue
    const key = pathKey(parentPath)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(node)
  }

  for (const [parentKey, children] of groups) {
    if (children.length < 2) continue
    const union = unionRect(children.map(n => n.rect))
    if (!isIconSized(union)) continue

    const parent = byPath.get(parentKey)
    const unionPath = [...(parent?.path || children[0].path.slice(0, -1)), '__icon_union__']
    const iconNode = {
      id: `${parent?.id || parentKey}::icon-union`,
      source: 'design',
      type: 'image',
      name: `${parent?.name || 'icon'}::icon-union`,
      path: unionPath,
      paintIndex: Math.max(...children.map(n => n.paintIndex ?? 0)) + 0.1,
      rect: union,
      normRect: {
        x: union.x / canvasWidth,
        y: union.y / canvasHeight,
        w: union.w / canvasWidth,
        h: union.h / canvasHeight,
      },
      visible: true,
      style: { ...(parent?.style || {}), iconUnion: true },
      iconUnion: true,
      iconFragmentIds: children.map(n => n.id),
    }

    for (const child of children) {
      child.iconFragment = true
      child.iconUnionParentId = iconNode.id
    }
    nodes.push(iconNode)
  }
}

function isPathLikeLayer(node) {
  return /^(path|路径)/i.test(String(node.name || '').trim())
}

function isIconSized(rect) {
  if (!rect) return false
  if (rect.w < 4 || rect.h < 4) return false
  if (rect.w > 48 || rect.h > 48) return false
  const ratio = Math.max(rect.w / rect.h, rect.h / rect.w)
  return ratio <= 4
}

function unionRect(rects) {
  const x1 = Math.min(...rects.map(r => r.x))
  const y1 = Math.min(...rects.map(r => r.y))
  const x2 = Math.max(...rects.map(r => r.x + r.w))
  const y2 = Math.max(...rects.map(r => r.y + r.h))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

function pathKey(path) {
  return Array.isArray(path) ? path.join('/') : ''
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
  return isIconSized({ w: rect.w ?? 0, h: rect.h ?? 0 })
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
