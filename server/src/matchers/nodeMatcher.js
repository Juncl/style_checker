import {
  makePair,
  matchRegionTextOptimal,
  matchByAnchorTopology,
  bestTextRoleMatch,
  bestTextPositionMatch,
  bestIoUMatch,
} from './matchStrategies.js'
import { matchAllTextNodes } from './allTextMatcher.js'
import { yDistance, xDistance, computeIoU, sizeRatio } from '../utils/matchGeometry.js'
import {
  textStyleSimilarity,
  hasUsableText,
  isStrongTitleSlotMatch,
  textSemanticSimilarity,
  passesTextSemanticGate,
  normalizeText,
  textFieldType,
  numericTextCompatible,
} from '../utils/textSemantics.js'
import {
  isComparableOutputNode,
  isCompatibleType,
  isAcceptablePair,
  hasBackgroundColor,
  hasVisualDecoration,
  isRenderableNonTextNode,
} from '../utils/nodeVisibility.js'
import {
  segmentRegions,
  buildRegionContext,
  candidatePool,
  annotatePairsWithRegions,
  formatRegionForOutput,
} from './regionContext.js'
import { comparePaths } from '../utils/pathOrder.js'
import { matchAlignedTextRows, matchDynamicTextSlots } from './dynamicTextSlots.js'
import { matchByListIndex } from './listIndexMatcher.js'

/**
 * 节点匹配器
 * Pass 1: 全文本节点加权匹配（matchAllTextNodes），可信文本视为强锚点
 * Pass 2: 匹配区域内文本节点全局最优匹配
 * Pass 3: 基于强锚点周边拓扑关系匹配弱节点
 * Pass 4: 文本位置回退匹配
 * Pass 4.5: 同行同类 list 顺序匹配（rawType 严格相同 + 上下邻居互证 + 首节点 IoU）
 * Pass 5: 几何 IoU 匹配（容器节点）
 * Pass 6: 非文本视觉容器几何匹配
 * Pass 7: 低置信度兜底匹配
 */

/**
 * 主入口：将 design 节点与 arkui 节点两两配对
 *
 * Pass 1 起以 ArkUI 为主序的全文本加权匹配，方向固定；不再支持 design-first /
 * arkui-first 双向切换（matchDirection 参数与 STYLE_CHECKER_MATCH_DIRECTION 已失效）。
 * @returns {{ pairs: MatchPair[], unmatchedDesign: Node[], unmatchedArkui: Node[] }}
 */
export function matchNodes(designNodes, arkuiNodes, options = {}) {
  return matchNodesDesignFirst(designNodes, arkuiNodes, options)
}

