import {
  buildTextIndex,
  bestExactTextCandidate,
  makePair,
  matchRegionTextOptimal,
  matchByAnchorTopology,
  bestTextRoleMatch,
  bestTextPositionMatch,
  bestIoUMatch,
} from './matchStrategies.js'
import { yDistance, xDistance, computeIoU } from './matchGeometry.js'
import {
  textStyleSimilarity,
  isAmbiguousUnitText,
  isAmbiguousShortNumberText,
  hasUsableText,
  isStrongTitleSlotMatch,
  textSemanticSimilarity,
  passesTextSemanticGate,
  normalizeText,
  textFieldType,
  numericTextCompatible,
} from './textSemantics.js'
import {
  annotateVisualOcclusion,
  isMatchableNode,
  isComparableOutputNode,
  isCompatibleType,
  isAcceptablePair,
  hasBackgroundColor,
  hasVisualDecoration,
  isRenderableNonTextNode,
} from './nodeVisibility.js'
import {
  segmentRegions,
  buildRegionContext,
  candidatePool,
  annotatePairsWithRegions,
  formatRegionForOutput,
} from './regionContext.js'
import { matchAlignedTextRows, matchDynamicTextSlots } from './dynamicTextSlots.js'

/**
 * 节点匹配器
 * Pass 1: 文本内容精确匹配，并识别强锚点文本
 * Pass 2: 匹配区域内文本节点全局最优匹配
 * Pass 3: 基于强锚点周边拓扑关系匹配弱节点
 * Pass 4: 文本位置回退匹配
 * Pass 5: 几何 IoU 匹配（容器节点）
 * Pass 6: 非文本视觉容器几何匹配
 * Pass 7: 低置信度兜底匹配
 */

/**
 * 主入口：将 design 节点与 arkui 节点两两配对
 * @returns {{ pairs: MatchPair[], unmatchedDesign: Node[], unmatchedArkui: Node[] }}
 */
export function matchNodes(designNodes, arkuiNodes, options = {}) {
  if (options.primarySource === 'arkui') {
    return matchNodesArkuiFirst(designNodes, arkuiNodes, options)
  }
  return matchNodesDesignFirst(designNodes, arkuiNodes, options)
}

function matchNodesArkuiFirst(designNodes, arkuiNodes, options = {}) {
  const primaryResult = matchNodesDesignFirst(arkuiNodes, designNodes, {
    ...options,
    primarySource: 'design',
  })

  const primaryPairs = primaryResult.pairs
    .map(pair => ({
      ...pair,
      design: pair.arkui,
      arkui: pair.design,
      designRegionId: pair.arkuiRegionId,
      arkuiRegionId: pair.designRegionId,
    }))
    .filter(isAcceptablePair)
  const fallbackResult = matchNodesDesignFirst(designNodes, arkuiNodes, {
    ...options,
    primarySource: 'design',
  })

  const usedDesign = new Set(primaryPairs.map(p => p.design.id))
  const usedArkui = new Set(primaryPairs.map(p => p.arkui.id))
  const fallbackPairs = fallbackResult.pairs.filter(pair => {
    if (usedDesign.has(pair.design.id) || usedArkui.has(pair.arkui.id)) return false
    usedDesign.add(pair.design.id)
    usedArkui.add(pair.arkui.id)
    return true
  })
  const pairs = selectOneToOnePairs([...primaryPairs, ...fallbackPairs].filter(isAcceptablePair))

  const matchedDesignSet = new Set(pairs.map(p => p.design.id))
  const matchedArkuiSet = new Set(pairs.map(p => p.arkui.id))
  const comparableDesignNodes = designNodes.filter(isComparableOutputNode)
  const comparableArkuiNodes = arkuiNodes.filter(isComparableOutputNode)

  return {
    pairs,
    unmatchedDesign: comparableDesignNodes.filter(n => !matchedDesignSet.has(n.id)),
    unmatchedArkui: comparableArkuiNodes.filter(n => !matchedArkuiSet.has(n.id)),
    comparableDesignCount: comparableDesignNodes.length,
    comparableArkuiCount: comparableArkuiNodes.length,
    regions: {
      design: fallbackResult.regions?.design || [],
      arkui: fallbackResult.regions?.arkui || [],
      pairs: (primaryResult.regions?.pairs || []).map(pair => ({
        ...pair,
        designRegionId: pair.arkuiRegionId,
        arkuiRegionId: pair.designRegionId,
      })),
    },
  }
}

