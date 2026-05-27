/**
 * ArkUI Step 2: 剪枝
 *
 * 两个子操作（按顺序）：
 *   2a. 硬剪枝 hardPrune    —— 整棵子树删除
 *       visibility=Hidden / opacity=0 / out-of-bounds / leftarrow / rightarrow /
 *       no-rect / tooWide / 空文本 Text
 *
 *   2b. 软剪枝 softPrune    —— 删除自身、把 children 顶替到原位
 *       FRAMEWORK_TYPES（无背景色时）/ Span / Blank /
 *       透明 layout（jsview / stack / column / row / flex / list / ...）/
 *       极小节点（w/h ≤ 4vp）/ 全屏包裹层（normRect.w/h ≥ 0.999）
 *
 * 注意：root 节点本身永远不会被 unwrap（它作为树根容器存在）。
 */

const SELF_SKIP_LAYOUT_TYPES = new Set([
  'jsview', 'stack', 'column', 'row', 'flex',
  'list', 'listitem', 'group', '__common__',
  'gridcol', 'gridrow', 'blank', 'spacer',
])

const TEXT_TYPES = new Set(['Text'])

/**
 * @param {object} root buildTree 输出的树根
 * @param {number} canvasW vp 单位画布宽度
 * @param {number} canvasH vp 单位画布高度
 * @returns root（就地修改）
 */
export function pruneArkuiTree(root, canvasW, canvasH) {
  if (!root) return root
  hardPrune(root, canvasW, canvasH)
  softPrune(root)
  return root
}

// ─── 2a. 硬剪枝 ─────────────────────────────────────────────────────────────────
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
  const attrs = node._attrs || {}
  const type = node.name
  const rawType = String(type || '').toLowerCase()

  if (attrs.visibility === 'Visibility.Hidden') return 'visibility-hidden'
  if (hasZeroOpacity(attrs.opacity)) return 'opacity-zero'
  if (rawType === 'leftarrow' || rawType === 'rightarrow') return 'special-component'

  // 无 rect：叶子节点（无 children）才剪；有 children 的当作 wrapper / 语法节点保留，
  // 留给 softPrune unwrap，避免连带剪掉真实子树（如 dump 里的 SyntaxItem、ContentSlot 等）
  if (!node._rectRaw && !node._spanType && !(node.children && node.children.length > 0)) {
    return 'no-rect'
  }

  if (isOutOfBoundsRect(node.rect, canvasW, canvasH)) return 'out-of-bounds'

  // 异常超宽（> 3 倍画布）
  if (node.rect.w > canvasW * 3) return 'too-wide'

  // 空文本 Text
  if (TEXT_TYPES.has(type) && String(node.textContent || '').trim().length === 0) {
    return 'empty-text'
  }

  return null
}

function hasZeroOpacity(value) {
  if (value === undefined || value === null || value === '') return false
  const opacity = Number(value)
  return Number.isFinite(opacity) && opacity <= 0
}

function isOutOfBoundsRect(rect, canvasW, canvasH) {
  if (!rect) return false
  // 零尺寸节点（框架节点等）无可见内容，不参与越界判定
  if (rect.w <= 0 || rect.h <= 0) return false
  return rect.x > canvasW ||
    rect.y > canvasH ||
    rect.x + rect.w <= 0 ||
    rect.y + rect.h <= 0
}

// ─── 2b. 软剪枝（unwrap）────────────────────────────────────────────────────────
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
  // Span / Blank 无独立布局，永远 unwrap
  if (node._spanType) return true
  if (node._blankType) return true

  // 无 rect 的 wrapper / 语法节点（dump 里的 SyntaxItem 等）：无条件 unwrap
  // root 例外（它是整棵树的容器，永远保留）
  if (!node._rectRaw && node.name !== 'root') return true

  // 框架节点：root 永不 unwrap；其余无背景色时 unwrap
  if (node._frameworkType) {
    if (node.name === 'root') return false
    return !hasBackgroundColor(node)
  }

  // 透明 layout 容器：jsview / stack / column / row / ...
  const rawType = String(node.name || '').toLowerCase()
  if (SELF_SKIP_LAYOUT_TYPES.has(rawType) && !hasBackgroundColor(node)) {
    return true
  }

  // 极小节点（≤4vp）：保留子节点，只删自身
  if (node.rect && (node.rect.w <= 4 || node.rect.h <= 4)) return true

  // 全屏包裹层（normRect.w/h 均 ≥ 0.999）：保留子节点，只删自身；有背景色的底层蒙版保留
  if (node.normRect && node.normRect.w >= 0.999 && node.normRect.h >= 0.999
      && !hasBackgroundColor(node)) return true

  return false
}

function hasBackgroundColor(node) {
  return !!(node.style && node.style.backgroundColor)
}
