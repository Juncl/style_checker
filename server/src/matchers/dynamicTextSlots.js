import { centerY, rectCenter, sizeRatio, xDistance } from '../utils/matchGeometry.js'
import { makePair } from './matchStrategies.js'
import { gaussianCurveParabola } from './allTextMatcher.js'
import { candidatePool, regionAffinity } from './regionContext.js'
import {
  colorDistance,
  hasUsableText,
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
const ROW_MATCH_THRESHOLD = 0.80  // 行对入选阈值（正确行对实测 ≥0.90，错误行对 ≤0.71）

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

export function matchAlignedTextRows(designNodes, arkuiNodes, usedArkui, matchedDesignIds, regionContext, opts = {}) {
  const d = dims(opts)
  const result = []
  const localUsedArkui = new Set()
  const localMatchedDesign = new Set()
  const designRows = textRows(designNodes, matchedDesignIds, localMatchedDesign, d.designH)
  const arkuiRows = textRows(arkuiNodes, usedArkui, localUsedArkui, d.H)

  const rowPairs = maxWeightRowMatch(designRows, arkuiRows, opts.anchors || [], d.H, d.designH)

  for (const { dRow, aRow } of rowPairs) {
    const matches = orderedSlotAssignment(dRow.nodes, aRow.nodes, regionContext, d)
    for (const match of matches) {
      if (match.score < 0.50) continue
      result.push(makePair(match.design, match.arkui, 'text-同行', {
        iou: 0,
        confidence: match.score >= 0.9 ? 'high' : match.score > 0.76 ? 'medium' : 'low',
        topologyScore: match.score,
      }))
      localMatchedDesign.add(match.design.id)
      localUsedArkui.add(match.arkui.id)
    }
  }

  return result
}

// bitmask DP 全局最优行配对（状态：di × usedA_mask），复杂度 O(m·2^n)，行数通常 ≤ 8 完全可行
function maxWeightRowMatch(designRows, arkuiRows, anchors, H, designH) {
  const m = designRows.length
  const n = arkuiRows.length
  if (!m || !n) return []

  const scores = designRows.map(dr => arkuiRows.map(ar => rowScore(dr, ar, anchors, H, designH)))
  const memo = new Map()

  function solve(di, usedA) {
    if (di >= m) return 0
    const key = `${di}:${usedA}`
    if (memo.has(key)) return memo.get(key)
    let best = solve(di + 1, usedA)  // dRow[di] 不匹配
    for (let ai = 0; ai < n; ai++) {
      if (usedA & (1 << ai)) continue
      const s = scores[di][ai]
      if (s < ROW_MATCH_THRESHOLD) continue
      const val = s + solve(di + 1, usedA | (1 << ai))
      if (val > best) best = val
    }
    memo.set(key, best)
    return best
  }

  function traceback(di, usedA) {
    if (di >= m) return []
    let best = solve(di + 1, usedA)
    let bestAi = -1
    for (let ai = 0; ai < n; ai++) {
      if (usedA & (1 << ai)) continue
      const s = scores[di][ai]
      if (s < ROW_MATCH_THRESHOLD) continue
      const val = s + solve(di + 1, usedA | (1 << ai))
      if (val > best) { best = val; bestAi = ai }
    }
    if (bestAi === -1) return traceback(di + 1, usedA)
    return [{ dRow: designRows[di], aRow: arkuiRows[bestAi] }, ...traceback(di + 1, usedA | (1 << bestAi))]
  }

  solve(0, 0)
  return traceback(0, 0)
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

// 只用字号/字重/字色（不含对齐），作为行身份标识
function rowNodeStyleScore(dn, an) {
  const ds = dn.style || {}
  const as = an.style || {}
  let score = 0, weight = 0
  if (ds.fontSize != null && as.fontSize != null) {
    weight += 0.40; score += Math.max(0, 1 - Math.abs(ds.fontSize - as.fontSize) / 6) * 0.40
  }
  if (ds.fontWeight != null && as.fontWeight != null) {
    weight += 0.25; score += Math.max(0, 1 - Math.abs(ds.fontWeight - as.fontWeight) / 400) * 0.25
  }
  if (ds.fontColor && as.fontColor) {
    weight += 0.35; score += Math.max(0, 1 - colorDistance(ds.fontColor, as.fontColor) / 180) * 0.35
  }
  return weight > 0 ? score / weight : 0.75
}

// 找开发侧 y 最近的 Pass1 强锚点对（只取最近 1 个，不分上下）
function nearestAnchor(yRef, anchors) {
  let best = null, bestD = Infinity
  for (const a of anchors) {
    if (!a.arkui?.rect || !a.design?.rect) continue
    const dd = Math.abs(a.arkui.rect.y - yRef)
    if (dd < bestD) { bestD = dd; best = a }
  }
  return best
}

// 行对得分 = yScore × 0.6 + 首节点样式分 × 0.4
//   yScore = 锚点相对差分(yScore1) × 0.6 + 绝对 rect.y 差分(yScore2) × 0.4
//   两个 diff 都走 抛物线-高斯曲线：中间值 (0.18·H, 0.5)，截断 0.5·H
function rowScore(dRow, aRow, anchors, H, designH) {
  const aFirst = aRow.nodes[0]
  const dFirst = dRow.nodes[0]
  const point = { x: 0.18 * H, y: 0.5 }
  const diffmax = 0.5 * H

  // yScore2：绝对 rect.y 差，正向(距顶) / 反向(距底) 取较优
  const diffTop = Math.abs(aFirst.rect.y - dFirst.rect.y)
  const diffBot = Math.abs(
    (H - aFirst.rect.y - aFirst.rect.h) - (designH - dFirst.rect.y - dFirst.rect.h)
  )
  const diff2 = Math.min(diffTop, diffBot)
  const yScore2 = gaussianCurveParabola(0, diff2, point, diffmax)

  // yScore1：相对最近锚点的偏移差；无锚点则退化为仅用 yScore2
  let yScore
  const anchor = nearestAnchor(aFirst.rect.y, anchors)
  if (anchor) {
    const deltaDev = aFirst.rect.y - anchor.arkui.rect.y
    const deltaDesign = dFirst.rect.y - anchor.design.rect.y
    if (deltaDev * deltaDesign < 0) return 0  // 偏移方向相反 → 一票否决
    const diff1 = Math.abs(deltaDev - deltaDesign)
    const yScore1 = gaussianCurveParabola(0, diff1, point, diffmax)
    yScore = yScore1 * 0.6 + yScore2 * 0.4
  } else {
    yScore = yScore2
  }

  const styleScore = rowNodeStyleScore(dFirst, aFirst)  // 仅首节点
  return yScore * 0.6 + styleScore * 0.4
}

function isRowSlotText(node) {
  const text = String(node.textContent || '').trim()
  const len = text.length
  return len >= 2 && len <= 8
}

function isSlotVisibleEnough(node) {
  if (node.source !== 'arkui') return true
  const visibility = node.pixelVisibility || {}
  if (node.pixelInvisible) return false
  const visibleRatio = visibility.visiblePixelRatio ?? 0
  const strokeScore = visibility.textStrokeScore ?? 0
  return visibleRatio >= 0.12 || strokeScore >= 0.09
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

  const style = textStyleSimilarity(dn, an)
  const hRatio = sizeRatio(dn.rect.h, an.rect.h)
  if (style < 0.55 || hRatio < 0.45) return 0

  const orderDelta = Math.abs((designOrder.get(dn.id) || 0) - (arkuiOrder.get(an.id) || 0))
  const orderScore = 1 - Math.min(1, orderDelta / Math.max(dCount, aCount, 1))
  const xScore = Math.max(0, 1 - dx / xMax)
  const yScore = Math.max(0, 1 - dy / yMax)
  const regionScore = regionAffinity(dn, an, regionContext)
  const lineScore = sameLineGroupScore(dn, an, d.W)
  const ds = dn.style || {}
  const as = an.style || {}
  const fontSizeScore = ds.fontSize != null && as.fontSize != null
    ? Math.max(0, 1 - Math.abs(ds.fontSize - as.fontSize) / 6) : 0.75
  const fontColorScore = ds.fontColor && as.fontColor
    ? Math.max(0, 1 - colorDistance(ds.fontColor, as.fontColor) / 180) : 0.75
  const fontWeightScore = ds.fontWeight != null && as.fontWeight != null
    ? Math.max(0, 1 - Math.abs(ds.fontWeight - as.fontWeight) / 400) : 0.75

  return xScore * 0.20 +
    yScore * 0.14 +
    orderScore * 0.20 +
    fontSizeScore * 0.14 +
    fontColorScore * 0.12 +
    fontWeightScore * 0.10 +
    hRatio * 0.06 +
    regionScore * 0.02 +
    lineScore * 0.02
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