function matchNodesDesignFirst(designNodes, arkuiNodes, options = {}) {
  annotateVisualOcclusion(designNodes)
  annotateVisualOcclusion(arkuiNodes)

  const usedArkui = new Set()
  const pairs = []
  const matchedDesignIds = new Set()
  const strongAnchors = []
  const topologyAnchors = []
  const designRegions = segmentRegions(designNodes, 'design')
  const arkuiRegions = segmentRegions(arkuiNodes, 'arkui')
  let regionContext = null

  // ── Pass 1: 文本内容精确匹配 ─────────────────────────────────────────────
  const arkuiTextMap = buildTextIndex(arkuiNodes.filter(n => n.type === 'text' && isMatchableNode(n)))

  for (const dn of designNodes) {
    if (!isMatchableNode(dn)) continue
    if (dn.type !== 'text') continue
    const content = normalizeText(dn.textContent)
    if (!content) continue
    if (isWeakPixelDuplicate(dn, designNodes, content)) continue

    const candidates = (arkuiTextMap.get(content) || []).filter(n => !usedArkui.has(n.id))
    if (candidates.length === 0) continue

    // 精确同文本优先看局部位置和样式；只按 y 选会在楼层偏移时漏掉同名文本。
    const best = bestExactTextCandidate(dn, candidates)
    const dist = yDistance(dn.normRect, best.normRect)

    const styleScore = textStyleSimilarity(dn, best)
    const xDist = xDistance(dn.normRect, best.normRect)
    const uniqueExactText = (arkuiTextMap.get(content) || []).length === 1 &&
      designNodes.filter(n => n.type === 'text' && normalizeText(n.textContent) === normalizeText(content)).length === 1

    const ambiguousShortNumber = isAmbiguousShortNumberText(content)

    // 短单位/短数字在页面中重复率高，必须更贴近才算强匹配。
    const yThreshold = isAmbiguousUnitText(content)
      ? 0.035
      : ambiguousShortNumber
        ? 0.045
      : uniqueExactText && styleScore >= 0.70
        ? 0.34
        : xDist < 0.08 && styleScore >= 0.70
          ? 0.22
          : 0.14
    const xThreshold = ambiguousShortNumber ? 0.10 : Infinity
    if (dist < yThreshold && xDist < xThreshold) {
      const isStrongAnchor = !ambiguousShortNumber && dist < 0.06 && styleScore >= 0.72
      const pair = makePair(dn, best, 'text-content', {
        confidence: isStrongAnchor ? 'high' : 'medium',
        topologyScore: styleScore,
        isAnchor: isStrongAnchor,
      })
      pairs.push(pair)
      usedArkui.add(best.id)
      matchedDesignIds.add(dn.id)
      if (isTrustedTopologyAnchor(pair, dist, styleScore)) topologyAnchors.push(pair)
      if (isStrongAnchor) strongAnchors.push(pair)
    }
  }

  regionContext = buildRegionContext(designRegions, arkuiRegions, strongAnchors)

  // ── Pass 2: 动态时间/星期槽位匹配（mock 与真实数据不同，但序列位置一致）──────
  const dynamicSlotPairs = matchDynamicTextSlots(
    designNodes,
    arkuiNodes,
    usedArkui,
    matchedDesignIds,
    regionContext
  )
  for (const pair of dynamicSlotPairs) {
    pairs.push(pair)
    usedArkui.add(pair.arkui.id)
    matchedDesignIds.add(pair.design.id)
  }

  const rowSlotPairs = matchAlignedTextRows(
    designNodes,
    arkuiNodes,
    usedArkui,
    matchedDesignIds,
    regionContext
  )
  for (const pair of rowSlotPairs) {
    pairs.push(pair)
    usedArkui.add(pair.arkui.id)
    matchedDesignIds.add(pair.design.id)
    if (pair.topologyScore >= 0.86) topologyAnchors.push(pair)
  }

  // ── Pass 3: 匹配区域内文本节点全局最优匹配，处理重复列表/卡片里的文本串位 ──────
  const regionTextPairs = matchRegionTextOptimal(
    designNodes,
    arkuiNodes,
    usedArkui,
    matchedDesignIds,
    regionContext
  )
  for (const pair of regionTextPairs) {
    pairs.push(pair)
    usedArkui.add(pair.arkui.id)
    matchedDesignIds.add(pair.design.id)
    if (isTrustedTopologyAnchor(pair, null, pair.topologyScore)) topologyAnchors.push(pair)
  }

  // ── Pass 3.5: 文本语义角色匹配（动态标题/副标题内容不同，但组件槽位一致）────
  for (const dn of designNodes) {
    if (!isMatchableNode(dn) || matchedDesignIds.has(dn.id) || dn.type !== 'text' || !hasUsableText(dn)) continue
    const candidates = candidatePool(dn, arkuiNodes, regionContext, n =>
      n.type === 'text' && hasUsableText(n) && !usedArkui.has(n.id)
    )
    const best = bestTextRoleMatch(dn, candidates)
    if (best && (best.score >= 0.85 || isStrongTitleSlotMatch(dn, best.node, best.score))) {
      pairs.push(makePair(dn, best.node, 'text-role', {
        iou: computeIoU(dn.normRect, best.node.normRect),
        confidence: 'medium',
        topologyScore: best.score,
      }))
      usedArkui.add(best.node.id)
      matchedDesignIds.add(dn.id)
    }
  }

  // ── Pass 4: 强锚点周边拓扑匹配（用局部相对位置匹配 mock 文本、图标、形状）──────
  if (topologyAnchors.length > 0) {
    const topologyPairs = matchByAnchorTopology(
      designNodes,
      arkuiNodes,
      topologyAnchors,
      usedArkui,
      matchedDesignIds,
      regionContext
    )
    for (const pair of topologyPairs) {
      pairs.push(pair)
      usedArkui.add(pair.arkui.id)
      matchedDesignIds.add(pair.design.id)
    }
  }

  // ── Pass 5: 文本节点位置回退匹配（处理 mock 数据与真实数据不一致）──────────────
  for (const dn of designNodes) {
    if (!isMatchableNode(dn) || matchedDesignIds.has(dn.id) || dn.type !== 'text' || !hasUsableText(dn)) continue
    const candidates = candidatePool(dn, arkuiNodes, regionContext, n =>
      n.type === 'text' && hasUsableText(n) && !usedArkui.has(n.id)
    )
    const best = bestTextPositionMatch(dn.normRect, candidates, dn, regionContext)
    if (best && best.score > 0.35) {
      pairs.push(makePair(dn, best.node, 'text-position', {
        iou: best.iou,
        confidence: 'medium',
      }))
      usedArkui.add(best.node.id)
      matchedDesignIds.add(dn.id)
    }
  }

  // ── Pass 5b: 数字槽位匹配（mock 整数与实际整数数值不同，但位置与样式一致）─────
  for (const dn of designNodes) {
    if (!isMatchableNode(dn) || matchedDesignIds.has(dn.id) || dn.type !== 'text') continue
    if (textFieldType(normalizeText(dn.textContent)) !== 'number') continue

    const candidates = candidatePool(dn, arkuiNodes, regionContext, n =>
      n.type === 'text' &&
      !usedArkui.has(n.id) &&
      hasUsableText(n) &&
      textFieldType(normalizeText(n.textContent)) === 'number'
    )

    let best = null
    let bestScore = -Infinity
    for (const an of candidates) {
      const dy = yDistance(dn.normRect, an.normRect)
      const dx = xDistance(dn.normRect, an.normRect)
      if (dy > 0.08 || dx > 0.20) continue
      const styleScore = textStyleSimilarity(dn, an)
      if (styleScore < 0.70) continue
      const score = (1 - dy / 0.08) * 0.55 + (1 - dx / 0.20) * 0.25 + styleScore * 0.20
      if (score > bestScore) { bestScore = score; best = an }
    }

    if (best && bestScore > 0.40) {
      pairs.push(makePair(dn, best, 'numeric-slot', {
        confidence: 'medium',
        topologyScore: bestScore,
      }))
      usedArkui.add(best.id)
      matchedDesignIds.add(dn.id)
    }
  }

  // ── Pass 5: 几何 IoU 匹配容器节点 ─────────────────────────────────────────
  for (const dn of designNodes) {
    if (!isMatchableNode(dn) || matchedDesignIds.has(dn.id)) continue
    if (dn.type !== 'container') continue

    const candidates = candidatePool(dn, arkuiNodes, regionContext, n =>
      n.type === 'container'
    )
    const best = bestIoUMatch(dn.normRect, candidates, dn, regionContext)
    const threshold = hasVisualDecoration(dn) ? 0.40 : 0.60
    if (best && best.iou > threshold) {
      pairs.push(makePair(dn, best.node, 'container-iou', {
        iou: best.iou,
        confidence: hasVisualDecoration(dn) ? 'high' : 'medium',
      }))
    }
  }

  // ── Pass 6: 非文本视觉容器几何匹配 ────────────────────────────────────────
  for (const dn of designNodes) {
    if (!isMatchableNode(dn) || matchedDesignIds.has(dn.id)) continue
    if (!isRenderableNonTextNode(dn)) continue

    const candidates = candidatePool(dn, arkuiNodes, regionContext, n => {
      return isRenderableNonTextNode(n)
    })
    const best = bestIoUMatch(dn.normRect, candidates, dn, regionContext)
    if (best && best.iou > 0.55) {
      pairs.push(makePair(dn, best.node, 'container-geometry', {
        iou: best.iou,
        confidence: 'medium',
      }))
    }
  }

  // ── Pass 7: Rescue Pass，保留低置信度标签，供前端和评分识别 ────────────────
  for (const dn of designNodes) {
    if (!isMatchableNode(dn) || matchedDesignIds.has(dn.id)) continue
    const candidates = candidatePool(dn, arkuiNodes, regionContext, n =>
      isCompatibleType(dn, n) &&
      (!(dn.type === 'text' && n.type === 'text') ||
        passesTextSemanticGate(dn.textContent, n.textContent, textSemanticSimilarity(dn.textContent, n.textContent))) &&
      (!(dn.type === 'text' && n.type === 'text') ||
        !isWeakVisibleTextNode(dn) && !isWeakVisibleTextNode(n) ||
        isWeakRescueTextAllowed(dn, n))
    )
    const best = bestIoUMatch(dn.normRect, candidates, dn, regionContext)
    if (best && best.iou > 0.25) {
      pairs.push(makePair(dn, best.node, 'rescue-iou', {
        iou: best.iou,
        confidence: 'low',
      }))
    }
  }

  annotatePairsWithRegions(pairs, regionContext)
  const acceptedPairs = selectOneToOnePairs(pairs.filter(isAcceptablePair))

  // ── 统计未匹配 ───────────────────────────────────────────────────────────
  const matchedDesignSet = new Set(acceptedPairs.map(p => p.design.id))
  const acceptedArkui = new Set(acceptedPairs.map(p => p.arkui.id))
  const comparableDesignNodes = designNodes.filter(isComparableOutputNode)
  const comparableArkuiNodes = arkuiNodes.filter(isComparableOutputNode)
  const unmatchedDesign = designNodes.filter(n =>
    !matchedDesignSet.has(n.id) && isComparableOutputNode(n)
  )
  const unmatchedArkui = arkuiNodes.filter(n =>
    !acceptedArkui.has(n.id) && isComparableOutputNode(n)
  )

  return {
    pairs: acceptedPairs,
    unmatchedDesign,
    unmatchedArkui,
    comparableDesignCount: comparableDesignNodes.length,
    comparableArkuiCount: comparableArkuiNodes.length,
    regions: {
      design: designRegions.map(formatRegionForOutput),
      arkui: arkuiRegions.map(formatRegionForOutput),
      pairs: regionContext?.regionPairs || [],
    },
  }
}

