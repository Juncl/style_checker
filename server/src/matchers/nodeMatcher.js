import {
  cropSimilarity,
  extractNodeVisualFeatures,
  extractRegionVisualFeatures,
  extractVisualPartitions,
  visualSimilarity,
} from '../utils/imageFeatures.js'

/**
 * 节点匹配器
 * Pass 1: 文本内容精确匹配，并识别强锚点文本
 * Pass 2: 匹配区域内文本节点全局最优匹配
 * Pass 3: 基于强锚点周边拓扑关系匹配弱节点
 * Pass 4: 文本位置回退匹配
 * Pass 5: 几何 IoU 匹配（容器节点）
 * Pass 6: 渐变节点匹配
 * Pass 7: shape/image/other 节点几何匹配
 * Pass 8: 低置信度兜底匹配
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
  const reversedVisualImages = options.visualImages ? {
    designBuffer: options.visualImages.arkuiBuffer,
    arkuiBuffer: options.visualImages.designBuffer,
    designCanvas: options.visualImages.arkuiCanvas,
    arkuiCanvas: options.visualImages.designCanvas,
  } : null
  const reversedVisualFeatures = options.visualFeatures ? {
    design: options.visualFeatures.arkui,
    arkui: options.visualFeatures.design,
  } : null

  const primaryResult = matchNodesDesignFirst(arkuiNodes, designNodes, {
    ...options,
    primarySource: 'design',
    visualImages: reversedVisualImages,
    visualFeatures: reversedVisualFeatures,
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
  const pairs = [...primaryPairs, ...fallbackPairs].filter(isAcceptablePair)

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
  annotateDesignIconFragments(designNodes)
  annotateVisualOcclusion(designNodes)
  annotateVisualOcclusion(arkuiNodes)

  const usedArkui = new Set()
  const pairs = []
  const matchedDesignIds = new Set()
  const strongAnchors = []
  const visualPartitions = buildVisualPartitions(options)
  const designRegions = segmentRegions(designNodes, 'design', visualPartitions?.design)
  const arkuiRegions = segmentRegions(arkuiNodes, 'arkui', visualPartitions?.arkui)
  const visualFeatures = buildVisualFeatures({
    ...options,
    visualNodes: { design: designNodes, arkui: arkuiNodes },
  }, designRegions, arkuiRegions)
  let regionContext = null

  // ── Pass 1: 文本内容精确匹配 ─────────────────────────────────────────────
  const arkuiTextMap = buildTextIndex(arkuiNodes.filter(n => n.type === 'text' && isMatchableNode(n)))

  for (const dn of designNodes) {
    if (!isMatchableNode(dn)) continue
    if (dn.type !== 'text') continue
    const content = (dn.textContent || '').trim()
    if (!content) continue

    const candidates = (arkuiTextMap.get(content) || []).filter(n => !usedArkui.has(n.id))
    if (candidates.length === 0) continue

    // 精确同文本优先看局部位置和样式；只按 y 选会在楼层偏移时漏掉同名文本。
    const best = bestExactTextCandidate(dn, candidates)
    const dist = yDistance(dn.normRect, best.normRect)

    const styleScore = textStyleSimilarity(dn, best)
    const xDist = xDistance(dn.normRect, best.normRect)
    const uniqueExactText = (arkuiTextMap.get(content) || []).length === 1 &&
      designNodes.filter(n => n.type === 'text' && normalizeText(n.textContent) === normalizeText(content)).length === 1

    // 短单位文本（如“分钟”）在页面中重复率高，必须更贴近才算强匹配。
    const yThreshold = isAmbiguousUnitText(content)
      ? 0.035
      : uniqueExactText && styleScore >= 0.70
        ? 0.34
        : xDist < 0.08 && styleScore >= 0.70
          ? 0.22
          : 0.14
    if (dist < yThreshold) {
      const isStrongAnchor = dist < 0.06 && styleScore >= 0.72
      const pair = makePair(dn, best, 'text-content', {
        confidence: isStrongAnchor ? 'high' : 'medium',
        topologyScore: styleScore,
        isAnchor: isStrongAnchor,
      })
      pairs.push(pair)
      usedArkui.add(best.id)
      matchedDesignIds.add(dn.id)
      if (isStrongAnchor) strongAnchors.push(pair)
    }
  }

  regionContext = buildRegionContext(designRegions, arkuiRegions, strongAnchors, visualFeatures)

  // ── Pass 2: 匹配区域内文本节点全局最优匹配，处理重复列表/卡片里的文本串位 ──────
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
  }

  // ── Pass 2.5: 文本语义角色匹配（动态标题/副标题内容不同，但组件槽位一致）──────
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

  // ── Pass 3: 强锚点周边拓扑匹配（用局部相对位置匹配 mock 文本、图标、形状）──────
  if (strongAnchors.length > 0) {
    const topologyPairs = matchByAnchorTopology(
      designNodes,
      arkuiNodes,
      strongAnchors,
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

  // ── Pass 4: 文本节点位置回退匹配（处理 mock 数据与真实数据不一致）──────────────
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

  // ── Pass 5: 几何 IoU 匹配容器节点 ─────────────────────────────────────────
  for (const dn of designNodes) {
    if (!isMatchableNode(dn) || matchedDesignIds.has(dn.id)) continue
    if (dn.type !== 'container') continue

    const candidates = candidatePool(dn, arkuiNodes, regionContext, n =>
      n.type === 'container' && !usedArkui.has(n.id)
    )
    const best = bestIoUMatch(dn.normRect, candidates, dn, regionContext)
    const threshold = hasVisualDecoration(dn) ? 0.40 : 0.60
    if (best && best.iou > threshold) {
      pairs.push(makePair(dn, best.node, 'container-iou', {
        iou: best.iou,
        confidence: hasVisualDecoration(dn) ? 'high' : 'medium',
      }))
      usedArkui.add(best.node.id)
      matchedDesignIds.add(dn.id)
    }
  }

  // ── Pass 6: 渐变节点几何匹配（形状/其他类型均纳入）──────────────────────────
  for (const dn of designNodes) {
    if (!isMatchableNode(dn) || matchedDesignIds.has(dn.id)) continue
    if (!dn.style.gradient) continue

    const candidates = candidatePool(dn, arkuiNodes, regionContext, n =>
      !usedArkui.has(n.id) && n.style.gradient
    )
    const best = bestIoUMatch(dn.normRect, candidates, dn, regionContext)
    if (best && best.iou > 0.3) {
      pairs.push(makePair(dn, best.node, 'gradient-iou', {
        iou: best.iou,
        confidence: 'medium',
      }))
      usedArkui.add(best.node.id)
      matchedDesignIds.add(dn.id)
    }
  }

  // ── Pass 7: shape / image / other 节点几何匹配 ──────────────────────────────
  for (const dn of designNodes) {
    if (!isMatchableNode(dn) || matchedDesignIds.has(dn.id)) continue
    if (!['shape', 'image', 'other'].includes(dn.type)) continue

    const candidates = candidatePool(dn, arkuiNodes, regionContext, n => {
      if (usedArkui.has(n.id)) return false
      if (dn.type === 'image') return n.type === 'image' || n.type === 'other'
      return n.type !== 'text'
    })
    const best = bestVisualIoUMatch(dn.normRect, candidates, dn, regionContext)
    if (best && best.iou > 0.55) {
      pairs.push(makePair(dn, best.node, `${dn.type}-geometry`, {
        iou: best.iou,
        confidence: 'medium',
        visualScore: best.visualScore ?? null,
      }))
      usedArkui.add(best.node.id)
      matchedDesignIds.add(dn.id)
    }
  }

  // ── Pass 8: Rescue Pass，保留低置信度标签，供前端和评分识别 ────────────────
  for (const dn of designNodes) {
    if (!isMatchableNode(dn) || matchedDesignIds.has(dn.id)) continue
    const candidates = candidatePool(dn, arkuiNodes, regionContext, n =>
      !usedArkui.has(n.id) &&
      isCompatibleType(dn, n) &&
      (!(dn.type === 'text' && n.type === 'text') ||
        passesTextSemanticGate(dn.textContent, n.textContent, textSemanticSimilarity(dn.textContent, n.textContent)))
    )
    const best = bestIoUMatch(dn.normRect, candidates, dn, regionContext)
    if (best && best.iou > 0.25) {
      pairs.push(makePair(dn, best.node, 'rescue-iou', {
        iou: best.iou,
        confidence: 'low',
      }))
      usedArkui.add(best.node.id)
      matchedDesignIds.add(dn.id)
    }
  }

  annotatePairsWithRegions(pairs, regionContext)
  const acceptedPairs = pairs.filter(isAcceptablePair)

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

// ──────────────────────────────────────────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────────────────────────────────────────

/** 构建 textContent → ArkUI节点数组 索引 */
function buildTextIndex(arkuiTextNodes) {
  const map = new Map()
  for (const n of arkuiTextNodes) {
    const key = (n.textContent || '').trim()
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(n)
  }
  return map
}

