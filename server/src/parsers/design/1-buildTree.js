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
 * @param {number} [arkuiCanvasWidthVp] arkui 画布宽度（vp），传入时对 design rect 做等比缩放使两侧坐标系对齐
 * @param {number} [designScale=1] design.json 内部数值缩放系数（hmWatch=0.5；把"伪 dp"换算成真 dp）
 * @returns {{ canvasWidth: number, canvasHeight: number, origCanvasWidth: number, origCanvasHeight: number, root: object | null }}
 */
export function buildDesignTree(designJson, arkuiCanvasWidthVp, designScale = 1) {
  const rawNodes = (designJson && Array.isArray(designJson.data)) ? designJson.data : []

  const rootRaw = rawNodes.find(n => Array.isArray(n.path) && n.path.length === 1)
  // 真实 dp 画布尺寸 = raw 画布 × designScale
  const origCanvasWidth  = (rootRaw?.rect?.w || 360) * designScale
  const origCanvasHeight = (rootRaw?.rect?.h || 792) * designScale

  const scale = arkuiCanvasWidthVp != null ? arkuiCanvasWidthVp / origCanvasWidth : 1
  const canvasWidth  = origCanvasWidth  * scale   // 缩放后 = arkuiCanvasWidthVp（或原值）
  const canvasHeight = origCanvasHeight * scale

  // 1a. 按 path 重建树结构
  const rawTreeRoot = rebuildAsTree(rawNodes)

  // 1b. 字段统一（递归把 _raw 转 UnifiedNode）
  const root = rawTreeRoot
    ? convertToUnified(rawTreeRoot, origCanvasWidth, origCanvasHeight, scale, canvasWidth, canvasHeight, designScale)
    : null

  return { canvasWidth, canvasHeight, origCanvasWidth, origCanvasHeight, root }
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
// 保留4位小数消除浮点累加精度差异
function r4(v) { return Math.round(v * 10000) / 10000 }

// dpScale：把 raw.rect / raw.style 里的"伪 dp"换算成真 dp 的系数（hmWatch=0.5）
function convertToUnified(wrap, origCanvasW, origCanvasH, scale, canvasW, canvasH, dpScale = 1) {
  const raw = wrap._raw
  const rect = raw.rect || {}
  const style = raw.style || {}
  const layout = raw.layout || {}

  const hmSymbol = raw.type === TEXT_TYPE && isHmSymbolNode(raw)

  // 把 raw 坐标先缩放到真实 dp（rx, ry, rw, rh 之后皆为 dp 单位）
  const rx = (rect.x ?? 0) * dpScale
  const ry = (rect.y ?? 0) * dpScale
  const rw = (rect.w ?? 0) * dpScale
  const rh = (rect.h ?? 0) * dpScale

  const unified = {
    id: raw.guid,
    source: 'design',
    type: hmSymbol ? 'container' : mapNodeType(raw.type),
    rawType: hmSymbol ? 'symbolglyph' : String(raw.type || '').toLowerCase(),
    name: raw.name || '',
    path: raw.path,
    size: { x: rx, y: ry, w: rw, h: rh },   // 真实 dp rect，供样式比对/间距计算使用
    rect: { x: r4(rx * scale), y: r4(ry * scale), w: r4(rw * scale), h: r4(rh * scale) },
    normRect: {
      x: rx * scale / canvasW,
      y: ry * scale / canvasH,
      w: rw * scale / canvasW,
      h: rh * scale / canvasH,
    },
    visible: raw.state?.visible !== false,
    // 给 extractDesignStyle 传一个等比缩放后的 rect（dp），供 borderRadius 上限计算用
    style: extractDesignStyle(raw.type, style, layout, { hmSymbol, rect: { x: rx, y: ry, w: rw, h: rh }, dpScale }),
    children: [],
    _raw: raw,
  }

  if (raw.type === TEXT_TYPE && !hmSymbol) {
    unified.textContent = raw.content || ''
    // 用 fontSize 估算文本实际渲染宽度，收紧 x/w 到真实文字范围
    // 顺序：先在 dp 域改 size，再按 scale 系数映射 rect / normRect
    refitTextRect(unified, scale, canvasW)
    // 文本高度收敛（y/h），仅 Harmony 开头字体生效
    refitTextHeight(unified, scale, canvasH)
  }

  for (const childWrap of wrap.children) {
    unified.children.push(convertToUnified(childWrap, origCanvasW, origCanvasH, scale, canvasW, canvasH, dpScale))
  }

  applyMaskClip(unified.children, canvasW, canvasH)

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
  const { hmSymbol = false, rect = null, dpScale = 1 } = options
  const result = {}

  if (style.opacity !== undefined) {
    result.opacity = style.opacity
  }

  const isHiddenMask = style.mask === true && style.showMask === false
  if (nodeType !== TEXT_TYPE && Array.isArray(style.background) && !isHiddenMask) {
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

  if (nodeType !== TEXT_TYPE && Array.isArray(style.borderRadius) && style.borderRadius.some(v => v > 0)) {
    const brRaw = parseDesignBorderRadius(style.borderRadius)
    const br = {
      topLeft:     (brRaw.topLeft     ?? 0) * dpScale,
      topRight:    (brRaw.topRight    ?? 0) * dpScale,
      bottomRight: (brRaw.bottomRight ?? 0) * dpScale,
      bottomLeft:  (brRaw.bottomLeft  ?? 0) * dpScale,
    }
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

  // VECTOR 类型：从 vectorData.styleOverrideTable 提取顶点圆角（路径形状的圆角存储在此）
  if (nodeType === 'VECTOR' && !result.borderRadius && Array.isArray(style.vectorData?.styleOverrideTable)) {
    const radii = style.vectorData.styleOverrideTable
      .map(e => (typeof e.cornerRadius === 'number' && e.cornerRadius > 0) ? e.cornerRadius : 0)
      .filter(r => r > 0)
    if (radii.length > 0) {
      const r = Math.max(...radii) * dpScale
      const maxBr = rect && rect.w > 0 && rect.h > 0 ? Math.min(rect.w, rect.h) / 2 : Infinity
      const capped = Math.min(r, maxBr)
      result.borderRadius = { topLeft: capped, topRight: capped, bottomRight: capped, bottomLeft: capped }
    }
  }

  if (nodeType !== TEXT_TYPE) {
    const borders = Array.isArray(style.border) ? style.border : (style.border ? [style.border] : [])
    if (borders.length > 0) {
      const b = borders[0]
      const bw = b?.weight
      const borderWidth = bw != null ? parseFloat(bw) : 0
      if (borderWidth > 0) {
        const fillData = b.data?.[0]
        let borderColor = null
        if (fillData?.type === 'SOLID' && fillData.color) {
          borderColor = normalizeDesignColor(fillData.color)
        } else if (fillData?.type === 'GRADIENT_LINEAR' && Array.isArray(fillData.data) && fillData.data.length > 0) {
          const angle = fillData.angle ?? 0
          const stops = fillData.data
            .map(stop => `${normalizeDesignColor(stop.color)} ${stop.position ?? '0%'}`)
            .join(', ')
          borderColor = `linear-gradient(${angle}deg, ${stops})`
        }
        result.border = {
          color: borderColor,
          width: borderWidth * dpScale,
          style: b.style || 'solid',
        }
      }
    }
  }

  if (Array.isArray(style.blur)) {
    const bgBlur     = style.blur.find(b => b.type === 'background')
    const filterBlur = style.blur.find(b => b.type === 'filter')
    if (filterBlur) result.blur = `高斯模糊 ${Number(filterBlur.blur) * dpScale}px`
    if (bgBlur)     result.blur = `背景模糊 ${Number(bgBlur.blur) * dpScale}px`
  }

  if (Array.isArray(style.shadows) && style.shadows.length > 0) {
    const s       = style.shadows[0]
    const color   = normalizeDesignColor(s.color)
    const radius  = (s.blur ?? 0) * dpScale
    const offsetX = (s.x ?? 0) * dpScale
    const offsetY = (s.y ?? 0) * dpScale
    const needShadow = radius > 0
      && (offsetX !== 0 || offsetY !== 0)
      && color
      && !color.startsWith('#00')
    if (needShadow) {
      const typeName = s.type === 'out' ? '外阴影' : '内阴影'
      result.shadow = `${typeName} ${color} ${radius}px X:${offsetX}, Y:${offsetY}`
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
      result.fontSize = t.fontSize != null ? t.fontSize * dpScale : null
      result.fontWeight = normalizeDesignFontWeight(t.fontWeight)
      result.fontFamily = t.fontFamily || null
      // 注意：lineHeight === 1 是 Figma 表示"默认行高"的哨兵值，用原始值比较再决定要不要缩放
      result.lineHeight = (typeof t.lineHeight === 'number' && t.lineHeight !== 1)
        ? t.lineHeight * dpScale
        : null
      result.letterSpacing = t.letterSpacing != null ? t.letterSpacing * dpScale : null
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
      const p = parseDesignPadding(container.padding)
      result.padding = {
        top:    (p.top    ?? 0) * dpScale,
        right:  (p.right  ?? 0) * dpScale,
        bottom: (p.bottom ?? 0) * dpScale,
        left:   (p.left   ?? 0) * dpScale,
      }
    }
    const primary = container.axis?.primary || {}
    if (primary.spacing !== undefined) {
      result.itemSpacing = primary.spacing * dpScale
    }
  }

  return result
}

// ─── 蒙版裁剪 ──────────────────────────────────────────────────────────────────
// 扫描同层 children，找到 mask=true 的节点后，对其所有前序兄弟取与蒙版 rect 的交集
function applyMaskClip(children, canvasW, canvasH) {
  for (let i = 0; i < children.length; i++) {
    if (children[i]._raw?.style?.mask !== true) continue
    const maskRect = children[i].rect
    for (let j = 0; j < i; j++) {
      clipToMask(children[j], maskRect, canvasW, canvasH)
    }
  }
}

function clipToMask(node, maskRect, canvasW, canvasH) {
  const r = node.rect
  const newX = Math.max(r.x, maskRect.x)
  const newY = Math.max(r.y, maskRect.y)
  const newW = Math.max(0, Math.min(r.x + r.w, maskRect.x + maskRect.w) - newX)
  const newH = Math.max(0, Math.min(r.y + r.h, maskRect.y + maskRect.h) - newY)
  node.rect = { x: r4(newX), y: r4(newY), w: r4(newW), h: r4(newH) }
  node.normRect = { x: newX / canvasW, y: newY / canvasH, w: newW / canvasW, h: newH / canvasH }
  for (const child of (node.children || [])) {
    clipToMask(child, maskRect, canvasW, canvasH)
  }
}

// ─── TEXT 节点 x/w 重算 ──────────────────────────────────────────────────────
// Figma 固定宽度文本框的 rect.w 常远大于实际文字渲染宽度，导致与开发侧 text 节点
// 的 IoU 偏低、x 错位。这里用 fontSize 估算文字真实宽度，按 textAlign 在原框内
// 重新定位 x、收紧 w。仅在 dp 域 size 上先算，再按 scale 系数映射到 rect / normRect。
// y / h 完全不动。
function refitTextRect(unified, scale, canvasW) {
  if (unified.type !== 'text') return
  const content = unified.textContent
  if (!content) return
  const fontSize = unified.style?.fontSize
  if (typeof fontSize !== 'number' || fontSize <= 0) return
  // 准入门槛：fontFamily 全小写后 harmony 开头（与 refitTextHeight / 开发侧一致）
  if (!(unified.style?.fontFamily || '').toLowerCase().startsWith('harmony')) return

  const { x: rx, w: rw } = unified.size
  if (rw <= 0) return

  const textWidth = estimateTextWidth(content, fontSize)
  // 保底判据：估算宽度已达/超过原框宽（含多行文本累加偏大、自适应宽度框已贴合），
  // 不重构，保留原 rect，避免把已贴合的文本框改坏
  if (textWidth >= rw - 0.5) return

  const align = unified.style?.textAlign || 'left'
  let newX
  if (align === 'center') {
    newX = rx + (rw - textWidth) / 2
  } else if (align === 'right' || align === 'end') {
    newX = rx + rw - textWidth
  } else {
    // left / justify / start / 缺省
    newX = rx
  }

  // 先改 dp 域 size，再按 scale 系数映射 rect / normRect
  unified.size.x = newX
  unified.size.w = textWidth
  unified.rect.x = r4(newX * scale)
  unified.rect.w = r4(textWidth * scale)
  unified.normRect.x = (newX * scale) / canvasW
  unified.normRect.w = (textWidth * scale) / canvasW
}

// 估算文本渲染宽度（dp 域）：中文/全角字符按 fontSize，其他字符按 fontSize×0.6
function estimateTextWidth(content, fontSize) {
  let w = 0
  for (const ch of String(content)) {
    if (/[一-龥　-〿＀-￯]/.test(ch)) {
      w += fontSize
    } else {
      w += fontSize * 0.6
    }
  }
  return w
}

// ─── TEXT 节点 y/h 重构（高度收敛） ──────────────────────────────────────────
// 参考 dev 侧文本高度收敛：单行文本 rect.h 常含行高留白（lineHeight=1 即 auto，
// rect.h 为字体默认行高≈1.25~1.4×fontSize，字形在行高内居中，TOP 也不贴顶），
// 收敛到 fontSize 并垂直居中调整 y，让竖向尺寸与开发侧对齐。
// 仅对 Harmony 开头字体生效（与 ArkUI 同源字体，行高 metrics 一致；非 harmony
// 字体 metrics 不同，重构会失真，跳过）。x/w 不动。
function refitTextHeight(unified, scale, canvasH) {
  if (unified.type !== 'text') return
  // 准入门槛：fontFamily 全小写后 harmony 开头（与 refitTextRect / 开发侧一致）
  if (!(unified.style?.fontFamily || '').toLowerCase().startsWith('harmony')) return
  const fontSize = unified.style?.fontSize
  if (typeof fontSize !== 'number' || fontSize <= 0) return
  const { y: ry, w: rw, h: rh } = unified.size
  if (rw <= 0 || rh <= 0) return
  // 单行判据：高度低于近两行视为单行；多行不重构
  if (rh >= fontSize * 1.9) return

  // 一律垂直居中收敛（与 dev 侧一致）：h→fontSize，y 上下各缩 (h-fs)/2 保文字位置
  const newH = fontSize
  const newY = ry + (rh - fontSize) / 2

  // 先改 dp 域 size，再按 scale 系数映射 rect / normRect
  unified.size.y = newY
  unified.size.h = newH
  unified.rect.y = r4(newY * scale)
  unified.rect.h = r4(newH * scale)
  unified.normRect.y = (newY * scale) / canvasH
  unified.normRect.h = (newH * scale) / canvasH
}
