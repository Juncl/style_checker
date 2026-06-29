import { gaussianCurveParabola, getPlaceScore } from './pass1.js'
import { makePair } from '../matchStrategies.js'

export function matchRemainingNodes(remainingDev, remainingDesign, textMatchResult, ctx) {
  const { canvasWidthVp, canvasHeightVp, canvasWidth, canvasHeight } = ctx
  const diagHm = Math.hypot(canvasWidthVp, canvasHeightVp)
  const diagDe = Math.hypot(canvasWidth, canvasHeight)
  const diagonal = (diagHm + diagDe) / 2
  const rootRectW = (canvasWidthVp + canvasWidth) / 2
  const rootRectMaxH = Math.max(canvasHeightVp, canvasHeight)

  const { textHmMapPixDetail } = textMatchResult

  const candidates = []
  for (const hn of remainingDev) {
    const { bestMatch, tempObj } = compareDeNodes(
      hn, remainingDesign, textHmMapPixDetail,
      diagonal, canvasHeightVp, canvasHeight, rootRectW, rootRectMaxH
    )
    if (bestMatch && tempObj.maxScore > 0) {
      candidates.push({ hn, dn: bestMatch, score: tempObj.maxScore })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  const lockedDev = new Set()
  const lockedDesign = new Set()
  const result = []
  for (const { hn, dn, score } of candidates) {
    if (lockedDev.has(hn.id) || lockedDesign.has(dn.id)) continue
    lockedDev.add(hn.id)
    lockedDesign.add(dn.id)
    const confidence = score >= 0.98 ? 'high' : score >= 0.8 ? 'medium' : 'low'
    result.push(makePair(dn, hn, 'text-con-web匹配', {
      confidence,
      topologyScore: score,
    }))
  }
  return result
}

export function compareDeNodes(hn, designNodes, textHmMapPixDetail, diagonal, canvasHeightHm, canvasHeightDe, rootRectW, rootRectMaxH) {
  const tempObj = {
    id: hn.id,
    type: hn.rawType,
    content: hn.textContent || null,
    maxScore: 0,
    maxScoreId: '',
    rect: hn.rect,
    compareDeIdS: {},
  }

  let bestMatch = null
  let maxScore = 0

  for (const dn of designNodes) {
    if (hn.type !== dn.type) continue
    let finalScore = 0

    if (hn.type === 'text') {
      const detail = textHmMapPixDetail[hn.id]
      if (detail && detail.compareDeIdS[dn.id]) {
        finalScore = detail.compareDeIdS[dn.id].finalScore
        tempObj.compareDeIdS[dn.id] = { ...detail.compareDeIdS[dn.id] }
      }
    } else {
      const scObj = commonLayerSim(hn, dn, diagonal, canvasHeightHm, canvasHeightDe, rootRectW, rootRectMaxH)
      finalScore = scObj.finalScore
      tempObj.compareDeIdS[dn.id] = { ...scObj }
    }

    if (finalScore > maxScore) {
      maxScore = finalScore
      bestMatch = dn
      tempObj.maxScore = maxScore
      tempObj.maxScoreId = dn.id
    }
  }

  return { bestMatch, tempObj }
}

function commonLayerSim(n1, n2, diagonal, canvasHeightHm, canvasHeightDe, rootRectW, rootRectMaxH) {
  const r1 = n1.rect.w / n1.rect.h
  const r2 = n2.rect.w / n2.rect.h
  const minR = Math.min(r1, r2)
  const whScore = gaussianCurveParabola(r1, r2, { x: 0.86 * minR, y: 0.5 }, 2 * minR)

  const a1 = n1.rect.w * n1.rect.h
  const a2 = n2.rect.w * n2.rect.h
  const minA = Math.min(a1, a2)
  const areaScore = gaussianCurveParabola(a1, a2, { x: minA, y: 0.5 }, 3 * minA)

  const placeScore = getPlaceScore(n1, n2, diagonal, canvasHeightHm, canvasHeightDe, rootRectW, rootRectMaxH)

  let finalScore = 0
  if (whScore && areaScore && placeScore) {
    finalScore = whScore * 0.25 + areaScore * 0.25 + placeScore * 0.5
  }

  return { finalScore, whScore, areaScore, placeScore }
}
