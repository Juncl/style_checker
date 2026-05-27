import { makePair } from './matchStrategies.js'
import { colorDelta } from '../utils/colorUtils.js'

const LONG_TEXT_MIN_LENGTH = 12
const ACCEPT_THRESHOLD     = 0.55
const MEDIUM_THRESHOLD     = 0.75
const MAX_ANCHORS          = 3

// ── 几何工具 ──────────────────────────────────────────────────────────────────

function centerOf(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}

function euclidean(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// ── 锚点方向判断 ──────────────────────────────────────────────────────────────

/** 判断 nodeRect 与 anchorRect 是否同行：y 范围有重叠 */
function isSameRow(nodeRect, anchorRect) {
  return nodeRect.y <= anchorRect.y + anchorRect.h &&
         anchorRect.y <= nodeRect.y + nodeRect.h
}

/** 计算节点相对于锚点的垂直方向 */
function verticalDir(nodeRect, anchorRect) {
  if (isSameRow(nodeRect, anchorRect)) return 'same-row'
  return centerOf(nodeRect).y < centerOf(anchorRect).y ? 'above' : 'below'
}

/**
 * 一票否决检查：
 * - 以 ArkUI 侧欧氏距离选取最近 MAX_ANCHORS 个锚点
 * - 任一侧为同行 → 该锚点跳过
 * - 两侧方向不一致（一上一下）→ 立即否决
 */
function isVetoed(an, dn, topologyAnchors) {
  if (!topologyAnchors || topologyAnchors.length === 0) return false

  const anCenter = centerOf(an.rect)
  const nearest = topologyAnchors
    .filter(a => a.arkui?.rect && a.design?.rect)
    .map(a => ({ pair: a, dist: euclidean(anCenter, centerOf(a.arkui.rect)) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, MAX_ANCHORS)

  for (const { pair } of nearest) {
    const dirAn = verticalDir(an.rect, pair.arkui.rect)
    const dirDn = verticalDir(dn.rect, pair.design.rect)
    if (dirAn === 'same-row' || dirDn === 'same-row') continue
    if (dirAn !== dirDn) return true
  }
  return false
}

// ── 评分函数 ──────────────────────────────────────────────────────────────────

/** 内容分：原文本 Levenshtein 相似度（权重 0.05） */
function scoreContent(dn, an) {
  const t1 = String(dn.textContent || '').trim()
  const t2 = String(an.textContent || '').trim()
  if (!t1 || !t2) return 0
  if (t1 === t2) return 1
  const len1 = t1.length, len2 = t2.length
  const maxLen = Math.max(len1, len2)
  const prev = Array.from({ length: len1 + 1 }, (_, i) => i)
  const curr = new Array(len1 + 1)
  for (let j = 1; j <= len2; j++) {
    curr[0] = j
    for (let i = 1; i <= len1; i++) {
      const cost = t1[i - 1] === t2[j - 1] ? 0 : 1
      curr[i] = Math.min(curr[i - 1] + 1, prev[i] + 1, prev[i - 1] + cost)
    }
    prev.splice(0, len1 + 1, ...curr)
  }
  return 1 - prev[len1] / maxLen
}

/** 样式分：字号(0.405) + 字重(0.262) + 字色(0.333)，缺失维度从权重中排除 */
function scoreStyle(dn, an) {
  const ds = dn.style || {}
  const as = an.style || {}
  let score = 0, weight = 0

  if (ds.fontSize != null && as.fontSize != null) {
    weight += 0.405
    score  += Math.max(0, 1 - Math.abs(ds.fontSize - as.fontSize) / 6) * 0.405
  }
  if (ds.fontWeight != null && as.fontWeight != null) {
    weight += 0.262
    score  += Math.max(0, 1 - Math.abs(ds.fontWeight - as.fontWeight) / 400) * 0.262
  }
  if (ds.fontColor && as.fontColor) {
    weight += 0.333
    // colorDelta: ARGB 四通道欧氏距离，最大 ≈ 510
    score  += Math.max(0, 1 - colorDelta(ds.fontColor, as.fontColor) / 510) * 0.333
  }
  return weight > 0 ? score / weight : 0.75
}

/** 抛物线-高斯曲线（与 allTextMatcher 保持一致） */
function gaussianParabola(dist, point, diffmax) {
  if (dist === 0) return 1
  if (dist > diffmax) return 0
  const { x, y } = point
  const a     = (1 - y) / (x * x)
  const sigma = x / Math.sqrt(-2 * Math.log(y))
  return dist <= x
    ? 1 - a * dist * dist
    : Math.exp(-(dist * dist) / (2 * sigma * sigma))
}

/** 位置分：绝对中心点距离，左上/左下双向对齐取较高分 */
function scorePosition(an, dn, options) {
  const { canvasWidthVp, canvasHeightVp, canvasWidth, canvasHeight } = options
  const diagonal = (Math.hypot(canvasWidthVp, canvasHeightVp) + Math.hypot(canvasWidth, canvasHeight)) / 2
  const point   = { x: 0.2 * diagonal, y: 0.5 }
  const diffmax = 0.5 * diagonal

  const bothCenter = an.style?.textAlign === 'center' && dn.style?.textAlign === 'center'
  const anX = bothCenter ? an.rect.x + an.rect.w / 2 : an.rect.x
  const anY = bothCenter ? an.rect.y + an.rect.h / 2 : an.rect.y
  const dnX = bothCenter ? dn.rect.x + dn.rect.w / 2 : dn.rect.x
  const dnY = bothCenter ? dn.rect.y + dn.rect.h / 2 : dn.rect.y

  const topDist = Math.hypot(anX - dnX, anY - dnY)
  const topScore = gaussianParabola(topDist, point, diffmax)

  const anYBot = canvasHeightVp - anY
  const dnYBot = canvasHeight   - dnY
  const botDist = Math.hypot(anX - dnX, anYBot - dnYBot)
  const botScore = gaussianParabola(botDist, point, diffmax)

  return Math.max(topScore, botScore)
}

// ── 主入口 ────────────────────────────────────────────────────────────────────

/**
 * Pass 1.5：长文本位置-样式兜底匹配
 *
 * 触发：开发侧未匹配文本节点字数 > 12，从设计侧未匹配文本节点中捞取候选。
 * 评分：position×0.60 + style×0.35 + content×0.05
 * 否决：最近 3 个锚点任一上下方向不一致即否决该候选对。
 */
export function matchLongTextFallback(
  designNodes,
  arkuiNodes,
  usedArkui,
  matchedDesignIds,
  topologyAnchors,
  options = {}
) {
  const result       = []
  const localUsed    = new Set()
  const localMatched = new Set()

  const arkuiLong = arkuiNodes.filter(n =>
    n.type === 'text' &&
    !usedArkui.has(n.id) &&
    String(n.textContent || '').trim().length > LONG_TEXT_MIN_LENGTH
  )
  if (arkuiLong.length === 0) return result

  const designText = designNodes.filter(n =>
    n.type === 'text' &&
    !matchedDesignIds.has(n.id)
  )
  if (designText.length === 0) return result

  const candidates = []
  for (const an of arkuiLong) {
    for (const dn of designText) {
      if (isVetoed(an, dn, topologyAnchors)) continue
      const pos     = scorePosition(an, dn, options)
      const style   = scoreStyle(dn, an)
      const content = scoreContent(dn, an)
      const final   = pos * 0.60 + style * 0.35 + content * 0.05
      if (final >= ACCEPT_THRESHOLD) {
        candidates.push({ an, dn, score: final })
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  for (const { an, dn, score } of candidates) {
    if (localUsed.has(an.id) || localMatched.has(dn.id)) continue
    result.push(makePair(dn, an, 'long-text-fallback', {
      iou:           0,
      confidence:    score >= MEDIUM_THRESHOLD ? 'medium' : 'low',
      topologyScore: score,
    }))
    localUsed.add(an.id)
    localMatched.add(dn.id)
  }

  return result
}
