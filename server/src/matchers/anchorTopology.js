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
// 纯 y 方向：outer 整体在 inner 正上方 / 正下方（本体脱离，不要求横向覆盖）
const isAbove = (outer, inner) => outer.y + outer.h <= inner.y + EPS
const isBelow = (outer, inner) => outer.y >= inner.y + inner.h - EPS

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
  // 全局硬上限：位置差超过 max 对角线长度的 1/4 一律截断归 0
  diffmax = Math.min(diffmax, 0.25 * ctx.maxDiag)
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

// ── 上下方向专用：放宽方向判定 + 边缘间距守门 + 相对锚点左上角的位置评分 ──────────────
// 放宽的上下关系：纯 y 脱离即算正上 / 正下（不要求 x 投影重叠）
function verticalRelation(nodeRect, anchorRect) {
  if (nodeRect.y + nodeRect.h <= anchorRect.y + EPS) return 'up'
  if (nodeRect.y >= anchorRect.y + anchorRect.h - EPS) return 'down'
  return null
}
// 节点与锚点的上下边缘间距（空隙）
function edgeGap(nodeRect, anchorRect, dir) {
  return dir === 'up'
    ? anchorRect.y - (nodeRect.y + nodeRect.h)
    : nodeRect.y - (anchorRect.y + anchorRect.h)
}
// 位置评分：相对锚点左上角的位移差，欧氏/x/y 三维高斯加权（参数沿用 getPlaceScore ÷2，权重 0.5/0.38/0.12）
function posScoreVertical(an, dn, aHm, aDe, ctx) {
  const dx = (an.rect.x - aHm.rect.x) - (dn.rect.x - aDe.rect.x)
  const dy = (an.rect.y - aHm.rect.y) - (dn.rect.y - aDe.rect.y)
  const eu = gaussianCurveParabola(0, Math.hypot(dx, dy), { x: 0.1 * ctx.diag, y: 0.5 }, 0.25 * ctx.diag)
  const xs = gaussianCurveParabola(0, Math.abs(dx), { x: 0.15 * ctx.rootW, y: 0.5 }, 0.3 * ctx.rootW)
  const ys = gaussianCurveParabola(0, Math.abs(dy), { x: 0.2 * ctx.rootMaxH, y: 0.5 }, 0.4 * ctx.rootMaxH)
  return eu * 0.5 + xs * 0.38 + ys * 0.12
}
// 上下三维：位置(新算法)·0.5 + 面积·0.25 + 宽高比·0.25，三维都 >0 才通过
function verticalTriple(an, dn, aHm, aDe, ctx) {
  const ps = posScoreVertical(an, dn, aHm, aDe, ctx)
  const as = scoreArea(an, dn)
  const rs = scoreAspect(an, dn)
  return { pass: ps > 0 && as > 0 && rs > 0, score: ps * 0.5 + as * 0.25 + rs * 0.25 }
}

