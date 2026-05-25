import path from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../')

import { parseDesign } from '../src/parsers/design/index.js'
import { parseArkui } from '../src/parsers/arkui/index.js'
import { matchAllTextNodes } from '../src/matchers/allTextMatcher.js'
import { segmentRegions, buildRegionContext, candidatePool } from '../src/matchers/regionContext.js'
import { matchAlignedTextRows, matchDynamicTextSlots } from '../src/matchers/dynamicTextSlots.js'
import {
  matchRegionTextOptimal,
  bestTextRoleMatch,
  nearestAnchor,
  relationToAnchor,
  distanceBetweenRelations,
  topologyMatchScore,
} from '../src/matchers/matchStrategies.js'
import { isCompatibleType, hasBackgroundColor } from '../src/utils/nodeVisibility.js'
import { computeIoU } from '../src/utils/matchGeometry.js'
import { isStrongTitleSlotMatch, hasUsableText, isShortCjkLabel } from '../src/utils/textSemantics.js'
import { comparePaths } from '../src/utils/pathOrder.js'

// ── 参数解析 ─────────────────────────────────────────────────────────────────
const [,, caseId, targetDeId] = process.argv
if (!caseId) {
  console.error('用法: node scripts/debugPass4.js <caseId> [deId]')
  console.error('  caseId  必填，如 case6')
  console.error('  deId    可选，指定要详细分析的 design 节点 ID')
  process.exit(1)
}

// ── 加载数据 ─────────────────────────────────────────────────────────────────
const casePath = path.join(ROOT, 'case', caseId)
const designJson = JSON.parse(readFileSync(path.join(casePath, 'design.json'), 'utf8'))
const arkuiJson  = JSON.parse(readFileSync(path.join(casePath, 'arkui.json'), 'utf8'))
const designImg  = readFileSync(path.join(casePath, 'design.png'))
const arkuiImg   = readFileSync(path.join(casePath, 'arkui.png'))

const { nodes: designNodes, canvasWidth, canvasHeight } = await parseDesign(designJson, { imageBuffer: designImg })
const { nodes: arkuiNodes, canvasWidthVp, canvasHeightVp } = await parseArkui(arkuiJson, { imageBuffer: arkuiImg })

const diagHm = Math.hypot(canvasWidthVp, canvasHeightVp)
const diagDe = Math.hypot(canvasWidth, canvasHeight)
const diagonal = (diagHm + diagDe) / 2

console.log(`\n[${caseId}] 画布 design: ${canvasWidth}x${canvasHeight}  diagDe=${diagDe.toFixed(1)}`)
console.log(`[${caseId}] 画布 arkui:  ${canvasWidthVp}x${canvasHeightVp}  diagHm=${diagHm.toFixed(1)}`)
console.log(`[${caseId}] diagonal 均值: ${diagonal.toFixed(1)}`)

// ── 重放 Pass 1-3.5（建立 topologyAnchors）────────────────────────────────────
const usedArkui = new Set()
const matchedDesignIds = new Set()
const topologyAnchors = []

const textMatchResult = matchAllTextNodes(designNodes, arkuiNodes, { canvasWidthVp, canvasHeightVp, canvasWidth, canvasHeight })
for (const pair of textMatchResult.pairs) {
  usedArkui.add(pair.arkui.id)
  matchedDesignIds.add(pair.design.id)
  topologyAnchors.push(pair)
}

const designRegions = segmentRegions(designNodes, 'design')
const arkuiRegions  = segmentRegions(arkuiNodes, 'arkui')
const regionContext = buildRegionContext(designRegions, arkuiRegions, topologyAnchors)

const dynamicSlotPairs = matchDynamicTextSlots(designNodes, arkuiNodes, usedArkui, matchedDesignIds, regionContext)
for (const p of dynamicSlotPairs) { usedArkui.add(p.arkui.id); matchedDesignIds.add(p.design.id) }

const rowSlotPairs = matchAlignedTextRows(designNodes, arkuiNodes, usedArkui, matchedDesignIds, regionContext)
for (const p of rowSlotPairs) { usedArkui.add(p.arkui.id); matchedDesignIds.add(p.design.id) }

