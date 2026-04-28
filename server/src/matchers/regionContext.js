import {
  extractNodeVisualFeatures,
  extractRegionVisualFeatures,
  extractVisualPartitions,
  visualSimilarity,
} from '../utils/imageFeatures.js'
import { centerY, unionNormRect, sizeRatio } from './matchGeometry.js'
import { hasVisualDecoration, isMatchableNode } from './nodeVisibility.js'
import { normalizeText } from './textSemantics.js'

// Regions provide coarse page structure before individual node matching runs.
export function segmentRegions(nodes, source, visualPartitions = null) {
  const matchable = nodes
    .filter(isMatchableNode)
    .filter(n => n.normRect && Number.isFinite(n.normRect.y))
    .sort((a, b) => centerY(a.normRect) - centerY(b.normRect))

  if (matchable.length === 0) return []
  const visualRegions = segmentRegionsByVisualPartitions(matchable, source, visualPartitions)
  if (visualRegions.length >= 3) return visualRegions

  const regions = []
  let current = []
  let lastCy = null

  for (const node of matchable) {
    const cy = centerY(node.normRect)
    const gap = lastCy === null ? 0 : cy - lastCy
    if (current.length >= 4 && gap > 0.075) {
      regions.push(makeRegion(source, regions.length, current))
      current = []
    }
    current.push(node)
    lastCy = cy
  }

  if (current.length > 0) regions.push(makeRegion(source, regions.length, current))

  // 若页面节点过于连续导致切不动，退化到移动端常见纵向楼层。
  if (regions.length < 3 && matchable.length > 80) {
    return segmentRegionsByFixedFloors(matchable, source)
  }

  return regions
}

export function segmentRegionsByVisualPartitions(nodes, source, visualPartitions) {
  if (!visualPartitions?.length) return []
  const regions = []
  const used = new Set()
  for (const partition of visualPartitions) {
    const band = partition.rect
    const bandNodes = nodes.filter(n => {
      if (used.has(n.id)) return false
      const cy = centerY(n.normRect)
      return cy >= band.y - 0.01 && cy <= band.y + band.h + 0.01
    })
    if (bandNodes.length < 2) continue
    for (const n of bandNodes) used.add(n.id)
    regions.push(makeRegion(source, regions.length, bandNodes, partition))
  }
  const leftovers = nodes.filter(n => !used.has(n.id))
  if (leftovers.length >= 4) {
    for (const region of segmentRegionsByFixedFloors(leftovers, source)) {
      regions.push({ ...region, id: `${source}-region-${regions.length}`, index: regions.length })
    }
  }
  return regions
}

export function buildVisualFeatures(options, designRegions, arkuiRegions) {
  if (options.visualFeatures) return options.visualFeatures
  if (!options.visualImages) return null

  const design = extractRegionVisualFeatures(
    options.visualImages.designBuffer,
    options.visualImages.designCanvas,
    designRegions
  )
  const arkui = extractRegionVisualFeatures(
    options.visualImages.arkuiBuffer,
    options.visualImages.arkuiCanvas,
    arkuiRegions
  )

  const designNodes = extractNodeVisualFeatures(
    options.visualImages.designBuffer,
    options.visualImages.designCanvas,
    options.visualNodes?.design || []
  )
  const arkuiNodes = extractNodeVisualFeatures(
    options.visualImages.arkuiBuffer,
    options.visualImages.arkuiCanvas,
    options.visualNodes?.arkui || []
  )

  return design && arkui ? { design, arkui, designNodes, arkuiNodes } : null
}

export function buildVisualPartitions(options) {
  if (options.visualPartitions) return options.visualPartitions
  if (!options.visualImages) return null
  return {
    design: extractVisualPartitions(options.visualImages.designBuffer, options.visualImages.designCanvas),
    arkui: extractVisualPartitions(options.visualImages.arkuiBuffer, options.visualImages.arkuiCanvas),
  }
}

