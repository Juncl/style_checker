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
 */
import { computeIoU } from '../utils/matchGeometry.js'
import { makePair } from './matchStrategies.js'

const ROW_TOLERANCE       = 0.005   // 同行 y 中心 / h / w 容差（normRect, 约 4vp）
const FIRST_NODE_IOU_MIN  = 0.60    // 首节点 IoU 阈值
const MIN_LIST_SIZE       = 2

export function matchByListIndex(designNodes, arkuiNodes, anchors) {
  const designLists = identifyLists(designNodes)
  const arkuiLists  = identifyLists(arkuiNodes)
  if (designLists.length === 0 || arkuiLists.length === 0) return []

  const newPairs = []
  const consumedDesign = new Set()
  const consumedArkui  = new Set()

  for (const Ld of designLists) {
    if (Ld.items.some(n => consumedDesign.has(n.id))) continue

    for (const La of arkuiLists) {
      if (La.items.some(n => consumedArkui.has(n.id))) continue

      // 条件 2+3：找一个强锚点 p，满足：
      //   - p 是 list 的上邻居（两侧 design/arkui 都在 list 上方）
      //     OR 下邻居（两侧都在 list 下方）
      //   - 两侧 list 相对于 p 的 y 偏移差 < list 高度 * 0.2
      const listH = Math.min(Ld.bottom - Ld.top, La.bottom - La.top)
      const qualifyingAnchor = anchors.find(p => {
        const pDeCy = p.design.normRect.y + p.design.normRect.h / 2
        const pArCy = p.arkui.normRect.y  + p.arkui.normRect.h  / 2
        const dAbove = p.design.normRect.y + p.design.normRect.h <= Ld.top + 1e-6
        const dBelow = p.design.normRect.y >= Ld.bottom - 1e-6
        const aAbove = p.arkui.normRect.y  + p.arkui.normRect.h  <= La.top + 1e-6
        const aBelow = p.arkui.normRect.y  >= La.bottom - 1e-6
        const isNeighbor = (dAbove && aAbove) || (dBelow && aBelow)
        if (!isNeighbor) return false
        const yDiffDe = Ld.cy - pDeCy
        const yDiffAr = La.cy - pArCy
        return Math.abs(yDiffDe - yDiffAr) < listH * 0.2
      })
      if (!qualifyingAnchor) continue

      // 条件 4：首节点 IoU
      const iou = computeIoU(Ld.items[0].normRect, La.items[0].normRect)
      if (iou < FIRST_NODE_IOU_MIN) continue

      const N = Math.min(Ld.items.length, La.items.length)
      for (let i = 0; i < N; i++) {
        newPairs.push(makePair(Ld.items[i], La.items[i], 'list-index', {
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

function identifyLists(nodes) {
  const candidates = nodes.filter(n => n.type === 'container')

  const rows = []
  for (const n of candidates) {
    const cy = n.normRect.y + n.normRect.h / 2
    const h  = n.normRect.h
    let row = rows.find(r =>
      Math.abs(r.cy - cy) <= ROW_TOLERANCE &&
      Math.abs(r.h  - h)  <= ROW_TOLERANCE
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
        let cluster = wClusters.find(c => Math.abs(c.w - n.normRect.w) <= ROW_TOLERANCE)
        if (!cluster) { cluster = { w: n.normRect.w, items: [] }; wClusters.push(cluster) }
        cluster.items.push(n)
      }
      for (const cluster of wClusters) {
        if (cluster.items.length < MIN_LIST_SIZE) continue
        const sorted = [...cluster.items].sort((a, b) => a.normRect.x - b.normRect.x)
        // 同 rawType 同 w 同行的项目若 x 重叠，是异常嵌套，剔除。
        let overlapped = false
        for (let i = 1; i < sorted.length; i++) {
          const prevEnd = sorted[i - 1].normRect.x + sorted[i - 1].normRect.w
          if (prevEnd > sorted[i].normRect.x + ROW_TOLERANCE) { overlapped = true; break }
        }
        if (overlapped) continue
        lists.push({
          rawType,
          items: sorted,
          top:    Math.min(...sorted.map(g => g.normRect.y)),
          bottom: Math.max(...sorted.map(g => g.normRect.y + g.normRect.h)),
          cy:     average(sorted.map(g => g.normRect.y + g.normRect.h / 2)),
        })
      }
    }
  }

  return lists
}

function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}