function isTrustedTopologyAnchor(pair, dist, score) {
  if (!pair?.design || !pair?.arkui) return false
  if (pair.design.type !== 'text' || pair.arkui.type !== 'text') return false
  if (normalizeText(pair.design.textContent) !== normalizeText(pair.arkui.textContent)) return false
  if (pair.isAnchor) return true
  if ((score ?? 0) < 0.68) return false
  return dist == null || dist < 0.12
}

function isWeakPixelDuplicate(node, nodes, content) {
  const ratio = node.pixelVisibility?.visiblePixelRatio
  if (ratio == null || ratio >= 0.08) return false
  return nodes.some(other =>
    other.id !== node.id &&
    other.type === 'text' &&
    normalizeText(other.textContent) === normalizeText(content) &&
    (other.pixelVisibility?.visiblePixelRatio ?? 0) >= 0.10
  )
}

function isWeakVisibleTextNode(node) {
  const visibility = node?.pixelVisibility || {}
  return (visibility.visiblePixelRatio ?? 1) < 0.10 && (visibility.textStrokeScore ?? 0) < 0.08
}

function isWeakRescueTextAllowed(dn, an) {
  const semantic = textSemanticSimilarity(dn.textContent, an.textContent)
  const typeA = textFieldType(normalizeText(dn.textContent))
  const typeB = textFieldType(normalizeText(an.textContent))
  if (typeA !== typeB) return false
  if (typeA !== 'label') {
    if (typeA === 'number') return numericTextCompatible(dn.textContent, an.textContent)
    return normalizeText(dn.textContent) === normalizeText(an.textContent)
  }
  return semantic >= 0.55
}