export function segmentRegionsByFixedFloors(nodes, source) {
  const floors = [
    [Number.NEGATIVE_INFINITY, 0.14],
    [0.14, 0.30],
    [0.30, 0.48],
    [0.48, 0.66],
    [0.66, 0.84],
    [0.84, Number.POSITIVE_INFINITY],
  ]

  return floors
    .map((range, idx) => {
      const floorNodes = nodes.filter(n => {
        const cy = centerY(n.normRect)
        return cy >= range[0] && cy < range[1]
      })
      return floorNodes.length ? makeRegion(source, idx, floorNodes) : null
    })
    .filter(Boolean)
}

export function makeRegion(source, index, nodes, visualPartition = null) {
  const rect = unionNormRect(nodes.map(n => n.normRect))
  const counts = { text: 0, container: 0, shape: 0, image: 0, other: 0 }
  const textSet = new Set()
  let decorated = 0

  for (const n of nodes) {
    counts[n.type] = (counts[n.type] || 0) + 1
    const text = normalizeText(n.textContent)
    if (text) textSet.add(text)
    if (hasVisualDecoration(n)) decorated += 1
  }

  return {
    id: `${source}-region-${index}`,
    source,
    index,
    rect,
    nodeIds: new Set(nodes.map(n => n.id)),
    nodeCount: nodes.length,
    counts,
    textSet,
    decoratedRatio: nodes.length ? decorated / nodes.length : 0,
    visualPartition: visualPartition?.id || null,
  }
}

export function buildRegionContext(designRegions, arkuiRegions, anchors, visualFeatures = null) {
  const designNodeToRegion = nodeToRegionMap(designRegions)
  const arkuiNodeToRegion = nodeToRegionMap(arkuiRegions)
  const anchorVotes = new Map()

  for (const pair of anchors) {
    const dr = designNodeToRegion.get(pair.design.id)
    const ar = arkuiNodeToRegion.get(pair.arkui.id)
    if (!dr || !ar) continue
    const key = `${dr}::${ar}`
    anchorVotes.set(key, (anchorVotes.get(key) || 0) + 1)
  }

  const scored = []
  for (const dr of designRegions) {
    for (const ar of arkuiRegions) {
      const visualScore = visualFeatures
        ? visualSimilarity(visualFeatures.design?.get(dr.id), visualFeatures.arkui?.get(ar.id))
        : 0
      const score = regionMatchScore(dr, ar, anchorVotes.get(`${dr.id}::${ar.id}`) || 0, visualScore)
      if (score > 0.28) scored.push({ designRegionId: dr.id, arkuiRegionId: ar.id, score, visualScore })
    }
  }

  scored.sort((a, b) => b.score - a.score)

  const usedD = new Set()
  const usedA = new Set()
  const regionPairs = []
  const designToArkuiRegions = new Map()
  const arkuiRegionNodeIds = new Map(arkuiRegions.map(r => [r.id, r.nodeIds]))

  for (const item of scored) {
    if (usedD.has(item.designRegionId) || usedA.has(item.arkuiRegionId)) continue
    usedD.add(item.designRegionId)
    usedA.add(item.arkuiRegionId)
    const pair = { ...item, score: Number(item.score.toFixed(3)), visualScore: Number((item.visualScore || 0).toFixed(3)) }
    regionPairs.push(pair)
    designToArkuiRegions.set(item.designRegionId, [item.arkuiRegionId])
  }

  return {
    designRegions,
    arkuiRegions,
    regionPairs,
    designNodeToRegion,
    arkuiNodeToRegion,
    designToArkuiRegions,
    arkuiRegionNodeIds,
    visualFeatures,
  }
}

