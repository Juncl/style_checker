import { makePair } from '../matchStrategies.js'
import { dropGridOutlierAnchors } from '../gridAnchorFilter.js'
import { normalizeText, textSemanticSimilarity, parseArgb, extractMainTone } from '../../utils/textSemantics.js'

const CREDIBLE_THRESHOLD = 0.9

export function gaussianCurveParabola(num1, num2, point, diffmax) {
  const diff = Math.abs(num1 - num2)
  if (num1 === num2) return 1
  if (diff > diffmax) return 0

  const { x, y } = point
  const a = (1 - y) / (x * x)
  const sigma = x / Math.sqrt(-2 * Math.log(y))

  let score
  if (diff <= x) {
    score = 1 - a * diff * diff
  } else {
    score = Math.exp(-(diff * diff) / (2 * sigma * sigma))
  }
  return parseFloat(score.toFixed(4))
}

function levenshteinSimilarity(s1, s2) {
  if (!s1 || !s2) return 0
  if (s1 === s2) return 1

  const len1 = s1.length
  const len2 = s2.length
  const maxLen = Math.max(len1, len2)
  if (maxLen === 0) return 1

  const dp = Array(len2 + 1).fill(0).map(() => Array(len1 + 1).fill(0))

  for (let i = 0; i <= len1; i++) dp[0][i] = i
  for (let j = 0; j <= len2; j++) dp[j][0] = j

  for (let j = 1; j <= len2; j++) {
    for (let i = 1; i <= len1; i++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
      dp[j][i] = Math.min(
        dp[j][i - 1] + 1,
        dp[j - 1][i] + 1,
        dp[j - 1][i - 1] + cost
      )
    }
  }

  const distance = dp[len2][len1]
  return 1 - distance / maxLen
}

function textSimilar(c1, c2) {
  const t1 = normalizeText(c1)
  const t2 = normalizeText(c2)
  if (!t1 || !t2) return 0
  if (t1 === t2) return 1

  const t1n = t1.replace(/\d+(\.\d+)?/g, '0')
  const t2n = t2.replace(/\d+(\.\d+)?/g, '0')
  if (t1n === t2n) return 1

  const editScore = levenshteinSimilarity(t1n, t2n)
  const semanticScore = textSemanticSimilarity(c1, c2)

  let prefixSuffixScore = 0
  const lenDiff = Math.abs(t1n.length - t2n.length)
  if (lenDiff <= 3) {
    const hasPrefixMatch = t1n.length >= 2 && t2n.length >= 2 && t1n.substring(0, 2) === t2n.substring(0, 2)
    const hasSuffixMatch = t1n.length >= 2 && t2n.length >= 2 && t1n.slice(-2) === t2n.slice(-2)

    if (hasPrefixMatch || hasSuffixMatch) {
      prefixSuffixScore = 0.7 + (1 - lenDiff / 3) * 0.3
    }
  }

  if (prefixSuffixScore > 0) {
    const weightedScore = editScore * 0.63 + semanticScore * 0.12 + prefixSuffixScore * 0.25
    return Math.max(weightedScore, editScore)
  }

  return Math.max(editScore, semanticScore)
}

function blendOnWhite(argb) {
  const alpha = argb.a / 255
  return {
    r: argb.r * alpha + 255 * (1 - alpha),
    g: argb.g * alpha + 255 * (1 - alpha),
    b: argb.b * alpha + 255 * (1 - alpha),
  }
}

function getSimilarityColor(c1, c2) {
  const p1 = parseArgb(extractMainTone(c1))
  const p2 = parseArgb(extractMainTone(c2))
  if (!p1 || !p2) return 1

  const b1 = blendOnWhite(p1)
  const b2 = blendOnWhite(p2)
  const distance =
    Math.abs(b1.r - b2.r) + Math.abs(b1.g - b2.g) + Math.abs(b1.b - b2.b)
  return Math.max(0, 1 - distance / 765)
}

function getSimilaritySize(s1, s2) {
  if (s1 == null || s2 == null) return 1
  return gaussianCurveParabola(s1, s2, { x: 4, y: 0.5 }, 12)
}

function getWeightScore(w1, w2) {
  if (w1 == null || w2 == null) return 1
  return gaussianCurveParabola(w1, w2, { x: 300, y: 0.5 }, 600)
}

