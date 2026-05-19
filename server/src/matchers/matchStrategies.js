import { centerDistance, centerY, computeIoU, rectCenter, sizeRatio, xDistance, yDistance } from '../utils/matchGeometry.js'
import {
  allowsTextPositionFallback,
  hasUsableText,
  isAmbiguousShortNumberText,
  isAmbiguousUnitText,
  isNearSameLineSlot,
  isShortCjkLabelPair,
  isShortCjkLabel,
  isStrongTitleSlotMatch,
  normalizeText,
  passesTextSemanticGate,
  numericTextCompatible,
  textFieldType,
  textRoleMatchScore,
  textSemanticSimilarity,
  textStyleSimilarity,
} from '../utils/textSemantics.js'
import { hasSameTextAttributeFingerprint } from './textFingerprints.js'
import { hasBackgroundColor, isCompatibleType } from '../utils/nodeVisibility.js'
import { candidatePool, regionAffinity } from './regionContext.js'
import { comparePaths } from '../utils/pathOrder.js'

const SCORE_TIE_EPSILON = 1e-9

export function buildTextIndex(arkuiTextNodes) {
  const map = new Map()
  for (const n of arkuiTextNodes) {
    const key = normalizeText(n.textContent)
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(n)
  }
  return map
}

export function closestByY(targetNode, candidates) {
  return candidates.reduce((best, cur) => {
    return yDistance(targetNode.normRect, cur.normRect) <
           yDistance(targetNode.normRect, best.normRect)
      ? cur : best
  })
}

export function bestExactTextCandidate(targetNode, candidates) {
  let best = null
  let bestScore = -Infinity
  let bestBackgroundScore = -1
  for (const cur of candidates) {
    const yScore = Math.max(0, 1 - yDistance(targetNode.normRect, cur.normRect) / 0.40)
    const xScore = Math.max(0, 1 - xDistance(targetNode.normRect, cur.normRect) / 0.35)
    const styleScore = textStyleSimilarity(targetNode, cur)
    const pixelScore = cur.pixelVisibility?.samples ? Math.min(1, cur.pixelVisibility.visiblePixelRatio / 0.14) : 0.70
    const score = yScore * 0.34 + xScore * 0.26 + styleScore * 0.22 + pixelScore * 0.18
    const backgroundScore = backgroundPresenceScore(targetNode, cur)
    if (score > bestScore + SCORE_TIE_EPSILON || (Math.abs(score - bestScore) <= SCORE_TIE_EPSILON && backgroundScore > bestBackgroundScore)) {
      bestScore = score
      bestBackgroundScore = backgroundScore
      best = cur
    }
  }
  return best || closestByY(targetNode, candidates)
}

export function makePair(design, arkui, matchType, extra = {}) {
  return {
    design,
    arkui,
    matchType,
    iou: extra.iou ?? null,
    confidence: extra.confidence || 'medium',
    topologyScore: extra.topologyScore ?? null,
    isAnchor: extra.isAnchor || false,
  }
}

export function matchRegionTextOptimal(designNodes, arkuiNodes, usedArkui, matchedDesignIds, regionContext) {
  if (!regionContext?.regionPairs?.length) return []

  const result = []
  const localUsedArkui = new Set()
  const localMatchedDesign = new Set()

  for (const regionPair of regionContext.regionPairs) {
    const designTexts = designNodes.filter(n =>
      n.type === 'text' &&
      hasUsableText(n) &&
      !matchedDesignIds.has(n.id) &&
      !localMatchedDesign.has(n.id) &&
      regionContext.designNodeToRegion.get(n.id) === regionPair.designRegionId
    )
    const arkuiTexts = arkuiNodes.filter(n =>
      n.type === 'text' &&
      hasUsableText(n) &&
      !usedArkui.has(n.id) &&
      !localUsedArkui.has(n.id) &&
      regionContext.arkuiNodeToRegion.get(n.id) === regionPair.arkuiRegionId
    )

    if (!designTexts.length || !arkuiTexts.length) continue

    const matches = maxWeightTextMatching(designTexts, arkuiTexts, regionPair.score)
    for (const match of matches) {
      if (match.score < 0.58) continue
      result.push(makePair(match.design, match.arkui, 'region-text-optimal', {
        iou: computeIoU(match.design.normRect, match.arkui.normRect),
        confidence: match.score > 0.74 ? 'medium' : 'low',
        topologyScore: match.score,
      }))
      localMatchedDesign.add(match.design.id)
      localUsedArkui.add(match.arkui.id)
    }
  }

  const remainingDesignTexts = designNodes.filter(n =>
    n.type === 'text' &&
    hasUsableText(n) &&
    !matchedDesignIds.has(n.id) &&
    !localMatchedDesign.has(n.id)
  )
  const remainingArkuiTexts = arkuiNodes.filter(n =>
    n.type === 'text' &&
    hasUsableText(n) &&
    !usedArkui.has(n.id) &&
    !localUsedArkui.has(n.id)
  )

  if (remainingDesignTexts.length && remainingArkuiTexts.length) {
    const matches = maxWeightTextMatching(remainingDesignTexts, remainingArkuiTexts, 0.30)
    for (const match of matches) {
      if (match.score < 0.60) continue
      result.push(makePair(match.design, match.arkui, 'region-text-global-rescue', {
        iou: computeIoU(match.design.normRect, match.arkui.normRect),
        confidence: match.score > 0.74 ? 'medium' : 'low',
        topologyScore: match.score,
      }))
      localMatchedDesign.add(match.design.id)
      localUsedArkui.add(match.arkui.id)
    }
  }

  return result
}

