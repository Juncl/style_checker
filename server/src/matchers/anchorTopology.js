/**
 * Pass 3：强锚点周边拓扑匹配（重构版）
 *
 * 与旧版的根本区别：
 *   - 全程用 rect 绝对坐标，不碰 normRect
 *   - 从开发侧（arkui）未匹配节点出发，借文本强锚点的「方向 / 包含」关系，
 *     到设计侧对应锚点的同方向找候选，给开发节点配设计节点
 *   - 锚点都是文本叶子，只可能「被包含」，所以包含关系 = 锚点的视觉祖先
 *   - 只处理两类几何关系：与锚点【脱离】(正左右上下) 和【包含】(祖先)；
 *     与锚点相交但非包含的节点一律不碰
 *   - 严格方向 + 序匹配 + 三维守门(AND) 的竞争式稳定匹配（Gale-Shapley）
 *
 * 三维评分（统一复用 Pass1 的抛物线-高斯曲线 gaussianCurveParabola）：
 *   位置：posDiff = |欧氏(an中心,a_hm中心) − 欧氏(dn中心,a_de中心)|
 *         point.x = 0.2·maxDiag，拦截线 = 水平 1.5·maxAnchorW / 垂直 0.25·rootRectH
 *   面积：MatchTools.gaussianCurveParabola(area_an, area_dn, {x:1.3·minArea, y:0.5}, 3·minArea)
 *   宽高比：MatchTools.gaussianCurveParabola(rate_an, rate_dn, {x:0.86·minRate, y:0.5}, 2·minRate)
 *   三维都 >0 才通过(AND)
 */
import { MatchTools } from './tools.js'
import { makePair } from './matchStrategies.js'
import { isCompatibleType, hasVisualDecoration } from '../utils/nodeVisibility.js'
import { computeIoU } from '../utils/matchGeometry.js'
import { EPS, relation, makeAnchorCheck } from './anchorCheck.js'

// 方向桶内排序键：左右按 x 间距、上下按 y 间距
function dirDist(rect, anchorRect, dir) {
  const c = MatchTools.center(rect), ac = MatchTools.center(anchorRect)
  return (dir === 'left' || dir === 'right') ? Math.abs(c.x - ac.x) : Math.abs(c.y - ac.y)
}

// ── 三维评分 ───────────────────────────────────────────────────────────────────
function scorePosition(an, dn, aHm, aDe, dir, ctx) {
  const posDiff = Math.abs(
    MatchTools.euclid(MatchTools.center(an.rect), MatchTools.center(aHm.rect)) -
    MatchTools.euclid(MatchTools.center(dn.rect), MatchTools.center(aDe.rect))
  )
  const horizontalMax = 1.5 * Math.max(aHm.rect.w, aDe.rect.w)
  const verticalMax = 0.25 * ctx.rootRectH
  let diffmax
  if (dir === 'left' || dir === 'right') diffmax = horizontalMax
  else if (dir === 'up' || dir === 'down') diffmax = verticalMax
  else diffmax = Math.max(horizontalMax, verticalMax) // contain / diagonal
  // 全局硬上限：位置差超过 max 对角线长度的 1/4 一律截断归 0
  diffmax = Math.min(diffmax, 0.25 * ctx.maxDiag)
  return MatchTools.gaussianCurveParabola(0, posDiff, { x: 0.2 * ctx.maxDiag, y: 0.5 }, diffmax)
}

function scoreArea(an, dn) {
  const aa = MatchTools.areaOf(an.rect), ad = MatchTools.areaOf(dn.rect)
  const minArea = Math.min(aa, ad)
  if (minArea <= 0) return 0
  return MatchTools.gaussianCurveParabola(aa, ad, { x: 1.3 * minArea, y: 0.5 }, 3 * minArea)
}

function scoreAspect(an, dn) {
  const ra = MatchTools.aspectOf(an.rect), rd = MatchTools.aspectOf(dn.rect)
  const minRate = Math.min(ra, rd)
  if (minRate <= 0) return 0
  return MatchTools.gaussianCurveParabola(ra, rd, { x: 0.86 * minRate, y: 0.5 }, 2 * minRate)
}

