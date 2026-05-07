import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { createWorker, PSM } from 'tesseract.js'
import chiSimData from '@tesseract.js-data/chi_sim'

import { rectIntersectionArea } from '../matchers/matchGeometry.js'
import { normalizeText } from '../matchers/textSemantics.js'
import { decodePng } from './pngDecoder.js'

const OCR_CACHE_PATH = resolve(process.cwd(), '.cache', 'tesseract')
const OCR_LANGS = 'chi_sim'

let workerPromise = null

/**
 * Use OCR results as a semantic visibility check for text nodes.
 *
 * When a PNG image buffer is passed in, this function runs Tesseract OCR
 * automatically and uses the detected text boxes to confirm visibility.
 * When OCR items are passed directly, they are normalized and reused.
 */
export async function annotateTextOcrVisibility(nodes, ocrPayload, canvas, options = {}) {
  const items = await resolveOcrItems(ocrPayload, canvas, options)
  if (!items.length || !canvas?.w || !canvas?.h) {
    return { checked: 0, hidden: 0, matched: 0, ocrItems: items.length }
  }

  const source = options.source || null
  const mode = options.mode || 'all'
  let checked = 0
  let hidden = 0
  let matched = 0

  for (const node of nodes) {
    if (source && node.source !== source) continue
    if (!isOcrCandidate(node, mode)) continue

    checked += 1
    const best = bestOcrMatch(node, items)
    node.ocrVisibility = best
      ? {
        checked: true,
        visible: true,
        text: best.item.text,
        score: Number(best.score.toFixed(3)),
        overlap: Number(best.overlap.toFixed(3)),
        rect: best.item.rect,
      }
      : { checked: true, visible: false }

    if (best) {
      matched += 1
    } else {
      hidden += 1
    }
  }

  return { checked, hidden, matched, ocrItems: items.length }
}

async function resolveOcrItems(payload, canvas, options) {
  if (!payload) return []

  if (Buffer.isBuffer(payload)) {
    const imageSize = options.imageSize || decodeImageSize(payload)
    const raw = await runTesseractOcr(payload)
    return normalizeOcrItems(raw, canvas, imageSize)
  }

  return normalizeOcrItems(payload, canvas, options.imageSize)
}