export function maxWeightTextMatching(designTexts, arkuiTexts, regionScore) {
  const edges = []
  const edgeScore = new Map()
  const designOrder = orderIndexMap(designTexts)
  const arkuiOrder = orderIndexMap(arkuiTexts)

  for (let di = 0; di < designTexts.length; di++) {
      const dn = designTexts[di]
    for (let ai = 0; ai < arkuiTexts.length; ai++) {
      const an = arkuiTexts[ai]
      const semantic = textSemanticSimilarity(dn.textContent, an.textContent)
      const roleScore = textRoleMatchScore(dn, an)
      if (isWeakVisibleTextNode(dn) || isWeakVisibleTextNode(an)) {
        if (!weakVisibleTextCompatible(dn, an, semantic, roleScore)) continue
      }
      const fingerprintMatch = hasSameTextAttributeFingerprint(dn, an)
      const fingerprintGeometryOk = fingerprintMatch &&
        Math.abs(centerY(dn.normRect) - centerY(an.normRect)) <= 0.03 &&
        Math.abs(rectCenter(dn.normRect).x - rectCenter(an.normRect).x) <= 0.06
      if (!passesTextSemanticGate(dn.textContent, an.textContent, semantic) && roleScore < 0.85 && !fingerprintGeometryOk) continue
      if (isAmbiguousUnitText(dn.textContent) && Math.abs(centerY(dn.normRect) - centerY(an.normRect)) > 0.04) continue
      if (isAmbiguousShortNumberText(dn.textContent) && !isNearSameLineSlot(dn, an, 0.10, 0.045)) continue

      const geom = localTextGeometryScore(dn.normRect, an.normRect)
      const style = textStyleSimilarity(dn, an)
      const order = 1 - Math.min(1, Math.abs(designOrder.get(dn.id) - arkuiOrder.get(an.id)) / Math.max(designTexts.length, arkuiTexts.length, 1))
      const semanticOrRole = Math.max(semantic, roleScore * 0.72, fingerprintGeometryOk ? 0.66 : 0)
      const score = semanticOrRole * 0.38 + style * 0.24 + geom * 0.22 + order * 0.10 + regionScore * 0.06
      if (score >= 0.45) {
        edges.push({ design: dn, arkui: an, score, di, ai })
        edgeScore.set(`${di}:${ai}`, score)
      }
    }
  }

  const exact = exactAssignmentForSmallGroups(designTexts, arkuiTexts, edgeScore)
  if (exact) {
    return exact
      .map(({ di, ai, score }) => ({ design: designTexts[di], arkui: arkuiTexts[ai], score }))
      .filter(m => m.score > 0)
  }

  edges.sort((a, b) => b.score - a.score)

  // Large text pools are rare but expensive for exact matching; keep a conservative fallback.
  const usedD = new Set()
  const usedA = new Set()
  const matches = []
  for (const edge of edges) {
    if (usedD.has(edge.design.id) || usedA.has(edge.arkui.id)) continue
    usedD.add(edge.design.id)
    usedA.add(edge.arkui.id)
    matches.push(edge)
  }
  return matches
}

function isWeakVisibleTextNode(node) {
  const visibility = node?.pixelVisibility || {}
  return (visibility.visiblePixelRatio ?? 1) < 0.10 && (visibility.textStrokeScore ?? 0) < 0.08
}

function backgroundPresenceScore(targetNode, candidateNode) {
  if (!targetNode || !candidateNode) return 0
  if (targetNode.type === 'text' || candidateNode.type === 'text') return 0
  return hasBackgroundColor(targetNode) === hasBackgroundColor(candidateNode) ? 1 : 0
}

