import { decodePng } from './pngDecoder.js'

export function extractRegionVisualFeatures(imageBuffer, canvas, regions) {
  if (!imageBuffer || !regions?.length) return null

  try {
    const image = decodePng(imageBuffer)
    return new Map(regions.map(region => [
      region.id,
      computeRegionFeatures(image, canvas, region.rect),
    ]))
  } catch (err) {
    console.warn(`Visual feature extraction skipped: ${err.message}`)
    return null
  }
}

export function extractNodeVisualFeatures(imageBuffer, canvas, nodes) {
  if (!imageBuffer || !nodes?.length || !canvas?.w || !canvas?.h) return null

  try {
    const image = decodePng(imageBuffer)
    return new Map(nodes
      .filter(n => n?.rect && n.rect.w > 1 && n.rect.h > 1)
      .map(node => [node.id, computeCropFeatures(image, canvas, node.rect)]))
  } catch (err) {
    console.warn(`Node visual feature extraction skipped: ${err.message}`)
    return null
  }
}

export function extractVisualPartitions(imageBuffer, canvas) {
  if (!imageBuffer || !canvas?.w || !canvas?.h) return []

  try {
    const image = decodePng(imageBuffer)
    return segmentImageByHorizontalEnergy(image)
      .map((band, idx) => ({
        id: `visual-band-${idx}`,
        rect: {
          x: 0,
          y: band.y1 / image.height,
          w: 1,
          h: (band.y2 - band.y1) / image.height,
        },
        score: Number(band.energy.toFixed(3)),
      }))
  } catch (err) {
    console.warn(`Visual partition extraction skipped: ${err.message}`)
    return []
  }
}

export function annotatePixelVisibility(nodes, imageBuffer, canvas, options = {}) {
  if (!imageBuffer || !nodes?.length || !canvas?.w || !canvas?.h) return { checked: 0, hidden: 0 }

  let image
  try {
    image = decodePng(imageBuffer)
  } catch (err) {
    console.warn(`Pixel visibility check skipped: ${err.message}`)
    return { checked: 0, hidden: 0 }
  }

  const source = options.source || null
  let checked = 0
  let hidden = 0
  for (const node of nodes) {
    if (source && node.source !== source) continue
    if (!isPixelVisibilityCandidate(node)) continue
    checked += 1

    const metrics = measureNodeVisibility(image, canvas, node.rect)
    node.pixelVisibility = metrics
    node.pixelInvisible = isPixelInvisible(node, metrics)

    if (node.pixelInvisible) {
      hidden += 1
      node.visualOccluded = true
      node.visualOcclusionReason = 'pixel-invisible'
    }
  }

  return { checked, hidden }
}

export function visualSimilarity(a, b) {
  if (!a || !b) return 0
  const color = histogramSimilarity(a.colorHist, b.colorHist)
  const edge = histogramSimilarity(a.edgeHist, b.edgeHist)
  const hash = 1 - hammingDistance(a.dhash, b.dhash) / 64
  const brightness = 1 - Math.min(1, Math.abs(a.meanLuma - b.meanLuma) / 255)
  const mask = a.foregroundRatio != null && b.foregroundRatio != null
    ? 1 - Math.min(1, Math.abs(a.foregroundRatio - b.foregroundRatio) / 0.5)
    : 0.5
  const density = a.edgeDensity != null && b.edgeDensity != null
    ? 1 - Math.min(1, Math.abs(a.edgeDensity - b.edgeDensity) / 0.35)
    : 0.5
  const aspect = a.aspectRatio != null && b.aspectRatio != null ? 1 - Math.min(1, Math.abs(Math.log((a.aspectRatio || 1) / (b.aspectRatio || 1))) / 1.5) : 0.5
  const centroid = centroidSimilarity(a.foregroundCentroid, b.foregroundCentroid)
  return color * 0.26 + edge * 0.24 + hash * 0.18 + brightness * 0.07 + mask * 0.09 + density * 0.07 + aspect * 0.04 + centroid * 0.05
}

