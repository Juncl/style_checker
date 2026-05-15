import { decodePng } from './pngDecoder.js'
import { isRenderableNonTextNode } from './nodeVisibility.js'

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

function isPixelVisibilityCandidate(node) {
  if (!node?.visible || node.visualOccluded || !node.rect) return false
  if (node.rect.w < 2 || node.rect.h < 2) return false
  if (node.type === 'text') return !!String(node.textContent || '').trim()
  return isRenderableNonTextNode(node) || hasPixelVisualDecoration(node)
}

function hasPixelVisualDecoration(node) {
  const s = node.style || {}
  return !!(s.backgroundColor || s.borderRadius || s.border || s.shadow || s.backdropBlur || s.blur)
}

function isPixelInvisible(node, metrics) {
  if (!metrics.samples) return true
  if (node.type === 'text') {
    return metrics.visiblePixelRatio < 0.006 &&
      metrics.meanColorDelta < 8 &&
      metrics.meanLumaDelta < 5
  }
  const threshold = isRenderableNonTextNode(node) ? 0.025 : 0.035
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
      r += c.r
      g += c.g
      b += c.b
      samples += 1
    }
  }
  return {
    mean: samples ? { r: r / samples, g: g / samples, b: b / samples } : { r: 255, g: 255, b: 255 },
    samples,
  }
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
      r += c.r
      g += c.g
      b += c.b
      samples += 1
    }
  }
  return {
    mean: samples ? { r: r / samples, g: g / samples, b: b / samples } : { r: 255, g: 255, b: 255 },
    samples,
  }
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
    Math.abs(luma(c3.r, c3.g, c3.b) - luma(c4.r, c4.g, c4.b)),
  )
}

function colorDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
}

function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}
