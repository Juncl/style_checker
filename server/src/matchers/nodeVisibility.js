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
  isAmbiguousShortNumberText,
  isNearSameLineSlot,
  normalizeText,
  numericTextCompatible,
  textFieldType,
} from './textSemantics.js'

// Visibility filters keep hidden framework and covered visual nodes out of matching output.
export function isAcceptablePair(pair) {
  const { design, arkui, matchType, confidence } = pair
  if (design.type === 'text') {
    if (arkui.type !== 'text') return false
    const designType = textFieldType(normalizeText(design.textContent))
    const arkuiType = textFieldType(normalizeText(arkui.textContent))
    if (designType === 'number' || arkuiType === 'number') {
      if (
        (isAmbiguousShortNumberText(design.textContent) || isAmbiguousShortNumberText(arkui.textContent)) &&
        !isNearSameLineSlot(design, arkui, 0.10, 0.045)
      ) return false
      if (matchType === 'dynamic-number-slot') {
        return designType === arkuiType
      }
      return designType === arkuiType && numericTextCompatible(design.textContent, arkui.textContent)
    }
    return true
  }
  if (isStructuralContainer(design)) return false

  const weakMatch = ['anchor-topology', 'rescue-iou', 'shape-geometry', 'image-geometry', 'other-geometry', 'container-iou'].includes(matchType)
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
  if (['image', 'shape', 'other'].includes(design.type) && ['image', 'shape', 'other'].includes(arkui.type) && aspectRatioScore < 0.45) return false

  // ArkUI SymbolGlyph is a complete icon. Avoid matching it to a small path inside
  // a decomposed design icon.
  if (arkui.name === 'SymbolGlyph' && design.type === 'image') {
    if (minRatio < 0.72 || centerDist > 0.04) return false
  }

  // Low-confidence container matches with both position drift and size drift are too risky.
  if (confidence === 'low' && centerDist > 0.08 && minRatio < 0.70 && ['container', 'shape', 'image', 'other'].includes(design.type)) {
    return false
  }

  return true
}

export function isStructuralContainer(node) {
  return node.type === 'container' && !hasVisualDecoration(node)
}

export function isComparableOutputNode(node) {
  return isMatchableNode(node) && !isStructuralContainer(node)
}

export function isPipelineVisibleNode(node) {
  if (!node?.visible) return false
  if (node.pixelInvisible) return false
  if (node.type === 'text' && node.hiddenFrameworkAncestor) return false
  if (node.visualOccluded) return false
  if (node.type === 'text' && node.ocrVisibility?.visible === false) {
    const stroke = node.pixelVisibility?.textStrokeScore ?? 0
    const ratio = node.pixelVisibility?.visiblePixelRatio ?? 0
    if (stroke < 0.05 && ratio > 0.20) return false
  }
  return true
}

export function annotateVisualOcclusion(nodes) {
  if (!nodes.some(n => n.source === 'arkui')) return

  const viewport = { x: 0, y: 0, w: 1, h: 1 }
  const sorted = [...nodes]
    .filter(n => n.source === 'arkui' && n.normRect && Number.isFinite(n.normRect.x))
    .sort((a, b) => (a.paintIndex ?? 0) - (b.paintIndex ?? 0))

  for (let i = 0; i < sorted.length; i++) {
    const node = sorted[i]
    if (node.pixelInvisible) {
      node.visualOccluded = true
      node.visualOcclusionReason = 'pixel-invisible'
      continue
    }
    node.visualOccluded = false
    node.visualOcclusionReason = null
    if (node.type === 'text' && node.pixelVisibility?.samples) continue
    if (!isVisualVisibilityCandidate(node)) continue

    const blockers = []
    for (let j = i + 1; j < sorted.length; j++) {
      const later = sorted[j]
      if (!isOccludingNode(later)) continue
      if (rectIntersectionArea(node.normRect, later.normRect) <= 0) continue
      blockers.push(later.normRect)
    }

    const visibleRatio = approximateVisibleRatio(node.normRect, blockers, viewport)
    if (visibleRatio < 0.15) {
      node.visualOccluded = true
      node.visualOcclusionReason = visibleRatio <= 0 ? 'outside-or-covered' : 'mostly-hidden'
    }
  }
}