export function cropSimilarity(a, b) {
  return visualSimilarity(a, b)
}
export function componentVisualDiff(a, b) {
  if (!a || !b) return null
  const similarity = visualSimilarity(a, b)
  return {
    similarity,
    diff: 1 - similarity,
    foregroundDelta: Math.abs((a.foregroundRatio || 0) - (b.foregroundRatio || 0)),
    edgeDelta: Math.abs((a.edgeDensity || 0) - (b.edgeDensity || 0)),
    lumaDelta: Math.abs((a.meanLuma || 0) - (b.meanLuma || 0)),
  }
}

function isPixelVisibilityCandidate(node) {
  if (!node?.visible || node.visualOccluded || !node.rect) return false
  if (node.rect.w < 2 || node.rect.h < 2) return false
  if (node.type === 'text') return !!String(node.textContent || '').trim()
  if (node.type === 'image' || node.type === 'shape') return true
  return hasPixelVisualDecoration(node)
}

function hasPixelVisualDecoration(node) {
  const s = node.style || {}
  return !!(s.backgroundColor || s.borderRadius || s.border || s.gradient || s.shadow || s.backdropBlur || s.blur)
}

function isPixelInvisible(node, metrics) {
  if (!metrics.samples) return true
  if (node.type === 'text') {
    return metrics.visiblePixelRatio < 0.006 &&
      metrics.meanColorDelta < 8 &&
      metrics.meanLumaDelta < 5
  }
  const threshold = node.type === 'image' ? 0.025 : 0.035
  return metrics.visiblePixelRatio < threshold &&
    metrics.meanColorDelta < 12 &&
    metrics.meanLumaDelta < 8
}

function measureNodeVisibility(image, canvas, rect) {
  const box = rectToImageBox(image, canvas, rect)
  const inner = sampleBox(image, box)
  const ring = sampleRing(image, box)
  const bg = ring.samples >= 8 ? ring.mean : inner.mean
  const bgLuma = luma(bg.r, bg.g, bg.b)

  let visible = 0
  let edgePixels = 0
  let total = 0
  let lumaDeltaSum = 0
  let colorDeltaSum = 0
  const stepX = Math.max(1, Math.floor((box.x2 - box.x1) / 28))
  const stepY = Math.max(1, Math.floor((box.y2 - box.y1) / 28))

  for (let y = box.y1; y < box.y2; y += stepY) {
    for (let x = box.x1; x < box.x2; x += stepX) {
      const c = pixelAt(image, x, y)
      const dl = Math.abs(luma(c.r, c.g, c.b) - bgLuma)
      const dc = colorDistance(c, bg)
      const edge = localEdge(image, x, y)
      if (dl > 14 || dc > 26 || edge > 18) visible += 1
      if (edge > 18) edgePixels += 1
      lumaDeltaSum += dl
      colorDeltaSum += dc
      total += 1
    }
  }

  return {
    visiblePixelRatio: total ? visible / total : 0,
    meanLumaDelta: total ? lumaDeltaSum / total : 0,
    meanColorDelta: total ? colorDeltaSum / total : 0,
    textStrokeScore: total ? edgePixels / total : 0,
    samples: total,
  }
}

function computeCropFeatures(image, canvas, rect) {
  const box = rectToImageBox(image, canvas, rect)
  return computeFeaturesForImageBox(image, box)
}