export function candidatePool(designNode, arkuiNodes, regionContext, predicate) {
  const all = arkuiNodes.filter(n => isMatchableNode(n)).filter(predicate)
  if (!regionContext) return all

  const designRegionId = regionContext.designNodeToRegion.get(designNode.id)
  const arkuiRegionIds = regionContext.designToArkuiRegions.get(designRegionId)
  if (!arkuiRegionIds?.length) return all

  const regionScoped = all.filter(n => {
    const arkuiRegionId = regionContext.arkuiNodeToRegion.get(n.id)
    return arkuiRegionIds.includes(arkuiRegionId)
  })

  if (regionScoped.length === 0) return all

  const scopedIds = new Set(regionScoped.map(n => n.id))
  return [
    ...regionScoped,
    ...all.filter(n => !scopedIds.has(n.id)),
  ]
}

export function annotatePairsWithRegions(pairs, regionContext) {
  if (!regionContext) return

  const scoreByRegionPair = new Map(
    regionContext.regionPairs.map(p => [`${p.designRegionId}::${p.arkuiRegionId}`, p.score])
  )

  for (const pair of pairs) {
    const designRegionId = regionContext.designNodeToRegion.get(pair.design.id) || null
    const arkuiRegionId = regionContext.arkuiNodeToRegion.get(pair.arkui.id) || null
    pair.designRegionId = designRegionId
    pair.arkuiRegionId = arkuiRegionId
    pair.regionScore = scoreByRegionPair.get(`${designRegionId}::${arkuiRegionId}`) ?? null
  }
}

export function regionMatchScore(designRegion, arkuiRegion, anchorVotes, visualScore = 0) {
  const centerScore = Math.max(0, 1 - Math.abs(centerY(designRegion.rect) - centerY(arkuiRegion.rect)) / 0.35)
  const heightScore = sizeRatio(designRegion.rect.h, arkuiRegion.rect.h)
  const geometryScore = centerScore * 0.65 + heightScore * 0.35
  const histScore = histogramSimilarity(designRegion.counts, arkuiRegion.counts)
  const textScore = setJaccard(designRegion.textSet, arkuiRegion.textSet)
  const decorationScore = Math.max(0, 1 - Math.abs(designRegion.decoratedRatio - arkuiRegion.decoratedRatio) / 0.5)
  const anchorScore = Math.min(1, anchorVotes / 3)

  return (
    anchorScore * 0.30 +
    geometryScore * 0.22 +
    histScore * 0.18 +
    textScore * 0.10 +
    decorationScore * 0.05 +
    visualScore * 0.15
  )
}

export function regionAffinity(designNode, arkuiNode, regionContext) {
  if (!regionContext) return 0
  const designRegionId = regionContext.designNodeToRegion.get(designNode.id)
  const arkuiRegionId = regionContext.arkuiNodeToRegion.get(arkuiNode.id)
  if (!designRegionId || !arkuiRegionId) return 0
  const pair = regionContext.regionPairs.find(p =>
    p.designRegionId === designRegionId && p.arkuiRegionId === arkuiRegionId
  )
  return pair?.score || 0
}

export function nodeToRegionMap(regions) {
  const map = new Map()
  for (const region of regions) {
    for (const id of region.nodeIds) map.set(id, region.id)
  }
  return map
}

export function histogramSimilarity(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  let dot = 0, aa = 0, bb = 0
  for (const key of keys) {
    const av = a[key] || 0
    const bv = b[key] || 0
    dot += av * bv
    aa += av * av
    bb += bv * bv
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0
}

export function setJaccard(a, b) {
  if (!a?.size && !b?.size) return 0
  let inter = 0
  for (const item of a) if (b.has(item)) inter += 1
  return inter / (a.size + b.size - inter || 1)
}

export function formatRegionForOutput(region) {
  return {
    id: region.id,
    index: region.index,
    rect: region.rect,
    nodeCount: region.nodeCount,
    counts: region.counts,
    decoratedRatio: Number(region.decoratedRatio.toFixed(3)),
    visualPartition: region.visualPartition,
  }
}