const regionTextPairs = matchRegionTextOptimal(designNodes, arkuiNodes, usedArkui, matchedDesignIds, regionContext)
for (const p of regionTextPairs) { usedArkui.add(p.arkui.id); matchedDesignIds.add(p.design.id) }

for (const dn of designNodes) {
  if (matchedDesignIds.has(dn.id) || dn.type !== 'text' || !hasUsableText(dn)) continue
  const candidates = candidatePool(dn, arkuiNodes, regionContext, n =>
    n.type === 'text' && hasUsableText(n) && !usedArkui.has(n.id)
  )
  const best = bestTextRoleMatch(dn, candidates)
  if (best && (best.score >= 0.85 || isStrongTitleSlotMatch(dn, best.node, best.score))) {
    usedArkui.add(best.node.id)
    matchedDesignIds.add(dn.id)
  }
}

console.log(`\nPass 1-3.5 完成: 锚点 ${topologyAnchors.length} 个，已匹配 ${matchedDesignIds.size} 个节点`)

// ── 本地辅助（与 matchStrategies.js Pass 4 逻辑同步）─────────────────────────
const SCORE_TIE_EPSILON = 1e-4

function absDistRect(rectA, rectB) {
  return Math.hypot(rectA.x - rectB.x, rectA.y - rectB.y)
}

function backgroundPresenceScore(dn, an) {
  return (hasBackgroundColor(dn) ? 1 : 0) + (hasBackgroundColor(an) ? 1 : 0)
}

function nearbyAnchors(node, anchors, side) {
  if (node.type === 'text' && !isShortCjkLabel(node.textContent)) {
    const anchor = nearestAnchor(node, anchors, side, diagDe)
    return anchor && anchor.dist < 0.35 ? [anchor] : []
  }
  return anchors
    .map(pair => ({ pair, dist: absDistRect(node.rect, pair[side].rect) / diagDe }))
    .filter(item => item.dist < 0.70)
    .sort((a, b) => a.dist - b.dist)
}

function bestTopologyCandidate(dn, unavailableArkui) {
  const anchorsForNode = nearbyAnchors(dn, topologyAnchors, 'design')
  if (!anchorsForNode.length) return null
  let best = null, bestScore = 0, bestAnchorDist = Infinity, bestBackgroundScore = -1
  const regionCandidates = candidatePool(dn, arkuiNodes, regionContext, n =>
    !unavailableArkui.has(n.id) && isCompatibleType(dn, n)
  )
  for (const an of regionCandidates) {
    for (const anchor of anchorsForNode) {
      const dr = relationToAnchor(dn, anchor.pair.design, diagDe)
      const ar = relationToAnchor(an, anchor.pair.arkui, diagHm)
      const relDist = distanceBetweenRelations(dr, ar)
      if (relDist > 0.24) continue
      const score = topologyMatchScore(dn, an, dr, ar, regionContext, diagonal, canvasHeight, canvasHeightVp)
      const backgroundScore = backgroundPresenceScore(dn, an)
      if (score > bestScore + SCORE_TIE_EPSILON ||
          (Math.abs(score - bestScore) <= SCORE_TIE_EPSILON && backgroundScore > bestBackgroundScore)) {
        bestScore = score; bestBackgroundScore = backgroundScore; bestAnchorDist = anchor.dist
        best = { node: an, score, anchorDist: anchor.dist }
      }
    }
  }
  return best
}