function computeFeaturesForImageBox(image, box) {
  const colorHist = new Array(64).fill(0)
  const edgeHist = new Array(4).fill(0)
  const gray = []
  const ring = sampleRing(image, box)
  const bg = ring.samples >= 8 ? ring.mean : { r: 255, g: 255, b: 255 }
  let lumaSum = 0
  let foreground = 0
  let edgePixels = 0
  let samples = 0
  let fgX = 0
  let fgY = 0
  const stepX = Math.max(1, Math.floor((box.x2 - box.x1) / 80))
  const stepY = Math.max(1, Math.floor((box.y2 - box.y1) / 80))

  for (let y = box.y1; y < box.y2; y += stepY) {
    const row = []
    for (let x = box.x1; x < box.x2; x += stepX) {
      const c = pixelAt(image, x, y)
      const v = luma(c.r, c.g, c.b)
      const bin = (c.r >> 6) * 16 + (c.g >> 6) * 4 + (c.b >> 6)
      const edge = localEdge(image, x, y)
      colorHist[bin] += 1
      lumaSum += v
      samples += 1
      const isForeground = colorDistance(c, bg) > 26 || Math.abs(v - luma(bg.r, bg.g, bg.b)) > 14 || edge > 18
      if (isForeground) {
        foreground += 1
        fgX += x
        fgY += y
      }
      if (edge > 18) edgePixels += 1
      row.push(v)
    }
    gray.push(row)
  }

  for (let y = 1; y < gray.length; y++) {
    for (let x = 1; x < gray[y].length; x++) {
      const gx = gray[y][x] - gray[y][x - 1]
      const gy = gray[y][x] - gray[y - 1][x]
      const mag = Math.hypot(gx, gy)
      if (mag < 12) continue
      const angle = Math.atan2(gy, gx)
      const bin = angle < -Math.PI / 4 ? 0 : angle < 0 ? 1 : angle < Math.PI / 4 ? 2 : 3
      edgeHist[bin] += mag
    }
  }
  normalize(colorHist)
  normalize(edgeHist)
  return {
    colorHist,
    edgeHist,
    dhash: dhash(image, box.x1, box.y1, box.x2, box.y2),
    meanLuma: samples ? lumaSum / samples : 0,
    foregroundRatio: samples ? foreground / samples : 0,
    edgeDensity: samples ? edgePixels / samples : 0,
    textStrokeScore: samples ? edgePixels / samples : 0,
    aspectRatio: (box.x2 - box.x1) / Math.max(1, box.y2 - box.y1),
    foregroundCentroid: foreground ? { x: (fgX / foreground - box.x1) / Math.max(1, box.x2 - box.x1), y: (fgY / foreground - box.y1) / Math.max(1, box.y2 - box.y1) } : null,
  }
}
function segmentImageByHorizontalEnergy(image) {
  const rows = []
  const stepX = Math.max(1, Math.floor(image.width / 120))
  for (let y = 0; y < image.height; y++) {
    let energy = 0
    let samples = 0
    for (let x = 1; x < image.width - 1; x += stepX) {
      energy += localEdge(image, x, y)
      samples += 1
    }
    rows.push(samples ? energy / samples : 0)
  }

  const smooth = rows.map((_, y) => {
    let sum = 0
    let count = 0
    for (let k = -3; k <= 3; k++) {
      const idx = y + k
      if (idx < 0 || idx >= rows.length) continue
      sum += rows[idx]
      count += 1
    }
    return count ? sum / count : 0
  })

  const threshold = Math.max(4, percentile(smooth, 0.45) * 0.75)
  const bands = []
  let start = null
  let energySum = 0
  for (let y = 0; y < smooth.length; y++) {
    if (smooth[y] > threshold) {
      if (start === null) {
        start = y
        energySum = 0
      }
      energySum += smooth[y]
    } else if (start !== null) {
      pushBand(bands, start, y, energySum)
      start = null
    }
  }
  if (start !== null) pushBand(bands, start, smooth.length, energySum)

  return mergeSmallGaps(bands, Math.round(image.height * 0.035))
    .filter(b => b.y2 - b.y1 > image.height * 0.035)
    .slice(0, 12)
}

function pushBand(bands, y1, y2, energy) {
  bands.push({ y1, y2, energy: energy / Math.max(1, y2 - y1) })
}