function weakVisibleTextCompatible(dn, an, semantic, roleScore) {
  const ta = normalizeText(dn.textContent)
  const tb = normalizeText(an.textContent)
  const typeA = textFieldType(ta)
  const typeB = textFieldType(tb)
  if (typeA !== typeB) return false
  const centerDist = centerDistance(dn.normRect, an.normRect)
  const xDist = xDistance(dn.normRect, an.normRect)
  const yDist = yDistance(dn.normRect, an.normRect)
  if (centerDist > 0.16 || xDist > 0.12 || yDist > 0.12) return false
  if (typeA !== 'label') {
    if (typeA === 'number') return numericTextCompatible(ta, tb)
    return ta === tb
  }
  return semantic >= 0.82 || roleScore >= 0.85
}

export function exactAssignmentForSmallGroups(designTexts, arkuiTexts, edgeScore) {
  const dCount = designTexts.length
  const aCount = arkuiTexts.length
  const maxSide = Math.max(dCount, aCount)
  if (maxSide > 18) return null

  const memo = new Map()
  const choice = new Map()

  function solve(di, usedMask) {
    if (di >= dCount) return 0
    const key = `${di}:${usedMask}`
    if (memo.has(key)) return memo.get(key)

    let best = solve(di + 1, usedMask)
    let bestChoice = -1

    for (let ai = 0; ai < aCount; ai++) {
      if (usedMask & (1 << ai)) continue
      const score = edgeScore.get(`${di}:${ai}`)
      if (!score) continue
      const total = score + solve(di + 1, usedMask | (1 << ai))
      if (total > best) {
        best = total
        bestChoice = ai
      }
    }

    memo.set(key, best)
    choice.set(key, bestChoice)
    return best
  }

  solve(0, 0)

  const matches = []
  let usedMask = 0
  for (let di = 0; di < dCount; di++) {
    const ai = choice.get(`${di}:${usedMask}`)
    if (ai === undefined || ai < 0) continue
    const score = edgeScore.get(`${di}:${ai}`) || 0
    matches.push({ di, ai, score })
    usedMask |= (1 << ai)
  }
  return matches
}

export function bestTextRoleMatch(targetNode, candidates) {
  let best = null
  let bestScore = 0
  let bestBackgroundScore = -1
  for (const node of candidates) {
    const score = textRoleMatchScore(targetNode, node)
    const backgroundScore = backgroundPresenceScore(targetNode, node)
    if (score > bestScore + SCORE_TIE_EPSILON || (Math.abs(score - bestScore) <= SCORE_TIE_EPSILON && backgroundScore > bestBackgroundScore)) {
      bestScore = score
      bestBackgroundScore = backgroundScore
      best = node
    }
  }
  return best ? { node: best, score: bestScore } : null
}

export function orderIndexMap(nodes) {
  const sorted = [...nodes].sort((a, b) => {
    const dy = centerY(a.normRect) - centerY(b.normRect)
    return Math.abs(dy) > 0.01 ? dy : rectCenter(a.normRect).x - rectCenter(b.normRect).x
  })
  return new Map(sorted.map((n, idx) => [n.id, idx]))
}

export function localTextGeometryScore(a, b) {
  const ac = rectCenter(a)
  const bc = rectCenter(b)
  const dx = Math.abs(ac.x - bc.x)
  const dy = Math.abs(ac.y - bc.y)
  const xScore = Math.max(0, 1 - dx / 0.28)
  const yScore = Math.max(0, 1 - dy / 0.08)
  return xScore * 0.40 + yScore * 0.60
}

export function matchByAnchorTopology(designNodes, arkuiNodes, anchors, usedArkui, matchedDesignIds, regionContext) {
  const result = []
  const localUsedArkui = new Set()
  const localMatchedDesign = new Set()
  const candidateDesignNodes = designNodes
    .filter(n => !matchedDesignIds.has(n.id))
    .filter(n => n.type !== 'text' || hasUsableText(n))
    .map(n => {
      const anchorsForNode = nearbyAnchors(n, anchors, 'design')
      const best = bestTopologyCandidate(n, arkuiNodes, anchorsForNode, usedArkui, regionContext)
      return {
        node: n,
        anchors: anchorsForNode,
        bestScore: best?.score ?? 0,
        bestAnchorDist: best?.anchorDist ?? Number.POSITIVE_INFINITY,
      }
    })
    .filter(item => item.anchors.length > 0 && item.bestScore > 0.58)
    .sort((a, b) => {
      if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore
      if (a.bestAnchorDist !== b.bestAnchorDist) return a.bestAnchorDist - b.bestAnchorDist
      return comparePaths(a.node.path, b.node.path)
    })

  for (const { node: dn, anchors: nodeAnchors } of candidateDesignNodes) {
    if (localMatchedDesign.has(dn.id)) continue

    const best = bestTopologyCandidate(
      dn,
      arkuiNodes,
      nodeAnchors,
      new Set([...usedArkui, ...localUsedArkui]),
      regionContext
    )

    if (best && best.score > 0.58) {
      result.push(makePair(dn, best.node, 'anchor-topology', {
        iou: best.iou,
        confidence: best.score > 0.72 ? 'medium' : 'low',
        topologyScore: best.score,
      }))
      localUsedArkui.add(best.node.id)
      localMatchedDesign.add(dn.id)
    }
  }

  return result
}

