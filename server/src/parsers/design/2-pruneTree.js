/**
 * Design Step 2: 剪枝
 *
 * Design 侧的剪枝包含 4 个子操作（按顺序）：
 *
 *   2a. 硬剪枝 hardPrune       —— 整棵子树删除
 *       opacity=0 / out-of-bounds 自身或后代
 *
 *   2b. 语义折叠 semanticCollapse
 *       icon / illustration 等小尺寸 FRAME/GROUP/VECTOR 折叠为单节点：
 *       用合适的子孙 representative 替换自身字段，并清空 children。
 *
 *   2c. 后代剪枝 pruneDescendantsOf
 *       BOOLEAN_OPERATION 节点本身保留，但其 children 全部清空。
 *
 *   2d. 软剪枝 softPrune       —— 删自身保子
 *       非 VISUAL_TYPES（理论上不会出现）/ 空文本 TEXT
 *
 * 注意：design 根节点（path=[0]）永不 unwrap。
 */

const VISUAL_TYPES = new Set(['TEXT', 'FRAME', 'RECTANGLE', 'ELLIPSE', 'GROUP', 'VECTOR', 'BOOLEAN_OPERATION'])
const TEXT_TYPE = 'TEXT'

/**
 * @param {object} root buildDesignTree 输出的树根
 * @param {number} canvasW
 * @param {number} canvasH
 * @returns root（就地修改）
 */
export function pruneDesignTree(root, canvasW, canvasH) {
  if (!root) return root
  hardPrune(root, canvasW, canvasH)
  semanticCollapse(root, canvasW, canvasH)
  pruneBooleanOperationDescendants(root)
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
  for (const c of node.children) hardPrune(c, canvasW, canvasH)
}

function hardPruneReason(node, canvasW, canvasH) {
  const raw = node._raw || {}
  if (hasZeroOpacity(raw.style?.opacity)) return 'opacity-zero'
  if (isOutOfBoundsRect(node.rect, canvasW, canvasH)) return 'out-of-bounds'
  return null
}

function hasZeroOpacity(value) {
  if (value === undefined || value === null || value === '') return false
  const opacity = Number(value)
  return Number.isFinite(opacity) && opacity <= 0
}

function isOutOfBoundsRect(rect, canvasW, canvasH) {
  if (!rect) return false
  return rect.x > canvasW ||
    rect.y > canvasH ||
    rect.x + rect.w <= 0 ||
    rect.y + rect.h <= 0
}

// ─── 2b. 语义折叠 ─────────────────────────────────────────────────────────────
function semanticCollapse(node, canvasW, canvasH) {
  if (!node) return
  // 自顶向下遍历，一旦命中 semanticAsset root 就折叠（其后代不再继续遍历）
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (shouldCollapseSemanticAsset(child, canvasW, canvasH)) {
        collapseToSemanticAsset(child)
      } else {
        semanticCollapse(child, canvasW, canvasH)
      }
    }
  }
}

function shouldCollapseSemanticAsset(node, canvasW, canvasH) {
  if (!isSemanticAssetRoot(node)) return false
  if (hasTextDescendant(node)) return false
  if (isLargeIllustrationContainer(node, canvasW, canvasH)) return false
  return true
}