function mergeSmallGaps(bands, maxGap) {
  if (!bands.length) return []
  const result = [bands[0]]
  for (let i = 1; i < bands.length; i++) {
    const last = result[result.length - 1]
    const cur = bands[i]
    if (cur.y1 - last.y2 <= maxGap) {
      const h1 = last.y2 - last.y1
      const h2 = cur.y2 - cur.y1
      last.y2 = cur.y2
      last.energy = (last.energy * h1 + cur.energy * h2) / Math.max(1, h1 + h2)
    } else {
      result.push(cur)
    }
  }
  return result
}

function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = clamp(Math.floor((sorted.length - 1) * p), 0, sorted.length - 1)
  return sorted[idx]
}
function centroidSimilarity(a, b) {
  return !a || !b ? 0.5 : 1 - Math.min(1, Math.hypot(a.x - b.x, a.y - b.y) / 0.8)
}

function rectToImageBox(image, canvas, rect) {
  const scaleX = image.width / canvas.w
  const scaleY = image.height / canvas.h
  const x1 = clamp(Math.floor(rect.x * scaleX), 0, image.width - 1)
  const y1 = clamp(Math.floor(rect.y * scaleY), 0, image.height - 1)
  const x2 = clamp(Math.ceil((rect.x + rect.w) * scaleX), x1 + 1, image.width)
  const y2 = clamp(Math.ceil((rect.y + rect.h) * scaleY), y1 + 1, image.height)
  return { x1, y1, x2, y2 }
}
function sampleBox(image, box) {
  let r = 0, g = 0, b = 0, samples = 0
  const stepX = Math.max(1, Math.floor((box.x2 - box.x1) / 16))
  const stepY = Math.max(1, Math.floor((box.y2 - box.y1) / 16))
  for (let y = box.y1; y < box.y2; y += stepY) {
    for (let x = box.x1; x < box.x2; x += stepX) {
      const c = pixelAt(image, x, y)
      r += c.r; g += c.g; b += c.b; samples += 1
    }
  }
  return { mean: samples ? { r: r / samples, g: g / samples, b: b / samples } : { r: 255, g: 255, b: 255 }, samples }
}

function sampleRing(image, box) {
  const padX = Math.max(2, Math.round((box.x2 - box.x1) * 0.18))
  const padY = Math.max(2, Math.round((box.y2 - box.y1) * 0.18))
  const outer = {
    x1: clamp(box.x1 - padX, 0, image.width - 1),
    y1: clamp(box.y1 - padY, 0, image.height - 1),
    x2: clamp(box.x2 + padX, 1, image.width),
    y2: clamp(box.y2 + padY, 1, image.height),
  }
  let r = 0, g = 0, b = 0, samples = 0
  const stepX = Math.max(1, Math.floor((outer.x2 - outer.x1) / 20))
  const stepY = Math.max(1, Math.floor((outer.y2 - outer.y1) / 20))
  for (let y = outer.y1; y < outer.y2; y += stepY) {
    for (let x = outer.x1; x < outer.x2; x += stepX) {
      if (x >= box.x1 && x < box.x2 && y >= box.y1 && y < box.y2) continue
      const c = pixelAt(image, x, y)
      r += c.r; g += c.g; b += c.b; samples += 1
    }
  }
  return { mean: samples ? { r: r / samples, g: g / samples, b: b / samples } : { r: 255, g: 255, b: 255 }, samples }
}

function pixelAt(image, x, y) {
  const xx = clamp(Math.round(x), 0, image.width - 1)
  const yy = clamp(Math.round(y), 0, image.height - 1)
  const i = (yy * image.width + xx) * 4
  return { r: image.rgba[i], g: image.rgba[i + 1], b: image.rgba[i + 2], a: image.rgba[i + 3] }
}