/** 按 normRect.y 距离找最近候选 */
function closestByY(targetNode, candidates) {
  return candidates.reduce((best, cur) => {
    return yDistance(targetNode.normRect, cur.normRect) <
           yDistance(targetNode.normRect, best.normRect)
      ? cur : best
  })
}

function bestExactTextCandidate(targetNode, candidates) {
  let best = null
  let bestScore = -Infinity
  for (const cur of candidates) {
    const yScore = Math.max(0, 1 - yDistance(targetNode.normRect, cur.normRect) / 0.40)
    const xScore = Math.max(0, 1 - xDistance(targetNode.normRect, cur.normRect) / 0.35)
    const styleScore = textStyleSimilarity(targetNode, cur)
    const sizeScore = sizeRatio(targetNode.normRect.h, cur.normRect.h)
    const score = yScore * 0.40 + xScore * 0.30 + styleScore * 0.20 + sizeScore * 0.10
    if (score > bestScore) {
      bestScore = score
      best = cur
    }
  }
  return best || closestByY(targetNode, candidates)
}

function yDistance(r1, r2) {
  const cy1 = r1.y + r1.h / 2
  const cy2 = r2.y + r2.h / 2
  return Math.abs(cy1 - cy2)
}

function xDistance(r1, r2) {
  const cx1 = r1.x + r1.w / 2
  const cx2 = r2.x + r2.w / 2
  return Math.abs(cx1 - cx2)
}

function makePair(design, arkui, matchType, extra = {}) {
  return {
    design,
    arkui,
    matchType,
    iou: extra.iou ?? null,
    confidence: extra.confidence || 'medium',
    topologyScore: extra.topologyScore ?? null,
    visualScore: extra.visualScore ?? null,
    isAnchor: extra.isAnchor || false,
  }
}

