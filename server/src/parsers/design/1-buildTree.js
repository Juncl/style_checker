/**
 * Design Step 1: 扁平 data[] + path → UnifiedNode 树
 *
 * 两个子操作（按顺序）：
 *   1a. 按 path 重建树结构（节点暂时保留 _raw 引用，孤儿丢弃）
 *   1b. 在树上递归把每个节点字段统一为 UnifiedNode 形状（style、rect、normRect 等）
 *
 * 不做任何过滤剪枝 —— opacity=0、out-of-bounds、boolean_operation 后代、
 * semantic asset 折叠等都留到 step2 处理。
 *
 * 节点形状：
 *   {
 *     id, source: 'design', type, rawType, name, path,
 *     rect, normRect, visible, style, textContent?,
 *     children: [],
 *     _raw: object,                // 原始 design data 节点，供 step2 折叠/剪枝判断
 *   }
 */

import { normalizeDesignColor } from '../../utils/colorUtils.js'
import {
  normalizeDesignFontWeight,
  parseDesignBorderRadius,
  parseDesignPadding,
} from '../../utils/unitUtils.js'

const TEXT_TYPE = 'TEXT'
const CONTAINER_TYPES = new Set(['FRAME', 'GROUP'])

/**
 * @param {object} designJson 原始 design.json
 * @returns {{ canvasWidth: number, canvasHeight: number, root: object | null }}
 */
export function buildDesignTree(designJson) {
  const rawNodes = (designJson && Array.isArray(designJson.data)) ? designJson.data : []

  const rootRaw = rawNodes.find(n => Array.isArray(n.path) && n.path.length === 1)
  const canvasWidth = rootRaw?.rect?.w || 360
  const canvasHeight = rootRaw?.rect?.h || 792

  // 1a. 按 path 重建树结构
  const rawTreeRoot = rebuildAsTree(rawNodes)

  // 1b. 字段统一（递归把 _raw 转 UnifiedNode）
  const root = rawTreeRoot
    ? convertToUnified(rawTreeRoot, canvasWidth, canvasHeight)
    : null

  return { canvasWidth, canvasHeight, root }
}

// ─── 1a. 按 path 重建树 ────────────────────────────────────────────────────────
function rebuildAsTree(rawNodes) {
  const wrapMap = new Map()
  for (const raw of rawNodes) {
    if (!Array.isArray(raw.path)) continue
    wrapMap.set(raw.path.join('.'), { _raw: raw, children: [] })
  }

  let root = null
  const sorted = [...wrapMap.values()]
    .sort((a, b) => a._raw.path.length - b._raw.path.length)

  for (const wrap of sorted) {
    const path = wrap._raw.path
    if (path.length === 1) {
      root = wrap
      continue
    }
    const parentKey = path.slice(0, -1).join('.')
    const parent = wrapMap.get(parentKey)
    if (!parent) continue   // 孤儿节点：丢弃
    parent.children.push(wrap)
  }
  return root
}

// ─── 1b. 字段统一 ──────────────────────────────────────────────────────────────
function convertToUnified(wrap, canvasW, canvasH) {
  const raw = wrap._raw
  const rect = raw.rect || {}
  const style = raw.style || {}
  const layout = raw.layout || {}

  const hmSymbol = raw.type === TEXT_TYPE && isHmSymbolNode(raw)

  const unified = {
    id: raw.guid,
    source: 'design',
    type: hmSymbol ? 'container' : mapNodeType(raw.type),
    rawType: hmSymbol ? 'symbolglyph' : String(raw.type || '').toLowerCase(),
    name: raw.name || '',
    path: raw.path,
    rect: {
      x: rect.x ?? 0,
      y: rect.y ?? 0,
      w: rect.w ?? 0,
      h: rect.h ?? 0,
    },
    normRect: {
      x: (rect.x ?? 0) / canvasW,
      y: (rect.y ?? 0) / canvasH,
      w: (rect.w ?? 0) / canvasW,
      h: (rect.h ?? 0) / canvasH,
    },
    visible: raw.state?.visible !== false,
    style: extractDesignStyle(raw.type, style, layout, { hmSymbol, rect }),
    children: [],
    _raw: raw,
  }

  if (raw.type === TEXT_TYPE && !hmSymbol) {
    unified.textContent = raw.content || ''
  }

  for (const childWrap of wrap.children) {
    unified.children.push(convertToUnified(childWrap, canvasW, canvasH))
  }

  return unified
}