function bestTopologyCandidate(dn, arkuiNodes, nodeAnchors, unavailableArkui, regionContext) {
  if (!nodeAnchors.length) return null

  let best = null
  let bestScore = 0
  let bestAnchorDist = Number.POSITIVE_INFINITY
  let bestBackgroundScore = -1
  const regionCandidates = candidatePool(dn, arkuiNodes, regionContext, n =>
    !unavailableArkui.has(n.id) &&
    isCompatibleType(dn, n)
  )

  for (const an of regionCandidates) {
    for (const anchor of nodeAnchors) {
      const designRelation = relationToAnchor(dn, anchor.pair.design)
      const arkuiRelation = relationToAnchor(an, anchor.pair.arkui)
      const relDist = distanceBetweenRelations(designRelation, arkuiRelation)
      if (relDist > 0.24) continue

      const score = topologyMatchScore(dn, an, designRelation, arkuiRelation, regionContext)
      const backgroundScore = backgroundPresenceScore(dn, an)
      if (score > bestScore + SCORE_TIE_EPSILON || (Math.abs(score - bestScore) <= SCORE_TIE_EPSILON && backgroundScore > bestBackgroundScore)) {
        bestScore = score
        bestBackgroundScore = backgroundScore
        bestAnchorDist = anchor.dist
        best = { node: an, score, iou: computeIoU(dn.normRect, an.normRect), anchorDist: anchor.dist }
      }
    }
  }

  return best ? { ...best, bestScore, bestAnchorDist } : null
}

export function nearestAnchor(node, anchors, side) {
  let best = null
  for (const pair of anchors) {
    const anchorNode = pair[side]
    const dist = centerDistance(node.normRect, anchorNode.normRect)
    if (!best || dist < best.dist) best = { pair, dist }
  }
  return best
}

function nearbyAnchors(node, anchors, side) {
  if (!(node.type === 'text' && isShortCjkLabel(node.textContent))) {
    const anchor = nearestAnchor(node, anchors, side)
    return anchor && anchor.dist < 0.35 ? [anchor] : []
  }
  return anchors
    .map(pair => ({ pair, dist: centerDistance(node.normRect, pair[side].normRect) }))
    .filter(item => item.dist < 0.70)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 6)
}

export function relationToAnchor(node, anchorNode) {
  const nr = node.normRect
  const ar = anchorNode.normRect
  const nc = rectCenter(nr)
  const ac = rectCenter(ar)
  return {
    dx: nc.x - ac.x,
    dy: nc.y - ac.y,
    w: nr.w,
    h: nr.h,
  }
}

export function topologyMatchScore(dn, an, designRelation, arkuiRelation, regionContext) {
  const semantic = dn.type === 'text' && an.type === 'text'
    ? textSemanticSimilarity(dn.textContent, an.textContent)
    : 1
  const roleScore = dn.type === 'text' && an.type === 'text' ? textRoleMatchScore(dn, an) : 0
  const relDist = distanceBetweenRelations(designRelation, arkuiRelation)
  const slotFallback = dn.type === 'text' && an.type === 'text' &&
    isShortCjkLabelPair(dn.textContent, an.textContent) &&
    isTopologySlotCompatible(dn, an, relDist, roleScore)
  if (!passesTextSemanticGate(dn.textContent, an.textContent, semantic) && roleScore < 0.85 && !slotFallback) return 0
  if (
    dn.type === 'text' &&
    an.type === 'text' &&
    isAmbiguousUnitText(dn.textContent) &&
    Math.abs(centerY(dn.normRect) - centerY(an.normRect)) > 0.04
  ) return 0
  if (
    dn.type === 'text' &&
    an.type === 'text' &&
    isAmbiguousShortNumberText(dn.textContent) &&
    !isNearSameLineSlot(dn, an, 0.10, 0.045)
  ) return 0

  const relScore = Math.max(0, 1 - relDist / 0.22)
  const wRatio = sizeRatio(dn.normRect.w, an.normRect.w)
  const hRatio = sizeRatio(dn.normRect.h, an.normRect.h)
  const sizeScore = dn.type === 'text' && an.type === 'text' ? 1 : (wRatio + hRatio) / 2
  const iou = dn.type === 'text' && an.type === 'text' ? 0 : computeIoU(dn.normRect, an.normRect)
  const typeScore = dn.type === an.type ? 1 : 0.68
  const textScore = dn.type === 'text' && an.type === 'text'
    ? textStyleSimilarity(dn, an)
    : 0.70

  const regionScore = regionAffinity(dn, an, regionContext)
  const semanticScore = dn.type === 'text' && an.type === 'text'
    ? Math.max(semantic, roleScore * 0.72, slotFallback ? 0.52 : 0)
    : 0.70

  return relScore * 0.38 + sizeScore * 0.18 + typeScore * 0.10 + textScore * 0.10 + semanticScore * 0.14 + iou * 0.06 + regionScore * 0.04
}

