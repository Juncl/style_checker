/**
 * Pass 4：强锚点周边拓扑匹配（重构版）
 *
 * 与旧版的根本区别：
 *   - 全程用 rect 绝对坐标，不碰 normRect
 *   - 从开发侧（arkui）未匹配节点出发，借文本强锚点的「方向 / 包含」关系，
 *     到设计侧对应锚点的同方向找候选，给开发节点配设计节点
 *   - 锚点都是文本叶子，只可能「被包含」，所以包含关系 = 锚点的视觉祖先
 *   - 只处理两类几何关系：与锚点【脱离】(正左右上下) 和【包含】(祖先)；
 *     与锚点相交但非包含的节点一律不碰
 *   - 分两轮：第一轮严格方向 + 序匹配 + 三维守门(AND)；
 *            第二轮放宽方向(含斜向) + 三维加权取最优
 *
 * 三维评分（统一复用 Pass1 的抛物线-高斯曲线 gaussianCurveParabola）：
 *   位置：posDiff = |欧氏(an中心,a_hm中心) − 欧氏(dn中心,a_de中心)|
 *         point.x = 0.2·maxDiag，拦截线 = 水平 1.5·maxAnchorW / 垂直 0.25·rootRectH
 *   面积：gaussianCurveParabola(area_an, area_dn, {x:1.3·minArea, y:0.5}, 3·minArea)
 *   宽高比：gaussianCurveParabola(rate_an, rate_dn, {x:0.86·minRate, y:0.5}, 2·minRate)
 *   第一轮三维都 >0 才通过(AND)；第二轮同样 AND 门控，过后按加权 0.5/0.25/0.25 取最优
 */
import { gaussianCurveParabola } from './allTextMatcher.js'
import { makePair } from './matchStrategies.js'
import { isCompatibleType, hasVisualDecoration } from '../utils/nodeVisibility.js'
import { computeIoU } from '../utils/matchGeometry.js'

const EPS = 0.5            // rect 包含 / 分离判定容差（dp/vp）
const ROUND2_MIN = 0.55   // 第二轮锁定的总分下限

// ── 几何小工具（纯 rect）────────────────────────────────────────────────────────
const center = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
const areaOf = r => r.w * r.h
const aspectOf = r => (r.h > 0 ? r.w / r.h : 0)
const euclid = (p, q) => Math.hypot(p.x - q.x, p.y - q.y)
const round4 = n => parseFloat(n.toFixed(4))

// outer 是否包住 inner（带容差）
function rectContains(outer, inner) {
  return outer.x <= inner.x + EPS &&
         outer.y <= inner.y + EPS &&
         outer.x + outer.w >= inner.x + inner.w - EPS &&
         outer.y + outer.h >= inner.y + inner.h - EPS
}
// 两 rect 本体是否分离（不相交）
function rectsDisjoint(a, b) {
  return a.x + a.w <= b.x + EPS || b.x + b.w <= a.x + EPS ||
         a.y + a.h <= b.y + EPS || b.y + b.h <= a.y + EPS
}
// 投影是否有交叠
const xOverlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > EPS
const yOverlap = (a, b) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > EPS

/**
 * 判定 nodeRect 相对 anchorRect 的几何关系：
 *   'contain'  node 包住 anchor（视觉祖先方向）
 *   'left/right/up/down'  本体脱离 + 落在锚点的同行带 / 同列带
 *   'diagonal' 本体脱离但斜对角（第一轮丢弃、第二轮可用）
 *   null       相交但非包含 → pass4 不碰
 */
function relation(nodeRect, anchorRect) {
  if (rectContains(nodeRect, anchorRect)) return 'contain'
  if (!rectsDisjoint(nodeRect, anchorRect)) return null
  const nc = center(nodeRect), ac = center(anchorRect)
  if (yOverlap(nodeRect, anchorRect)) return nc.x < ac.x ? 'left' : 'right'
  if (xOverlap(nodeRect, anchorRect)) return nc.y < ac.y ? 'up' : 'down'
  return 'diagonal'
}

// 方向桶内排序键：左右按 x 间距、上下按 y 间距
function dirDist(rect, anchorRect, dir) {
  const c = center(rect), ac = center(anchorRect)
  return (dir === 'left' || dir === 'right') ? Math.abs(c.x - ac.x) : Math.abs(c.y - ac.y)
}

// ── 三维评分 ───────────────────────────────────────────────────────────────────
function scorePosition(an, dn, aHm, aDe, dir, ctx) {
  const posDiff = Math.abs(
    euclid(center(an.rect), center(aHm.rect)) -
    euclid(center(dn.rect), center(aDe.rect))
  )
  const horizontalMax = 1.5 * Math.max(aHm.rect.w, aDe.rect.w)
  const verticalMax = 0.25 * ctx.rootRectH
  let diffmax
  if (dir === 'left' || dir === 'right') diffmax = horizontalMax
  else if (dir === 'up' || dir === 'down') diffmax = verticalMax
  else diffmax = Math.max(horizontalMax, verticalMax) // contain / diagonal
  return gaussianCurveParabola(0, posDiff, { x: 0.2 * ctx.maxDiag, y: 0.5 }, diffmax)
}

function scoreArea(an, dn) {
  const aa = areaOf(an.rect), ad = areaOf(dn.rect)
  const minArea = Math.min(aa, ad)
  if (minArea <= 0) return 0
  return gaussianCurveParabola(aa, ad, { x: 1.3 * minArea, y: 0.5 }, 3 * minArea)
}

