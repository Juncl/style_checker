import { makePair } from '../matchStrategies.js'
import { isCompatibleType, hasVisualDecoration } from '../../utils/nodeVisibility.js'
import { computeIoU } from '../../utils/matchGeometry.js'
import { rectContains, relation } from '../anchorCheck.js'
import { tripleScore } from '../anchorTopology.js'
import { MatchTools } from '../tools.js'

export function matchByAnchorContain(anchors, availDev, availDesign, ctx) {
  const consistentWithAnchors = (an, dn) => anchors.every(s => {
    if (s.arkui.id === an.id || s.design.id === dn.id) return true
    return rectContains(an.rect, s.arkui.rect) === rectContains(dn.rect, s.design.rect)
  })

  const candidates = []
  for (const anchor of anchors) {
    const aHm = anchor.arkui, aDe = anchor.design
    const devAnc = availDev.filter(n => hasVisualDecoration(n) && relation(n.rect, aHm.rect) === 'contain')
    const designAnc = availDesign.filter(n => hasVisualDecoration(n) && relation(n.rect, aDe.rect) === 'contain')
    for (const an of devAnc) {
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
  const lockedDev = new Set()
  const lockedDesign = new Set()
  const result = []
  for (const { an, dn, score } of candidates) {
    if (lockedDev.has(an.id) || lockedDesign.has(dn.id)) continue
    lockedDev.add(an.id)
    lockedDesign.add(dn.id)
    result.push(makePair(dn, an, 'text-con-包含', {
      confidence: 'high',
      topologyScore: MatchTools.round4(score),
      iou: computeIoU(dn.normRect, an.normRect),
    }))
  }
  return result
}
