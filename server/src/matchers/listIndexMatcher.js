/**
 * Pass 3.5: 同行同类 list 顺序匹配
 *
 * 触发条件（全部满足才生效）：
 *   1. 两侧分别能形成同行 + 同 rawType + 同 w + x 互不重叠的 list（≥2 个元素）
 *   2. 存在一个强锚点对 p（topologyAnchors），且该锚点是 list 的上邻居 OR 下邻居
 *      （两侧方向须一致：都在上方，或都在下方）
 *   3. 同一锚点 p：两侧 list 相对于 p 的 y 偏移差 < list 高度 * 0.2
 *      即 |(Ld.cy − p.de.cy) − (La.cy − p.ar.cy)| < listH * 0.2
 *   4. 两侧 list 首节点 IoU ≥ 0.60
 *
 * 通过后按 x 升序对齐前 min(N) 个，不看 IoU 直接锁定（matchType=list-index, confidence=high）。
 * 多出的节点留给后续 Pass。
 *
 * 不过滤已匹配节点 —— 本 Pass 的本职是纠偏先前 Pass 的错配：
 * 把已匹配节点也纳入 list，让 list-index 的高 priority 在最终 selectOneToOnePairs 中覆盖旧配对。
 *
 * 🔴 全程使用绝对坐标 rect（vp/dp），不碰 normRect（见 CLAUDE.md 坐标系统硬性规则）。
 */
import { makePair } from './matchStrategies.js'
import { makeAnchorConsistencyCheckers } from './anchorTopology.js'

const ROW_TOL_RATIO        = 0.005  // 同行容差比例（沿用原归一化标定，按画布边换算成绝对 vp/dp）
const FIRST_NODE_SCORE_MIN = 0.60   // 首节点综合判定分阈值（替代 IoU）
const MIN_LIST_SIZE        = 2

// 高斯衰减：dist=0→1，dist=σ→0.607
function gauss(dist, sigma) { return Math.exp(-(dist * dist) / (2 * sigma * sigma)) }

/**
 * 首节点综合判定分（替代 IoU）：绝对位置 + 相对锚点位置 + 面积比 + 宽高比。
 * 不用 IoU —— IoU 对小节点 + 画布累积偏移过敏，且设计/开发尺寸本就不完全合一、存在多余。
 * 用距离系数（对角线尺度）天然宽容小偏移；相对锚点位置消除画布累积偏差（纯绝对坐标，不碰 normRect）。
 */
function firstNodeScore(dn, an, anchor, diag) {
  const d = dn.rect, a = an.rect
  // 绝对位置：中心距离（对角线尺度，宽容小偏移）
  const absDist = Math.hypot((d.x + d.w / 2) - (a.x + a.w / 2), (d.y + d.h / 2) - (a.y + a.h / 2))
  const absPos = gauss(absDist, 0.10 * diag)
  // 相对锚点位置：首节点相对锚点左上角的偏移，两侧应一致（累积偏差对锚点/首节点一致，相减抵消）
  const rdx = (d.x - anchor.design.rect.x) - (a.x - anchor.arkui.rect.x)
  const rdy = (d.y - anchor.design.rect.y) - (a.y - anchor.arkui.rect.y)
  const relAnchor = gauss(Math.hypot(rdx, rdy), 0.06 * diag)
  // 面积比
  const areaD = d.w * d.h, areaA = a.w * a.h
  const area = Math.min(areaD, areaA) / Math.max(areaD, areaA)
  // 宽高比
  const arD = d.w / d.h, arA = a.w / a.h
  const aspect = Math.min(arD, arA) / Math.max(arD, arA)
  // 方位监督：锚点 → 首节点的方向向量，两侧余弦相似度（方向相反得 0）
  const ad = anchor.design.rect, aa = anchor.arkui.rect
  const dDirX = (d.x + d.w / 2) - (ad.x + ad.w / 2)
  const dDirY = (d.y + d.h / 2) - (ad.y + ad.h / 2)
  const aDirX = (a.x + a.w / 2) - (aa.x + aa.w / 2)
  const aDirY = (a.y + a.h / 2) - (aa.y + aa.h / 2)
  const lenD = Math.hypot(dDirX, dDirY), lenA = Math.hypot(aDirX, aDirY)
  const cosine = lenD > 0 && lenA > 0 ? (dDirX * aDirX + dDirY * aDirY) / (lenD * lenA) : 0
  const dirScore = Math.max(0, cosine)
  return absPos * 0.10 + relAnchor * 0.40 + area * 0.20 + aspect * 0.15 + dirScore * 0.15
}