// 后绘制且足够不透明的图层，如果把前面的节点整块盖住，前面的节点和子节点都应视为不可匹配。
export function annotateCoverageOcclusion(nodes) {
  if (!nodes.some(n => n?.rect && Number.isFinite(n.rect.x))) return

  const sorted = [...nodes]
    .filter(n => n.visible !== false && n.rect && Number.isFinite(n.paintIndex))
    .sort((a, b) => (a.paintIndex ?? 0) - (b.paintIndex ?? 0))

  const coveredPaths = []

  for (let i = 0; i < sorted.length; i++) {
    const node = sorted[i]
    if (node.visualOccluded) continue
    if (!isCoverageCandidate(node)) continue

    for (let j = i + 1; j < sorted.length; j++) {
      const later = sorted[j]
      if (!isOpaqueCoverNode(later)) continue
      if (!sameParentPath(node.path, later.path)) continue
      if (rectIntersectionArea(node.normRect, later.normRect) <= 0) continue
      if (
        rectContainsRect(later.normRect, node.normRect) ||
        approximateCoveredRatio(node.normRect, [later.normRect]) >= 0.95
      ) {
        node.visualOccluded = true
        node.visualOcclusionReason = 'covered-by-later-node'
        coveredPaths.push(Array.isArray(node.path) ? [...node.path] : null)
        break
      }
    }
  }

  if (!coveredPaths.length) return

  for (const node of sorted) {
    if (node.visualOccluded) continue
    const path = node.path
    if (!Array.isArray(path) || path.length === 0) continue
    if (coveredPaths.some(prefix => prefix && isPathPrefix(prefix, path))) {
      node.visualOccluded = true
      node.visualOcclusionReason = 'covered-by-opaque-ancestor'
    }
  }
}

export function isVisualVisibilityCandidate(node) {
  if (!node?.visible || !node.normRect) return false
  if (node.type === 'text') return hasUsableText(node)
  if (node.type === 'image' || node.type === 'shape') return true
  return hasVisualDecoration(node)
}

export function isOccludingNode(node) {
  if (!node?.visible || node.visualOccluded) return false
  if (node.type === 'text') return false
  const s = node.style || {}
  const opacity = s.opacity == null ? 1 : s.opacity
  if (opacity < 0.70) return false
  return !!(s.backgroundColor || node.type === 'image' || node.type === 'shape')
}

export function approximateCoveredRatio(rect, blockers) {
  if (!blockers.length) return 0
  const cols = 8
  const rows = 4
  let covered = 0
  let total = 0
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = rect.x + (x + 0.5) / cols * rect.w
      const py = rect.y + (y + 0.5) / rows * rect.h
      total += 1
      if (blockers.some(b => pointInRect(px, py, b))) covered += 1
    }
  }
  return total ? covered / total : 0
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

export function isMatchableNode(node) {
  return !!(node?.visible && !isBlankNode(node) && !isHiddenByFramework(node) && !node.visualOccluded && node.rect?.w > 4 && node.rect?.h > 4)
}

function isHiddenByFramework(node) {
  if (!node.hiddenFrameworkAncestor) return false
  if (node.type === 'text') return true
  if (node.pixelInvisible) return true
  return (node.pixelVisibility?.visiblePixelRatio ?? 0) < 0.08
}

function isCoverageCandidate(node) {
  if (!node?.rect || !node?.normRect) return false
  if (node.type === 'text') return hasUsableText(node)
  return node.type === 'container' || node.type === 'shape' || node.type === 'image' || node.type === 'other'
}

function isOpaqueCoverNode(node) {
  if (!node?.visible || node.visualOccluded || !node.rect || !node.normRect) return false
  if (node.type === 'text') return false
  const s = node.style || {}
  const opacity = s.opacity == null ? 1 : s.opacity
  if (opacity < 0.96) return false
  return !!(s.backgroundColor || node.type === 'image' || node.type === 'shape')
}

function rectContainsRect(container, rect) {
  return rect.x >= container.x &&
    rect.y >= container.y &&
    rect.x + rect.w <= container.x + container.w &&
    rect.y + rect.h <= container.y + container.h
}

function sameParentPath(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length - 1; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function isPathPrefix(prefix, path) {
  if (!Array.isArray(prefix) || !Array.isArray(path) || prefix.length >= path.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== path[i]) return false
  }
  return true
}

function isBlankNode(node) {
  const type = String(node?.type || node?.name || '').trim().toLowerCase()
  return type === 'blank'
}

export function isCompatibleType(designNode, arkuiNode) {
  if (designNode.type === 'text') return arkuiNode.type === 'text'
  if (designNode.type === arkuiNode.type) return true
  if (designNode.type === 'image') return arkuiNode.type === 'other' || arkuiNode.type === 'shape'
  if (designNode.type === 'shape') return arkuiNode.type === 'container' || arkuiNode.type === 'other' || arkuiNode.type === 'image'
  if (designNode.type === 'other') return arkuiNode.type !== 'text'
  return false
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