// 返回 { pass, score }：pass = 三维都 >0（AND 门控）；score = 0.5/0.25/0.25 加权
export function tripleScore(an, dn, aHm, aDe, dir, ctx) {
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
  const eu = MatchTools.gaussianCurveParabola(0, Math.hypot(dx, dy), { x: 0.1 * ctx.diag, y: 0.5 }, 0.25 * ctx.diag)
  const xs = MatchTools.gaussianCurveParabola(0, Math.abs(dx), { x: 0.15 * ctx.rootW, y: 0.5 }, 0.3 * ctx.rootW)
  const ys = MatchTools.gaussianCurveParabola(0, Math.abs(dy), { x: 0.2 * ctx.rootMaxH, y: 0.5 }, 0.4 * ctx.rootMaxH)
  return eu * 0.5 + xs * 0.38 + ys * 0.12
}
// 中心点方向一致性：两侧「锚点→节点」方向向量余弦相似度
function scoreCenterDirection(an, dn, aHm, aDe) {
  const dxHm = MatchTools.center(an.rect).x - MatchTools.center(aHm.rect).x
  const dyHm = MatchTools.center(an.rect).y - MatchTools.center(aHm.rect).y
  const dxDe = MatchTools.center(dn.rect).x - MatchTools.center(aDe.rect).x
  const dyDe = MatchTools.center(dn.rect).y - MatchTools.center(aDe.rect).y
  const lenHm = Math.hypot(dxHm, dyHm)
  const lenDe = Math.hypot(dxDe, dyDe)
  if (lenHm < 1e-6 || lenDe < 1e-6) return 1
  return Math.max(0, (dxHm * dxDe + dyHm * dyDe) / (lenHm * lenDe))
}
// 水平对齐一致性：左边/中轴/右边三种对齐取最优，差值用 rootW 归一化后转分
function scoreHorizontalAlignment(an, dn, aHm, aDe, ctx) {
  const cx = r => r.x + r.w / 2
  const leftDiff  = Math.abs((an.rect.x - aHm.rect.x) - (dn.rect.x - aDe.rect.x))
  const midDiff   = Math.abs((cx(an.rect) - cx(aHm.rect)) - (cx(dn.rect) - cx(aDe.rect)))
  const rightDiff = Math.abs(((an.rect.x + an.rect.w) - (aHm.rect.x + aHm.rect.w)) -
                             ((dn.rect.x + dn.rect.w) - (aDe.rect.x + aDe.rect.w)))
  const minDiff = Math.min(leftDiff, midDiff, rightDiff)
  return MatchTools.gaussianCurveParabola(0, minDiff, { x: 0.08 * ctx.rootW, y: 0.5 }, 0.25 * ctx.rootW)
}
// 样式装饰一致性：两侧是否同为有/无视觉装饰
function scoreStyleDecoration(an, dn) {
  return hasVisualDecoration(an) === hasVisualDecoration(dn) ? 1 : 0.3
}
// 上下六维：位置·0.45 + 面积·0.15 + 宽高比·0.10 + 中心方向·0.08 + 水平对齐·0.12 + 样式·0.10
// pass 门控仍用原三维 AND（ps/as/rs > 0），新维度只影响分数
function verticalTriple(an, dn, aHm, aDe, ctx) {
  const ps = posScoreVertical(an, dn, aHm, aDe, ctx)
  const as = scoreArea(an, dn)
  const rs = scoreAspect(an, dn)
  const ds = scoreCenterDirection(an, dn, aHm, aDe)
  const hs = scoreHorizontalAlignment(an, dn, aHm, aDe, ctx)
  const ss = scoreStyleDecoration(an, dn)
  return { pass: ps > 0 && as > 0 && rs > 0, score: ps * 0.45 + as * 0.15 + rs * 0.10 + ds * 0.08 + hs * 0.12 + ss * 0.10 }
}

// ── 主入口 ─────────────────────────────────────────────────────────────────────
export function matchByAnchorTopology(designNodes, arkuiNodes, anchors, usedArkui, matchedDesignIds, regionContext, options = {}) {
  const { diagDe = 1, diagHm = 1, canvasHeight, canvasHeightVp, canvasWidth, canvasWidthVp, priorContainPairs = [] } = options
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

  const result = [...priorContainPairs]
  const lockedArkui = new Set(priorContainPairs.map(p => p.arkui.id))
  const lockedDesign = new Set(priorContainPairs.map(p => p.design.id))

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

  // 包含强锚点组 = 原文本锚点 + 外部传入的 Pass 1.5 包含配对；约束左右/上下候选
  const strongC = [...anchors, ...result]
  // 包含一致性以 strongC 为参照、方向一致性以原 pass1 文本锚点为参照
  // （方向矛盾示例：1819上↔64272相交、1828斜脱离↔64270相交 被卡；「上↔斜上」这类布局微差放行，不误杀）
  const anchorCheck = makeAnchorCheck(strongC, anchors)

  // ── ②③ 左右最近邻 / 上下守门带：先各自算候选排行，再竞争式稳定匹配 ──
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
      const dn = nearestInDir(availDesign, aDe.rect, dir, d => !lockedDesign.has(d.id) && isCompatibleType(d, an) && anchorCheck(an, d))
      if (!dn) continue
      const t = tripleScore(an, dn, aHm, aDe, dir, ctx)
      if (t.pass) addNom(an, dn, true, t.score)
    }
  }

  // 上下：遍历开发侧待匹配节点，距锚点边缘间距 < 0.4 * 画布高度的 an 才纳入，
  // 守门带内所有可行 dn 都进候选排行（支持转次选）
  for (const an of availArkui) {
    if (lockedArkui.has(an.id)) continue
    for (const anchor of anchors) {
      const aHm = anchor.arkui, aDe = anchor.design
      const dir = verticalRelation(an.rect, aHm.rect)
      if (!dir) continue
      const gapHm = edgeGap(an.rect, aHm.rect, dir)
      if (gapHm >= 0.4 * ctx.rootRectH) continue
      for (const dn of availDesign) {
        if (lockedDesign.has(dn.id) || !isCompatibleType(dn, an)) continue
        if (verticalRelation(dn.rect, aDe.rect) !== dir) continue
        // 守门：边缘间距差超过待匹配节点高度 → 放弃，丢后续流程
        if (Math.abs(edgeGap(dn.rect, aDe.rect, dir) - gapHm) > an.rect.h) continue
        if (!anchorCheck(an, dn)) continue
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
    result.push(makePair(e.dn, an, e.horizontal ? 'text-con-方向x' : 'text-con-方向y', {
      confidence: 'high',
      topologyScore: MatchTools.round4(e.score),
      iou: computeIoU(e.dn.normRect, an.normRect),
    }))
  }

  // 只返回本函数新增的配对，priorContainPairs 已由调用方处理
  return result.slice(priorContainPairs.length)
}