function matchRegionTextOptimal(designNodes, arkuiNodes, usedArkui, matchedDesignIds, regionContext) {
  if (!regionContext?.regionPairs?.length) return []

  const result = []
  const localUsedArkui = new Set()
  const localMatchedDesign = new Set()

  for (const regionPair of regionContext.regionPairs) {
    const designTexts = designNodes.filter(n =>
      n.type === 'text' &&
      hasUsableText(n) &&
      isMatchableNode(n) &&
      !matchedDesignIds.has(n.id) &&
      !localMatchedDesign.has(n.id) &&
      regionContext.designNodeToRegion.get(n.id) === regionPair.designRegionId
    )
    const arkuiTexts = arkuiNodes.filter(n =>
      n.type === 'text' &&
      hasUsableText(n) &&
      isMatchableNode(n) &&
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

  return result
}

function maxWeightTextMatching(designTexts, arkuiTexts, regionScore) {
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
      if (!passesTextSemanticGate(dn.textContent, an.textContent, semantic) && roleScore < 0.85) continue
      if (isAmbiguousUnitText(dn.textContent) && Math.abs(centerY(dn.normRect) - centerY(an.normRect)) > 0.04) continue

      const geom = localTextGeometryScore(dn.normRect, an.normRect)
      const style = textStyleSimilarity(dn, an)
      const order = 1 - Math.min(1, Math.abs(designOrder.get(dn.id) - arkuiOrder.get(an.id)) / Math.max(designTexts.length, arkuiTexts.length, 1))
      const semanticOrRole = Math.max(semantic, roleScore * 0.72)
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

function exactAssignmentForSmallGroups(designTexts, arkuiTexts, edgeScore) {
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

function bestTextRoleMatch(targetNode, candidates) {
  let best = null
  let bestScore = 0
  for (const node of candidates) {
    const score = textRoleMatchScore(targetNode, node)
    if (score > bestScore) {
      bestScore = score
      best = node
    }
  }
  return best ? { node: best, score: bestScore } : null
}

function orderIndexMap(nodes) {
  const sorted = [...nodes].sort((a, b) => {
    const dy = centerY(a.normRect) - centerY(b.normRect)
    return Math.abs(dy) > 0.01 ? dy : rectCenter(a.normRect).x - rectCenter(b.normRect).x
  })
  return new Map(sorted.map((n, idx) => [n.id, idx]))
}

function localTextGeometryScore(a, b) {
  const ac = rectCenter(a)
  const bc = rectCenter(b)
  const dx = Math.abs(ac.x - bc.x)
  const dy = Math.abs(ac.y - bc.y)
  const hRatio = sizeRatio(a.h, b.h)
  const xScore = Math.max(0, 1 - dx / 0.28)
  const yScore = Math.max(0, 1 - dy / 0.08)
  return xScore * 0.30 + yScore * 0.50 + hRatio * 0.20
}

function matchByAnchorTopology(designNodes, arkuiNodes, anchors, usedArkui, matchedDesignIds, regionContext) {
  const result = []
  const localUsedArkui = new Set()
  const localMatchedDesign = new Set()
  const candidateDesignNodes = designNodes
    .filter(n => isMatchableNode(n) && !matchedDesignIds.has(n.id))
    .filter(n => n.type !== 'text' || hasUsableText(n))
    .map(n => ({ node: n, anchor: nearestAnchor(n, anchors, 'design') }))
    .filter(item => item.anchor && item.anchor.dist < 0.35)
    .sort((a, b) => a.anchor.dist - b.anchor.dist)

  for (const { node: dn, anchor } of candidateDesignNodes) {
    if (localMatchedDesign.has(dn.id)) continue

    let best = null
    let bestScore = 0
    const arkuiAnchor = anchor.pair.arkui
    const designRelation = relationToAnchor(dn, anchor.pair.design)
    const regionCandidates = candidatePool(dn, arkuiNodes, regionContext, n =>
      isMatchableNode(n) &&
      !usedArkui.has(n.id) &&
      !localUsedArkui.has(n.id) &&
      isCompatibleType(dn, n)
    )

    for (const an of regionCandidates) {
      const arkuiRelation = relationToAnchor(an, arkuiAnchor)
      if (distanceBetweenRelations(designRelation, arkuiRelation) > 0.22) continue

      const score = topologyMatchScore(dn, an, designRelation, arkuiRelation, regionContext)
      if (score > bestScore) {
        bestScore = score
        best = { node: an, score, iou: computeIoU(dn.normRect, an.normRect) }
      }
    }

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

function segmentRegions(nodes, source, visualPartitions = null) {
  const matchable = nodes
    .filter(isMatchableNode)
    .filter(n => n.normRect && Number.isFinite(n.normRect.y))
    .sort((a, b) => centerY(a.normRect) - centerY(b.normRect))

  if (matchable.length === 0) return []
  const visualRegions = segmentRegionsByVisualPartitions(matchable, source, visualPartitions)
  if (visualRegions.length >= 3) return visualRegions

  const regions = []
  let current = []
  let lastCy = null

  for (const node of matchable) {
    const cy = centerY(node.normRect)
    const gap = lastCy === null ? 0 : cy - lastCy
    if (current.length >= 4 && gap > 0.075) {
      regions.push(makeRegion(source, regions.length, current))
      current = []
    }
    current.push(node)
    lastCy = cy
  }

  if (current.length > 0) regions.push(makeRegion(source, regions.length, current))

  // 若页面节点过于连续导致切不动，退化到移动端常见纵向楼层。
  if (regions.length < 3 && matchable.length > 80) {
    return segmentRegionsByFixedFloors(matchable, source)
  }

  return regions
}

function segmentRegionsByVisualPartitions(nodes, source, visualPartitions) {
  if (!visualPartitions?.length) return []
  const regions = []
  const used = new Set()
  for (const partition of visualPartitions) {
    const band = partition.rect
    const bandNodes = nodes.filter(n => {
      if (used.has(n.id)) return false
      const cy = centerY(n.normRect)
      return cy >= band.y - 0.01 && cy <= band.y + band.h + 0.01
    })
    if (bandNodes.length < 2) continue
    for (const n of bandNodes) used.add(n.id)
    regions.push(makeRegion(source, regions.length, bandNodes, partition))
  }
  const leftovers = nodes.filter(n => !used.has(n.id))
  if (leftovers.length >= 4) {
    for (const region of segmentRegionsByFixedFloors(leftovers, source)) {
      regions.push({ ...region, id: `${source}-region-${regions.length}`, index: regions.length })
    }
  }
  return regions
}

function buildVisualFeatures(options, designRegions, arkuiRegions) {
  if (options.visualFeatures) return options.visualFeatures
  if (!options.visualImages) return null

  const design = extractRegionVisualFeatures(
    options.visualImages.designBuffer,
    options.visualImages.designCanvas,
    designRegions
  )
  const arkui = extractRegionVisualFeatures(
    options.visualImages.arkuiBuffer,
    options.visualImages.arkuiCanvas,
    arkuiRegions
  )

  const designNodes = extractNodeVisualFeatures(
    options.visualImages.designBuffer,
    options.visualImages.designCanvas,
    options.visualNodes?.design || []
  )
  const arkuiNodes = extractNodeVisualFeatures(
    options.visualImages.arkuiBuffer,
    options.visualImages.arkuiCanvas,
    options.visualNodes?.arkui || []
  )

  return design && arkui ? { design, arkui, designNodes, arkuiNodes } : null
}

function buildVisualPartitions(options) {
  if (options.visualPartitions) return options.visualPartitions
  if (!options.visualImages) return null
  return {
    design: extractVisualPartitions(options.visualImages.designBuffer, options.visualImages.designCanvas),
    arkui: extractVisualPartitions(options.visualImages.arkuiBuffer, options.visualImages.arkuiCanvas),
  }
}

function segmentRegionsByFixedFloors(nodes, source) {
  const floors = [
    [Number.NEGATIVE_INFINITY, 0.14],
    [0.14, 0.30],
    [0.30, 0.48],
    [0.48, 0.66],
    [0.66, 0.84],
    [0.84, Number.POSITIVE_INFINITY],
  ]

  return floors
    .map((range, idx) => {
      const floorNodes = nodes.filter(n => {
        const cy = centerY(n.normRect)
        return cy >= range[0] && cy < range[1]
      })
      return floorNodes.length ? makeRegion(source, idx, floorNodes) : null
    })
    .filter(Boolean)
}

function makeRegion(source, index, nodes, visualPartition = null) {
  const rect = unionNormRect(nodes.map(n => n.normRect))
  const counts = { text: 0, container: 0, shape: 0, image: 0, other: 0 }
  const textSet = new Set()
  let decorated = 0

  for (const n of nodes) {
    counts[n.type] = (counts[n.type] || 0) + 1
    const text = normalizeText(n.textContent)
    if (text) textSet.add(text)
    if (hasVisualDecoration(n)) decorated += 1
  }

  return {
    id: `${source}-region-${index}`,
    source,
    index,
    rect,
    nodeIds: new Set(nodes.map(n => n.id)),
    nodeCount: nodes.length,
    counts,
    textSet,
    decoratedRatio: nodes.length ? decorated / nodes.length : 0,
    visualPartition: visualPartition?.id || null,
  }
}

function buildRegionContext(designRegions, arkuiRegions, anchors, visualFeatures = null) {
  const designNodeToRegion = nodeToRegionMap(designRegions)
  const arkuiNodeToRegion = nodeToRegionMap(arkuiRegions)
  const anchorVotes = new Map()

  for (const pair of anchors) {
    const dr = designNodeToRegion.get(pair.design.id)
    const ar = arkuiNodeToRegion.get(pair.arkui.id)
    if (!dr || !ar) continue
    const key = `${dr}::${ar}`
    anchorVotes.set(key, (anchorVotes.get(key) || 0) + 1)
  }

  const scored = []
  for (const dr of designRegions) {
    for (const ar of arkuiRegions) {
      const visualScore = visualFeatures
        ? visualSimilarity(visualFeatures.design?.get(dr.id), visualFeatures.arkui?.get(ar.id))
        : 0
      const score = regionMatchScore(dr, ar, anchorVotes.get(`${dr.id}::${ar.id}`) || 0, visualScore)
      if (score > 0.28) scored.push({ designRegionId: dr.id, arkuiRegionId: ar.id, score, visualScore })
    }
  }

  scored.sort((a, b) => b.score - a.score)

  const usedD = new Set()
  const usedA = new Set()
  const regionPairs = []
  const designToArkuiRegions = new Map()
  const arkuiRegionNodeIds = new Map(arkuiRegions.map(r => [r.id, r.nodeIds]))

  for (const item of scored) {
    if (usedD.has(item.designRegionId) || usedA.has(item.arkuiRegionId)) continue
    usedD.add(item.designRegionId)
    usedA.add(item.arkuiRegionId)
    const pair = { ...item, score: Number(item.score.toFixed(3)), visualScore: Number((item.visualScore || 0).toFixed(3)) }
    regionPairs.push(pair)
    designToArkuiRegions.set(item.designRegionId, [item.arkuiRegionId])
  }

  return {
    designRegions,
    arkuiRegions,
    regionPairs,
    designNodeToRegion,
    arkuiNodeToRegion,
    designToArkuiRegions,
    arkuiRegionNodeIds,
    visualFeatures,
  }
}

function candidatePool(designNode, arkuiNodes, regionContext, predicate) {
  const all = arkuiNodes.filter(n => isMatchableNode(n)).filter(predicate)
  if (!regionContext) return all

  const designRegionId = regionContext.designNodeToRegion.get(designNode.id)
  const arkuiRegionIds = regionContext.designToArkuiRegions.get(designRegionId)
  if (!arkuiRegionIds?.length) return all

  const regionScoped = all.filter(n => {
    const arkuiRegionId = regionContext.arkuiNodeToRegion.get(n.id)
    return arkuiRegionIds.includes(arkuiRegionId)
  })

  if (regionScoped.length === 0) return all

  const scopedIds = new Set(regionScoped.map(n => n.id))
  return [
    ...regionScoped,
    ...all.filter(n => !scopedIds.has(n.id)),
  ]
}

function annotatePairsWithRegions(pairs, regionContext) {
  if (!regionContext) return

  const scoreByRegionPair = new Map(
    regionContext.regionPairs.map(p => [`${p.designRegionId}::${p.arkuiRegionId}`, p.score])
  )

  for (const pair of pairs) {
    const designRegionId = regionContext.designNodeToRegion.get(pair.design.id) || null
    const arkuiRegionId = regionContext.arkuiNodeToRegion.get(pair.arkui.id) || null
    pair.designRegionId = designRegionId
    pair.arkuiRegionId = arkuiRegionId
    pair.regionScore = scoreByRegionPair.get(`${designRegionId}::${arkuiRegionId}`) ?? null
  }
}

function isAcceptablePair(pair) {
  const { design, arkui, matchType, confidence, visualScore } = pair
  if (design.type === 'text') {
    if (arkui.type !== 'text') return false
    const designType = textFieldType(normalizeText(design.textContent))
    const arkuiType = textFieldType(normalizeText(arkui.textContent))
    if (designType === 'number' || arkuiType === 'number') {
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

function isStructuralContainer(node) {
  return node.type === 'container' && !hasVisualDecoration(node)
}

function isDesignIconFragment(node) {
  return node.source === 'design' && (node.iconFragment || /^(path|路径)/i.test(String(node.name || '').trim()))
}

function isComparableOutputNode(node) {
  return isMatchableNode(node) && !isStructuralContainer(node)
}

function annotateDesignIconFragments(nodes) {
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

function isPathPrefix(prefix, path) {
  if (prefix.length >= path.length) return false
  return prefix.every((part, idx) => part === path[idx])
}

function rectContainsCenter(container, rect) {
  const c = rectCenter(rect)
  return pointInRect(c.x, c.y, container)
}

function rectArea(rect) {
  return Math.max(0, rect?.w || 0) * Math.max(0, rect?.h || 0)
}

function annotateVisualOcclusion(nodes) {
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

function isVisualVisibilityCandidate(node) {
  if (!node?.visible || !node.normRect) return false
  if (node.type === 'text') return hasUsableText(node)
  if (node.type === 'image' || node.type === 'shape') return true
  return hasVisualDecoration(node)
}

function isOccludingNode(node) {
  if (!node?.visible || node.visualOccluded) return false
  if (node.type === 'text') return false
  const s = node.style || {}
  const opacity = s.opacity == null ? 1 : s.opacity
  if (opacity < 0.70) return false
  return !!(s.backgroundColor || s.gradient || node.type === 'image' || node.type === 'shape')
}

function approximateCoveredRatio(rect, blockers) {
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

function approximateVisibleRatio(rect, blockers, viewport) {
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

function regionMatchScore(designRegion, arkuiRegion, anchorVotes, visualScore = 0) {
  const centerScore = Math.max(0, 1 - Math.abs(centerY(designRegion.rect) - centerY(arkuiRegion.rect)) / 0.35)
  const heightScore = sizeRatio(designRegion.rect.h, arkuiRegion.rect.h)
  const geometryScore = centerScore * 0.65 + heightScore * 0.35
  const histScore = histogramSimilarity(designRegion.counts, arkuiRegion.counts)
  const textScore = setJaccard(designRegion.textSet, arkuiRegion.textSet)
  const decorationScore = Math.max(0, 1 - Math.abs(designRegion.decoratedRatio - arkuiRegion.decoratedRatio) / 0.5)
  const anchorScore = Math.min(1, anchorVotes / 3)

  return (
    anchorScore * 0.30 +
    geometryScore * 0.22 +
    histScore * 0.18 +
    textScore * 0.10 +
    decorationScore * 0.05 +
    visualScore * 0.15
  )
}

function regionAffinity(designNode, arkuiNode, regionContext) {
  if (!regionContext) return 0
  const designRegionId = regionContext.designNodeToRegion.get(designNode.id)
  const arkuiRegionId = regionContext.arkuiNodeToRegion.get(arkuiNode.id)
  if (!designRegionId || !arkuiRegionId) return 0
  const pair = regionContext.regionPairs.find(p =>
    p.designRegionId === designRegionId && p.arkuiRegionId === arkuiRegionId
  )
  return pair?.score || 0
}

function nodeToRegionMap(regions) {
  const map = new Map()
  for (const region of regions) {
    for (const id of region.nodeIds) map.set(id, region.id)
  }
  return map
}

function histogramSimilarity(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  let dot = 0, aa = 0, bb = 0
  for (const key of keys) {
    const av = a[key] || 0
    const bv = b[key] || 0
    dot += av * bv
    aa += av * av
    bb += bv * bv
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0
}

function setJaccard(a, b) {
  if (!a?.size && !b?.size) return 0
  let inter = 0
  for (const item of a) if (b.has(item)) inter += 1
  return inter / (a.size + b.size - inter || 1)
}

function unionNormRect(rects) {
  const x1 = Math.min(...rects.map(r => r.x))
  const y1 = Math.min(...rects.map(r => r.y))
  const x2 = Math.max(...rects.map(r => r.x + r.w))
  const y2 = Math.max(...rects.map(r => r.y + r.h))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

function formatRegionForOutput(region) {
  return {
    id: region.id,
    index: region.index,
    rect: region.rect,
    nodeCount: region.nodeCount,
    counts: region.counts,
    decoratedRatio: Number(region.decoratedRatio.toFixed(3)),
    visualPartition: region.visualPartition,
  }
}

function normalizeText(text) {
  return String(text || '').trim().toLowerCase()
}

function nearestAnchor(node, anchors, side) {
  let best = null
  for (const pair of anchors) {
    const anchorNode = pair[side]
    const dist = centerDistance(node.normRect, anchorNode.normRect)
    if (!best || dist < best.dist) best = { pair, dist }
  }
  return best
}

function relationToAnchor(node, anchorNode) {
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

function topologyMatchScore(dn, an, designRelation, arkuiRelation, regionContext) {
  const semantic = dn.type === 'text' && an.type === 'text'
    ? textSemanticSimilarity(dn.textContent, an.textContent)
    : 1
  const roleScore = dn.type === 'text' && an.type === 'text' ? textRoleMatchScore(dn, an) : 0
  if (!passesTextSemanticGate(dn.textContent, an.textContent, semantic) && roleScore < 0.85) return 0
  if (
    dn.type === 'text' &&
    an.type === 'text' &&
    isAmbiguousUnitText(dn.textContent) &&
    Math.abs(centerY(dn.normRect) - centerY(an.normRect)) > 0.04
  ) return 0

  const relDist = distanceBetweenRelations(designRelation, arkuiRelation)
  const relScore = Math.max(0, 1 - relDist / 0.22)
  const wRatio = sizeRatio(dn.normRect.w, an.normRect.w)
  const hRatio = sizeRatio(dn.normRect.h, an.normRect.h)
  const sizeScore = (wRatio + hRatio) / 2
  const iou = computeIoU(dn.normRect, an.normRect)
  const typeScore = dn.type === an.type ? 1 : 0.68
  const textScore = dn.type === 'text' && an.type === 'text'
    ? textStyleSimilarity(dn, an)
    : 0.70

  const regionScore = regionAffinity(dn, an, regionContext)
  const semanticScore = dn.type === 'text' && an.type === 'text' ? Math.max(semantic, roleScore * 0.72) : 0.70

  return relScore * 0.38 + sizeScore * 0.18 + typeScore * 0.10 + textScore * 0.10 + semanticScore * 0.14 + iou * 0.06 + regionScore * 0.04
}

function distanceBetweenRelations(a, b) {
  return Math.hypot(a.dx - b.dx, a.dy - b.dy)
}

function centerDistance(a, b) {
  const ac = rectCenter(a)
  const bc = rectCenter(b)
  return Math.hypot(ac.x - bc.x, ac.y - bc.y)
}

function rectCenter(r) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

function centerY(r) {
  return r.y + r.h / 2
}

function sizeRatio(a, b) {
  if (!a || !b) return 0
  return Math.min(a, b) / Math.max(a, b)
}

function textStyleSimilarity(dn, an) {
  const ds = dn.style || {}
  const as = an.style || {}
  let score = 0
  let weight = 0

  if (ds.fontSize != null && as.fontSize != null) {
    weight += 0.34
    score += Math.max(0, 1 - Math.abs(ds.fontSize - as.fontSize) / 6) * 0.34
  }
  if (ds.fontWeight != null && as.fontWeight != null) {
    weight += 0.22
    score += Math.max(0, 1 - Math.abs(ds.fontWeight - as.fontWeight) / 400) * 0.22
  }
  if (ds.fontColor && as.fontColor) {
    weight += 0.28
    score += Math.max(0, 1 - colorDistance(ds.fontColor, as.fontColor) / 180) * 0.28
  }
  if (ds.textAlign && as.textAlign) {
    weight += 0.16
    score += (ds.textAlign === as.textAlign ? 1 : 0.55) * 0.16
  }

  return weight > 0 ? score / weight : 0.75
}

function textSemanticSimilarity(a, b) {
  const ta = normalizeText(a)
  const tb = normalizeText(b)
  if (!ta || !tb) return 0
  if (ta === tb) return 1

  const typeA = textFieldType(ta)
  const typeB = textFieldType(tb)
  const typeScore = typeA !== 'label' && typeA === typeB && (typeA !== 'number' || numericTextCompatible(ta, tb)) ? 0.72 : 0
  const charScore = charJaccard(ta, tb)
  const bigramScore = bigramJaccard(ta, tb)
  const prefixScore = cjkCommonPrefixScore(ta, tb)

  return Math.max(typeScore, prefixScore, charScore * 0.45 + bigramScore * 0.55)
}

function passesTextSemanticGate(a, b, semantic) {
  if (!a || !b) return true
  const ta = normalizeText(a)
  const tb = normalizeText(b)
  if (!ta || !tb || ta === tb) return true
  const typeA = textFieldType(ta)
  const typeB = textFieldType(tb)
  if (typeA !== 'label' || typeB !== 'label') {
    if (typeA === 'number' || typeB === 'number') return typeA === typeB && numericTextCompatible(ta, tb)
    return typeA === typeB || semantic >= 0.45
  }

  // Short stable Chinese labels should not be matched purely by position/topology.
  if (hasCjk(ta) && hasCjk(tb) && Math.min(ta.length, tb.length) <= 4) return semantic >= 0.28
  return semantic >= 0.22
}

function allowsTextPositionFallback(a, b, semantic) {
  if (passesTextSemanticGate(a, b, semantic)) return true
  const ta = normalizeText(a)
  const tb = normalizeText(b)
  if (!ta || !tb) return false
  if (isAmbiguousUnitText(ta) || isAmbiguousUnitText(tb)) return false
  if (hasNumericSignal(ta) || hasNumericSignal(tb)) return false
  if (textFieldType(ta) !== 'label' || textFieldType(tb) !== 'label') return textFieldType(ta) === textFieldType(tb)
  // Longer mock descriptions often differ in content but keep layout and style.
  return Math.min(ta.length, tb.length) >= 5
}

function textRoleMatchScore(dn, an) {
  const roleA = inferTextRole(dn)
  const roleB = inferTextRole(an)
  if (roleA === 'body' || !isCompatibleTextRole(roleA, roleB)) return 0

  const dr = dn.normRect
  const ar = an.normRect
  const dx = Math.abs(dr.x - ar.x)
  const dy = Math.abs(centerY(dr) - centerY(ar))
  const hRatio = sizeRatio(dr.h, ar.h)
  const style = textStyleSimilarity(dn, an)

  if (dx > 0.08 || dy > 0.08 || hRatio < 0.65 || style < 0.72) return 0

  const xScore = Math.max(0, 1 - dx / 0.08)
  const yScore = Math.max(0, 1 - dy / 0.08)
  return xScore * 0.25 + yScore * 0.35 + hRatio * 0.20 + style * 0.20
}

function isStrongTitleSlotMatch(dn, an, score = 0) {
  const roleA = inferTextRole(dn)
  const roleB = inferTextRole(an)
  if (!isTitleLikeRole(roleA) || !isTitleLikeRole(roleB)) return false
  const dx = Math.abs(dn.normRect.x - an.normRect.x)
  const dy = Math.abs(centerY(dn.normRect) - centerY(an.normRect))
  const hRatio = sizeRatio(dn.normRect.h, an.normRect.h)
  const style = textStyleSimilarity(dn, an)
  const maxDx = roleA === 'page-title' ? 0.055 : 0.04
  const maxDy = roleA === 'page-title' ? 0.045 : 0.05
  const minScore = roleA === 'page-title' ? 0.75 : 0.78
  return score >= minScore && dx < maxDx && dy < maxDy && hRatio > 0.80 && style > 0.82
}

function inferTextRole(node) {
  const text = normalizeText(node?.textContent)
  const s = node?.style || {}
  const fontSize = Number(s.fontSize || s.actualFontSize || 0)
  const fontWeight = normalizeFontWeight(s.fontWeight)
  if (!text || textFieldType(text) !== 'label') return 'body'
  if (isTopPageTitleNode(node, text, fontSize, fontWeight)) return 'page-title'
  if (fontSize >= 15 && fontWeight >= 450) return 'title'
  if (fontSize >= 14 && fontWeight >= 400 && text.length >= 5) return 'subtitle'
  return 'body'
}

function isTopPageTitleNode(node, text, fontSize, fontWeight) {
  const r = node?.normRect
  if (!r) return false
  if (hasNumericSignal(text) || isAmbiguousUnitText(text)) return false
  if (text.length > 12) return false
  const topBand = r.y < 0.16 && centerY(r) < 0.20
  const visuallyTitle = fontSize >= 17 || (fontSize >= 15 && fontWeight >= 600)
  return topBand && visuallyTitle
}

function isTitleLikeRole(role) {
  return role === 'page-title' || role === 'title'
}

function isCompatibleTextRole(roleA, roleB) {
  if (roleA === roleB) return true
  return isTitleLikeRole(roleA) && isTitleLikeRole(roleB)
}

function normalizeFontWeight(value) {
  if (value == null) return 400
  if (typeof value === 'number') return value
  const text = String(value).toLowerCase()
  if (text.includes('bold')) return 700
  if (text.includes('medium')) return 500
  const n = Number(text)
  return Number.isFinite(n) ? n : 400
}

function textFieldType(text) {
  if (/^\d{1,2}:\d{2}$/.test(text)) return 'time'
  if (isDurationText(text)) return 'duration'
  if (/^-?\d+(\.\d+)?%$/.test(text)) return 'percent'
  if (/^-?\d+(\.\d+)?°$/.test(text)) return 'temperature'
  if (/^\/?-?\d+(\.\d+)?\s*(w\+|万|k|km|m|kcal|cal|千卡|步|次|小时|分钟|分)?$/i.test(text)) return 'number'
  if (/[年月日周星期]/.test(text) && /\d/.test(text)) return 'date'
  return 'label'
}

function isDurationText(text) {
  const t = normalizeText(text).replace(/\s+/g, '')
  return /^\d+(\.\d+)?(小时|分钟|分|秒)$/.test(t) ||
    /^(\d+(\.\d+)?小时)?\d+(\.\d+)?(分钟|分|秒)$/.test(t)
}

function isAmbiguousUnitText(text) {
  return /^(分钟|小时|天|步|次|分|秒|千卡|kcal|cal|km|m|%|°)$/i.test(normalizeText(text))
}

function hasNumericSignal(text) {
  return /(\d|\/|%|°|千卡|kcal|cal|km|公里|米|m\b|分钟|小时|步|次)/i.test(normalizeText(text))
}

function numericTextCompatible(a, b) {
  const na = normalizeNumericText(a)
  const nb = normalizeNumericText(b)
  if (!na || !nb) return false
  if (na.raw === nb.raw) return true
  if (na.unit !== nb.unit) return false
  return na.value === nb.value && na.prefix === nb.prefix
}

function normalizeNumericText(text) {
  const raw = normalizeText(text).replace(/\s+/g, '')
  const m = raw.match(/^(\/?)(-?\d+(?:\.\d+)?)(w\+|万|k|km|m|kcal|cal|千卡|步|次|小时|分钟|分)?$/i)
  if (!m) return null
  return {
    raw,
    prefix: m[1] || '',
    value: Number(m[2]),
    unit: (m[3] || '').toLowerCase(),
  }
}

function hasCjk(text) {
  return /[\u4e00-\u9fff]/.test(text)
}

function charJaccard(a, b) {
  return setJaccard(new Set([...a]), new Set([...b]))
}

function bigramJaccard(a, b) {
  const grams = (s) => {
    if (s.length <= 1) return new Set([s])
    const result = new Set()
    for (let i = 0; i < s.length - 1; i++) result.add(s.slice(i, i + 2))
    return result
  }
  return setJaccard(grams(a), grams(b))
}

function cjkCommonPrefixScore(a, b) {
  if (!hasCjk(a) || !hasCjk(b)) return 0
  let len = 0
  const max = Math.min(a.length, b.length)
  while (len < max && a[len] === b[len]) len += 1
  if (len < 2) return 0
  const prefixRatio = len / Math.max(a.length, b.length)
  return Math.min(0.62, 0.32 + prefixRatio * 0.42)
}

function colorDistance(c1, c2) {
  const p1 = parseArgb(c1)
  const p2 = parseArgb(c2)
  if (!p1 || !p2) return 180
  return Math.sqrt(
    (p1.a - p2.a) ** 2 +
    (p1.r - p2.r) ** 2 +
    (p1.g - p2.g) ** 2 +
    (p1.b - p2.b) ** 2
  )
}

function parseArgb(hex) {
  if (!hex || typeof hex !== 'string') return null
  const h = hex.replace('#', '')
  if (h.length !== 8) return null
  return {
    a: parseInt(h.slice(0, 2), 16),
    r: parseInt(h.slice(2, 4), 16),
    g: parseInt(h.slice(4, 6), 16),
    b: parseInt(h.slice(6, 8), 16),
  }
}

/** 找综合得分最高的候选（IoU × 尺寸相似度），避免父容器抢占子节点的匹配 */
function bestIoUMatch(targetRect, candidates, targetNode = null, regionContext = null) {
  let best = null
  let bestScore = 0
  for (const n of candidates) {
    const iou = computeIoU(targetRect, n.normRect)
    if (iou <= 0) continue
    const wRatio = Math.min(targetRect.w, n.normRect.w) / Math.max(targetRect.w, n.normRect.w)
    const hRatio = Math.min(targetRect.h, n.normRect.h) / Math.max(targetRect.h, n.normRect.h)
    const regionBonus = targetNode ? regionAffinity(targetNode, n, regionContext) : 0
    const score = iou * wRatio * hRatio * (1 + regionBonus * 0.25)
    if (score > bestScore) {
      bestScore = score
      best = { node: n, iou }
    }
  }
  return best
}

function bestVisualIoUMatch(targetRect, candidates, targetNode = null, regionContext = null) {
  let best = null
  let bestScore = 0
  for (const n of candidates) {
    const iou = computeIoU(targetRect, n.normRect)
    if (iou <= 0) continue
    const wRatio = Math.min(targetRect.w, n.normRect.w) / Math.max(targetRect.w, n.normRect.w)
    const hRatio = Math.min(targetRect.h, n.normRect.h) / Math.max(targetRect.h, n.normRect.h)
    const regionBonus = targetNode ? regionAffinity(targetNode, n, regionContext) : 0
    const visualScore = nodeVisualSimilarity(targetNode, n, regionContext)
    const visualWeight = targetNode?.type === 'image' || n.type === 'image' ? 0.35 : 0.18
    const geometryScore = iou * wRatio * hRatio
    const score = geometryScore * (1 - visualWeight) +
      visualScore * visualWeight +
      regionBonus * 0.08
    if (score > bestScore) {
      bestScore = score
      best = { node: n, iou, visualScore }
    }
  }
  return best
}

function nodeVisualSimilarity(designNode, arkuiNode, regionContext) {
  const features = regionContext?.visualFeatures
  if (!features || !designNode || !arkuiNode) return 0
  const designFeature = features.designNodes?.get(designNode.id)
  const arkuiFeature = features.arkuiNodes?.get(arkuiNode.id)
  return cropSimilarity(designFeature, arkuiFeature)
}

/** 文本内容可能不同，宽度也会随内容变化；位置回退主要看中心点和高度相似度。 */
function bestTextPositionMatch(targetRect, candidates, targetNode = null, regionContext = null) {
  let best = null
  let bestScore = 0
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
    const hRatio = Math.min(targetRect.h, r.h) / Math.max(targetRect.h, r.h)

    const yLimit = targetNode && passesTextSemanticGate(targetNode.textContent, n.textContent, semantic) ? 0.05 : 0.04
    if (dy > yLimit || dx > 0.25 || hRatio < 0.35) continue

    const iou = computeIoU(targetRect, r)
    const yScore = Math.max(0, 1 - dy / yLimit)
    const xScore = Math.max(0, 1 - dx / 0.25)
    const regionBonus = targetNode ? regionAffinity(targetNode, n, regionContext) : 0
    const score = yScore * 0.48 + xScore * 0.22 + hRatio * 0.18 + iou * 0.12 + semantic * 0.16 + regionBonus * 0.05
    if (score > bestScore) {
      bestScore = score
      best = { node: n, iou, score }
    }
  }

  return best
}

/** 计算两个 normRect 的 IoU（Intersection over Union） */
function computeIoU(a, b) {
  const ax2 = a.x + a.w, ay2 = a.y + a.h
  const bx2 = b.x + b.w, by2 = b.y + b.h

  const interX1 = Math.max(a.x, b.x)
  const interY1 = Math.max(a.y, b.y)
  const interX2 = Math.min(ax2, bx2)
  const interY2 = Math.min(ay2, by2)

  if (interX2 <= interX1 || interY2 <= interY1) return 0

  const inter = (interX2 - interX1) * (interY2 - interY1)
  const areaA = a.w * a.h
  const areaB = b.w * b.h
  const union = areaA + areaB - inter

  return union <= 0 ? 0 : inter / union
}

function rectIntersectionArea(a, b) {
  const interX1 = Math.max(a.x, b.x)
  const interY1 = Math.max(a.y, b.y)
  const interX2 = Math.min(a.x + a.w, b.x + b.w)
  const interY2 = Math.min(a.y + a.h, b.y + b.h)
  if (interX2 <= interX1 || interY2 <= interY1) return 0
  return (interX2 - interX1) * (interY2 - interY1)
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
}

/** 判断节点是否有实质装饰（非透明背景色、圆角、渐变、描边或效果） */
function hasVisualDecoration(node) {
  const s = node.style || {}
  return !!(s.backgroundColor || s.borderRadius || s.border || s.gradient || s.shadow || s.backdropBlur || s.blur)
}

function isMatchableNode(node) {
  return !!(node?.visible && !node.visualOccluded && !node.iconFragment && node.rect?.w > 4 && node.rect?.h > 4)
}

function hasUsableText(node) {
  return !!String(node?.textContent || '').trim()
}

function isCompatibleType(designNode, arkuiNode) {
  if (designNode.type === 'text') return arkuiNode.type === 'text'
  if (designNode.type === arkuiNode.type) return true
  if (designNode.type === 'image') return arkuiNode.type === 'other'
  if (designNode.type === 'shape') return arkuiNode.type === 'container' || arkuiNode.type === 'other'
  if (designNode.type === 'other') return arkuiNode.type !== 'text'
  return false
}