// ── 指定节点详细分析 ──────────────────────────────────────────────────────────
if (targetDeId) {
  const dn = designNodes.find(n => n.id === targetDeId)
  if (!dn) {
    console.log(`\n指定节点 deId=${targetDeId} 未找到`)
  } else {
    const label = dn.type === 'text' ? `"${dn.textContent}"` : `[${dn.type}]`
    const anchorsForDn = nearbyAnchors(dn, topologyAnchors, 'design')

    console.log(`\n── ${targetDeId} ${label} 的锚点（共 ${anchorsForDn.length} 个）──`)
    for (const a of anchorsForDn) {
      const dr = a.pair.design.rect
      console.log(`  design=${a.pair.design.id.padEnd(12)} "${a.pair.design.textContent}"  leftTop=(${dr.x.toFixed(0)},${dr.y.toFixed(0)})  → arkui=${a.pair.arkui.id}  dist=${a.dist.toFixed(4)}`)
    }

    const regionCandidates = candidatePool(dn, arkuiNodes, regionContext, n =>
      !usedArkui.has(n.id) && isCompatibleType(dn, n)
    )
    console.log(`\n── ${targetDeId} 的 arkui 候选 Top10（共 ${regionCandidates.length} 个）──`)
    const rows = []
    for (const an of regionCandidates) {
      let bestScore = -1, bestAnchorId = null, bestRelDist = null
      for (const a of anchorsForDn) {
        const dr = relationToAnchor(dn, a.pair.design, diagDe)
        const ar = relationToAnchor(an, a.pair.arkui, diagHm)
        const relDist = distanceBetweenRelations(dr, ar)
        if (relDist > 0.24) continue
        const score = topologyMatchScore(dn, an, dr, ar, regionContext, diagonal, canvasHeight, canvasHeightVp)
        if (score > bestScore) { bestScore = score; bestAnchorId = a.pair.design.id; bestRelDist = relDist }
      }
      if (bestScore >= 0) rows.push({ an, bestScore, bestAnchorId, bestRelDist })
    }
    rows.sort((a, b) => b.bestScore - a.bestScore)
    for (const { an, bestScore, bestAnchorId, bestRelDist } of rows.slice(0, 10)) {
      const iou = computeIoU(dn.normRect, an.normRect)
      const anLabel = an.type === 'text' ? `"${an.textContent}"` : `[${an.type}]`
      console.log(`  arkui=${an.id.padEnd(8)} score=${bestScore.toFixed(4)} relDist=${bestRelDist.toFixed(4)} iou=${iou.toFixed(4)} 最优锚点=${bestAnchorId}  ${anLabel}`)
    }
  }
}

// ── Pass 4 预扫描排序 ──────────────────────────────────────────────────────────
const candidateDesignNodes = []
for (const n of designNodes) {
  if (matchedDesignIds.has(n.id)) continue
  if (n.type === 'text' && !hasUsableText(n)) continue
  const anchorsForNode = nearbyAnchors(n, topologyAnchors, 'design')
  if (!anchorsForNode.length) continue
  const best = bestTopologyCandidate(n, usedArkui)
  if (!best || best.score <= 0.58) continue
  candidateDesignNodes.push({ node: n, bestScore: best.score, bestAnchorDist: best.anchorDist ?? Infinity })
}
candidateDesignNodes.sort((a, b) => {
  if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore
  if (a.bestAnchorDist !== b.bestAnchorDist) return a.bestAnchorDist - b.bestAnchorDist
  const aHasBg = !!a.node.style?.backgroundColor
  const bHasBg = !!b.node.style?.backgroundColor
  if (aHasBg !== bHasBg) return bHasBg ? 1 : -1
  return comparePaths(a.node.path, b.node.path)
})

console.log(`\n── Pass 4 排序后候选节点（共 ${candidateDesignNodes.length} 个）──`)
for (const { node, bestScore, bestAnchorDist } of candidateDesignNodes) {
  const tag = node.id === targetDeId ? ' ← 目标' : ''
  const label = node.type === 'text' ? `"${node.textContent}"` : `[${node.type}]`
  console.log(`  ${node.id.padEnd(12)} ${label.padEnd(20)} score=${bestScore.toFixed(4)} anchorDist=${bestAnchorDist.toFixed(4)}${tag}`)
}

// ── Pass 4 正式执行 ──────────────────────────────────────────────────────────
console.log('\n── Pass 4 正式执行 ──')
const localUsedArkui = new Set()
const localMatchedDesign = new Set()
for (const { node: dn } of candidateDesignNodes) {
  if (localMatchedDesign.has(dn.id)) continue
  const best = bestTopologyCandidate(dn, new Set([...usedArkui, ...localUsedArkui]))
  if (best && best.score > 0.58) {
    const tag = (dn.id === targetDeId) ? ' ← 目标' : ''
    const dnLabel = dn.type === 'text' ? `"${dn.textContent}"` : `[${dn.type}]`
    console.log(`  design=${dn.id.padEnd(12)} ${dnLabel.padEnd(20)} → arkui=${best.node.id.padEnd(8)} score=${best.score.toFixed(4)}${tag}`)
    localUsedArkui.add(best.node.id)
    localMatchedDesign.add(dn.id)
  }
}
