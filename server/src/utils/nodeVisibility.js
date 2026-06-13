import {
  centerDistance,
  pointInRect,
  rectArea,
  rectCenter,
  rectContainsCenter,
  rectIntersectionArea,
  sizeRatio,
} from './matchGeometry.js'
import {
  hasUsableText,
  normalizeText,
} from './textSemantics.js'

const INTRINSIC_VISUAL_RAW_TYPES = new Set([
  'image',
  'button',
  'search',
  'searchfield',
  'symbolglyph',
  'circle',
  'ellipse',
  'rect',
  'vector',
  'boolean_operation',
])

// Visibility filters keep hidden framework and covered visual nodes out of matching output.
export function isAcceptablePair(pair) {
  const { design, arkui, matchType, confidence } = pair
  if (design.type === 'text') {
    if (arkui.type !== 'text') return false
    const dLen = (design.textContent ?? '').length
    const aLen = (arkui.textContent ?? '').length
    if ((dLen < 6 || aLen < 6) && Math.abs(dLen - aLen) > 20) return false
    return true
  }
  // list-index 已通过"同行/同尺寸/同类/不重叠/上下锚/首节点 IoU"多重几何验证，
  // 比 isStructuralContainer 的视觉装饰检查更严格，故跳过此过滤。
  if (matchType !== 'list-index' && isStructuralContainer(design)) return false

  const weakMatch = matchType?.startsWith('anchor-topology') || ['rescue-iou', 'container-iou', 'container-geometry'].includes(matchType)
  if (!weakMatch) return true

  const wRatio = sizeRatio(design.normRect.w, arkui.normRect.w)
  const hRatio = sizeRatio(design.normRect.h, arkui.normRect.h)
  const minRatio = Math.min(wRatio, hRatio)
  const centerDist = centerDistance(design.normRect, arkui.normRect)
  const aspectRatioScore = nonTextAspectRatioScore(design.normRect, arkui.normRect)

  // Tiny icons/dots must not match large rows/cards.
  if (Math.min(design.rect.w, design.rect.h) <= 8 && minRatio < 0.35) return false

  // Weak non-text matches with extreme size drift are usually wrapper/neighbor mistakes.
  if (minRatio < 0.22) return false
  if (design.type === 'container' && arkui.type === 'container' && aspectRatioScore < 0.45) return false

  // ArkUI SymbolGlyph 是一个完整图标，避免它匹配到设计稿分解图标里的小碎片 path。
  // 仅保留尺寸保护；去掉原来的 normRect 中心距检验（两侧系统性偏移会把正确图标对误杀）。
  if (getRawType(arkui) === 'symbolglyph' && isIntrinsicVisualNode(design)) {
    if (minRatio < 0.72) return false
  }

  // Low-confidence container matches with both position drift and size drift are too risky.
  if (confidence === 'low' && centerDist > 0.08 && minRatio < 0.70 && design.type === 'container') {
    return false
  }

  return true
}

export function isStructuralContainer(node) {
  return node.type === 'container' && !isRenderableNonTextNode(node)
}

export function isComparableOutputNode(node) {
  return !isStructuralContainer(node)
}

export function approximateVisibleRatio(rect, blockers, viewport) {
  const cols = 8
  const rows = 4
  let visible = 0
  let total = 0
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = rect.x + (x + 0.5) / cols * rect.w
      const py = rect.y + (y + 0.5) / rows * rect.h
      total += 1
      if (!pointInRect(px, py, viewport)) continue
      if (blockers.some(b => pointInRect(px, py, b))) continue
      visible += 1
    }
  }
  return total ? visible / total : 0
}

export function hasVisualDecoration(node) {
  const s = node.style || {}
  return !!(s.backgroundColor || s.borderRadius || s.border || s.shadow || s.backdropBlur || s.blur)
}

export function isIntrinsicVisualNode(node) {
  const rawType = getRawType(node)
  return INTRINSIC_VISUAL_RAW_TYPES.has(rawType) || !!node?.semanticAsset
}

export function isRenderableNonTextNode(node) {
  if (node?.type !== 'container') return false
  return hasVisualDecoration(node) || isIntrinsicVisualNode(node)
}

export function hasBackgroundColor(node) {
  return !!node?.style?.backgroundColor
}

export function isCompatibleType(designNode, arkuiNode) {
  return designNode?.type === arkuiNode?.type &&
    (designNode.type === 'text' || designNode.type === 'container')
}

function nonTextAspectRatioScore(a, b) {
  const ar = aspectRatio(a)
  const br = aspectRatio(b)
  return sizeRatio(ar, br)
}

function aspectRatio(rect) {
  const w = Math.max(1e-6, rect?.w || 0)
  const h = Math.max(1e-6, rect?.h || 0)
  return Math.max(w / h, h / w)
}

function getRawType(node) {
  return String(node?.rawType || node?.type || node?.name || '').toLowerCase()
}