async function runTesseractOcr(imageBuffer) {
  const worker = await getWorker()
  const result = await worker.recognize(
    imageBuffer,
    {},
    { blocks: true, text: true }
  )
  return flattenTesseractBlocks(result.data)
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      mkdirSync(OCR_CACHE_PATH, { recursive: true })
      const worker = await createWorker(OCR_LANGS, 1, {
        cachePath: OCR_CACHE_PATH,
        langPath: chiSimData.langPath,
        gzip: chiSimData.gzip,
      })
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      })
      return worker
    })().catch(err => {
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

function decodeImageSize(buffer) {
  try {
    const image = decodePng(buffer)
    return { w: image.width, h: image.height }
  } catch {
    return null
  }
}

function flattenTesseractBlocks(page) {
  const items = []
  const seen = new Set()

  const pushItem = (text, bbox, confidence, kind) => {
    const normalized = normalizeTesseractBbox(bbox)
    const cleanText = String(text || '').trim()
    if (!cleanText || !normalized) return
    const key = `${kind}:${cleanText}:${normalized.x}:${normalized.y}:${normalized.w}:${normalized.h}`
    if (seen.has(key)) return
    seen.add(key)
    items.push({
      text: cleanText,
      rect: normalized,
      confidence: normalizeConfidence(confidence),
      kind,
    })
  }

  for (const block of page?.blocks || []) {
    pushItem(block.text, block.bbox, block.confidence, 'block')
    for (const paragraph of block.paragraphs || []) {
      pushItem(paragraph.text, paragraph.bbox, paragraph.confidence, 'paragraph')
      for (const line of paragraph.lines || []) {
        pushItem(line.text, line.bbox, line.confidence, 'line')
        for (const word of line.words || []) {
          pushItem(word.text, word.bbox, word.confidence, 'word')
        }
      }
    }
  }

  return items
}

function normalizeTesseractBbox(bbox) {
  if (!bbox) return null
  const x0 = Number(bbox.x0)
  const y0 = Number(bbox.y0)
  const x1 = Number(bbox.x1)
  const y1 = Number(bbox.y1)
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null
  const w = x1 - x0
  const h = y1 - y0
  if (w <= 0 || h <= 0) return null
  return { x: x0, y: y0, w, h }
}

function isOcrCandidate(node, mode) {
  if (!node?.visible || node.type !== 'text' || !node.rect) return false
  if (!String(node.textContent || '').trim()) return false
  if (mode === 'all') return true
  return !!(node.hiddenFrameworkAncestor || node.pixelInvisible)
}

function bestOcrMatch(node, items) {
  const target = normalizeForOcr(node.textContent)
  if (!target) return null

  let best = null
  for (const item of items) {
    const textScore = textSimilarity(target, normalizeForOcr(item.text))
    if (textScore < 0.7) continue

    const overlap = rectOverlap(node.rect, item.rect)
    if (overlap < 0.14) continue

    const confidence = item.confidence == null ? 1 : item.confidence
    if (confidence < 0.25) continue

    const score = textScore * 0.68 + overlap * 0.22 + confidence * 0.10
    if (!best || score > best.score) best = { item, score, overlap }
  }
  return best
}

function normalizeOcrItems(payload, canvas, imageSize) {
  const root = typeof payload === 'string' ? safeJson(payload) : payload
  const list = Array.isArray(root)
    ? root
    : root?.items || root?.results || root?.words || root?.data || []
  if (!Array.isArray(list)) return []

  const sourceSize = {
    w: Number(root?.width || root?.imageWidth || root?.canvas?.w || imageSize?.w || 0),
    h: Number(root?.height || root?.imageHeight || root?.canvas?.h || imageSize?.h || 0),
  }

  return list
    .map(item => {
      const text = String(item.text || item.content || item.value || item.words || '').trim()
      const rect = normalizeOcrRect(item, canvas, sourceSize)
      if (!text || !rect) return null
      return {
        text,
        rect,
        confidence: normalizeConfidence(item.confidence ?? item.score ?? item.probability),
      }
    })
    .filter(Boolean)
}

function normalizeOcrRect(item, canvas, sourceSize) {
  const raw = rectFromItem(item)
  if (!raw) return null

  let rect = { ...raw }
  const maxCoord = Math.max(rect.x + rect.w, rect.y + rect.h)
  if (maxCoord <= 1.5) {
    rect = {
      x: rect.x * canvas.w,
      y: rect.y * canvas.h,
      w: rect.w * canvas.w,
      h: rect.h * canvas.h,
    }
  } else if (sourceSize.w > 0 && sourceSize.h > 0 && (rect.x + rect.w > canvas.w || rect.y + rect.h > canvas.h)) {
    rect = {
      x: rect.x / sourceSize.w * canvas.w,
      y: rect.y / sourceSize.h * canvas.h,
      w: rect.w / sourceSize.w * canvas.w,
      h: rect.h / sourceSize.h * canvas.h,
    }
  }

  if (rect.w <= 0 || rect.h <= 0) return null
  return rect
}

function rectFromItem(item) {
  const r = item.rect || item.boundingBox || item.bbox || item.box
  if (Array.isArray(r)) {
    if (r.length === 4 && r.every(v => typeof v === 'number')) {
      return { x: r[0], y: r[1], w: r[2], h: r[3] }
    }
    if (r.length >= 4 && Array.isArray(r[0])) {
      return rectFromPoints(r)
    }
  }
  if (r && typeof r === 'object') {
    const x = Number(r.x ?? r.left ?? r.l)
    const y = Number(r.y ?? r.top ?? r.t)
    const w = Number(r.w ?? r.width ?? (Number(r.right) - x))
    const h = Number(r.h ?? r.height ?? (Number(r.bottom) - y))
    if ([x, y, w, h].every(Number.isFinite)) return { x, y, w, h }
  }
  if (Array.isArray(item.points)) return rectFromPoints(item.points)
  return null
}

function rectFromPoints(points) {
  const xs = points.map(p => Number(p[0] ?? p.x)).filter(Number.isFinite)
  const ys = points.map(p => Number(p[1] ?? p.y)).filter(Number.isFinite)
  if (!xs.length || !ys.length) return null
  const x1 = Math.min(...xs)
  const y1 = Math.min(...ys)
  const x2 = Math.max(...xs)
  const y2 = Math.max(...ys)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

function rectOverlap(a, b) {
  const inter = rectIntersectionArea(a, b)
  const basis = Math.max(1e-6, Math.min(a.w * a.h, b.w * b.h))
  return inter / basis
}

function textSimilarity(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length)
  return lcsLength(a, b) / Math.max(a.length, b.length)
}

function lcsLength(a, b) {
  const dp = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    let prev = 0
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[b.length]
}

function normalizeForOcr(text) {
  return normalizeText(text).replace(/[^\p{L}\p{N}]/gu, '')
}

function normalizeConfidence(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return n > 1 ? n / 100 : n
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