function selectOneToOnePairs(pairs) {
  const selected = []
  const usedDesign = new Set()
  const usedArkui = new Set()
  const sorted = [...pairs].sort((a, b) => {
    const priorityDelta = pairPriority(b) - pairPriority(a)
    if (priorityDelta !== 0) return priorityDelta

    const backgroundDelta = backgroundMatchPriority(b) - backgroundMatchPriority(a)
    if (backgroundDelta !== 0) return backgroundDelta

    const designOrderDelta = (a.design.paintIndex ?? 0) - (b.design.paintIndex ?? 0)
    if (designOrderDelta !== 0) return designOrderDelta

    return (a.arkui.paintIndex ?? 0) - (b.arkui.paintIndex ?? 0)
  })

  for (const pair of sorted) {
    if (usedDesign.has(pair.design.id) || usedArkui.has(pair.arkui.id)) continue
    selected.push(pair)
    usedDesign.add(pair.design.id)
    usedArkui.add(pair.arkui.id)
  }

  return selected.sort((a, b) => (a.design.paintIndex ?? 0) - (b.design.paintIndex ?? 0))
}

function pairPriority(pair) {
  const confidenceScore = pair.confidence === 'high' ? 300 : pair.confidence === 'medium' ? 200 : 100
  const anchorScore = pair.isAnchor ? 25 : 0
  const typeScore = matchTypePriority(pair.matchType)
  const topologyScore = (pair.topologyScore ?? 0) * 10
  const iouScore = (pair.iou ?? 0) * 8
  return confidenceScore + anchorScore + typeScore + topologyScore + iouScore
}

function backgroundMatchPriority(pair) {
  return hasBackgroundColor(pair.design) === hasBackgroundColor(pair.arkui) ? 1 : 0
}

function matchTypePriority(matchType) {
  const order = {
    'text-content': 40,
    'region-text-optimal': 34,
    'text-role': 30,
    'anchor-topology': 24,
    'dynamic-text-slot': 22,
    'text-row-slot': 21,
    'text-position': 20,
    'numeric-slot': 19,
    'container-iou': 18,
    'container-geometry': 14,
    'region-text-global-rescue': 8,
    'rescue-iou': 2,
  }
  return order[matchType] ?? 0
}
