import { centerY, rectCenter, sizeRatio, xDistance } from '../utils/matchGeometry.js'
import { makePair } from './matchStrategies.js'
import { candidatePool, regionAffinity } from './regionContext.js'
import {
  hasUsableText,
  isAmbiguousShortNumberText,
  isNearSameLineSlot,
  normalizeText,
  textFieldType,
  textStyleSimilarity,
} from '../utils/textSemantics.js'

// Time / weekday are "value slots" whose displayed内容 may change between design
// mock and runtime data while the layout relationship stays stable.
const SLOT_TYPES = new Set(['time', 'weekday'])

// 🔴 全程使用绝对坐标 rect（vp/dp），不碰 normRect（见 CLAUDE.md 坐标系统硬性规则）。
// 跨侧 dx/dy 截断阈值按画布尺寸换算（×W / ×H，统一以 arkui 画布为基准）；
// 同侧行聚类阈值用固定 vp 常量（本质是行高量级的绝对物理距离）。
const ROW_CLUSTER_TOL = 14   // textRows 同行聚类容差（绝对 vp，≈0.018×809）
const LINE_Y_TOL      = 28   // readingOrder 同行判定容差（绝对 vp，≈0.035×809）

function dims(opts = {}) {
  return {
    W: opts.canvasWidthVp ?? 376,
    H: opts.canvasHeightVp ?? 809,
    designH: opts.canvasHeight ?? 947,
  }
}

export function matchDynamicTextSlots(designNodes, arkuiNodes, usedArkui, matchedDesignIds, regionContext, opts = {}) {
  const d = dims(opts)
  const result = []
  const localUsedArkui = new Set()
  const localMatchedDesign = new Set()

  const numberPairs = matchDynamicNumberSlots(
    designNodes,
    arkuiNodes,
    usedArkui,
    matchedDesignIds,
    regionContext,
    d
  )
  for (const pair of numberPairs) {
    result.push(pair)
    localMatchedDesign.add(pair.design.id)
    localUsedArkui.add(pair.arkui.id)
  }

  for (const slotType of SLOT_TYPES) {
    const designTexts = slotCandidates(designNodes, slotType, matchedDesignIds, localMatchedDesign)
    const arkuiTexts = slotCandidates(arkuiNodes, slotType, usedArkui, localUsedArkui)
    if (!designTexts.length || !arkuiTexts.length) continue

    const matches = orderedSlotAssignment(designTexts, arkuiTexts, regionContext, d)
    for (const match of matches) {
      if (match.score < 0.58) continue
      result.push(makePair(match.design, match.arkui, 'text-时间槽', {
        iou: 0,
        confidence: match.score > 0.72 ? 'medium' : 'low',
        topologyScore: match.score,
      }))
      localMatchedDesign.add(match.design.id)
      localUsedArkui.add(match.arkui.id)
    }
  }

  return result
}

function matchDynamicNumberSlots(designNodes, arkuiNodes, usedArkui, matchedDesignIds, regionContext, d) {
  const result = []
  const localUsedArkui = new Set()
  const localMatchedDesign = new Set()
  const designNumbers = slotCandidates(designNodes, 'number', matchedDesignIds, localMatchedDesign)
  if (!designNumbers.length) return result

  for (const dn of designNumbers) {
    const candidates = candidatePool(dn, arkuiNodes, regionContext, n =>
      n.type === 'text' &&
      hasUsableText(n) &&
      !usedArkui.has(n.id) &&
      !localUsedArkui.has(n.id) &&
      textFieldType(String(n.textContent || '').trim().toLowerCase()) === 'number'
    )
    const best = bestNumericSlotMatch(dn, candidates, regionContext, d)
    if (!best || best.score < 0.70) continue
    result.push(makePair(dn, best.node, 'text-数字槽', {
      iou: 0,
      confidence: best.score > 0.82 ? 'medium' : 'low',
      topologyScore: best.score,
    }))
    localMatchedDesign.add(dn.id)
    localUsedArkui.add(best.node.id)
  }

  return result
}

export function matchAlignedTextRows(designNodes, arkuiNodes, usedArkui, matchedDesignIds, regionContext, opts = {}) {
  const d = dims(opts)
  const result = []
  const localUsedArkui = new Set()
  const localMatchedDesign = new Set()
  const designRows = textRows(designNodes, matchedDesignIds, localMatchedDesign, d.designH)
  const arkuiRows = textRows(arkuiNodes, usedArkui, localUsedArkui, d.H)

  for (const dRow of designRows) {
    const availableArkuiRows = arkuiRows
      .map(row => ({ ...row, nodes: row.nodes.filter(n => !localUsedArkui.has(n.id)) }))
      .filter(row => row.nodes.length >= 2)
    const aRow = bestRow(dRow, availableArkuiRows, d.H)
    if (!aRow) continue
    const matches = orderedSlotAssignment(dRow.nodes, aRow.nodes, regionContext, d)
    for (const match of matches) {
      if (match.score < 0.50) continue
      result.push(makePair(match.design, match.arkui, 'text-同行', {
        iou: 0,
        confidence: match.score > 0.76 ? 'medium' : 'low',
        topologyScore: match.score,
      }))
      localMatchedDesign.add(match.design.id)
      localUsedArkui.add(match.arkui.id)
    }
  }

  return result
}

