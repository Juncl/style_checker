import {
  makePair,
  matchRegionTextOptimal,
  bestTextRoleMatch,
  bestIoUMatch,
} from './matchStrategies.js'
import { matchByAnchorTopology } from './anchorTopology.js'
import { matchAllTextNodes } from './allTextMatcher.js'
import { computeIoU } from '../utils/matchGeometry.js'
import {
  textStyleSimilarity,
  hasUsableText,
  isStrongTitleSlotMatch,
  textSemanticSimilarity,
  normalizeText,
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
import { isCanvasRoot } from '../utils/deduplicateRootNodes.js'
import { matchAlignedTextRows, matchDynamicTextSlots } from './dynamicTextSlots.js'
import { matchLongTextFallback } from './longTextFallback.js'
import { matchByListIndex } from './listIndexMatcher.js'


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

  // 去掉两侧的画布根节点，不参与匹配（背景层没有对应还原元素）
  designNodes = designNodes.filter(n => !isCanvasRoot(n, canvasWidth, canvasHeight))
  arkuiNodes = arkuiNodes.filter(n => !isCanvasRoot(n, canvasWidthVp, canvasHeightVp))

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

  // ── Pass 2.1/2.2: 动态数字/时间星期槽位匹配（mock 与真实数据不同，但序列位置一致）──
  const dynamicSlotPairs = matchDynamicTextSlots(
    designNodes,
    arkuiNodes,
    usedArkui,
    matchedDesignIds,
    regionContext,
    { canvasWidthVp, canvasHeightVp, canvasWidth, canvasHeight }
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
    regionContext,
    { canvasWidthVp, canvasHeightVp, canvasWidth, canvasHeight, anchors: strongAnchors }
  )
  for (const pair of rowSlotPairs) {
    pairs.push(pair)
    usedArkui.add(pair.arkui.id)
    matchedDesignIds.add(pair.design.id)
    if (pair.topologyScore >= 0.86) topologyAnchors.push(pair)
  }

  // ── Pass 2.4: 长文本位置-样式兜底（字数 > 12，锚点方向一票否决）──────────────
  const longTextPairs = matchLongTextFallback(
    designNodes, arkuiNodes, usedArkui, matchedDesignIds, topologyAnchors,
    { canvasWidthVp, canvasHeightVp, canvasWidth, canvasHeight }
  )
  for (const pair of longTextPairs) {
    pairs.push(pair)
  }

  // ── Pass 2.5: 文本语义角色匹配（动态标题/副标题内容不同，但组件槽位一致）────
  for (const dn of designNodes) {
    if (matchedDesignIds.has(dn.id) || dn.type !== 'text' || !hasUsableText(dn)) continue
    const candidates = candidatePool(dn, arkuiNodes, regionContext, n =>
      n.type === 'text' && hasUsableText(n) && !usedArkui.has(n.id)
    )
    const best = bestTextRoleMatch(dn, candidates)
    if (best && (best.score >= 0.85 || isStrongTitleSlotMatch(dn, best.node, best.score))) {
      const rolePair = makePair(dn, best.node, 'text-角色', {
        confidence: 'high',
        topologyScore: best.score,
      })
      pairs.push(rolePair)
      usedArkui.add(best.node.id)
      matchedDesignIds.add(dn.id)
      topologyAnchors.push(rolePair)
    }
  }

  // ── Pass 3: 强锚点周边拓扑匹配（用局部相对位置匹配 mock 文本、图标、形状）──────
  if (topologyAnchors.length > 0) {
    const diagHm = Math.hypot(canvasWidthVp ?? 376, canvasHeightVp ?? 809)
    const diagDe = Math.hypot(canvasWidth ?? 360, canvasHeight ?? 947)
    const diagonal = (diagHm + diagDe) / 2
    const topologyPairs = matchByAnchorTopology(
      designNodes,
      arkuiNodes,
      topologyAnchors,
      usedArkui,
      matchedDesignIds,
      regionContext,
      { diagonal, diagDe, diagHm, canvasHeightVp: canvasHeightVp ?? 809, canvasHeight: canvasHeight ?? 947, canvasWidthVp: canvasWidthVp ?? 376, canvasWidth: canvasWidth ?? 360 }
    )
    for (const pair of topologyPairs) {
      pairs.push(pair)
      usedArkui.add(pair.arkui.id)
      matchedDesignIds.add(pair.design.id)
    }
  }

  // ── Pass 3.5: 同行同类 list 顺序匹配 ─────────────────────────────────────
  // 在 Pass 3（拓扑匹配）之后运行，按序号顺序执行。
  // 用强锚点（topologyAnchors）作为上/下邻居验证，按 x 升序对齐横向列表。
  // confidence=medium，不锁节点，交由 selectOneToOnePairs 最终裁决。
  {
    const listPairs = matchByListIndex(designNodes, arkuiNodes, topologyAnchors, { canvasWidthVp, canvasHeightVp, canvasWidth, canvasHeight })
    for (const pair of listPairs) {
      pairs.push(pair)
    }
  }

  // ── Pass 4: 区域内文本节点全局最优匹配 ────────────────────────────────────
  // 在拓扑(Pass 3)/list(Pass 3.5)都跑完后，仅对剩余未匹配文本做区域内全局最优收尾。
  // 注意：此处晚于 Pass 3，topologyAnchors 已被消费完，下面这句 push 不再供锚。
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

  // ── Pass 5.3: 几何 IoU 匹配容器节点 ────────────────────────────────────────
  for (const dn of designNodes) {
    if (matchedDesignIds.has(dn.id)) continue
    if (dn.type !== 'container') continue

    const candidates = candidatePool(dn, arkuiNodes, regionContext, n =>
      n.type === 'container'
    )
    const best = bestIoUMatch(dn.normRect, candidates, dn, regionContext)
    const threshold = hasVisualDecoration(dn) ? 0.40 : 0.60
    if (best && best.iou > threshold) {
      pairs.push(makePair(dn, best.node, 'con-交叠', {
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
      pairs.push(makePair(dn, best.node, 'con-视觉', {
        iou: best.iou,
        confidence: 'medium',
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
  const typeScore = matchTypePriority(pair.matchDetail?.type)
  const topologyScore = (pair.topologyScore ?? 0) * 10
  const isTextPair = pair.design?.type === 'text' && pair.arkui?.type === 'text'
  const iouScore = isTextPair ? 0 : (pair.iou ?? 0) * 8
  return confidenceScore + anchorScore + typeScore + topologyScore + iouScore
}

function backgroundMatchPriority(pair) {
  return hasBackgroundColor(pair.design) === hasBackgroundColor(pair.arkui) ? 1 : 0
}

function matchTypePriority(matchType) {
  if (['text-con-包含', 'text-con-方向x', 'text-con-方向y', 'text-con-自由'].includes(matchType)) return 24
  const order = {
    'text-锚点': 40,
    'text-区域优选': 34,
    'text-角色': 30,
    'text-时间槽': 22,
    'text-同行': 21,
    'text-con-列表': 18.5,
    'con-交叠': 18,
    'con-视觉': 14,
    'text-区域兜底': 8,
  }
  return order[matchType] ?? 0
}