function mapNodeType(type) {
  if (type === TEXT_TYPE) return 'text'
  return 'container'
}

function isHmSymbolNode(node) {
  const t = node.style?.text?.[0]
  return !!t && /hm\s*symbol/i.test(t.fontFamily || '')
}

function extractDesignStyle(nodeType, style, layout, options = {}) {
  const { hmSymbol = false, rect = null } = options
  const result = {}

  if (style.opacity !== undefined) {
    result.opacity = style.opacity
  }

  if (Array.isArray(style.background)) {
    const solidBg = style.background.find(b => b.type === 'SOLID')
    if (solidBg?.color) {
      result.backgroundColor = normalizeDesignColor(solidBg.color)
    } else {
      const linearGradient = style.background.find(b => b.type === 'GRADIENT_LINEAR')
      if (linearGradient && Array.isArray(linearGradient.data) && linearGradient.data.length > 0) {
        const angle = linearGradient.angle ?? 0
        const stops = linearGradient.data
          .map(stop => `${normalizeDesignColor(stop.color)} ${stop.position ?? '0%'}`)
          .join(', ')
        result.backgroundColor = `linear-gradient(${angle}deg, ${stops})`
      }
    }
  }

  if (Array.isArray(style.borderRadius) && style.borderRadius.some(v => v > 0)) {
    const br = parseDesignBorderRadius(style.borderRadius)
    if (rect && rect.w > 0 && rect.h > 0) {
      const maxBr = Math.min(rect.w, rect.h) / 2
      result.borderRadius = {
        topLeft:     Math.min(br.topLeft,     maxBr),
        topRight:    Math.min(br.topRight,    maxBr),
        bottomRight: Math.min(br.bottomRight, maxBr),
        bottomLeft:  Math.min(br.bottomLeft,  maxBr),
      }
    } else {
      result.borderRadius = br
    }
  }

  const borders = Array.isArray(style.border) ? style.border : (style.border ? [style.border] : [])
  if (borders.length > 0 && borders[0].width > 0) {
    const b = borders[0]
    result.border = {
      color: normalizeDesignColor(b.color),
      width: b.width ?? 0,
      style: b.style || 'solid',
    }
  }

  if (Array.isArray(style.blur)) {
    const bgBlur = style.blur.find(b => b.type === 'background')
    const filterBlur = style.blur.find(b => b.type === 'filter')
    if (bgBlur) result.backdropBlur = bgBlur.blur
    if (filterBlur) result.blur = filterBlur.blur
  }

  if (Array.isArray(style.shadows) && style.shadows.length > 0) {
    const s = style.shadows[0]
    result.shadow = {
      color:   normalizeDesignColor(s.color),
      radius:  s.blur ?? 0,
      offsetX: s.x ?? 0,
      offsetY: s.y ?? 0,
    }
  }

  if (nodeType === TEXT_TYPE && Array.isArray(style.text) && style.text.length > 0) {
    const t = style.text[0]
    if (hmSymbol) {
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
      if (Array.isArray(t.data)) {
        const solidFill = t.data.find(d => d.type === 'SOLID')
        if (solidFill?.color) {
          result.fontColor = normalizeDesignColor(solidFill.color)
        }
        const gradient = t.data.find(d => d.type === 'GRADIENT_LINEAR')
        if (gradient && Array.isArray(gradient.data) && gradient.data.length > 0) {
          const angle = gradient.angle ?? 0
          const stops = gradient.data
            .map(stop => `${normalizeDesignColor(stop.color)} ${stop.position ?? '0%'}`)
            .join(', ')
          result.fontColor = `linear-gradient(${angle}deg, ${stops})`
        }
      }
    }
  }

  if (CONTAINER_TYPES.has(nodeType)) {
    const container = layout.container || {}
    if (Array.isArray(container.padding)) {
      result.padding = parseDesignPadding(container.padding)
    }
    const primary = container.axis?.primary || {}
    if (primary.spacing !== undefined) {
      result.itemSpacing = primary.spacing
    }
  }

  return result
}