function isSemanticAssetRoot(node) {
  const raw = node._raw || {}
  if (!['FRAME', 'GROUP', 'VECTOR', 'BOOLEAN_OPERATION'].includes(raw.type)) return false
  const name = String(node.name || '').trim()
  if (!name) return false
  if (/^#?illustration\b/i.test(name) || /插画|illustration/i.test(name)) return true
  if (!/(^|[/_\s-])icon([/_\s-]|$)|(^|[/_\s-])ic_|图标/i.test(name)) return false
  const w = node.rect?.w ?? 0
  const h = node.rect?.h ?? 0
  if (w < 4 || h < 4) return false
  if (w > 48 || h > 48) return false
  const ratio = Math.max(w / h, h / w)
  return ratio <= 4
}

function isLargeIllustrationContainer(node, canvasW, canvasH) {
  const name = String(node?.name || '')
  if (!/(^#?illustration\b|插画|illustration)/i.test(name)) return false
  const w = node.rect?.w ?? 0
  const h = node.rect?.h ?? 0
  const canvasArea = Math.max(1, canvasW * canvasH)
  const areaRatio = (w * h) / canvasArea
  if (areaRatio < 0.55) return false
  return countTextDescendants(node) >= 3
}

function hasTextDescendant(node) {
  if (!node || !Array.isArray(node.children)) return false
  for (const c of node.children) {
    if (c.type === 'text' && String(c.textContent || '').trim().length > 0) return true
    if (hasTextDescendant(c)) return true
  }
  return false
}

function countTextDescendants(node) {
  if (!node || !Array.isArray(node.children)) return 0
  let n = 0
  for (const c of node.children) {
    if (c.type === 'text' && String(c.textContent || '').trim().length > 0) n++
    n += countTextDescendants(c)
  }
  return n
}

function collapseToSemanticAsset(node) {
  const repr = selectSemanticRepresentative(node)
  if (repr && repr !== node) {
    // 用 representative 的字段覆盖当前节点（保留原 id / path / name 以维持稳定性）
    node.rect = { ...repr.rect }
    node.normRect = { ...repr.normRect }
    // representative 的 style 可能含背景色等关键视觉信息
    node.style = { ...node.style, ...repr.style }
    node.type = repr.type
    node.rawType = repr.rawType
  }
  node.semanticAsset = true
  node.style = node.style || {}
  node.style.semanticAsset = assetKind(node)
  // 清空后代
  node.children = []
}

function selectSemanticRepresentative(frameNode) {
  const frameW = frameNode.rect?.w ?? 0
  const frameH = frameNode.rect?.h ?? 0

  const descendants = collectDescendants(frameNode)
  const sameSized = descendants.filter(n => {
    if (n.type === 'text') return false
    const w = n.rect?.w ?? 0
    const h = n.rect?.h ?? 0
    return Math.abs(w - frameW) <= 1 && Math.abs(h - frameH) <= 1
  })
  if (sameSized.length === 0) return frameNode

  const withBg = sameSized
    .filter(n => !!n.style?.backgroundColor)
    .sort((a, b) => (a.path?.length || 0) - (b.path?.length || 0))

  if (withBg.length === 0) return frameNode
  return withBg[0]
}

function collectDescendants(node) {
  const out = []
  walkDesc(node, out, true)
  return out
}

function walkDesc(node, out, skipSelf) {
  if (!node) return
  if (!skipSelf) out.push(node)
  if (Array.isArray(node.children)) {
    for (const c of node.children) walkDesc(c, out, false)
  }
}

function assetKind(node) {
  const name = String(node?.name || '')
  return /插画|illustration/i.test(name) ? 'illustration' : 'icon'
}

// ─── 2c. BOOLEAN_OPERATION 后代清空 ─────────────────────────────────────────────
function pruneBooleanOperationDescendants(node) {
  if (!node || !Array.isArray(node.children)) return
  for (const c of node.children) {
    const rawType = String(c._raw?.type || '').toUpperCase()
    if (rawType === 'BOOLEAN_OPERATION') {
      c.children = []
    } else {
      pruneBooleanOperationDescendants(c)
    }
  }
}

// ─── 2d. 软剪枝 ────────────────────────────────────────────────────────────────
function softPrune(node) {
  if (!node || !Array.isArray(node.children)) return
  let i = 0
  while (i < node.children.length) {
    softPrune(node.children[i])
    const child = node.children[i]
    if (shouldUnwrap(child)) {
      node.children.splice(i, 1, ...child.children)
      continue
    }
    i++
  }
}

function shouldUnwrap(node) {
  const rawType = String(node._raw?.type || '').toUpperCase()
  if (rawType && !VISUAL_TYPES.has(rawType)) return true
  // 空文本 TEXT
  if (rawType === TEXT_TYPE && String(node.textContent || '').trim().length === 0) return true
  return false
}