function slotCandidates(nodes, slotType, usedIds, localUsedIds) {
  return nodes
    .filter(n =>
      n.type === 'text' &&
      hasUsableText(n) &&
      isSlotVisibleEnough(n) &&
      !usedIds.has(n.id) &&
      !localUsedIds.has(n.id) &&
      textFieldType(String(n.textContent || '').trim().toLowerCase()) === slotType
    )
    .sort(readingOrder)
}

function textRows(nodes, usedIds, localUsedIds, canvasH) {
  const rows = []
  const candidates = nodes
    .filter(n =>
      n.type === 'text' &&
      hasUsableText(n) &&
      isSlotVisibleEnough(n) &&
      isRowSlotText(n) &&
      !usedIds.has(n.id) &&
      !localUsedIds.has(n.id)
    )
    .sort(readingOrder)

  for (const node of candidates) {
    const y = centerY(node.rect)
    if (y < 0.26 * canvasH) continue   // 跳过画布顶部 26%（状态栏/标题区）
    let row = rows.find(r => Math.abs(r.y - y) < ROW_CLUSTER_TOL)
    if (!row) {
      row = { y, nodes: [] }
      rows.push(row)
    }
    row.nodes.push(node)
    row.y = row.nodes.reduce((sum, n) => sum + centerY(n.rect), 0) / row.nodes.length
  }

  return rows
    .map(row => ({ ...row, nodes: row.nodes.sort(readingOrder) }))
    .filter(row => row.nodes.length >= 2)
}

function bestRow(dRow, arkuiRows, H) {
  let best = null
  let bestScore = 0
  const yMax = 0.08 * H
  for (const aRow of arkuiRows) {
    const dy = Math.abs(dRow.y - aRow.y)
    if (dy > yMax) continue
    const countScore = Math.min(dRow.nodes.length, aRow.nodes.length) / Math.max(dRow.nodes.length, aRow.nodes.length)
    const xScore = rowXOverlapScore(dRow.nodes, aRow.nodes)
    const score = (1 - dy / yMax) * 0.45 + countScore * 0.20 + xScore * 0.35
    if (score > bestScore) {
      bestScore = score
      best = aRow
    }
  }
  return bestScore >= 0.52 ? best : null
}

function isRowSlotText(node) {
  const text = String(node.textContent || '').trim()
  if (SLOT_TYPES.has(textFieldType(text.toLowerCase()))) return true
  return /^[一-鿿]{2,4}$/.test(text)
}

function isSlotVisibleEnough(node) {
  if (node.source !== 'arkui') return true
  const visibility = node.pixelVisibility || {}
  if (node.pixelInvisible) return false
  const visibleRatio = visibility.visiblePixelRatio ?? 0
  const strokeScore = visibility.textStrokeScore ?? 0
  return visibleRatio >= 0.12 || strokeScore >= 0.09
}

function rowXOverlapScore(aNodes, bNodes) {
  const ax1 = Math.min(...aNodes.map(n => n.rect.x))
  const ax2 = Math.max(...aNodes.map(n => n.rect.x + n.rect.w))
  const bx1 = Math.min(...bNodes.map(n => n.rect.x))
  const bx2 = Math.max(...bNodes.map(n => n.rect.x + n.rect.w))
  const overlap = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1))
  const span = Math.max(ax2, bx2) - Math.min(ax1, bx1)
  return span ? overlap / span : 0
}

function orderedSlotAssignment(designTexts, arkuiTexts, regionContext, d) {
  const designOrder = orderMap(designTexts)
  const arkuiOrder = orderMap(arkuiTexts)
  const score = Array.from({ length: designTexts.length }, () => new Array(arkuiTexts.length).fill(0))

  for (let di = 0; di < designTexts.length; di++) {
    for (let ai = 0; ai < arkuiTexts.length; ai++) {
      score[di][ai] = slotScore(designTexts[di], arkuiTexts[ai], designOrder, arkuiOrder, designTexts.length, arkuiTexts.length, regionContext, d)
    }
  }

  const memo = new Map()
  const choice = new Map()
  function solve(di, ai) {
    if (di >= designTexts.length || ai >= arkuiTexts.length) return 0
    const key = `${di}:${ai}`
    if (memo.has(key)) return memo.get(key)
    let best = solve(di + 1, ai)
    let bestChoice = 'skipD'
    const skipA = solve(di, ai + 1)
    if (skipA > best) {
      best = skipA
      bestChoice = 'skipA'
    }
    if (score[di][ai] >= 0.45) {
      const take = score[di][ai] + solve(di + 1, ai + 1)
      if (take > best) {
        best = take
        bestChoice = 'take'
      }
    }
    memo.set(key, best)
    choice.set(key, bestChoice)
    return best
  }
  solve(0, 0)

  const matches = []
  for (let di = 0, ai = 0; di < designTexts.length && ai < arkuiTexts.length;) {
    const c = choice.get(`${di}:${ai}`)
    if (c === 'take') {
      matches.push({ design: designTexts[di], arkui: arkuiTexts[ai], score: score[di][ai] })
      di += 1
      ai += 1
    } else if (c === 'skipA') {
      ai += 1
    } else {
      di += 1
    }
  }
  return matches
}