// ── 主入口 ─────────────────────────────────────────────────────────────────────
export function matchByAnchorTopology(designNodes, arkuiNodes, anchors, usedArkui, matchedDesignIds, regionContext, options = {}) {
  const { diagDe = 1, diagHm = 1, canvasHeight, canvasHeightVp, canvasWidth, canvasWidthVp } = options
  const fallback = Math.max(diagDe, diagHm)
  const ctx = {
    maxDiag: Math.max(diagDe, diagHm),
    rootRectH: Math.max(canvasHeight ?? 0, canvasHeightVp ?? 0) || fallback,
    // 上下三维位置评分沿用高可信文本距离算法口径
    diag: (diagDe + diagHm) / 2,
    rootW: ((canvasWidth ?? 0) + (canvasWidthVp ?? 0)) / 2 || fallback,
    rootMaxH: Math.max(canvasHeight ?? 0, canvasHeightVp ?? 0) || fallback,
  }
  if (!anchors.length) return []

  const availArkui = arkuiNodes.filter(n => !usedArkui.has(n.id))
  const availDesign = designNodes.filter(n => !matchedDesignIds.has(n.id))

  const result = []
  const lockedArkui = new Set()
  const lockedDesign = new Set()

  // 取某锚点某方向上、离锚点最近的 1 个节点（可带候选过滤）
  const nearestInDir = (nodes, anchorRect, dir, filter) => {
    let best = null, bestD = Infinity
    for (const n of nodes) {
      if (relation(n.rect, anchorRect) !== dir) continue
      if (filter && !filter(n)) continue
      const d = dirDist(n.rect, anchorRect, dir)
      if (d < bestD) { bestD = d; best = n }
    }
    return best
  }

  // 双向包含一致性：容器 an/dn 对每个 pass1 锚点的「包 / 不包」必须两侧完全一致
  // （an 包某锚点 ⟺ dn 也包该锚点对端；an 不包 ⟺ dn 也不包）
  const consistentWithAnchors = (an, dn) => anchors.every(s => {
    if (s.arkui.id === an.id || s.design.id === dn.id) return true
    return rectContains(an.rect, s.arkui.rect) === rectContains(dn.rect, s.design.rect)
  })

  // ── 第一轮 ① 包含匹配：锚点视觉祖先容器先跑先锁定（包含=拓扑关系，比方向更可信）──
  const round1Contain = []
  for (const anchor of anchors) {
    const aHm = anchor.arkui, aDe = anchor.design
    const arkuiAnc = availArkui.filter(n => hasVisualDecoration(n) && relation(n.rect, aHm.rect) === 'contain')
    const designAnc = availDesign.filter(n => hasVisualDecoration(n) && relation(n.rect, aDe.rect) === 'contain')
    for (const an of arkuiAnc) {
      let best = null
      for (const dn of designAnc) {
        if (!isCompatibleType(dn, an)) continue
        if (!consistentWithAnchors(an, dn)) continue // 双向包含一致性：包了一起包、没包一起不包
        const t = tripleScore(an, dn, aHm, aDe, 'contain', ctx)
        if (t.pass && (!best || t.score > best.score)) best = { dn, score: t.score }
      }
      if (best) round1Contain.push({ an, dn: best.dn, score: best.score })
    }
  }
  round1Contain.sort((a, b) => b.score - a.score)
  for (const { an, dn, score } of round1Contain) {
    if (lockedArkui.has(an.id) || lockedDesign.has(dn.id)) continue
    lockedArkui.add(an.id); lockedDesign.add(dn.id)
    result.push(makePair(dn, an, 'anchor-topology-包含', { confidence: 'high', topologyScore: round4(score), iou: computeIoU(dn.normRect, an.normRect) }))
  }

  // 包含强锚点组 = 原文本锚点 + 刚锁定的包含容器配对；约束左右/上下候选
  const strongC = [...anchors, ...result]
  // 包含一致性：an 落在某容器内 ⟺ dn 落在其设计侧对端内（嵌套要求所有层一致）
  const containConsistent = (an, dn) => strongC.every(s => {
    if (s.arkui.id === an.id || s.design.id === dn.id) return true
    return rectContains(s.arkui.rect, an.rect) === rectContains(s.design.rect, dn.rect)
  })
  // 方向一致性：对每个 pass1 锚点，an 只要与锚点「脱离」（上/下/左/右/斜向）就约束 dn ——
  // 卡两类明确矛盾：相交(dn 与对端部分重叠非包含) 与 反向(上↔下/左↔右)；放行同向/斜向/包含。
  // （1819上↔64272相交、1828斜脱离↔64270相交 都被卡；「上↔斜上」这类布局微差放行，不误杀）
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' }
  const directionConsistent = (an, dn) => anchors.every(s => {
    const ra = relation(an.rect, s.arkui.rect)
    if (ra === null || ra === 'contain') return true      // an 与锚点相交/包含 → 不约束
    const rd = relation(dn.rect, s.design.rect)
    if (rd === null) return false                          // 脱离 vs 相交 → 矛盾
    return rd !== OPPOSITE[ra]                              // 反向 → 矛盾
  })

  // ── 第一轮 ②③ 左右最近邻 / 上下守门带：先各自算候选排行，再竞争式稳定匹配 ──
  // 每个 an 收集候选 dn：(an,dn) 取最优途径（水平优先，再分数），过包含一致性 + 三维守门 AND
  const candMap = new Map() // anId → Map<dnId, { dn, horizontal, score }>
  const betterNom = (a, b) => a.horizontal !== b.horizontal ? a.horizontal : a.score > b.score
  const addNom = (an, dn, horizontal, score) => {
    if (!candMap.has(an.id)) candMap.set(an.id, new Map())
    const m = candMap.get(an.id)
    const ex = m.get(dn.id)
    if (!ex || betterNom({ horizontal, score }, ex)) m.set(dn.id, { dn, horizontal, score })
  }

  // 左右：arkui 最近邻；design 在「未锁 + 兼容 + 包含一致」候选里取最近
  for (const anchor of anchors) {
    const aHm = anchor.arkui, aDe = anchor.design
    for (const dir of ['left', 'right']) {
      const an = nearestInDir(availArkui, aHm.rect, dir, n => !lockedArkui.has(n.id))
      if (!an) continue
      const dn = nearestInDir(availDesign, aDe.rect, dir, d => !lockedDesign.has(d.id) && isCompatibleType(d, an) && containConsistent(an, d) && directionConsistent(an, d))
      if (!dn) continue
      const t = tripleScore(an, dn, aHm, aDe, dir, ctx)
      if (t.pass) addNom(an, dn, true, t.score)
    }
  }

  // 上下：遍历开发侧待匹配节点，守门带内所有可行 dn 都进候选排行（不再只取 best，支持转次选）
  for (const an of availArkui) {
    if (lockedArkui.has(an.id)) continue
    for (const anchor of anchors) {
      const aHm = anchor.arkui, aDe = anchor.design
      const dir = verticalRelation(an.rect, aHm.rect)
      if (!dir) continue
      const gapHm = edgeGap(an.rect, aHm.rect, dir)
      for (const dn of availDesign) {
        if (lockedDesign.has(dn.id) || !isCompatibleType(dn, an)) continue
        if (verticalRelation(dn.rect, aDe.rect) !== dir) continue
        // 守门：边缘间距差超过待匹配节点高度 → 放弃，丢后续流程
        if (Math.abs(edgeGap(dn.rect, aDe.rect, dir) - gapHm) > an.rect.h) continue
        if (!containConsistent(an, dn)) continue
        if (!directionConsistent(an, dn)) continue
        const t = verticalTriple(an, dn, aHm, aDe, ctx)
        if (t.pass) addNom(an, dn, false, t.score)
      }
    }
  }

  // 竞争式稳定匹配（Gale-Shapley）：an 按候选排行(水平优先→分数)求婚，
  // dn 在求婚者中选「水平优先→高分」者订婚，输家转次选继续，直到稳定
  const anById = new Map(availArkui.map(n => [n.id, n]))
  const prefs = new Map()
  for (const [anId, m] of candMap) {
    prefs.set(anId, [...m.values()].sort((a, b) => a.horizontal !== b.horizontal ? (a.horizontal ? -1 : 1) : b.score - a.score))
  }
  const ptr = new Map()      // anId → 下一个求婚的候选下标
  const engaged = new Map()  // dnId → { anId, dn, horizontal, score }
  const free = [...prefs.keys()]
  while (free.length) {
    const anId = free.pop()
    const list = prefs.get(anId)
    let i = ptr.get(anId) ?? 0
    while (i < list.length) {
      const cand = list[i++]
      if (lockedDesign.has(cand.dn.id)) continue // 已被包含①锁定
      const cur = engaged.get(cand.dn.id)
      if (!cur) { engaged.set(cand.dn.id, { anId, ...cand }); break }
      if (betterNom(cand, cur)) { engaged.set(cand.dn.id, { anId, ...cand }); free.push(cur.anId); break } // 抢赢，旧的转自由
      // 被拒，继续求婚下一个
    }
    ptr.set(anId, i)
  }
  for (const [, e] of engaged) {
    const an = anById.get(e.anId)
    lockedArkui.add(an.id); lockedDesign.add(e.dn.id)
    result.push(makePair(e.dn, an, 'anchor-topology-方向', {
      confidence: 'high',
      topologyScore: round4(e.score),
      iou: computeIoU(e.dn.normRect, an.normRect),
    }))
  }

  // ── 第二轮：扩展强锚点组(原锚点 + 第一轮配对) + 包含一致性过滤 + 三维加权取最优 ──
  const strong = [...anchors, ...result]
  const round2 = []
  for (const an of availArkui) {
    if (lockedArkui.has(an.id)) continue
    let best = null
    for (const dn of availDesign) {
      if (lockedDesign.has(dn.id) || !isCompatibleType(dn, an)) continue
      // 包含一致性：an 与 dn 相对每个强锚点的「包 / 被包」关系必须完全对齐（不包含也须两侧都不包含）
      if (!strong.every(s => {
        if (s.arkui.id === an.id || s.design.id === dn.id) return true
        // 正向：强锚点包 an ⟺ 其设计侧对端包 dn
        if (rectContains(s.arkui.rect, an.rect) !== rectContains(s.design.rect, dn.rect)) return false
        // 反向：an 包强锚点 ⟺ dn 包其设计侧对端映射
        if (rectContains(an.rect, s.arkui.rect) !== rectContains(dn.rect, s.design.rect)) return false
        // 上下夹持（纯 y 上下关系，不要求横向覆盖）：强锚点在 an 正上/正下 ⟺ 对端在 dn 正上/正下
        if (isAbove(s.arkui.rect, an.rect) !== isAbove(s.design.rect, dn.rect)) return false
        if (isBelow(s.arkui.rect, an.rect) !== isBelow(s.design.rect, dn.rect)) return false
        return true
      })) continue
      for (const anchor of strong) {
        const dirHm = relation(an.rect, anchor.arkui.rect)
        if (dirHm === null) continue // 相交非包含，不作位置参照
        if (relation(dn.rect, anchor.design.rect) === null) continue
        const t = tripleScore(an, dn, anchor.arkui, anchor.design, dirHm, ctx)
        if (t.pass && t.score >= ROUND2_MIN && (!best || t.score > best.score)) best = { dn, score: t.score }
      }
    }
    if (best) round2.push({ an, dn: best.dn, score: best.score })
  }

  round2.sort((a, b) => b.score - a.score)
  for (const { an, dn, score } of round2) {
    if (lockedArkui.has(an.id) || lockedDesign.has(dn.id)) continue
    lockedArkui.add(an.id); lockedDesign.add(dn.id)
    result.push(makePair(dn, an, 'anchor-topology-自由', {
      confidence: score > 0.72 ? 'medium' : 'low',
      topologyScore: round4(score),
      iou: computeIoU(dn.normRect, an.normRect),
    }))
  }

  return result
}
