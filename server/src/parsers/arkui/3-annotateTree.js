/**
 * ArkUI Step 3: 后项杀前项剪枝 → 像素标注 → OCR 标注 → 不可见 unwrap
 *
 * 四个独立子操作，互不依赖标注字段：
 *   1. pruneOccludedSiblings  — 直接从树中删除被后绘制兄弟完全覆盖的节点，不挂任何标注
 *   2. annotatePixelVisibility — 挂 pixelVisibility / pixelInvisible
 *   3. annotateTextOcrVisibility — 挂 ocrVisibility（文本节点）
 *   4. unwrapInvisible         — 基于 isPipelineVisibleNode 做 unwrap（删自身保子）
 */

import { annotatePixelVisibility } from '../../utils/imageFeatures.js'
import { annotateTextOcrVisibility } from '../../utils/textOcrVisibility.js'

// ─── 遮挡剪枝 ────────────────────────────────────────────────────────────────

const INTRINSIC_VISUAL_RAW_TYPES = new Set([
  'image', 'button', 'search', 'searchfield', 'symbolglyph',
  'circle', 'ellipse', 'rect', 'vector', 'boolean_operation',
])

function hasVisualDecoration(node) {
  const s = node.style || {}
  return !!(s.backgroundColor || s.borderRadius || s.border || s.shadow || s.backdropBlur || s.blur)
}

function isIntrinsicVisualNode(node) {
  const rawType = String(node?.rawType || node?.type || node?.name || '').toLowerCase()
  return INTRINSIC_VISUAL_RAW_TYPES.has(rawType) || !!node?.semanticAsset
}

function isRenderableNonTextNode(node) {
  if (node?.type !== 'container') return false
  return hasVisualDecoration(node) || isIntrinsicVisualNode(node)
}

function isOccludingNode(node) {
  if (!node?.visible) return false
  if (node.type === 'text') return false
  if (!isRenderableNonTextNode(node)) return false
  const s = node.style || {}
  const opacity = s.opacity == null ? 1 : s.opacity
  if (opacity < 0.70) return false
  // 特殊混合模式（非 0）表示该节点以合成方式叠加，不是普通覆盖层，不视为遮挡物
  if (s.blendMode != null && s.blendMode !== 0) return false
  return true
}

function isCoveredByRect(rectA, rectB) {
  if (!rectA || !rectB) return false
  return (
    rectB.x <= rectA.x &&
    rectB.y <= rectA.y &&
    rectB.x + rectB.w >= rectA.x + rectA.w &&
    rectB.y + rectB.h >= rectA.y + rectA.h
  )
}

function deepCanOcclude(blocker, targetRect) {
  if (!blocker) return false
  if (isOccludingNode(blocker) && isCoveredByRect(targetRect, blocker.rect)) return true
  for (const child of (blocker.children || [])) {
    if (deepCanOcclude(child, targetRect)) return true
  }
  return false
}

function traverseAndPrune(node, type) {
  if (!node || !Array.isArray(node.children) || node.children.length === 0) return
  for (const child of node.children) {
    traverseAndPrune(child, type)
  }
  node.children = node.children.filter((current, index, arr) => {
    if (!current?.rect || current.rect.w <= 0 || current.rect.h <= 0) return true
    if (type === 'forward') {
      for (let i = 0; i < index; i++) {
        if (deepCanOcclude(arr[i], current.rect)) return false
      }
    } else {
      for (let i = index + 1; i < arr.length; i++) {
        if (deepCanOcclude(arr[i], current.rect)) return false
      }
    }
    return true
  })
}

/**
 * 按渲染顺序在每一层兄弟节点之间判断遮挡，直接剪枝，不挂标注。
 * type='reverse'（默认）: 后项杀前项（ArkUI）
 * type='forward': 前项杀后项（设计侧）
 */
function pruneOccludedSiblings(root, type = 'reverse') {
  if (!root) return
  traverseAndPrune(root, type)
}

