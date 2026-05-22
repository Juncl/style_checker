import { makePair } from './matchStrategies.js'
import { normalizeText, textSemanticSimilarity, parseArgb } from '../utils/textSemantics.js'

/**
 * 新版 Pass 1：全文本节点加权匹配
 *
 * 以 ArkUI(hm) 为外层主序，对每个 ArkUI 文本节点遍历全部 design(pix) 文本节点，
 * 用 5 个子评分（内容/颜色/字号/字重/位置）加权出 finalScore，取最高分候选。
 * finalScore ≥ 可信阈值的匹配视为「可信文本」，转成强锚点 MatchPair。
 *
 * 入口：matchAllTextNodes(designNodes, arkuiNodes)
 */

// 可信文本阈值：finalScore ≥ 此值视为高置信匹配，转成 pair
const CREDIBLE_THRESHOLD = 0.9

// 位置子分参数：以归一化坐标系下画布对角线（√2）为基准
const DIAGONAL = Math.SQRT2
const PLACE_POINT = { x: 0.2 * DIAGONAL, y: 0.5 } // 中心距 = 对角线 20% 时得 0.5
const PLACE_DIFFMAX = 0.5 * DIAGONAL              // 中心距 ≥ 对角线一半时截断为 0

// ─── 抛物线-高斯分段曲线 ───────────────────────────────────────────────────────
/**
 * 抛物线-高斯分段曲线
 * - num1 === num2          → 1
 * - diff > diffmax         → 0
 * - diff ≤ point.x         → 抛物线段 1 - a·diff²
 * - diff > point.x         → 高斯段 exp(-diff²/2σ²)
 * 抛物线与高斯在 diff = point.x 处衔接，值均为 point.y。
 */
function gaussianCurveParabola(num1, num2, point, diffmax) {
  const diff = Math.abs(num1 - num2)
  if (num1 === num2) return 1
  if (diff > diffmax) return 0

  const { x, y } = point
  const a = (1 - y) / (x * x)                      // 抛物线系数
  const sigma = x / Math.sqrt(-2 * Math.log(y))    // 高斯 sigma

  let score
  if (diff <= x) {
    score = 1 - a * diff * diff                    // 抛物线段
  } else {
    score = Math.exp(-(diff * diff) / (2 * sigma * sigma)) // 高斯段
  }
  return parseFloat(score.toFixed(4))
}

// ─── 五个子评分函数 ────────────────────────────────────────────────────────────

/** 编辑距离（Levenshtein），滚动数组实现 */
function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let cur = new Array(n + 1)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]
}

/**
 * 子评分1 · 内容相似度：编辑距离 + 语义算法结合
 * 完全相同优先：归一化后完全一致 → 1；否则取「编辑距离归一化」与「语义相似度」的较大值
 */
function textSimilar(c1, c2) {
  const t1 = normalizeText(c1)
  const t2 = normalizeText(c2)
  if (!t1 || !t2) return 0
  if (t1 === t2) return 1

  const maxLen = Math.max(t1.length, t2.length)
  const editScore = maxLen > 0 ? 1 - levenshtein(t1, t2) / maxLen : 0
  const semanticScore = textSemanticSimilarity(c1, c2)
  return Math.max(editScore, semanticScore)
}

/** 将 ARGB 颜色按 alpha 与白底混合，得到不透明 RGB：ch' = ch·α + 255·(1-α) */
function blendOnWhite(argb) {
  const alpha = argb.a / 255
  return {
    r: argb.r * alpha + 255 * (1 - alpha),
    g: argb.g * alpha + 255 * (1 - alpha),
    b: argb.b * alpha + 255 * (1 - alpha),
  }
}

/**
 * 子评分2 · 颜色相似度：考虑 alpha 补偿（与白底混合后比较）
 * distance = |dR|+|dG|+|dB|（曼哈顿距离，最大 765），score = max(0, 1 - distance/765)
 * 任一侧无颜色值 → 视为不构成差异，返回 1
 */
function getSimilarityColor(c1, c2) {
  const p1 = parseArgb(c1)
  const p2 = parseArgb(c2)
  if (!p1 || !p2) return 1

  const b1 = blendOnWhite(p1)
  const b2 = blendOnWhite(p2)
  const distance =
    Math.abs(b1.r - b2.r) + Math.abs(b1.g - b2.g) + Math.abs(b1.b - b2.b)
  return Math.max(0, 1 - distance / 765)
}

/**
 * 子评分3 · 字号相似度：抛物线-高斯曲线，差 4 得 0.5，差 ≥12 得 0
 * 任一侧无字号 → 视为不构成差异，返回 1
 */