export function matchByListIndex(designNodes, arkuiNodes, anchors, opts = {}) {
  // 两侧分别按各自画布尺寸换算容差：x/w 用画布宽（两侧已对齐到 vp），y/h 用各侧画布高
  const W  = opts.canvasWidthVp  ?? 376
  const Hv = opts.canvasHeightVp ?? 809   // arkui 画布高
  const Hd = opts.canvasHeight   ?? 947   // design 画布高（缩放后）
  const designLists = identifyLists(designNodes, ROW_TOL_RATIO * W, ROW_TOL_RATIO * Hd)
  const arkuiLists  = identifyLists(arkuiNodes,  ROW_TOL_RATIO * W, ROW_TOL_RATIO * Hv)
  if (designLists.length === 0 || arkuiLists.length === 0) return []
  const diag = Math.hypot(W, Hv)

  // Pass 3.1.2 同款一致性校验：以强锚点为参照，过滤与锚点拓扑矛盾的 list 配对
  const { containConsistent, directionConsistent } = makeAnchorConsistencyCheckers(anchors)

  const newPairs = []
  const consumedDesign = new Set()
  const consumedArkui  = new Set()

  for (const Ld of designLists) {
    if (Ld.items.some(n => consumedDesign.has(n.id))) continue

    for (const La of arkuiLists) {
      if (La.items.some(n => consumedArkui.has(n.id))) continue

      // 条件 2：找方向一致的邻居锚点（上邻 or 下邻，两侧 design/arkui 方向须一致）。
      // 去掉原 yDiff<listH*0.2 硬阈值 —— 绝对坐标下底部 list 与顶部锚点间会累积画布高偏移，
      // 该硬阈值会误杀正常 list。相对偏移的守卫改交给 firstNodeScore 的 relAnchor 系数（平滑、对角线尺度）。
      const neighbors = anchors.filter(p => {
        const dAbove = p.design.rect.y + p.design.rect.h <= Ld.top + 1e-6
        const dBelow = p.design.rect.y >= Ld.bottom - 1e-6
        const aAbove = p.arkui.rect.y  + p.arkui.rect.h  <= La.top + 1e-6
        const aBelow = p.arkui.rect.y  >= La.bottom - 1e-6
        return (dAbove && aAbove) || (dBelow && aBelow)
      })
      if (!neighbors.length) continue
      // 选离 list 相对偏移最小的邻居锚点作参照（越近累积偏差越小）
      let anchor = null, bestRel = Infinity
      for (const q of neighbors) {
        const rel = Math.abs((Ld.cy - (q.design.rect.y + q.design.rect.h / 2)) -
                             (La.cy - (q.arkui.rect.y  + q.arkui.rect.h  / 2)))
        if (rel < bestRel) { bestRel = rel; anchor = q }
      }

      // 条件 3：首节点综合判定分（绝对位置 + 相对锚点 + 面积 + 宽高比），替代 IoU
      const score = firstNodeScore(Ld.items[0], La.items[0], anchor, diag)
      if (score < FIRST_NODE_SCORE_MIN) continue

      const N = Math.min(Ld.items.length, La.items.length)

      // 一致性校验（Pass 3.1.2 同款）：逐项以强锚点为参照，包含 / 方向任一矛盾则整组放弃
      let consistent = true
      for (let i = 0; i < N; i++) {
        const an = La.items[i], dn = Ld.items[i]
        if (!containConsistent(an, dn) || !directionConsistent(an, dn)) { consistent = false; break }
      }
      if (!consistent) continue

      for (let i = 0; i < N; i++) {
        newPairs.push(makePair(Ld.items[i], La.items[i], 'text-con-列表', {
          confidence: 'medium',
          topologyScore: 1.0,
        }))
        consumedDesign.add(Ld.items[i].id)
        consumedArkui.add(La.items[i].id)
      }
      break
    }
  }
  return newPairs
}