// ─── 可见性过滤 ───────────────────────────────────────────────────────────────

function isLightFontColor(color) {
  if (!color || typeof color !== 'string') return false
  const hex = color.replace('#', '')
  let r, g, b
  if (hex.length === 8) {
    r = parseInt(hex.slice(2, 4), 16)
    g = parseInt(hex.slice(4, 6), 16)
    b = parseInt(hex.slice(6, 8), 16)
  } else if (hex.length === 6) {
    r = parseInt(hex.slice(0, 2), 16)
    g = parseInt(hex.slice(2, 4), 16)
    b = parseInt(hex.slice(4, 6), 16)
  } else {
    return false
  }
  // 感知亮度 > 200/255 视为浅色字体
  return (0.299 * r + 0.587 * g + 0.114 * b) > 200
}

function isPipelineVisibleNode(node) {
  if (!node?.visible) return false
  if (node.pixelInvisible) return false
  if (node.type === 'text' && node.hiddenFrameworkAncestor) return false
  if (node.type === 'text' && node.ocrVisibility?.visible === false) {
    const stroke = node.pixelVisibility?.textStrokeScore ?? 0
    const ratio = node.pixelVisibility?.visiblePixelRatio ?? 0
    // 白色/浅色字体在 OCR 中天然识别率极低，不参与此项过滤
    if (stroke < 0.05 && ratio > 0.20 && !isLightFontColor(node.style?.fontColor)) return false
  }
  return true
}

// ─── 流水线主函数 ──────────────────────────────────────────────────────────────

/**
 * @param {object} root pruneTree 处理后的树根
 * @param {{ imageBuffer?: Buffer, canvasWidthVp: number, canvasHeightVp: number }} opts
 * @returns {Promise<{ root, stats }>}
 */
export async function annotateArkuiTree(root, opts = {}) {
  if (!root) return { root, stats: emptyStats() }
  const { imageBuffer, canvasWidthVp, canvasHeightVp } = opts

  // 1. 后项杀前项：先于像素/OCR，直接剪掉被遮挡节点
  pruneOccludedSiblings(root)

  // 2 & 3. 像素 + OCR 标注（基于剪枝后的树收 nodeList）
  const nodeList = []
  collectNodes(root, nodeList, /* skipSelf */ true)

  const stats = emptyStats()

  if (imageBuffer && canvasWidthVp && canvasHeightVp) {
    const pix = annotatePixelVisibility(
      nodeList, imageBuffer,
      { w: canvasWidthVp, h: canvasHeightVp },
      { source: 'arkui' },
    )
    stats.pixelChecked = pix.checked
    stats.pixelHidden = pix.hidden

    const ocr = await annotateTextOcrVisibility(
      nodeList, imageBuffer,
      { w: canvasWidthVp, h: canvasHeightVp },
      { source: 'arkui', mode: 'all' },
    )
    stats.ocrChecked = ocr.checked
    stats.ocrHidden = ocr.hidden
    stats.ocrMatched = ocr.matched
    stats.ocrItems = ocr.ocrItems
  }

  // 4. 基于像素/OCR 标注做 unwrap
  unwrapInvisible(root)

  return { root, stats }
}

function collectNodes(node, out, skipSelf = false) {
  if (!node) return
  if (!skipSelf) out.push(node)
  if (Array.isArray(node.children)) {
    for (const c of node.children) collectNodes(c, out, false)
  }
}

function unwrapInvisible(node) {
  if (!node || !Array.isArray(node.children)) return
  let i = 0
  while (i < node.children.length) {
    unwrapInvisible(node.children[i])
    const child = node.children[i]
    if (!isPipelineVisibleNode(child)) {
      node.children.splice(i, 1, ...child.children)
      continue
    }
    i++
  }
}

function emptyStats() {
  return {
    pixelChecked: 0, pixelHidden: 0,
    ocrChecked: 0, ocrHidden: 0, ocrMatched: 0, ocrItems: 0,
  }
}
