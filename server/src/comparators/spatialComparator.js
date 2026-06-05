/**
 * 空间关系（间距）差异对比
 *
 * 算法说明（来自 test/compareBetweenDiff.js）：
 *   1) 为每个已匹配节点计算其上、下、左、右、父层邻居（基于 rect 几何关系）
 *   2) 对每个匹配对，找到 ArkUI 侧最近的"上"和"左"邻居（含父层包含关系）
 *   3) 在两侧分别计算该方向的间距 distance，两端都允许误差 ≤ SPACE_ERR_RANGE 内归零
 *   4) 过滤掉明显异常的对（一侧间距过大、倍数差异过大）
 *   5) diffDistance > 0 的对转换为 StyleDiff，融入 server 的 diffs 流水线
 *
 * 注意：
 *   - 算法内部所有坐标统一使用 node.rect（缩放后的 vp 维度）
 *   - 根节点 rect 也使用 vp 维度（直接由调用方传入画布宽高）
 *   - 只做"上"和"左"两个方向，下/右方向不重复计算（相邻两节点的间距是同一段）
 */

import { SPACE_ERR_RANGE } from '../config/constants.js'

/**
 * @param {Array} pairs 匹配对数组，每项 { design: {id, rect, ...}, arkui: {id, rect, ...}, ... }
 * @param {Object} ctx
 * @param {Object} ctx.hmNodesMap arkui id → UnifiedNode 映射
 * @param {Object} ctx.deNodesMap design id → UnifiedNode 映射
 * @param {Object} ctx.rootHmRect arkui 根节点 rect { x:0, y:0, w, h }（vp）
 * @param {Object} ctx.rootDeRect design 根节点 rect { x:0, y:0, w, h }（vp）
 * @returns {Array} StyleDiff[]
 */
export function compareSpatialRelations(pairs, ctx = {}) {
  const { hmNodesMap = {}, deNodesMap = {}, rootHmRect, rootDeRect } = ctx
  if (!pairs?.length || !rootHmRect || !rootDeRect) return []

  // 构造 hmIdMap: arkuiId → designId
  const hmIdMap = {}
  for (const p of pairs) {
    if (p?.arkui?.id && p?.design?.id) hmIdMap[p.arkui.id] = p.design.id
  }

  // 参与间距计算的 arkui 节点（仅匹配上的）
  const hmMapNodes = Object.keys(hmIdMap)
    .map(id => hmNodesMap[id])
    .filter(Boolean)

  // 计算每个节点的邻居关系（写入 node.neighborIds，仅供本轮使用）
  getNeighbor(hmMapNodes)

  const diffs = []
  for (const hmNodeId in hmIdMap) {
    const hmNode = hmNodesMap[hmNodeId]
    const deNode = deNodesMap[hmIdMap[hmNodeId]]
    if (!hmNode || !deNode) continue

    // 上间距
    const top = findDiffTopSpace(hmIdMap, hmNode, deNode, { hmNodesMap, deNodesMap, rootHmRect, rootDeRect })
    if (top && top.diffDistance > 0) diffs.push(toStyleDiff(top, 'top'))

    // 左间距
    const left = findDiffLeftSpace(hmIdMap, hmNode, deNode, { hmNodesMap, deNodesMap, rootHmRect, rootDeRect })
    if (left && left.diffDistance > 0) diffs.push(toStyleDiff(left, 'left'))
  }

  return diffs
}

// ─────────────────────────────────────────────────────────────────────────────
// 邻居计算
// ─────────────────────────────────────────────────────────────────────────────

