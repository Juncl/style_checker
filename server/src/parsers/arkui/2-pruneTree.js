/**
 * ArkUI Step 2: 剪枝
 *
 * 三个子操作（按顺序）：
 *   2a. 硬剪枝 hardPrune       —— 整棵子树删除
 *       visibility=Hidden / opacity=0 / out-of-bounds / leftarrow / rightarrow /
 *       no-rect / tooWide / 空文本 Text
 *
 *   2a.5 filterSCBSystemLayer —— 过滤 SCB 系统覆盖图层
 *       消除 __Common__ 下的 SCBSystemScene / SCBKeyboardPanel 等全屏系统叠加层
 *       以及 CardStackViewItem 层级的后项杀前项
 *
 *   2b. 软剪枝 softPrune       —— 删除自身、把 children 顶替到原位
 *       FRAMEWORK_TYPES（无背景色时）/ Span / Blank /
 *       透明 layout（jsview / stack / column / row / flex / list / ...）/
 *       极小节点（w/h ≤ 4vp）/ 全屏包裹层（normRect.w/h ≥ 0.999）
 *
 * 注意：root 节点本身永远不会被 unwrap（它作为树根容器存在）。
 *
 * unwrap 带 zIndex 继承：消解 TitleBar 等结构壳时，把壳的显式非零 zIndex
 * （如 TitleBar 的 zIndex=2）以 _inheritedZIndex 传递给提升的子孙，供 step3
 * 遮挡剪枝（traverseAndPrune）做浮层豁免——否则壳消解后浮层层级信息丢失，
 * 伪兄弟会被内容根子树的全屏节点误杀（vmall case：标题栏"推荐"被 banner 误杀）。
 */

import { filterSCBSystemLayer } from '../../utils/filterSCBSystemLayer.js'

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
  root = filterSCBSystemLayer(root)
  // TabBar 阴影转移须在 softPrune 之前：承载投影的透明装饰叶子会被 softPrune 删除
  transferTabBarShadow(root)
  softPrune(root, canvasW, canvasH)
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

  // 零尺寸或极小尺寸（w/h 为 0，或 w,h 均 < 2）
  // 有子节点时跳过：可能是中间层布局代理（h=0 但子节点有实际内容，如 case16），
  // 留给 softPrune unwrap；叶子节点的零尺寸才是真不可见
  if (node.rect && (!node.rect.w || !node.rect.h || (node.rect.w < 2 && node.rect.h < 2))
      && !(node.children && node.children.length > 0)) return 'zero-size'

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
function softPrune(node, canvasW, canvasH) {
  if (!node || !Array.isArray(node.children)) return
  let i = 0
  while (i < node.children.length) {
    softPrune(node.children[i], canvasW, canvasH)
    const child = node.children[i]
    if (shouldUnwrap(child, canvasW, canvasH)) {
      // zIndex 继承：壳（如 TitleBar 的 zIndex=2）消解时，把显式非零 zIndex
      // 传递给提升的子孙，供 step3 遮挡剪枝做浮层豁免
      const z = explicitZIndexOf(child)
      if (z > 0) inheritZIndexDown(child.children, z)
      node.children.splice(i, 1, ...child.children)
      continue   // 不递增 i：新顶替上来的孙子可能也是 unwrap 候选
    }
    i++
  }
}

// 节点显式 zIndex（无值 / 0 视为默认层）
function explicitZIndexOf(node) {
  const z = node?._attrs?.zIndex
  if (z === undefined || z === null || z === '') return 0
  const n = parseFloat(z)
  return Number.isNaN(n) ? 0 : n
}

// 递归给子孙挂 _inheritedZIndex（取 max：嵌套壳多次 unwrap 时保留最高层级）
function inheritZIndexDown(children, z) {
  for (const c of children || []) {
    if ((c._inheritedZIndex ?? 0) < z) c._inheritedZIndex = z
    inheritZIndexDown(c.children, z)
  }
}

// TabBar 阴影转移：TabBar 的投影视觉常由一个与 TabBar 同 rect 的透明
// layout 叶子（无子、无背景、仅带阴影的装饰层，vmall 26.8 首页 Stack[52]）
// 承载。softPrune 会把该叶子当无子透明壳删除，阴影随之丢失——在删除前
// 把阴影转移给 rect 近似全等且无自身阴影的 TabBar。全树预扫描，与层级无关。
function transferTabBarShadow(root) {
  const tabbars = []
  ;(function collect(n) {
    if (!n || typeof n !== 'object') return
    if (String(n.name || '').toLowerCase() === 'tabbar' && !n.style?.shadow) tabbars.push(n)
    ;(n.children || []).forEach(collect)
  })(root)
  if (!tabbars.length) return

  ;(function scan(n) {
    if (!n || typeof n !== 'object') return
    const isShadowLeaf = (n.children || []).length === 0
      && SELF_SKIP_LAYOUT_TYPES.has(String(n.name || '').toLowerCase())
      && !!n.style?.shadow
      && !n.style?.backgroundColor
    if (isShadowLeaf) {
      for (const tb of tabbars) {
        if (isRectNearlyEqual(n.rect, tb.rect)) {
          tb.style.shadow = n.style.shadow
          break
        }
      }
    }
    ;(n.children || []).forEach(scan)
  })(root)
}

// rect 近似全等（vp，容差 0.5：Inspector 导出精度抖动）
function isRectNearlyEqual(a, b, tol = 0.5) {
  return !!(a && b)
    && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol
    && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol
}

function shouldUnwrap(node, canvasW, canvasH) {
  // Span / Blank 无独立布局，永远 unwrap
  if (node._spanType) return true
  if (node._blankType) return true
  
  // 极小节点（≤4vp）：保留子节点，只删自身
  if (node.rect && (node.rect.w <= 4 || node.rect.h <= 4)) return true

  // 异常超宽（宽 > 3 倍画布）：保留子节点，只删自身
  //   横滑列表(Row/Swiper/RelativeContainer)内容容器宽常远超画布，属合法布局
  if (node.rect && node.rect.w > canvasW * 3) return true

  // 无 rect 的 wrapper / 语法节点（dump 里的 SyntaxItem 等）：无条件 unwrap
  // root 例外（它是整棵树的容器，永远保留）
  if (!node._rectRaw && node.name !== 'root') return true

  // 框架节点：root 永不 unwrap；其余无背景色时 unwrap
  // 零尺寸框架节点（如 BackButton rect=0×0）即使有背景色也 unwrap，视觉上不存在
  if (node._frameworkType) {
    if (node.name === 'root') return false
    return !hasBackgroundColor(node)
  }

  // 透明 layout 容器：jsview / stack / column / row / ...
  const rawType = String(node.name || '').toLowerCase()
  if (SELF_SKIP_LAYOUT_TYPES.has(rawType) && !hasBackgroundColor(node)) {
    return true
  }



  // 全屏包裹层（normRect.w/h 均 ≥ 0.999）：保留子节点，只删自身；有背景色的底层蒙版保留
  if (node.normRect && node.normRect.w >= 0.999 && node.normRect.h >= 0.999
      && !hasBackgroundColor(node)) return true

  return false
}

function hasBackgroundColor(node) {
  return !!(node.style && node.style.backgroundColor)
}