function slotScore(dn, an, designOrder, arkuiOrder, dCount, aCount, regionContext, d) {
  const xMax = 0.24 * d.W
  const yMax = 0.22 * d.H
  const dc = rectCenter(dn.rect)
  const ac = rectCenter(an.rect)
  const dx = Math.abs(dc.x - ac.x)
  const dy = Math.abs(centerY(dn.rect) - centerY(an.rect))
  if (dx > xMax || dy > yMax) return 0

  const ta = normalizeText(dn.textContent)
  const tb = normalizeText(an.textContent)
  const typeA = textFieldType(ta)
  const typeB = textFieldType(tb)
  const numericSlot = typeA === 'number' && typeB === 'number'

  const style = textStyleSimilarity(dn, an)
  const hRatio = sizeRatio(dn.rect.h, an.rect.h)
  if (style < 0.55 || hRatio < 0.45) return 0
  // TODO(normRect): isNearSameLineSlot 为跨 Pass 共享工具，仍用 normRect（阈值 0.10/0.045 归一化）
  if (numericSlot && (isAmbiguousShortNumberText(ta) || isAmbiguousShortNumberText(tb)) &&
    !isNearSameLineSlot(dn, an, 0.10, 0.045)) return 0

  const orderDelta = Math.abs((designOrder.get(dn.id) || 0) - (arkuiOrder.get(an.id) || 0))
  const orderScore = 1 - Math.min(1, orderDelta / Math.max(dCount, aCount, 1))
  const xScore = Math.max(0, 1 - dx / xMax)
  const yScore = Math.max(0, 1 - dy / yMax)
  const regionScore = regionAffinity(dn, an, regionContext)
  const lineScore = sameLineGroupScore(dn, an, d.W)
  const semanticScore = 0.72

  return xScore * 0.24 +
    yScore * 0.18 +
    orderScore * 0.24 +
    style * 0.16 +
    hRatio * 0.10 +
    regionScore * 0.04 +
    lineScore * 0.04 +
    semanticScore * 0.04
}

function orderMap(nodes) {
  return new Map(nodes.map((n, idx) => [n.id, idx]))
}

function readingOrder(a, b) {
  const ay = centerY(a.rect)
  const by = centerY(b.rect)
  if (Math.abs(ay - by) > LINE_Y_TOL) return ay - by
  return rectCenter(a.rect).x - rectCenter(b.rect).x
}

function sameLineGroupScore(dn, an, W) {
  return xDistance(dn.rect, an.rect) < 0.18 * W ? 1 : 0
}

function bestNumericSlotMatch(targetNode, candidates, regionContext, d) {
  let best = null
  let bestScore = 0
  for (const node of candidates) {
    const score = numericSlotScore(targetNode, node, regionContext, d)
    if (score > bestScore) {
      bestScore = score
      best = node
    }
  }
  return best ? { node: best, score: bestScore } : null
}

function numericSlotScore(dn, an, regionContext, d) {
  const xMax = 0.20 * d.W
  const yMax = 0.16 * d.H
  const dc = rectCenter(dn.rect)
  const ac = rectCenter(an.rect)
  const dx = Math.abs(dc.x - ac.x)
  const dy = Math.abs(centerY(dn.rect) - centerY(an.rect))
  if (dx > xMax || dy > yMax) return 0

  const style = textStyleSimilarity(dn, an)
  const hRatio = sizeRatio(dn.rect.h, an.rect.h)
  if (style < 0.60 || hRatio < 0.50) return 0
  // TODO(normRect): isNearSameLineSlot 为跨 Pass 共享工具，仍用 normRect（阈值 0.10/0.045 归一化）
  if ((isAmbiguousShortNumberText(dn.textContent) || isAmbiguousShortNumberText(an.textContent)) &&
    !isNearSameLineSlot(dn, an, 0.10, 0.045)) return 0

  const xScore = Math.max(0, 1 - dx / xMax)
  const yScore = Math.max(0, 1 - dy / yMax)
  const regionScore = regionAffinity(dn, an, regionContext)
  const lineScore = xDistance(dn.rect, an.rect) < 0.18 * d.W ? 1 : 0
  return xScore * 0.34 +
    yScore * 0.24 +
    style * 0.22 +
    hRatio * 0.10 +
    regionScore * 0.06 +
    lineScore * 0.04
}