function isTopologySlotCompatible(dn, an, relDist, roleScore) {
  const style = textStyleSimilarity(dn, an)
  const absoluteX = Math.abs(rectCenter(dn.normRect).x - rectCenter(an.normRect).x)
  const absoluteY = Math.abs(centerY(dn.normRect) - centerY(an.normRect))
  const maxRelDist = roleScore >= 0.72 ? 0.22 : 0.16
  return relDist <= maxRelDist &&
    style >= 0.72 &&
    absoluteX <= 0.18 &&
    (absoluteY <= 0.14 || roleScore >= 0.72)
}

export function distanceBetweenRelations(a, b) {
  return Math.hypot(a.dx - b.dx, a.dy - b.dy)
}

export function bestIoUMatch(targetRect, candidates, targetNode = null, regionContext = null) {
  let best = null
  let bestScore = 0
  let bestBackgroundScore = -1
  for (const n of candidates) {
    const iou = computeIoU(targetRect, n.normRect)
    if (iou <= 0) continue
    const wRatio = Math.min(targetRect.w, n.normRect.w) / Math.max(targetRect.w, n.normRect.w)
    const hRatio = Math.min(targetRect.h, n.normRect.h) / Math.max(targetRect.h, n.normRect.h)
    const regionBonus = targetNode ? regionAffinity(targetNode, n, regionContext) : 0
    const score = iou * wRatio * hRatio * (1 + regionBonus * 0.25)
    const backgroundScore = backgroundPresenceScore(targetNode, n)
    if (score > bestScore + SCORE_TIE_EPSILON || (Math.abs(score - bestScore) <= SCORE_TIE_EPSILON && backgroundScore > bestBackgroundScore)) {
      bestScore = score
      bestBackgroundScore = backgroundScore
      best = { node: n, iou }
    }
  }
  return best
}

export function bestTextPositionMatch(targetRect, candidates, targetNode = null, regionContext = null) {
  let best = null
  let bestScore = 0
  let bestBackgroundScore = -1
  const tcx = targetRect.x + targetRect.w / 2
  const tcy = targetRect.y + targetRect.h / 2

  for (const n of candidates) {
    const semantic = targetNode ? textSemanticSimilarity(targetNode.textContent, n.textContent) : 1
    if (targetNode && !allowsTextPositionFallback(targetNode.textContent, n.textContent, semantic)) continue

    const r = n.normRect
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    const dx = Math.abs(tcx - cx)
    const dy = Math.abs(tcy - cy)

    const yLimit = targetNode && passesTextSemanticGate(targetNode.textContent, n.textContent, semantic) ? 0.05 : 0.04
    if (dy > yLimit || dx > 0.25) continue

    const yScore = Math.max(0, 1 - dy / yLimit)
    const xScore = Math.max(0, 1 - dx / 0.25)
    const styleScore = targetNode ? textStyleSimilarity(targetNode, n) : 0.75
    const regionBonus = targetNode ? regionAffinity(targetNode, n, regionContext) : 0
    const score = yScore * 0.45 + xScore * 0.20 + semantic * 0.15 + styleScore * 0.15 + regionBonus * 0.05
    const backgroundScore = backgroundPresenceScore(targetNode, n)
    if (score > bestScore + SCORE_TIE_EPSILON || (Math.abs(score - bestScore) <= SCORE_TIE_EPSILON && backgroundScore > bestBackgroundScore)) {
      bestScore = score
      bestBackgroundScore = backgroundScore
      best = { node: n, score }
    }
  }

  return best
}
