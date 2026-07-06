import { matchAllTextNodes } from './pass1.js'
import { matchByAnchorContain } from './pass1_5.js'
import { matchRemainingNodes } from './pass2.js'
import { validateByAnchors } from './pass3.js'
import {
  segmentRegions,
  buildRegionContext,
  annotatePairsWithRegions,
  formatRegionForOutput,
} from '../regionContext.js'
import {
  isComparableOutputNode,
  isAcceptablePair,
  hasBackgroundColor,
} from '../../utils/nodeVisibility.js'
import { isCanvasRoot } from '../../utils/deduplicateRootNodes.js'
import { comparePaths } from '../../utils/pathOrder.js'

export function matchNodes(designNodes, devNodes, options = {}) {
  const { canvasWidthVp, canvasHeightVp, canvasWidth, canvasHeight, nodeNumStatus = 'all' } = options

  if (nodeNumStatus !== 'part') {
    designNodes = [...designNodes].filter(n => !isCanvasRoot(n, canvasWidth, canvasHeight))
    devNodes    = [...devNodes].filter(n => !isCanvasRoot(n, canvasWidthVp, canvasHeightVp))
  }

  const usedDev = new Set()
  const matchedDesignIds = new Set()
  const pairs = []
  const strongAnchors = {}
  const collectAnchors = (whitelist) =>
    (whitelist ?? Object.keys(strongAnchors)).flatMap(k => strongAnchors[k] ?? [])

  const designRegions = segmentRegions(designNodes, 'design')
  const devRegions    = segmentRegions(devNodes, 'arkui')

  // Pass 1: 全文本加权匹配
  const textMatchResult = matchAllTextNodes(designNodes, devNodes, {
    canvasWidthVp, canvasHeightVp, canvasWidth, canvasHeight,
  })
  for (const pair of textMatchResult.pairs) {
    pairs.push(pair)
    usedDev.add(pair.arkui.id)
    matchedDesignIds.add(pair.design.id)
    ;(strongAnchors['text-锚点'] ??= []).push(pair)
  }

  // Pass 1.5: 包含容器匹配
  const pass15Anchors = collectAnchors()
  if (pass15Anchors.length > 0) {
    const diagDev = Math.hypot(canvasWidthVp ?? 376, canvasHeightVp ?? 809)
    const diagDe  = Math.hypot(canvasWidth ?? 360, canvasHeight ?? 947)
    const fallback = Math.max(diagDe, diagDev)
    const ctx15 = {
      maxDiag:   Math.max(diagDe, diagDev),
      rootRectH: Math.max(canvasHeightVp ?? 809, canvasHeight ?? 947),
      diag:      (diagDe + diagDev) / 2,
      rootW:     ((canvasWidthVp ?? 376) + (canvasWidth ?? 360)) / 2 || fallback,
      rootMaxH:  Math.max(canvasHeightVp ?? 809, canvasHeight ?? 947),
    }
    const containPairs = matchByAnchorContain(
      pass15Anchors,
      devNodes.filter(n => !usedDev.has(n.id)),
      designNodes.filter(n => !matchedDesignIds.has(n.id)),
      ctx15
    )
    for (const pair of containPairs) {
      pairs.push(pair)
      usedDev.add(pair.arkui.id)
      matchedDesignIds.add(pair.design.id)
      if (pair.confidence === 'high') (strongAnchors[pair.matchDetail.type] ??= []).push(pair)
    }
  }

  // Pass 2: 剩余节点兜底匹配（文本复用 pass1 分数，非文本用几何相似性）
  const pass2Ctx = { canvasWidthVp, canvasHeightVp, canvasWidth, canvasHeight }
  const pass2Pairs = matchRemainingNodes(
    devNodes.filter(n => !usedDev.has(n.id)),
    designNodes.filter(n => !matchedDesignIds.has(n.id)),
    textMatchResult,
    pass2Ctx
  )
  for (const pair of pass2Pairs) {
    pairs.push(pair)
    usedDev.add(pair.arkui.id)
    matchedDesignIds.add(pair.design.id)
  }

  // Pass 3: 锚点一致性校验，剔除不可信中低置信 pairs，入盲匹配
  const highPairs        = pairs.filter(p => p.confidence === 'high')
  const candidatePairs   = pairs.filter(p => p.confidence !== 'high')
  const devTextUnmatched = devNodes.filter(n => !usedDev.has(n.id) && n.type === 'text')
  const designPool       = designNodes.filter(n => !matchedDesignIds.has(n.id))

  const { trustedPairs, untrustedPairs, blindMatchPairs } = validateByAnchors(
    highPairs, candidatePairs, devTextUnmatched, designPool, textMatchResult, pass2Ctx
  )
  for (const p of untrustedPairs) {
    usedDev.delete(p.arkui.id)
    matchedDesignIds.delete(p.design.id)
  }
  pairs.splice(0, pairs.length, ...highPairs, ...trustedPairs, ...blindMatchPairs)
  for (const pair of blindMatchPairs) {
    usedDev.add(pair.arkui.id)
    matchedDesignIds.add(pair.design.id)
  }

  const regionContext = buildRegionContext(designRegions, devRegions, collectAnchors())

  annotatePairsWithRegions(pairs, regionContext)
  const acceptedPairs = selectOneToOnePairs(pairs.filter(isAcceptablePair))

  const matchedDesignSet = new Set(acceptedPairs.map(p => p.design.id))
  const acceptedDevIds   = new Set(acceptedPairs.map(p => p.arkui.id))
  const comparableDesignNodes = designNodes.filter(isComparableOutputNode)
  const comparableDevNodes    = devNodes.filter(isComparableOutputNode)

  return {
    pairs: acceptedPairs,
    unmatchedDesign:       comparableDesignNodes.filter(n => !matchedDesignSet.has(n.id)),
    unmatchedArkui:        comparableDevNodes.filter(n => !acceptedDevIds.has(n.id)),
    comparableDesignCount: comparableDesignNodes.length,
    comparableArkuiCount:  comparableDevNodes.length,
    regions: {
      design: designRegions.map(formatRegionForOutput),
      arkui:  devRegions.map(formatRegionForOutput),
      pairs:  regionContext?.regionPairs || [],
    },
    textMatch: {
      textHmMapPix:         textMatchResult.textHmMapPix,
      textHmMapPixCredible: textMatchResult.textHmMapPixCredible,
      textHmMapPixDetail:   textMatchResult.textHmMapPixDetail,
    },
  }
}

// copy 自 nodeMatcher.js（matchers 目录）
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
  const order = {
    'text-锚点':        40,
    'text-con-包含':    32,
    'text-con-web匹配': 16,
    'text-con-盲匹配':  12,
  }
  return order[matchType] ?? 0
}
