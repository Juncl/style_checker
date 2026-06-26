/**
 * Pass 1.5：锚点视觉祖先容器包含匹配
 *
 * 以强锚点为参照，找两侧各自「包住锚点」的有装饰容器，按三维评分最优配对。
 * 包含关系（container → anchor）比方向关系更可信，先于方向匹配执行并提前锁定。
 */
import { makePair } from './matchStrategies.js'
import { isCompatibleType, hasVisualDecoration } from '../utils/nodeVisibility.js'
import { computeIoU } from '../utils/matchGeometry.js'
import { rectContains, relation } from './anchorCheck.js'
import { tripleScore, round4 } from './anchorTopology.js'

export function matchByAnchorContain(anchors, availArkui, availDesign, ctx) {
  // 双向包含一致性：an/dn 对每个锚点的「包 / 不包」必须两侧完全一致
  const consistentWithAnchors = (an, dn) => anchors.every(s => {
    if (s.arkui.id === an.id || s.design.id === dn.id) return true
    return rectContains(an.rect, s.arkui.rect) === rectContains(dn.rect, s.design.rect)
  })

  const candidates = []
  for (const anchor of anchors) {
    const aHm = anchor.arkui, aDe = anchor.design
    const arkuiAnc = availArkui.filter(n => hasVisualDecoration(n) && relation(n.rect, aHm.rect) === 'contain')
    const designAnc = availDesign.filter(n => hasVisualDecoration(n) && relation(n.rect, aDe.rect) === 'contain')
    for (const an of arkuiAnc) {
      let best = null
      for (const dn of designAnc) {
        if (!isCompatibleType(dn, an)) continue
        if (!consistentWithAnchors(an, dn)) continue
        const t = tripleScore(an, dn, aHm, aDe, 'contain', ctx)
        if (t.pass && (!best || t.score > best.score)) best = { dn, score: t.score }
      }
      if (best) candidates.push({ an, dn: best.dn, score: best.score })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  const lockedArkui = new Set()
  const lockedDesign = new Set()
  const result = []
  for (const { an, dn, score } of candidates) {
    if (lockedArkui.has(an.id) || lockedDesign.has(dn.id)) continue
    lockedArkui.add(an.id)
    lockedDesign.add(dn.id)
    result.push(makePair(dn, an, 'text-con-包含', {
      confidence: 'high',
      topologyScore: round4(score),
      iou: computeIoU(dn.normRect, an.normRect),
    }))
  }
  return result
}