function localEdge(image, x, y) {
  const c1 = pixelAt(image, x - 1, y)
  const c2 = pixelAt(image, x + 1, y)
  const c3 = pixelAt(image, x, y - 1)
  const c4 = pixelAt(image, x, y + 1)
  return Math.max(
    Math.abs(luma(c1.r, c1.g, c1.b) - luma(c2.r, c2.g, c2.b)),
    Math.abs(luma(c3.r, c3.g, c3.b) - luma(c4.r, c4.g, c4.b))
  )
}

function colorDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
}

function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function computeRegionFeatures(image, canvas, normRect) {
  const x1 = clamp(Math.floor(normRect.x * canvas.w / canvas.w * image.width), 0, image.width - 1)
  const y1 = clamp(Math.floor(normRect.y * canvas.h / canvas.h * image.height), 0, image.height - 1)
  const x2 = clamp(Math.ceil((normRect.x + normRect.w) * image.width), x1 + 1, image.width)
  const y2 = clamp(Math.ceil((normRect.y + normRect.h) * image.height), y1 + 1, image.height)

  const colorHist = new Array(64).fill(0)
  const edgeHist = new Array(4).fill(0)
  const gray = []
  let lumaSum = 0
  let samples = 0
  const stepX = Math.max(1, Math.floor((x2 - x1) / 80))
  const stepY = Math.max(1, Math.floor((y2 - y1) / 80))

  for (let y = y1; y < y2; y += stepY) {
    const row = []
    for (let x = x1; x < x2; x += stepX) {
      const i = (y * image.width + x) * 4
      const r = image.rgba[i], g = image.rgba[i + 1], b = image.rgba[i + 2]
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      const bin = (r >> 6) * 16 + (g >> 6) * 4 + (b >> 6)
      colorHist[bin] += 1
      lumaSum += luma
      samples += 1
      row.push(luma)
    }
    gray.push(row)
  }

  for (let y = 1; y < gray.length; y++) {
    for (let x = 1; x < gray[y].length; x++) {
      const gx = gray[y][x] - gray[y][x - 1]
      const gy = gray[y][x] - gray[y - 1][x]
      const mag = Math.hypot(gx, gy)
      if (mag < 12) continue
      const angle = Math.atan2(gy, gx)
      const bin = angle < -Math.PI / 4 ? 0 : angle < 0 ? 1 : angle < Math.PI / 4 ? 2 : 3
      edgeHist[bin] += mag
    }
  }

  normalize(colorHist)
  normalize(edgeHist)

  return {
    colorHist,
    edgeHist,
    dhash: dhash(image, x1, y1, x2, y2),
    meanLuma: samples ? lumaSum / samples : 0,
  }
}

function dhash(image, x1, y1, x2, y2) {
  let bits = 0n
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      const ax = sampleLuma(image, x1, y1, x2, y2, gx, gy, 9, 8)
      const bx = sampleLuma(image, x1, y1, x2, y2, gx + 1, gy, 9, 8)
      bits = (bits << 1n) | (ax > bx ? 1n : 0n)
    }
  }
  return bits
}

function sampleLuma(image, x1, y1, x2, y2, gx, gy, gw, gh) {
  const x = clamp(Math.floor(x1 + (gx + 0.5) / gw * (x2 - x1)), x1, x2 - 1)
  const y = clamp(Math.floor(y1 + (gy + 0.5) / gh * (y2 - y1)), y1, y2 - 1)
  const i = (y * image.width + x) * 4
  return 0.299 * image.rgba[i] + 0.587 * image.rgba[i + 1] + 0.114 * image.rgba[i + 2]
}

function histogramSimilarity(a, b) {
  let dot = 0, aa = 0, bb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    aa += a[i] * a[i]
    bb += b[i] * b[i]
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0
}

function hammingDistance(a, b) {
  let x = a ^ b
  let count = 0
  while (x) {
    count += Number(x & 1n)
    x >>= 1n
  }
  return count
}

function normalize(hist) {
  const sum = hist.reduce((a, b) => a + b, 0)
  if (!sum) return
  for (let i = 0; i < hist.length; i++) hist[i] /= sum
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}
