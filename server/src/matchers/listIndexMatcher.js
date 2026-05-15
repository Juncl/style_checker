/**
 * Pass 4.5: 同行同类 list 顺序匹配
 *
 * 触发条件（全部满足才生效）：
 *   1. 两侧分别能形成同行 + 同 rawType + 同 w + x 互不重叠的 list（≥2 个元素）
 *   2. 两侧 list 整体 y 中心接近（normRect 容差 0.02）
 *   3. 两侧 list 上方存在共同锚 pair（设计侧 design 在 Ld 上方、且其 arkui 在 La 上方）
 *   4. 两侧 list 下方存在共同锚 pair（同上，方向相反）
 *   5. 两侧 list 首节点 IoU ≥ 0.40
 *
 * 通过后按 x 升序对齐前 min(N) 个，不看 IoU 直接锁定（matchType=list-index, confidence=high）。
 * 多出的节点（如 case1 ArkUI 侧 1901）留给后续 Pass。
 *
 * 不过滤已匹配节点 —— 本 Pass 的本职是纠偏先前 Pass 的错配：
 * 把已匹配节点也纳入 list，让 list-index 的高 priority 在最终 selectOneToOnePairs 中覆盖旧配对。
 */
import { computeIoU } from '../utils/matchGeometry.js'
import { isMatchableNode } from '../utils/nodeVisibility.js'
import { makePair } from './matchStrategies.js'

const ROW_TOLERANCE       = 0.005   // 同行 y 中心 / h / w 容差（normRect, 约 4vp）
const LIST_Y_TOLERANCE    = 0.02    // 跨侧 list 整体 y 中心接近阈值
const FIRST_NODE_IOU_MIN  = 0.40    // 首节点 IoU 阈值
const MIN_LIST_SIZE       = 2

export function matchByListIndex(designNodes, arkuiNodes, pairs) {
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
      if (Math.abs(Ld.cy - La.cy) > LIST_Y_TOLERANCE) continue

      const hasAboveAnchor = pairs.some(p =>
        p.design.normRect.y + p.design.normRect.h <= Ld.top + 1e-6 &&
        p.arkui.normRect.y  + p.arkui.normRect.h  <= La.top + 1e-6
      )
      if (!hasAboveAnchor) continue

      const hasBelowAnchor = pairs.some(p =>
        p.design.normRect.y >= Ld.bottom - 1e-6 &&
        p.arkui.normRect.y  >= La.bottom - 1e-6
      )
      if (!hasBelowAnchor) continue

      const iou = computeIoU(Ld.items[0].normRect, La.items[0].normRect)
      if (iou < FIRST_NODE_IOU_MIN) continue

      const N = Math.min(Ld.items.length, La.items.length)
      for (let i = 0; i < N; i++) {
        newPairs.push(makePair(Ld.items[i], La.items[i], 'list-index', {
          confidence: 'high',
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
  const candidates = nodes.filter(n => isMatchableNode(n) && n.type === 'container')

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