export function getPlaceScore(hmNode, deNode, diagonal, canvasHeightHm, canvasHeightDe, rootRectW, rootRectMaxH) {
  const bothCenter = hmNode.style?.textAlign === 'center' && deNode.style?.textAlign === 'center'

  const hmX = bothCenter ? hmNode.rect.x + hmNode.rect.w / 2 : hmNode.rect.x
  const hmY = bothCenter ? hmNode.rect.y + hmNode.rect.h / 2 : hmNode.rect.y
  const deX = bothCenter ? deNode.rect.x + deNode.rect.w / 2 : deNode.rect.x
  const deY = bothCenter ? deNode.rect.y + deNode.rect.h / 2 : deNode.rect.y

  const euclidPoint = { x: 0.2 * diagonal, y: 0.5 }
  const euclidMax   = 0.5 * diagonal
  const xPoint      = { x: 0.3 * rootRectW, y: 0.5 }
  const xMax        = 0.6 * rootRectW
  const yPoint      = { x: 0.4 * rootRectMaxH, y: 0.5 }
  const yMax        = 0.8 * rootRectMaxH

  function weightedScore(dx, dy) {
    const euclidScore = gaussianCurveParabola(0, Math.hypot(dx, dy), euclidPoint, euclidMax)
    const xScore      = gaussianCurveParabola(0, Math.abs(dx), xPoint, xMax)
    const yScore      = gaussianCurveParabola(0, Math.abs(dy), yPoint, yMax)
    return euclidScore * 0.6 + xScore * 0.3 + yScore * 0.1
  }

  const topScore = weightedScore(hmX - deX, hmY - deY)

  const hmYBot = canvasHeightHm - hmY
  const deYBot = canvasHeightDe - deY
  const botScore = weightedScore(hmX - deX, hmYBot - deYBot)

  return Math.max(topScore, botScore)
}

function getTextFinalScore(content, color, size, weight, place) {
  if (place === 0 || weight === 0) return 0
  if (color === 1 && size === 1 && weight === 1 && place >= 0.9) {
    return content * 0.15 + place * 0.6 + 0.25
  }
  return content * 0.25 + color * 0.15 + size * 0.15 + place * 0.35 + weight * 0.1
}

function octant(px, py, qx, qy) {
  const angle = Math.atan2(-(py - qy), px - qx)
  let idx = Math.round(angle / (Math.PI / 4))
  idx = ((idx % 8) + 8) % 8
  return idx
}

function octantDist(a, b) {
  const d = Math.abs(a - b)
  return Math.min(d, 8 - d)
}

function filterAnchorsByOrientation(pairs) {
  const CONFLICT_OCTANT = 3
  const CONFLICT_RATE = 0.5
  const dropped = []

  const center = (n) => ({ x: n.rect.x + n.rect.w / 2, y: n.rect.y + n.rect.h / 2 })

  let kept = pairs.filter(p => p.design?.rect && p.arkui?.rect)
  const skipped = pairs.filter(p => !(p.design?.rect && p.arkui?.rect))

  for (let iter = 0; iter < 2; iter++) {
    if (kept.length < 3) break

    const nodes = kept.map(p => ({
      pair: p,
      de: center(p.design),
      hm: center(p.arkui),
    }))

    const survivors = []
    let removedThisRound = false
    for (let i = 0; i < nodes.length; i++) {
      let conflict = 0
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue
        const dirDe = octant(nodes[i].de.x, nodes[i].de.y, nodes[j].de.x, nodes[j].de.y)
        const dirHm = octant(nodes[i].hm.x, nodes[i].hm.y, nodes[j].hm.x, nodes[j].hm.y)
        if (octantDist(dirDe, dirHm) >= CONFLICT_OCTANT) conflict++
      }
      const rate = conflict / (nodes.length - 1)
      if (rate > CONFLICT_RATE) {
        dropped.push(nodes[i].pair)
        removedThisRound = true
      } else {
        survivors.push(nodes[i].pair)
      }
    }

    kept = survivors
    if (!removedThisRound) break
  }

  return { kept: [...kept, ...skipped], dropped }
}