function identifyLists(nodes, tolW, tolH) {
  const candidates = nodes.filter(n => n.type === 'container')

  const rows = []
  for (const n of candidates) {
    const cy = n.rect.y + n.rect.h / 2
    const h  = n.rect.h
    let row = rows.find(r =>
      Math.abs(r.cy - cy) <= tolH &&
      Math.abs(r.h  - h)  <= tolH
    )
    if (!row) {
      row = { cy, h, nodes: [] }
      rows.push(row)
    }
    row.nodes.push(n)
  }

  const lists = []
  for (const row of rows) {
    const byRawType = new Map()
    for (const n of row.nodes) {
      const key = n.rawType || ''
      if (!byRawType.has(key)) byRawType.set(key, [])
      byRawType.get(key).push(n)
    }
    for (const [rawType, group] of byRawType.entries()) {
      // 行内按 w 聚类 —— 同行同 rawType 但 w 不同的"父容器 + 子节点"会分到不同 cluster，
      // 各 cluster 独立成 list，避免整组被父容器拖累丢失真正的 list 项。
      const wClusters = []
      for (const n of group) {
        let cluster = wClusters.find(c => Math.abs(c.w - n.rect.w) <= tolW)
        if (!cluster) { cluster = { w: n.rect.w, items: [] }; wClusters.push(cluster) }
        cluster.items.push(n)
      }
      for (const cluster of wClusters) {
        if (cluster.items.length < MIN_LIST_SIZE) continue
        const sorted = [...cluster.items].sort((a, b) => a.rect.x - b.rect.x)
        // 同 rawType 同 w 同行的项目若 x 重叠，是异常嵌套，剔除。
        let overlapped = false
        for (let i = 1; i < sorted.length; i++) {
          const prevEnd = sorted[i - 1].rect.x + sorted[i - 1].rect.w
          if (prevEnd > sorted[i].rect.x + tolW) { overlapped = true; break }
        }
        if (overlapped) continue

        // 同行所有节点（含文本/不同类容器），排除当前候选节点自身，用于检测间隙障碍
        const sortedIds = new Set(sorted.map(n => n.id))
        const halfH = row.h * 0.5
        const rowNeighbors = nodes.filter(m => {
          if (sortedIds.has(m.id)) return false
          const mCy = m.rect.y + m.rect.h / 2
          return mCy >= row.cy - halfH && mCy <= row.cy + halfH
        })

        // 按连续性拆分：满足以下任一条件则在此截断
        const segments = []
        let seg = [sorted[0]]
        let segBaseGap = null  // 当前段的基准间隙（以第一对为准）
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1]
          const curr = sorted[i]
          const gapStart = prev.rect.x + prev.rect.w
          const gapEnd   = curr.rect.x
          const gap      = gapEnd - gapStart
          const nodeW    = (prev.rect.w + curr.rect.w) / 2

          // 条件1：间隙超过节点本身宽度
          const gapTooLarge = gap > nodeW

          // 条件2：间隙内有其他节点（中心点在间隙内），豁免完全包含两者的公共祖先容器
          const hasBlocker = !gapTooLarge && gap > tolW && rowNeighbors.some(m => {
            if (m.rect.x <= prev.rect.x && m.rect.x + m.rect.w >= curr.rect.x + curr.rect.w) return false
            const mCx = m.rect.x + m.rect.w / 2
            return mCx > gapStart && mCx < gapEnd
          })

          // 条件3：间隙与当前段基准间隙差超过 2（单位同坐标系 vp/dp）
          const gapInconsistent = segBaseGap !== null && Math.abs(gap - segBaseGap) > 2

          if (gapTooLarge || hasBlocker || gapInconsistent) {
            if (seg.length >= MIN_LIST_SIZE) segments.push(seg)
            seg = [curr]
            segBaseGap = null
          } else {
            if (segBaseGap === null) segBaseGap = gap
            seg.push(curr)
          }
        }
        if (seg.length >= MIN_LIST_SIZE) segments.push(seg)

        for (const segment of segments) {
          lists.push({
            rawType,
            items: segment,
            top:    Math.min(...segment.map(g => g.rect.y)),
            bottom: Math.max(...segment.map(g => g.rect.y + g.rect.h)),
            cy:     average(segment.map(g => g.rect.y + g.rect.h / 2)),
          })
        }
      }
    }
  }

  return lists
}

function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}
