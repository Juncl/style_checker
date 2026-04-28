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
  const { design, arkui, matchType, confidence, visualScore } = pair
  if (design.type === 'text') {
    if (arkui.type !== 'text') return false
    const designType = textFieldType(normalizeText(design.textContent))
    const arkuiType = textFieldType(normalizeText(arkui.textContent))
    if (designType === 'number' || arkuiType === 'number') {
      if (
        (isAmbiguousShortNumberText(design.textContent) || isAmbiguousShortNumberText(arkui.textContent)) &&
        !isNearSameLineSlot(design, arkui, 0.10, 0.045)
      ) return false
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

  // Tiny icons/dots must not match large rows/cards.
  if (Math.min(design.rect.w, design.rect.h) <= 8 && minRatio < 0.35) return false

  // Weak non-text matches with extreme size drift are usually wrapper/neighbor mistakes.
  if (minRatio < 0.22) return false

  // ArkUI SymbolGlyph is a complete icon. Avoid matching it to a small path inside
  // a decomposed design icon.
  if (arkui.name === 'SymbolGlyph' && design.type === 'image') {
    if (isDesignIconFragment(design)) return false
    if (minRatio < 0.72 || centerDist > 0.04) return false
  }

  if (design.type === 'image' && arkui.type === 'image' && visualScore != null && visualScore < 0.18 && confidence !== 'high') {
    return false
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

export function isDesignIconFragment(node) {
  return node.source === 'design' && (node.iconFragment || /^(path|路径)/i.test(String(node.name || '').trim()))
}

export function isComparableOutputNode(node) {
  return isMatchableNode(node) && !isStructuralContainer(node)
}

export function annotateDesignIconFragments(nodes) {
  const designImages = nodes.filter(n => n.source === 'design' && n.type === 'image' && n.rect && n.normRect)
  for (const node of designImages) {
    node.iconFragment = !!node.iconFragment
    if (node.iconUnion) continue
    if (!/^(path|路径)/i.test(String(node.name || '').trim())) continue
    const parent = designImages.find(other =>
      other.id !== node.id &&
      Array.isArray(node.path) &&
      Array.isArray(other.path) &&
      other.path.length < node.path.length &&
      isPathPrefix(other.path, node.path) &&
      rectContainsCenter(other.normRect, node.normRect) &&
      rectArea(other.normRect) > rectArea(node.normRect) * 1.35
    )
    if (parent) node.iconFragment = true
  }
}

export function isPathPrefix(prefix, path) {
  if (prefix.length >= path.length) return false
  return prefix.every((part, idx) => part === path[idx])
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
  return !!(s.backgroundColor || s.gradient || node.type === 'image' || node.type === 'shape')
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
  return !!(s.backgroundColor || s.borderRadius || s.border || s.gradient || s.shadow || s.backdropBlur || s.blur)
}

export function isMatchableNode(node) {
  return !!(node?.visible && !node.visualOccluded && !node.iconFragment && node.rect?.w > 4 && node.rect?.h > 4)
}

export function isCompatibleType(designNode, arkuiNode) {
  if (designNode.type === 'text') return arkuiNode.type === 'text'
  if (designNode.type === arkuiNode.type) return true
  if (designNode.type === 'image') return arkuiNode.type === 'other'
  if (designNode.type === 'shape') return arkuiNode.type === 'container' || arkuiNode.type === 'other'
  if (designNode.type === 'other') return arkuiNode.type !== 'text'
  return false
}