function getSimilaritySize(s1, s2) {
  if (s1 == null || s2 == null) return 1
  return gaussianCurveParabola(s1, s2, { x: 4, y: 0.5 }, 12)
}

/**
 * 子评分4 · 字重相似度：抛物线-高斯曲线，差 300 得 0.5，差 ≥600 得 0
 * 任一侧无字重 → 视为不构成差异，返回 1（避免误触发一票否决）
 */
function getWeightScore(w1, w2) {
  if (w1 == null || w2 == null) return 1
  return gaussianCurveParabola(w1, w2, { x: 300, y: 0.5 }, 600)
}

/**
 * 子评分5 · 位置相似度：normRect 中心点欧氏距离套抛物线-高斯曲线
 * 中心距 = 对角线 20% 时得 0.5，≥ 对角线一半时截断为 0
 */
function getPlaceScore(n1, n2) {
  const c1x = n1.normRect.x + n1.normRect.w / 2
  const c1y = n1.normRect.y + n1.normRect.h / 2
  const c2x = n2.normRect.x + n2.normRect.w / 2
  const c2y = n2.normRect.y + n2.normRect.h / 2
  const dist = Math.hypot(c1x - c2x, c1y - c2y)
  return gaussianCurveParabola(0, dist, PLACE_POINT, PLACE_DIFFMAX)
}

/**
 * 最终加权评分
 * - 一票否决：位置或字重子分为 0 → finalScore = 0
 * - 高可信特殊分支：字色/字号/字重均为 1 且位置 ≥ 0.9 → content·0.15 + place·0.6 + 0.25
 * - 普通加权：content·0.25 + color·0.15 + size·0.15 + place·0.35 + weight·0.1
 */
function getTextFinalScore(content, color, size, weight, place) {
  if (place === 0 || weight === 0) return 0
  if (color === 1 && size === 1 && weight === 1 && place >= 0.9) {
    return content * 0.15 + place * 0.6 + 0.25
  }
  return content * 0.25 + color * 0.15 + size * 0.15 + place * 0.35 + weight * 0.1
}

// ─── 主流程 ────────────────────────────────────────────────────────────────────

/**
 * 全文本节点加权匹配
 * @param {UnifiedNode[]} designNodes 设计侧节点（pix）
 * @param {UnifiedNode[]} arkuiNodes  开发侧节点（hm）
 * @returns {{
 *   pairs: MatchPair[],            // 可信文本（≥阈值）去重后的强锚点 pair
 *   textHmMapPix: object,          // 全部 hm→de 最高分映射（含 <阈值）
 *   textHmMapPixCredible: object,  // 仅 ≥阈值 的 hm→de 映射
 *   textHmMapPixDetail: object,    // 每个 hm 的完整比对详情
 * }}
 */
export function matchAllTextNodes(designNodes, arkuiNodes) {
  const hmTextNodes = arkuiNodes.filter(
    n => n.type === 'text' && normalizeText(n.textContent)
  )
  const deTextNodes = designNodes.filter(
    n => n.type === 'text' && normalizeText(n.textContent)
  )

  const textHmMapPix = {}
  const textHmMapPixCredible = {}
  const textHmMapPixDetail = {}

  // 阶段一/二：遍历每个 hm 文本节点，对所有 de 文本节点打分，取最高分候选
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
      const placeScore = getPlaceScore(hm, de)
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

  // 多对一去重：多个 hm 命中同一 de，仅保留 maxScore 最高者，其余舍弃
  // 只在可信集合内做（只有 ≥阈值 的匹配会转成 pair）
  const deToHm = new Map() // deId → { hmId, score }
  for (const hmId of Object.keys(textHmMapPixCredible)) {
    const deId = textHmMapPixCredible[hmId]
    const score = textHmMapPixDetail[hmId].maxScore
    const existing = deToHm.get(deId)
    if (!existing || score > existing.score) {
      deToHm.set(deId, { hmId, score })
    }
  }

  // 转 pairs：可信文本视为高置信强锚点
  const hmMap = new Map(arkuiNodes.map(n => [n.id, n]))
  const deMap = new Map(designNodes.map(n => [n.id, n]))
  const pairs = []
  for (const [deId, { hmId, score }] of deToHm) {
    const hm = hmMap.get(hmId)
    const de = deMap.get(deId)
    if (!hm || !de) continue
    const pair = makePair(de, hm, 'text-content', {
      confidence: 'high',
      topologyScore: score,
      isAnchor: true,
    })
    pair.matchSource = 'creText'
    pairs.push(pair)
  }

  return { pairs, textHmMapPix, textHmMapPixCredible, textHmMapPixDetail }
}
