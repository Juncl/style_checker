/**
 * Web Step 2: 剪枝
 *
 * 2a. 硬剪枝：整棵子树删除
 *     opacity=0 / 越界 / 空文本 / 零尺寸
 *
 * 2b. 软剪枝：删除自身、把 children 顶替到原位
 *     - 根节点 viewport（已作为树根，会在 flatten 时被跳过，这里不处理）
 *     - body（HTML 框架节点）
 *     - iframe（前端只是占位，没有真实可视内容会进入这棵树）
 *     - 透明无装饰的纯布局容器（ul / li / 无背景的 div / span / i ）
 *     - 极小节点（w/h ≤ 4 px）
 *     - 全屏包裹层（normRect.w/h ≥ 0.999 且无视觉装饰）
 *
 * 注意：根节点不会被 unwrap（作为树根容器）。
 */

import { isRenderableNonTextNode } from '../../utils/nodeVisibility.js'

const FRAMEWORK_RAW_TYPES = new Set(['body', 'iframe'])
// 默认无视觉语义的 HTML 布局标签，无装饰时整体 unwrap
const PURE_LAYOUT_RAW_TYPES = new Set(['div', 'span', 'ul', 'li', 'i', 'input'])

export function pruneWebTree(root, canvasW, canvasH) {
  if (!root) return root
  hardPrune(root, canvasW, canvasH)
  softPrune(root)
  return root
}

// ─── 硬剪枝 ─────────────────────────────────────────────────────────────────────
function hardPrune(node, canvasW, canvasH) {
  if (!node || !Array.isArray(node.children)) return
  node.children = node.children.filter(child => {
    const reason = hardPruneReason(child, canvasW, canvasH)
    if (reason) {
      child._prunedReason = reason
      return false
    }
    return true
  })
  for (const child of node.children) hardPrune(child, canvasW, canvasH)
}

function hardPruneReason(node, canvasW, canvasH) {
  if (typeof node.style?.opacity === 'number' && node.style.opacity <= 0) return 'opacity-zero'
  if (isOutOfBoundsRect(node.rect, canvasW, canvasH)) return 'out-of-bounds'
  if (node.rect.w <= 0 || node.rect.h <= 0) return 'zero-size'
  if (node.type === 'text' && String(node.textContent || '').trim().length === 0) return 'empty-text'
  return null
}

function isOutOfBoundsRect(rect, canvasW, canvasH) {
  if (!rect) return false
  return rect.x >= canvasW ||
    rect.y >= canvasH ||
    rect.x + rect.w <= 0 ||
    rect.y + rect.h <= 0
}

// ─── 软剪枝（unwrap）────────────────────────────────────────────────────────────
function softPrune(node) {
  if (!node || !Array.isArray(node.children)) return
  let i = 0
  while (i < node.children.length) {
    softPrune(node.children[i])
    const child = node.children[i]
    if (shouldUnwrap(child)) {
      node.children.splice(i, 1, ...child.children)
      continue   // 不递增 i：新顶替上来的孙子可能也是 unwrap 候选
    }
    i++
  }
}

function shouldUnwrap(node) {
  if (!node || node.type === 'text') return false
  const rawType = String(node.rawType || '').toLowerCase()

  // 框架节点：无脑 unwrap
  if (FRAMEWORK_RAW_TYPES.has(rawType)) return true

  // 极小节点
  if (node.rect.w <= 4 || node.rect.h <= 4) return true

  // 全屏包裹层 + 无装饰
  if (node.normRect && node.normRect.w >= 0.999 && node.normRect.h >= 0.999 && !isRenderableNonTextNode(node)) {
    return true
  }

  // 纯布局标签 + 无视觉装饰 → unwrap
  if (PURE_LAYOUT_RAW_TYPES.has(rawType) && !isRenderableNonTextNode(node)) {
    return true
  }

  return false
}