function matchNodesDesignFirst(designNodes, arkuiNodes, options = {}) {
  const { canvasWidthVp, canvasHeightVp, canvasWidth, canvasHeight } = options
  const usedArkui = new Set()
  const pairs = []
  const matchedDesignIds = new Set()
  const strongAnchors = []
  const topologyAnchors = []
  const designRegions = segmentRegions(designNodes, 'design')
  const arkuiRegions = segmentRegions(arkuiNodes, 'arkui')
  let regionContext = null

  // ── Pass 1: 全文本节点加权匹配（ArkUI 主序，可信文本 ≥0.9 视为强锚点）──────────
  const textMatchResult = matchAllTextNodes(designNodes, arkuiNodes, {
    canvasWidthVp, canvasHeightVp, canvasWidth, canvasHeight,
  })
  for (const pair of textMatchResult.pairs) {
    pairs.push(pair)
    usedArkui.add(pair.arkui.id)
    matchedDesignIds.add(pair.design.id)
    // 可信文本即强锚点，同时驱动区域切割（strongAnchors）和拓扑匹配（topologyAnchors）
    strongAnchors.push(pair)
    topologyAnchors.push(pair)
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
    if (matchedDesignIds.has(dn.id) || dn.type !== 'text' || !hasUsableText(dn)) continue
    const candidates = candidatePool(dn, arkuiNodes, regionContext, n =>
      n.type === 'text' && hasUsableText(n) && !usedArkui.has(n.id)
    )
    const best = bestTextRoleMatch(dn, candidates)
    if (best && (best.score >= 0.85 || isStrongTitleSlotMatch(dn, best.node, best.score))) {
      pairs.push(makePair(dn, best.node, 'text-role', {
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

  // ── Pass 4.5: 同行同类 list 顺序匹配 ─────────────────────────────────────
  // 两侧分别识别同行 + rawType 严格相同的 list（≥2 个），并通过
  // y 接近 + 上下邻居互为同一 pair + 首节点 IoU 验证后，按 x 升序锁定前 N 对。
  // 不看 IoU 分数，避免横向列表中"溢出节点"被 IoU 抢走匹配。
  {
    const listPairs = matchByListIndex(designNodes, arkuiNodes, pairs)
    for (const pair of listPairs) {
      pairs.push(pair)
      usedArkui.add(pair.arkui.id)
      matchedDesignIds.add(pair.design.id)
    }
  }

  // ── Pass 5: 文本节点位置回退匹配（处理 mock 数据与真实数据不一致）──────────────
  for (const dn of designNodes) {
    if (matchedDesignIds.has(dn.id) || dn.type !== 'text' || !hasUsableText(dn)) continue
    const candidates = candidatePool(dn, arkuiNodes, regionContext, n =>
      n.type === 'text' && hasUsableText(n) && !usedArkui.has(n.id)
    )
    const best = bestTextPositionMatch(dn.normRect, candidates, dn, regionContext)
    if (best && best.score > 0.35) {
      pairs.push(makePair(dn, best.node, 'text-position', {
        confidence: 'medium',
      }))
      usedArkui.add(best.node.id)
      matchedDesignIds.add(dn.id)
    }
  }

  // ── Pass 5b: 数字槽位匹配（mock 整数与实际整数数值不同，但位置与样式一致）─────
  for (const dn of designNodes) {
    if (matchedDesignIds.has(dn.id) || dn.type !== 'text') continue
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
    if (matchedDesignIds.has(dn.id)) continue
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
    if (matchedDesignIds.has(dn.id)) continue
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

  // ── Pass 6.5: 空间担保匹配 ─────────────────────────────────────────────────
  // 当已匹配对从左右两侧夹住候选节点（两侧方向一致），且尺寸吻合时，确认该匹配。
  // 适用于因画布宽度差异导致 IoU=0 但位置关系明确的小型容器/图标节点。
  {
    const previewPairs = selectOneToOnePairs(pairs.filter(isAcceptablePair))
    const previewUsedDesign = new Set(previewPairs.map(p => p.design.id))
    const previewUsedArkui  = new Set(previewPairs.map(p => p.arkui.id))

    const bracketCandidates = []

    for (const dn of designNodes) {
      if (previewUsedDesign.has(dn.id)) continue
      if (dn.type !== 'container') continue

      const dnCX = dn.normRect.x + dn.normRect.w / 2
      const dnCY = dn.normRect.y + dn.normRect.h / 2

      const sameRowPairs = previewPairs.filter(p => {
        const pDCY = p.design.normRect.y + p.design.normRect.h / 2
        const pACY = p.arkui.normRect.y  + p.arkui.normRect.h  / 2
        return Math.abs(pDCY - dnCY) < 0.08 && Math.abs(pACY - dnCY) < 0.08
      })

      const leftBrackets = sameRowPairs.filter(p =>
        p.design.normRect.x + p.design.normRect.w <= dnCX
      )
      const rightBrackets = sameRowPairs.filter(p =>
        p.design.normRect.x >= dnCX
      )
      if (leftBrackets.length === 0 || rightBrackets.length === 0) continue

      const bestLeft = leftBrackets.reduce((best, p) =>
        (dnCX - (p.design.normRect.x + p.design.normRect.w)) <
        (dnCX - (best.design.normRect.x + best.design.normRect.w)) ? p : best
      )
      const bestRight = rightBrackets.reduce((best, p) =>
        (p.design.normRect.x - dnCX) < (best.design.normRect.x - dnCX) ? p : best
      )

      // 左右两个担保对本身必须在同一行（design 侧互相对齐，arkui 侧互相对齐）
      const blDCY = bestLeft.design.normRect.y  + bestLeft.design.normRect.h  / 2
      const brDCY = bestRight.design.normRect.y + bestRight.design.normRect.h / 2
      const blACY = bestLeft.arkui.normRect.y   + bestLeft.arkui.normRect.h   / 2
      const brACY = bestRight.arkui.normRect.y  + bestRight.arkui.normRect.h  / 2
      if (Math.abs(blDCY - brDCY) > 0.06) continue
      if (Math.abs(blACY - brACY) > 0.06) continue

      for (const an of arkuiNodes) {
        if (previewUsedArkui.has(an.id)) continue
        if (an.type !== 'container') continue
        if (Math.min(sizeRatio(dn.normRect.w, an.normRect.w), sizeRatio(dn.normRect.h, an.normRect.h)) < 0.5) continue

        const anCX = an.normRect.x + an.normRect.w / 2
        const anCY = an.normRect.y + an.normRect.h / 2

        // 候选节点本身 y 轴不能相差太远
        if (Math.abs(anCY - dnCY) > 0.05) continue

        // 两个担保对的 arkui 侧也必须与 an 同行
        const leftArkuiCY  = bestLeft.arkui.normRect.y  + bestLeft.arkui.normRect.h  / 2
        const rightArkuiCY = bestRight.arkui.normRect.y + bestRight.arkui.normRect.h / 2
        if (Math.abs(anCY - leftArkuiCY)  > 0.08) continue
        if (Math.abs(anCY - rightArkuiCY) > 0.08) continue

        // 开发侧也必须被同一担保对的 ArkUI 节点从左右夹住
        if (bestLeft.arkui.normRect.x + bestLeft.arkui.normRect.w > anCX) continue
        if (bestRight.arkui.normRect.x < anCX) continue

        const score = sizeRatio(dn.normRect.w, an.normRect.w) * 0.5 +
                      sizeRatio(dn.normRect.h, an.normRect.h) * 0.5
        bracketCandidates.push({
          dn, an,
          confidence: lowerConfidence(bestLeft.confidence, bestRight.confidence),
          score,
        })
      }
    }

    bracketCandidates.sort((a, b) => b.score - a.score)
    const usedBracketDesign = new Set()
    const usedBracketArkui  = new Set()
    for (const { dn, an, confidence, score } of bracketCandidates) {
      if (usedBracketDesign.has(dn.id) || usedBracketArkui.has(an.id)) continue
      pairs.push(makePair(dn, an, 'spatial-bracket', { confidence, topologyScore: score }))
      usedArkui.add(an.id)
      matchedDesignIds.add(dn.id)
      usedBracketDesign.add(dn.id)
      usedBracketArkui.add(an.id)
    }
  }

  // ── Pass 7: Rescue Pass，保留低置信度标签，供前端和评分识别 ────────────────
  for (const dn of designNodes) {
    if (matchedDesignIds.has(dn.id)) continue
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
    // 新版 Pass 1 全文本加权匹配明细，供后续前端可视化 / 调试使用
    textMatch: {
      textHmMapPix: textMatchResult.textHmMapPix,
      textHmMapPixCredible: textMatchResult.textHmMapPixCredible,
      textHmMapPixDetail: textMatchResult.textHmMapPixDetail,
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

    const designOrderDelta = comparePaths(a.design.path, b.design.path)
    if (designOrderDelta !== 0) return designOrderDelta

    return comparePaths(a.arkui.path, b.arkui.path)
  })

  for (const pair of sorted) {
    if (usedDesign.has(pair.design.id) || usedArkui.has(pair.arkui.id)) continue
    selected.push(pair)
    usedDesign.add(pair.design.id)
    usedArkui.add(pair.arkui.id)
  }

  return selected.sort((a, b) => comparePaths(a.design.path, b.design.path))
}

function pairPriority(pair) {
  const confidenceScore = pair.confidence === 'high' ? 300 : pair.confidence === 'medium' ? 200 : 100
  const anchorScore = pair.isAnchor ? 25 : 0
  const typeScore = matchTypePriority(pair.matchType)
  const topologyScore = (pair.topologyScore ?? 0) * 10
  const isTextPair = pair.design?.type === 'text' && pair.arkui?.type === 'text'
  const iouScore = isTextPair ? 0 : (pair.iou ?? 0) * 8
  return confidenceScore + anchorScore + typeScore + topologyScore + iouScore
}

function backgroundMatchPriority(pair) {
  return hasBackgroundColor(pair.design) === hasBackgroundColor(pair.arkui) ? 1 : 0
}

function lowerConfidence(a, b) {
  const rank = { high: 2, medium: 1, low: 0 }
  return rank[a] <= rank[b] ? a : b
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
    'list-index': 18.5,
    'container-iou': 18,
    'spatial-bracket': 16,
    'container-geometry': 14,
    'region-text-global-rescue': 8,
    'rescue-iou': 2,
  }
  return order[matchType] ?? 0
}
