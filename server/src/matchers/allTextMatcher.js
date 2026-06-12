import { makePair } from './matchStrategies.js'
import { normalizeText, textSemanticSimilarity, parseArgb, extractMainTone } from '../utils/textSemantics.js'

/**
 * 新版 Pass 1：全文本节点加权匹配
 *
 * 以 ArkUI(hm) 为外层主序，对每个 ArkUI 文本节点遍历全部 design(pix) 文本节点，
 * 用 5 个子评分（内容/颜色/字号/字重/位置）加权出 finalScore，取最高分候选。
 * finalScore ≥ 可信阈值的匹配视为「可信文本」，转成强锚点 MatchPair。
 *
 * 入口：matchAllTextNodes(designNodes, arkuiNodes, options)
 */

// 可信文本阈值：finalScore ≥ 此值视为高置信匹配，转成 pair
const CREDIBLE_THRESHOLD = 0.9

// ─── 抛物线-高斯分段曲线 ───────────────────────────────────────────────────────
/**
 * 抛物线-高斯分段曲线
 * - num1 === num2          → 1
 * - diff > diffmax         → 0
 * - diff ≤ point.x         → 抛物线段 1 - a·diff²
 * - diff > point.x         → 高斯段 exp(-diff²/2σ²)
 * 抛物线与高斯在 diff = point.x 处衔接，值均为 point.y。
 */
export function gaussianCurveParabola(num1, num2, point, diffmax) {
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

/** 计算 Levenshtein 编辑距离相似度 (0-1) */
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
        dp[j][i - 1] + 1,      // 插入
        dp[j - 1][i] + 1,      // 删除
        dp[j - 1][i - 1] + cost // 替换
      )
    }
  }

  const distance = dp[len2][len1]
  return 1 - distance / maxLen
}

/**
 * 子评分1 · 内容相似度：fuse.js 编辑距离 + 语义相似度 + 前后缀结构相似
 * 完全相同优先：数字归一化后完全一致 → 1
 * 前后缀相似：前≥2字符或后≥2字符相同 → 加权融合（edit:semantic:prefixSuffix = 0.5:0.25:0.25）
 * 无前后缀匹配：取编辑距离和语义的较大值，但至少不低于编辑距离
 */
function textSimilar(c1, c2) {
  const t1 = normalizeText(c1)
  const t2 = normalizeText(c2)
  if (!t1 || !t2) return 0
  if (t1 === t2) return 1

  // 数字归一化后的编辑距离
  const t1n = t1.replace(/\d+/g, '0')
  const t2n = t2.replace(/\d+/g, '0')
  if (t1n === t2n) return 1

  const editScore = levenshteinSimilarity(t1n, t2n)
  const semanticScore = textSemanticSimilarity(c1, c2)

  // 前后缀相似度计算
  let prefixSuffixScore = 0
  const lenDiff = Math.abs(t1n.length - t2n.length)
  if (lenDiff <= 3) {
    const hasPrefixMatch = t1n.length >= 2 && t2n.length >= 2 && t1n.substring(0, 2) === t2n.substring(0, 2)
    const hasSuffixMatch = t1n.length >= 2 && t2n.length >= 2 && t1n.slice(-2) === t2n.slice(-2)

    if (hasPrefixMatch || hasSuffixMatch) {
      prefixSuffixScore = 0.7 + (1 - lenDiff / 3) * 0.3
    }
  }

  // 加权融合：edit 0.63、semantic 0.12、prefixSuffix 0.25
  if (prefixSuffixScore > 0) {
    const weightedScore = editScore * 0.63 + semanticScore * 0.12 + prefixSuffixScore * 0.25
    return Math.max(weightedScore, editScore)
  }

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
  const p1 = parseArgb(extractMainTone(c1))
  const p2 = parseArgb(extractMainTone(c2))
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
 * 子评分5 · 位置相似度：三维加权（欧氏0.6 + x轴0.3 + y轴0.1），双向计算取较高分
 * - 顶部对齐：以左上角坐标分别计算欧氏/x/y三个高斯分后加权
 * - 底部对齐：各自用"距画布底边距离"计算（适配 design 画布比 arkui 更长的场景）
 * - x轴参数：point={x:0.3*rootRectW, y:0.5}, diffmax=0.6*rootRectW
 * - y轴参数：point={x:0.4*rootRectMaxH, y:0.5}, diffmax=0.8*rootRectMaxH
 * - 欧氏参数沿用 diagonal（对角线均值）
 */
function getPlaceScore(hmNode, deNode, diagonal, canvasHeightHm, canvasHeightDe, rootRectW, rootRectMaxH) {
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

  // 顶部对齐
  const topScore = weightedScore(hmX - deX, hmY - deY)

  // 底部对齐（各自距底边）
  const hmYBot = canvasHeightHm - hmY
  const deYBot = canvasHeightDe - deY
  const botScore = weightedScore(hmX - deX, hmYBot - deYBot)

  return Math.max(topScore, botScore)
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
 * @param {{ canvasWidthVp, canvasHeightVp, canvasWidth, canvasHeight }} options 画布尺寸（用于位置子分）
 * @returns {{
 *   pairs: MatchPair[],            // 可信文本（≥阈值）去重后的强锚点 pair
 *   textHmMapPix: object,          // 全部 hm→de 最高分映射（含 <阈值）
 *   textHmMapPixCredible: object,  // 仅 ≥阈值 的 hm→de 映射
 *   textHmMapPixDetail: object,    // 每个 hm 的完整比对详情
 * }}
 */
export function matchAllTextNodes(designNodes, arkuiNodes, options = {}) {
  const {
    canvasWidthVp = 376, canvasHeightVp = 809,
    canvasWidth = 360, canvasHeight = 947,
  } = options
  const diagHm = Math.hypot(canvasWidthVp, canvasHeightVp)
  const diagDe = Math.hypot(canvasWidth, canvasHeight)
  const diagonal = (diagHm + diagDe) / 2
  const rootRectW = (canvasWidthVp + canvasWidth) / 2
  const rootRectMaxH = Math.max(canvasHeightVp, canvasHeight)
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
