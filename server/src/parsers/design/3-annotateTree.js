/**
 * Design Step 3: 前项杀后项剪枝 → 像素标注 → 不可见 unwrap
 *
 * Design 侧不做 OCR。
 * 三步相互独立，不通过标注字段联动。
 */

import { annotatePixelVisibility } from '../../utils/imageFeatures.js'

// ─── 遮挡剪枝 ────────────────────────────────────────────────────────────────

const INTRINSIC_VISUAL_RAW_TYPES = new Set([
  'image', 'button', 'search', 'searchfield', 'symbolglyph',
  'circle', 'ellipse', 'rect', 'vector', 'boolean_operation',
])

function hasVisualDecoration(node) {
  const s = node.style || {}
  return !!(s.backgroundColor || s.borderRadius || s.border || s.shadow || s.blur)
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
  // 设计侧专有规则：FRAME 节点无背景色时不视为遮挡物（空壳 FRAME 不应压盖后面的有色节点）
  if (String(node.rawType || '').toLowerCase() === 'frame' && !s.backgroundColor) return false
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

function isPipelineVisibleNode(node) {
  if (!node?.visible) return false
  if (node.pixelInvisible) return false
  if (node.type === 'text' && node.hiddenFrameworkAncestor) return false
  return true
}

// ─── 流水线主函数 ──────────────────────────────────────────────────────────────

/**
 * @param {object} root pruneDesignTree 处理后的树根
 * @param {{ imageBuffer?: Buffer, canvasWidth: number, canvasHeight: number }} opts
 * @returns {{ root, stats }}
 */
export function annotateDesignTree(root, opts = {}) {
  if (!root) return { root, stats: emptyStats() }
  const { imageBuffer, canvasWidth, canvasHeight } = opts

  // 1. 前项杀后项：先于像素，直接剪掉被前绘制兄弟完全覆盖的节点
  pruneOccludedSiblings(root, 'forward')

  const nodeList = []
  collectNodes(root, nodeList, /* skipSelf */ true)

  const stats = emptyStats()
  if (imageBuffer && canvasWidth && canvasHeight) {
    const pix = annotatePixelVisibility(
      nodeList, imageBuffer,
      { w: canvasWidth, h: canvasHeight },
      { source: 'design' },
    )
    stats.pixelChecked = pix.checked
    stats.pixelHidden = pix.hidden
  }

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
  return { pixelChecked: 0, pixelHidden: 0 }
}