function detectTextAlignment(textNodes, anchorIds) {
  const TOL = 1.5
  const hasAnchor = grp => grp.some(n => anchorIds.has(n.id))

  function bucket(nodes, keyFn) {
    const sorted = [...nodes].sort((a, b) => keyFn(a) - keyFn(b))
    const groups = []
    for (const n of sorted) {
      const last = groups[groups.length - 1]
      if (last && keyFn(n) - keyFn(last[last.length - 1]) <= TOL) {
        last.push(n)
      } else {
        groups.push([n])
      }
    }
    return groups.filter(g => g.length >= 2)
  }

  const byBottom = bucket(textNodes, n => n.rect.y + n.rect.h)
  const byMid    = bucket(textNodes, n => n.rect.y + n.rect.h / 2)
  const sameRow  = []
  for (const grp of [...byBottom, ...byMid]) {
    const ids = new Set(grp.map(n => n.id))
    const idx = sameRow.findIndex(m => m.some(n => ids.has(n.id)))
    if (idx >= 0) {
      for (const n of grp) {
        if (!sameRow[idx].some(e => e.id === n.id)) sameRow[idx].push(n)
      }
    } else {
      sameRow.push([...grp])
    }
  }

  const res = {
    sameRow:       sameRow.filter(hasAnchor),
    leftAligned:   bucket(textNodes, n => n.rect.x).filter(hasAnchor),
    rightAligned:  bucket(textNodes, n => n.rect.x + n.rect.w).filter(hasAnchor),
    centerAligned: bucket(textNodes, n => n.rect.x + n.rect.w / 2).filter(hasAnchor),
  }

  const allCols = [
    ...res.leftAligned.map(g => ({ g, type: 'left' })),
    ...res.rightAligned.map(g => ({ g, type: 'right' })),
    ...res.centerAligned.map(g => ({ g, type: 'center' })),
  ]
  const nRows = res.sameRow.length
  const nCols = allCols.length
  const uf = Array.from({ length: nRows + nCols }, (_, i) => i)
  const find = x => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x] } return x }
  const union = (a, b) => { uf[find(a)] = find(b) }

  for (let ri = 0; ri < nRows; ri++) {
    const rowIds = new Set(res.sameRow[ri].map(n => n.id))
    for (let ci = 0; ci < nCols; ci++) {
      if (allCols[ci].g.some(n => rowIds.has(n.id))) union(ri, nRows + ci)
    }
  }

  const compMap = new Map()
  for (let i = 0; i < nRows + nCols; i++) {
    const root = find(i)
    if (!compMap.has(root)) compMap.set(root, { rows: [], leftCols: [], rightCols: [], centerCols: [] })
    const comp = compMap.get(root)
    if (i < nRows) {
      comp.rows.push(res.sameRow[i])
    } else {
      const { g, type } = allCols[i - nRows]
      if (type === 'left')        comp.leftCols.push(g)
      else if (type === 'right')  comp.rightCols.push(g)
      else                        comp.centerCols.push(g)
    }
  }

  res.grids = []
  for (const comp of compMap.values()) {
    if (comp.rows.length < 2 || comp.leftCols.length + comp.rightCols.length + comp.centerCols.length < 1) continue

    const rawCols = [...comp.leftCols, ...comp.rightCols, ...comp.centerCols]
    const colUf = Array.from({ length: rawCols.length }, (_, i) => i)
    const cFind = x => { while (colUf[x] !== x) { colUf[x] = colUf[colUf[x]]; x = colUf[x] } return x }
    for (let ci = 0; ci < rawCols.length; ci++) {
      const ids = new Set(rawCols[ci].map(n => n.id))
      for (let cj = ci + 1; cj < rawCols.length; cj++) {
        if (rawCols[cj].some(n => ids.has(n.id))) colUf[cFind(ci)] = cFind(cj)
      }
    }
    const colMergeMap = new Map()
    for (let ci = 0; ci < rawCols.length; ci++) {
      const root = cFind(ci)
      if (!colMergeMap.has(root)) colMergeMap.set(root, new Map())
      for (const n of rawCols[ci]) colMergeMap.get(root).set(n.id, n)
    }
    const gridCols = [...colMergeMap.values()]
      .map(m => [...m.values()])
      .sort((a, b) => {
        const ax = a.reduce((s, n) => s + n.rect.x, 0) / a.length
        const bx = b.reduce((s, n) => s + n.rect.x, 0) / b.length
        return ax - bx
      })

    const gridRows = [...comp.rows].sort((a, b) => {
      const ay = a.reduce((s, n) => s + n.rect.y, 0) / a.length
      const by = b.reduce((s, n) => s + n.rect.y, 0) / b.length
      return ay - by
    })

    const matrix = gridRows.map(row => {
      const rowIds = new Set(row.map(n => n.id))
      return gridCols.map(col => col.find(n => rowIds.has(n.id)) ?? null)
    })

    let ci = 0
    while (ci < matrix[0].length - 1) {
      const colNodes = matrix.map(row => row[ci])
      const nonNullCount = colNodes.filter(n => n !== null).length
      if (nonNullCount === 1) {
        const ri = colNodes.findIndex(n => n !== null)
        if (matrix[ri][ci + 1] === null) {
          matrix[ri][ci + 1] = matrix[ri][ci]
          for (const row of matrix) row.splice(ci, 1)
          continue
        }
      }
      ci++
    }

    if (matrix.some(row => row.some(cell => cell !== null && anchorIds.has(cell.id)))) {
      res.grids.push(matrix)
    }
  }

  return res
}

