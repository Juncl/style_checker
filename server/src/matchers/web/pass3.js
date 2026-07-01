import { nodeAnchorRelation } from '../anchorCheck.js'
import { compareDeNodes } from './pass2.js'
import { makePair } from '../matchStrategies.js'

const TOP_K = 5

export function validateByAnchors(highPairs, candidatePairs, devTextUnmatched, designPool, textMatchResult, ctx) {
  const { canvasWidthVp, canvasHeightVp, canvasWidth, canvasHeight } = ctx
  const diagHm = Math.hypot(canvasWidthVp, canvasHeightVp)
  const diagDe = Math.hypot(canvasWidth, canvasHeight)
  const compareCtx = {
    diagonal:      (diagHm + diagDe) / 2,
    canvasHeightHm: canvasHeightVp,
    canvasHeightDe: canvasHeight,
    rootRectW:     (canvasWidthVp + canvasWidth) / 2,
    rootRectMaxH:  Math.max(canvasHeightVp, canvasHeight),
  }

  // 预计算 candidatePairs 里所有 dev 节点与 highPairs 锚点的关系和欧氏距离
  const nodeAnchorData = new Map()
  for (const pair of candidatePairs) {
    const an = pair.arkui
    if (!nodeAnchorData.has(an.id)) {
      nodeAnchorData.set(an.id, computeAnchorEntries(an, highPairs))
    }
  }

  // 一致性校验，分类 trusted / untrusted
  const untrustedPairs = []
  const trustedPairs = []
  for (const pair of candidatePairs) {
    const anchorEntries = nodeAnchorData.get(pair.arkui.id) ?? []
    if (isUntrusted(pair, anchorEntries)) {
      untrustedPairs.push(pair)
    } else {
      trustedPairs.push(pair)
    }
  }

  // 对 devTextUnmatched 补充计算锚点数据
  for (const n of devTextUnmatched) {
    if (!nodeAnchorData.has(n.id)) {
      nodeAnchorData.set(n.id, computeAnchorEntries(n, highPairs))
    }
  }

  const rematchDev    = [...untrustedPairs.map(p => p.arkui), ...devTextUnmatched]
  const rematchDesign = [...untrustedPairs.map(p => p.design), ...designPool]
  const blindPairs    = blindMatch(rematchDev, rematchDesign, nodeAnchorData, textMatchResult, compareCtx)

  return { trustedPairs, untrustedPairs, blindMatchPairs: blindPairs }
}

function computeAnchorEntries(devNode, highPairs) {
  const entries = highPairs.map(s => ({
    devAnchor:   s.arkui,
    deAnchor:    s.design,
    dist:        euclidDist(devNode, s.arkui),
    devRelation: nodeAnchorRelation(devNode.rect, s.arkui.rect),
  }))
  entries.sort((a, b) => a.dist - b.dist)
  return entries
}

function isUntrusted(pair, anchorEntries) {
  const { arkui: an, design: dn } = pair

  // 包含一致性：任意一个锚点四态关系不一致 → 不可信
  for (const { devAnchor, deAnchor, devRelation } of anchorEntries) {
    if (devAnchor.id === an.id || deAnchor.id === dn.id) continue
    if (devRelation !== nodeAnchorRelation(dn.rect, deAnchor.rect)) return true
  }

  // 方位一致性：八方位差 ≥ 3 的锚点比例 > 50% → 不可信
  const relevant = anchorEntries.filter(e => e.devAnchor.id !== an.id && e.deAnchor.id !== dn.id)
  if (relevant.length > 0) {
    let conflicts = 0
    for (const { devAnchor, deAnchor } of relevant) {
      const dirDev = octant(cx(an), cy(an), cx(devAnchor), cy(devAnchor))
      const dirDe  = octant(cx(dn), cy(dn), cx(deAnchor), cy(deAnchor))
      if (octantDist(dirDev, dirDe) >= 3) conflicts++
    }
    if (conflicts / relevant.length > 0.5) return true
  }

  return false
}

function blindMatch(rematchDev, rematchDesign, nodeAnchorData, textMatchResult, compareCtx) {
  const { diagonal, canvasHeightHm, canvasHeightDe, rootRectW, rootRectMaxH } = compareCtx
  const candidates = []

  for (const devNode of rematchDev) {
    const anchorEntries = nodeAnchorData.get(devNode.id) ?? []
    const topK = anchorEntries.slice(0, TOP_K)
    if (topK.length === 0) continue

    // 对每个锚点对，过滤通过包含一致性 + 方位一致性的 design 节点
    const groups = topK.map(({ devRelation, devAnchor, deAnchor }) => {
      const dirDev = octant(cx(devNode), cy(devNode), cx(devAnchor), cy(devAnchor))
      return rematchDesign.filter(dn => {
        if (dn.type !== devNode.type) return false
        if (nodeAnchorRelation(dn.rect, deAnchor.rect) !== devRelation) return false
        const dirDe = octant(cx(dn), cy(dn), cx(deAnchor), cy(deAnchor))
        return octantDist(dirDev, dirDe) < 3
      })
    })

    // 取 5 组的交集
    const intersectionIds = groups.reduce((acc, group) => {
      const groupIds = new Set(group.map(n => n.id))
      return new Set([...acc].filter(id => groupIds.has(id)))
    }, new Set(groups[0].map(n => n.id)))

    if (intersectionIds.size === 0) continue

    const designCandidates = rematchDesign.filter(n => intersectionIds.has(n.id))

    // compareDeNodes 打分
    const { bestMatch, tempObj } = compareDeNodes(
      devNode, designCandidates, textMatchResult.textHmMapPixDetail,
      diagonal, canvasHeightHm, canvasHeightDe, rootRectW, rootRectMaxH
    )
    if (bestMatch && tempObj.maxScore > 0) {
      candidates.push({ devNode, designNode: bestMatch, score: tempObj.maxScore })
    }
  }

  // 一对一贪心裁决（按分数降序）
  candidates.sort((a, b) => b.score - a.score)
  const lockedDev    = new Set()
  const lockedDesign = new Set()
  const result = []
  for (const { devNode, designNode, score } of candidates) {
    if (lockedDev.has(devNode.id) || lockedDesign.has(designNode.id)) continue
    lockedDev.add(devNode.id)
    lockedDesign.add(designNode.id)
    const confidence = score >= 0.98 ? 'high' : score >= 0.8 ? 'medium' : 'low'
    result.push(makePair(designNode, devNode, 'text-con-盲匹配', { confidence, topologyScore: score }))
  }
  return result
}

const cx = n => n.rect.x + n.rect.w / 2
const cy = n => n.rect.y + n.rect.h / 2

function euclidDist(n1, n2) {
  const dx = cx(n1) - cx(n2)
  const dy = cy(n1) - cy(n2)
  return Math.sqrt(dx * dx + dy * dy)
}

function octant(px, py, qx, qy) {
  const angle = Math.atan2(-(py - qy), px - qx)
  let idx = Math.round(angle / (Math.PI / 4))
  return ((idx % 8) + 8) % 8
}

function octantDist(a, b) {
  const d = Math.abs(a - b)
  return Math.min(d, 8 - d)
}
