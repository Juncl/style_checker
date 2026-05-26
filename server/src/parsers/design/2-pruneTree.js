/**
 * Design Step 2: 剪枝
 *
 * Design 侧的剪枝包含 4 个子操作（按顺序）：
 *
 *   2a. 硬剪枝 hardPrune       —— 整棵子树删除
 *       opacity=0 / out-of-bounds / status-bar（系统状态栏整组件）
 *
 *   2b. 语义折叠 semanticCollapse
 *       icon / illustration 等小尺寸 FRAME/GROUP/VECTOR 折叠为单节点：
 *       用合适的子孙 representative 替换自身字段，并清空 children。
 *
 *   2c. 后代剪枝 pruneDescendantsOf
 *       BOOLEAN_OPERATION 节点本身保留，但其 children 全部清空。
 *
 *   2d. 软剪枝 softPrune       —— 删自身保子
 *       非 VISUAL_TYPES（理论上不会出现）/ 空文本 TEXT /
 *       极小节点（w/h ≤ 4dp）/ 全屏包裹层（normRect.w/h ≥ 0.999）
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
  mergeFrameBackgroundRects(root)
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
  if (isStatusBarComp(node)) return 'status-bar'
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

// 系统状态栏整组件硬剪枝（参考 test/isStatusBarComp.js）
// 设计稿顶部的状态栏（时间/信号/电量）属于系统级 UI，不参与还原度比对，
// 命中后整棵子树硬剪掉。判定四要素全部满足：
//   1. name / componentData 标识为 StatusBar
//   2. 贴左上角：x === 0 且 y <= 2（容忍 1-2px 设计稿偏移）
//   3. 矮条：h < 50
//   4. 子树中存在时间格式文本（^\d{1,2}:\d{2}$，如 08:08 / 9:41）
const TIME_TEXT_RE = /^\d{1,2}:\d{2}$/

function isStatusBarComp(node) {
  if (!node) return false
  const cd = node._raw?.componentData || {}
  const name = String(node.name || '')
  const namedStatusBar =
    cd.componentDescription === 'StatusBar' ||
    String(cd.componentName || '').includes('StatusBar') ||
    name.includes('StatusBar')
  if (!namedStatusBar) return false
  const r = node.rect || {}
  if (!(r.x === 0 && r.y <= 2 && r.h < 50)) return false
  return hasTimeTextDescendant(node)
}

// 递归遍历整棵子树，查找时间格式的文本节点
function hasTimeTextDescendant(node) {
  if (!node) return false
  if (node.type === 'text' && TIME_TEXT_RE.test(String(node.textContent || '').trim())) {
    return true
  }
  if (Array.isArray(node.children)) {
    for (const c of node.children) {
      if (hasTimeTextDescendant(c)) return true
    }
  }
  return false
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
  const s = node.style || {}
  const hasDecoration = !!(s.backgroundColor || s.borderRadius || s.border)
  // GROUP 无视觉装饰时软剪枝
  if (rawType === 'GROUP' && !hasDecoration) return true
  // 极小节点（≤4dp）：保留子节点，只删自身
  if (node.rect && (node.rect.w <= 4 || node.rect.h <= 4)) return true
  // 全屏包裹层（normRect.w/h 均 ≥ 0.999）：保留子节点，只删自身；有背景色的底层蒙版保留
  if (node.normRect && node.normRect.w >= 0.999 && node.normRect.h >= 0.999
      && !hasDecoration) return true
  return false
}

// ─── 2b.5 背景节点同化 ─────────────────────────────────────────────────────────
// 对每个 FRAME，倒序遍历 children，将 rect 完全一致的 FRAME/RECTANGLE 子节点同化：
//   - 合并 child.style 进 frame.style（靠前的 child 最后合并，覆盖靠后的）
//   - unwrap：把 child.children 提升到当前层（splice 替换），继续处理提升上来的节点
// 自顶向下递归，每个节点最多被访问一次，O(N)。
function mergeFrameBackgroundRects(root) {
  absorbDescendants(root)
}

function absorbDescendants(node) {
  if (String(node._raw?.type || '').toUpperCase() !== 'FRAME') {
    for (const child of (node.children || [])) absorbDescendants(child)
    return
  }
  // DFS 搜索子树，同化所有与 node 同 rect 的 FRAME/RECTANGLE 后代
  absorbSameRectInSubtree(node, node.children)
  // 对剩余子节点递归（子节点自身可能也是 FRAME）
  for (const child of (node.children || [])) absorbDescendants(child)
}

// 在 children 列表中 DFS 寻找与 frameNode 同 rect 的 FRAME/RECTANGLE 后代：
// - 同 rect FRAME：同化 style（有装饰时）+ unwrap，i 不变继续处理提升上来的节点
// - 同 rect RECTANGLE：同化 style（有装饰时）+ 删除，停止（RECTANGLE 无后代）
// - 其他节点：穿透，继续往下 DFS
// 倒序遍历保证同层中 index 靠前的最后合并（靠前覆盖靠后）
function absorbSameRectInSubtree(frameNode, children) {
  let i = children.length - 1
  while (i >= 0) {
    const child = children[i]
    if (!child) { i--; continue }
    const ctype = String(child._raw?.type || '').toUpperCase()
    if (rectsMatch(frameNode.rect, child.rect)) {
      if (ctype === 'FRAME') {
        if (childHasVisualDecoration(child)) {
          frameNode.style = { ...frameNode.style, ...child.style }
        }
        children.splice(i, 1, ...(child.children || []))
        // i 不变：继续处理提升上来的节点
      } else if (ctype === 'RECTANGLE') {
        if (childHasVisualDecoration(child)) {
          frameNode.style = { ...frameNode.style, ...child.style }
        }
        children.splice(i, 1)
        i--
      } else {
        // 同 rect 但非 FRAME/RECTANGLE（如 GROUP）：穿透继续
        absorbSameRectInSubtree(frameNode, child.children || [])
        i--
      }
    } else {
      // 不同 rect：穿透继续
      absorbSameRectInSubtree(frameNode, child.children || [])
      i--
    }
  }
}

function childHasVisualDecoration(node) {
  const s = node.style || {}
  return !!(s.backgroundColor || s.borderRadius || s.border || s.shadow || s.blur)
}

function rectsMatch(a, b) {
  if (!a || !b || a.w <= 0 || a.h <= 0) return false
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 &&
    Math.abs(a.h - b.h) < 0.5
  )
}