function buildTextAlignGroups(hmTextNodes, deTextNodes, pairs) {
  const hmAnchorIds = new Set(pairs.map(p => p.arkui.id))
  const deAnchorIds = new Set(pairs.map(p => p.design.id))
  return {
    hm: detectTextAlignment(hmTextNodes, hmAnchorIds),
    de: detectTextAlignment(deTextNodes, deAnchorIds),
  }
}

export function matchAllTextNodes(designNodes, devNodes, options = {}) {
  const {
    canvasWidthVp = 376, canvasHeightVp = 809,
    canvasWidth = 360, canvasHeight = 947,
  } = options
  const diagHm = Math.hypot(canvasWidthVp, canvasHeightVp)
  const diagDe = Math.hypot(canvasWidth, canvasHeight)
  const diagonal = (diagHm + diagDe) / 2
  const rootRectW = (canvasWidthVp + canvasWidth) / 2
  const rootRectMaxH = Math.max(canvasHeightVp, canvasHeight)
  const hmTextNodes = devNodes.filter(
    n => n.type === 'text' && normalizeText(n.textContent)
  )
  const deTextNodes = designNodes.filter(
    n => n.type === 'text' && normalizeText(n.textContent)
  )

  const textHmMapPix = {}
  const textHmMapPixCredible = {}
  const textHmMapPixDetail = {}

  for (const hm of hmTextNodes) {
    const tempobj = {
      id: hm.id,
      type: hm.type,
      content: hm.textContent,
      maxScore: 0,
      maxScoreId: '',
      rect: hm.rect,
      matchSource: 'creText',
      compareDeIdS: {},
    }

    for (const de of deTextNodes) {
      const contentScore = textSimilar(hm.textContent, de.textContent)
      const colorScore = getSimilarityColor(hm.style?.fontColor, de.style?.fontColor)
      const sizeScore = getSimilaritySize(hm.style?.fontSize, de.style?.fontSize)
      const weightScore = getWeightScore(hm.style?.fontWeight, de.style?.fontWeight)
      const placeScore = getPlaceScore(hm, de, diagonal, canvasHeightVp, canvasHeight, rootRectW, rootRectMaxH)
      const finalScore = getTextFinalScore(
        contentScore, colorScore, sizeScore, weightScore, placeScore
      )

      tempobj.compareDeIdS[de.id] = {
        pixId: de.id,
        content: de.textContent,
        contentScore,
        colorScore,
        sizeScore,
        weightScore,
        placeScore,
        finalScore,
      }

      if (finalScore > tempobj.maxScore) {
        tempobj.maxScore = finalScore
        tempobj.maxScoreId = de.id
      }
    }

    if (tempobj.maxScoreId) {
      textHmMapPix[hm.id] = tempobj.maxScoreId
      if (tempobj.maxScore >= CREDIBLE_THRESHOLD) {
        textHmMapPixCredible[hm.id] = tempobj.maxScoreId
      }
    }
    textHmMapPixDetail[hm.id] = tempobj
  }

  const deToHm = new Map()
  for (const hmId of Object.keys(textHmMapPixCredible)) {
    const deId = textHmMapPixCredible[hmId]
    const score = textHmMapPixDetail[hmId].maxScore
    const existing = deToHm.get(deId)
    if (!existing || score > existing.score) {
      deToHm.set(deId, { hmId, score })
    }
  }

  const hmMap = new Map(devNodes.map(n => [n.id, n]))
  const deMap = new Map(designNodes.map(n => [n.id, n]))
  const pairs = []
  for (const [deId, { hmId, score }] of deToHm) {
    const hm = hmMap.get(hmId)
    const de = deMap.get(deId)
    if (!hm || !de) continue
    const pair = makePair(de, hm, 'text-锚点', {
      confidence: 'high',
      topologyScore: score,
      isAnchor: true,
    })
    pair.matchSource = 'creText'
    pairs.push(pair)
  }

  const { hm: hmTextAlignGroups, de: deTextAlignGroups } = buildTextAlignGroups(hmTextNodes, deTextNodes, pairs)

  const { kept, dropped } = filterAnchorsByOrientation(pairs)
  if (dropped.length) {
    for (const p of dropped) {
      delete textHmMapPixCredible[p.arkui.id]
    }
  }

  const gridDropped = dropGridOutlierAnchors(hmTextAlignGroups, deTextAlignGroups, kept)
  const droppedKey = new Set(gridDropped.map(p => `${p.arkui.id}|${p.design.id}`))
  for (const p of gridDropped) delete textHmMapPixCredible[p.arkui.id]
  const finalPairs = kept.filter(p => !droppedKey.has(`${p.arkui.id}|${p.design.id}`))

  return { pairs: finalPairs, textHmMapPix, textHmMapPixCredible, textHmMapPixDetail, hmTextAlignGroups, deTextAlignGroups }
}