function getNeighbor(nodes) {
  const er = 3 // 允许误差为 3
  for (const n1 of nodes) {
    n1.neighborIds = { left: [], right: [], top: [], bottom: [], parentLay: [] }
    const r1 = n1.rect
    if (!r1) continue
    for (const n2 of nodes) {
      if (n1.id === n2.id) continue
      const r2 = n2.rect
      if (!r2) continue

      // 左右：n2 在 n1 的高度范围内（一方包含另一方）
      if (
        (r2.y <= r1.y + er && r2.y + r2.h >= r1.y + r1.h - er) ||
        (r2.y >= r1.y - er && r2.y + r2.h <= r1.y + r1.h + er)
      ) {
        if (r2.x + r2.w <= r1.x) n1.neighborIds.left.push(n2.id)
        if (r2.x >= r1.x + r1.w) n1.neighborIds.right.push(n2.id)
      }

      // 上下：宽度有交集
      if (
        (r1.x >= r2.x - er && r1.x <= r2.x + r2.w + er) ||
        (r2.x >= r1.x - er && r2.x <= r1.x + r1.w + er)
      ) {
        if (r2.y + r2.h <= r1.y) n1.neighborIds.top.push(n2.id)
        if (r2.y >= r1.y + r1.h) n1.neighborIds.bottom.push(n2.id)
      }

      // 父子：n2 完全包含 n1
      if (
        r2.y <= r1.y && r2.y + r2.h >= r1.y + r1.h &&
        r2.x <= r1.x && r2.x + r2.w >= r1.x + r1.w
      ) {
        n1.neighborIds.parentLay.push(n2.id)
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 方向邻居查找
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 寻找 type 方向上离 node 最近的邻居（兜底用父层包含关系）
 * @returns {{ rel: 'd'|'c', hmDirId: string }}
 */
function findHmDirectNode(type, node, hmNodesMap) {
  const direct = type === 'y' ? 'top' : 'left'
  let rel = 'd' // 默认脱离关系
  let hmDirId = ''

  if (node.neighborIds?.[direct]?.length) {
    const directNodes = node.neighborIds[direct]
      .map(id => hmNodesMap[id])
      .filter(Boolean)
    if (type === 'y') {
      directNodes.sort((a, b) => (b.rect.y + b.rect.h) - (a.rect.y + a.rect.h))
    } else {
      directNodes.sort((a, b) => (b.rect.x + b.rect.w) - (a.rect.x + a.rect.w))
    }
    if (directNodes[0]) hmDirId = directNodes[0].id
  }

  // 存在父层节点时，优先用包含关系（取最近的父）
  if (node.neighborIds?.parentLay?.length) {
    const parentNodes = node.neighborIds.parentLay
      .map(id => hmNodesMap[id])
      .filter(Boolean)
    if (parentNodes.length) {
      if (type === 'y') {
        parentNodes.sort((a, b) => b.rect.y - a.rect.y)
      } else {
        parentNodes.sort((a, b) => b.rect.x - a.rect.x)
      }
      hmDirId = parentNodes[0].id
      rel = 'c'
    }
  }

  return { rel, hmDirId }
}

// ─────────────────────────────────────────────────────────────────────────────
// 上间距（纵向）
// ─────────────────────────────────────────────────────────────────────────────

function findDiffTopSpace(hmIdMap, hmNode, deNode, ctx) {
  const { hmNodesMap, deNodesMap, rootHmRect, rootDeRect } = ctx
  const { rel, hmDirId } = findHmDirectNode('y', hmNode, hmNodesMap)
  if (!hmDirId) return null

  const deTopNodeId = hmIdMap[hmDirId]
  const hmTopNode = hmNodesMap[hmDirId]
  const deTopNode = deNodesMap[deTopNodeId]
  if (!hmTopNode || !deTopNode) return null

  const hmR = hmNode.rect, deR = deNode.rect
  const hmT = hmTopNode.rect, deT = deTopNode.rect
  if (!hmR || !deR || !hmT || !deT) return null

  // size：用户展示用（design 侧是真实 dp；arkui 侧等同 rect）
  const hmS = hmNode.size || hmR
  const deS = deNode.size || deR
  const hmTs = hmTopNode.size || hmT
  const deTs = deTopNode.size || deT

  const getBor = (r, num) => (r === 'c' ? 0 : num)

  // design 侧对应节点反了（design 上邻反在下方）→ 放弃
  if (deR.y - deT.y - getBor(rel, deT.h) < 0) return null

  // 用 rect 算"过滤判断 distance"（两侧 vp 同维度，可直接比差）
  const hmDistance = Number((hmR.y - hmT.y - getBor(rel, hmT.h)).toFixed(1))
  const deDistance = Number((deR.y - deT.y - getBor(rel, deT.h)).toFixed(1))

  // 用 size 算"展示 distance"（design 真实 dp / arkui vp）
  const hmDisplayDistance = Number((hmS.y - hmTs.y - getBor(rel, hmTs.h)).toFixed(1))
  const deDisplayDistance = Number((deS.y - deTs.y - getBor(rel, deTs.h)).toFixed(1))

  // 间距过大（超过画布 1/3）
  if (hmDistance > rootHmRect.h / 3) return null
  if (deDistance > rootDeRect.h / 3) return null

  // 允许的间距误差（用展示值比，和卡片里显示的保持一致）
  let diffDistance = Math.abs(Number((hmDisplayDistance - deDisplayDistance).toFixed(1)))
  if (diffDistance <= SPACE_ERR_RANGE) diffDistance = 0

  // 差值过大过滤（包含关系除外）
  const minD = Math.min(hmDisplayDistance, deDisplayDistance)
  if (rel !== 'c' && minD > 20 && diffDistance >= 2 * minD) return null
  if (rel !== 'c' && ((minD !== 0 && diffDistance >= 10 * minD) || (minD === 0 && diffDistance >= 20))) return null

  return {
    rel,
    diffDistance,
    hm: { node: hmNode, anchor: hmTopNode, distance: hmDistance, displayDistance: hmDisplayDistance, spaceRect: spaceRectVertical(hmR, hmT, rel) },
    de: { node: deNode, anchor: deTopNode, distance: deDistance, displayDistance: deDisplayDistance, spaceRect: spaceRectVertical(deR, deT, rel) },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 左间距（横向，findDiffTopSpace 的镜像实现）
// ─────────────────────────────────────────────────────────────────────────────

function findDiffLeftSpace(hmIdMap, hmNode, deNode, ctx) {
  const { hmNodesMap, deNodesMap, rootHmRect, rootDeRect } = ctx
  const { rel, hmDirId } = findHmDirectNode('x', hmNode, hmNodesMap)
  if (!hmDirId) return null

  const deLeftNodeId = hmIdMap[hmDirId]
  const hmLeftNode = hmNodesMap[hmDirId]
  const deLeftNode = deNodesMap[deLeftNodeId]
  if (!hmLeftNode || !deLeftNode) return null

  const hmR = hmNode.rect, deR = deNode.rect
  const hmL = hmLeftNode.rect, deL = deLeftNode.rect
  if (!hmR || !deR || !hmL || !deL) return null

  const hmS = hmNode.size || hmR
  const deS = deNode.size || deR
  const hmLs = hmLeftNode.size || hmL
  const deLs = deLeftNode.size || deL

  const getBor = (r, num) => (r === 'c' ? 0 : num)

  if (deR.x - deL.x - getBor(rel, deL.w) < 0) return null

  const hmDistance = Number((hmR.x - hmL.x - getBor(rel, hmL.w)).toFixed(1))
  const deDistance = Number((deR.x - deL.x - getBor(rel, deL.w)).toFixed(1))

  const hmDisplayDistance = Number((hmS.x - hmLs.x - getBor(rel, hmLs.w)).toFixed(1))
  const deDisplayDistance = Number((deS.x - deLs.x - getBor(rel, deLs.w)).toFixed(1))

  // 间距过大（超过画布 1/3，横向用宽度）
  if (hmDistance > rootHmRect.w / 3) return null
  if (deDistance > rootDeRect.w / 3) return null

  let diffDistance = Math.abs(Number((hmDisplayDistance - deDisplayDistance).toFixed(1)))
  if (diffDistance <= SPACE_ERR_RANGE) diffDistance = 0

  const minD = Math.min(hmDisplayDistance, deDisplayDistance)
  if (rel !== 'c' && minD > 20 && diffDistance >= 2 * minD) return null
  if (rel !== 'c' && ((minD !== 0 && diffDistance >= 10 * minD) || (minD === 0 && diffDistance >= 20))) return null

  return {
    rel,
    diffDistance,
    hm: { node: hmNode, anchor: hmLeftNode, distance: hmDistance, displayDistance: hmDisplayDistance, spaceRect: spaceRectHorizontal(hmR, hmL, rel) },
    de: { node: deNode, anchor: deLeftNode, distance: deDistance, displayDistance: deDisplayDistance, spaceRect: spaceRectHorizontal(deR, deL, rel) },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 辅助：构造间距矩形（前端高亮间距条）
// ─────────────────────────────────────────────────────────────────────────────

function spaceRectVertical(selfRect, anchorRect, rel) {
  const top = rel === 'c' ? anchorRect.y : anchorRect.y + anchorRect.h
  return { x: selfRect.x, y: top, w: selfRect.w, h: selfRect.y - top }
}

function spaceRectHorizontal(selfRect, anchorRect, rel) {
  const left = rel === 'c' ? anchorRect.x : anchorRect.x + anchorRect.w
  return { x: left, y: selfRect.y, w: selfRect.x - left, h: selfRect.h }
}

// ─────────────────────────────────────────────────────────────────────────────
// 输出转换：内部结果 → StyleDiff
// ─────────────────────────────────────────────────────────────────────────────

function toStyleDiff(result, direction) {
  const axis = direction === 'top' ? 'vertical' : 'horizontal'
  const property = direction === 'top' ? 'spacing.top' : 'spacing.left'
  const label = direction === 'top' ? '上间距' : '左间距'
  const { hm, de, rel, diffDistance } = result

  // 展示给用户的 distance 用 size（design=真实 dp、arkui=vp）
  // 间距 diff 一律标低置信：前端"模糊比对"tab 才会展示
  // severity 按全局规则：低置信→warning，中/高置信→error
  const dir = direction === 'top' ? 'y' : 'x'
  const spaceId       = `${hm.anchor.id}-${hm.node.id}-${dir}`
  const designSpaceId = `${de.anchor.id}-${de.node.id}-${dir}`
  const confidence = 'low'
  return {
    property,
    severity: confidence === 'low' ? 'warning' : 'error',
    confidence,
    spaceId,
    designSpaceId,
    description: `${label}偏差 ${diffDistance.toFixed(1)}vp（设计 ${de.displayDistance.toFixed(1)} / 开发 ${hm.displayDistance.toFixed(1)}）`,
    designValue: `${de.displayDistance.toFixed(1)}`,
    arkuiValue: `${hm.displayDistance.toFixed(1)}`,
    designNodeId: de.node.id,
    arkuiNodeId: hm.node.id,
    relatedDesignNodeId: de.anchor.id,
    relatedArkuiNodeId: hm.anchor.id,
    designName: de.node.name,
    arkuiName: hm.node.name,
    relatedDesignName: de.anchor.name,
    relatedArkuiName: hm.anchor.name,
    relationKind: rel === 'c' ? 'parent-child' : 'sibling',
    relationAxis: axis,
    relationRects: {
      design: [de.anchor.rect, de.node.rect],
      arkui: [hm.anchor.rect, hm.node.rect],
      axis,
    },
  }
}