function scoreAspect(an, dn) {
  const ra = aspectOf(an.rect), rd = aspectOf(dn.rect)
  const minRate = Math.min(ra, rd)
  if (minRate <= 0) return 0
  return gaussianCurveParabola(ra, rd, { x: 0.86 * minRate, y: 0.5 }, 2 * minRate)
}

// 返回 { pass, score }：pass = 三维都 >0（AND 门控）；score = 0.5/0.25/0.25 加权
function tripleScore(an, dn, aHm, aDe, dir, ctx) {
  const ps = scorePosition(an, dn, aHm, aDe, dir, ctx)
  const as = scoreArea(an, dn)
  const rs = scoreAspect(an, dn)
  return { pass: ps > 0 && as > 0 && rs > 0, score: ps * 0.5 + as * 0.25 + rs * 0.25 }
}

// ── 主入口 ─────────────────────────────────────────────────────────────────────
export function matchByAnchorTopology(designNodes, arkuiNodes, anchors, usedArkui, matchedDesignIds, regionContext, options = {}) {
  const { diagDe = 1, diagHm = 1, canvasHeight, canvasHeightVp } = options
  const ctx = {
    maxDiag: Math.max(diagDe, diagHm),
    rootRectH: Math.max(canvasHeight ?? 0, canvasHeightVp ?? 0) || Math.max(diagDe, diagHm),
  }
  if (!anchors.length) return []

  const availArkui = arkuiNodes.filter(n => !usedArkui.has(n.id))
  const availDesign = designNodes.filter(n => !matchedDesignIds.has(n.id))

  const result = []
  const lockedArkui = new Set()
  const lockedDesign = new Set()

  // ── 第一轮：严格方向 + 序匹配（脱离）/ 最高分（包含）+ 三维守门 AND ──────────────
  const round1 = [] // { an, dn, score }
  for (const anchor of anchors) {
    const aHm = anchor.arkui, aDe = anchor.design

    // 脱离四方向：两侧同方向桶序匹配（第 k 对第 k）
    for (const dir of ['left', 'right', 'up', 'down']) {
      const arkuiBucket = availArkui
        .filter(n => relation(n.rect, aHm.rect) === dir)
        .sort((p, q) => dirDist(p.rect, aHm.rect, dir) - dirDist(q.rect, aHm.rect, dir))
      const designBucket = availDesign
        .filter(n => relation(n.rect, aDe.rect) === dir)
        .sort((p, q) => dirDist(p.rect, aDe.rect, dir) - dirDist(q.rect, aDe.rect, dir))
      const len = Math.min(arkuiBucket.length, designBucket.length)
      for (let k = 0; k < len; k++) {
        const an = arkuiBucket[k], dn = designBucket[k]
        if (!isCompatibleType(dn, an)) continue
        const t = tripleScore(an, dn, aHm, aDe, dir, ctx)
        if (t.pass) round1.push({ an, dn, score: t.score })
      }
    }

    // 包含：两侧视觉祖先候选组，三维取最高分
    const arkuiAnc = availArkui.filter(n => hasVisualDecoration(n) && relation(n.rect, aHm.rect) === 'contain')
    const designAnc = availDesign.filter(n => hasVisualDecoration(n) && relation(n.rect, aDe.rect) === 'contain')
    for (const an of arkuiAnc) {
      let best = null
      for (const dn of designAnc) {
        if (!isCompatibleType(dn, an)) continue
        const t = tripleScore(an, dn, aHm, aDe, 'contain', ctx)
        if (t.pass && (!best || t.score > best.score)) best = { dn, score: t.score }
      }
      if (best) round1.push({ an, dn: best.dn, score: best.score })
    }
  }

  // 全局裁决：分数降序贪心，一个 an / 一个 dn 各只用一次
  round1.sort((a, b) => b.score - a.score)
  for (const { an, dn, score } of round1) {
    if (lockedArkui.has(an.id) || lockedDesign.has(dn.id)) continue
    lockedArkui.add(an.id); lockedDesign.add(dn.id)
    result.push(makePair(dn, an, 'anchor-topology', {
      confidence: 'high',
      topologyScore: round4(score),
      iou: computeIoU(dn.normRect, an.normRect),
    }))
  }

  // ── 第二轮：放宽方向(含斜向) + 三维加权取最优 ────────────────────────────────────
  const round2 = []
  for (const an of availArkui) {
    if (lockedArkui.has(an.id)) continue
    let best = null
    for (const anchor of anchors) {
      const aHm = anchor.arkui, aDe = anchor.design
      const dirHm = relation(an.rect, aHm.rect)
      if (dirHm === null) continue // 相交非包含，不碰
      for (const dn of availDesign) {
        if (lockedDesign.has(dn.id)) continue
        if (!isCompatibleType(dn, an)) continue
        if (relation(dn.rect, aDe.rect) === null) continue
        const t = tripleScore(an, dn, aHm, aDe, dirHm, ctx)
        if (t.pass && t.score >= ROUND2_MIN && (!best || t.score > best.score)) {
          best = { dn, score: t.score }
        }
      }
    }
    if (best) round2.push({ an, dn: best.dn, score: best.score })
  }

  round2.sort((a, b) => b.score - a.score)
  for (const { an, dn, score } of round2) {
    if (lockedArkui.has(an.id) || lockedDesign.has(dn.id)) continue
    lockedArkui.add(an.id); lockedDesign.add(dn.id)
    result.push(makePair(dn, an, 'anchor-topology', {
      confidence: score > 0.72 ? 'medium' : 'low',
      topologyScore: round4(score),
      iou: computeIoU(dn.normRect, an.normRect),
    }))
  }

  return result
}
