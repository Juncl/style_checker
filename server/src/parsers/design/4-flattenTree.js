/**
 * Design Step 4: 树 → 扁平 UnifiedNode[]（DFS 顺序）
 *
 * - 不包含 root 节点本身（root 仅作树根容器）
 * - 去掉树构建期的内部字段（_raw / _prunedReason / children）
 * - paintIndex 概念已移除：下游一律按 path 字典序（utils/pathOrder.js）排序
 * - canvasWidth/canvasHeight 传参时做根节点去重
 * - origCanvasWidth/origCanvasHeight 为原始 dp 画布尺寸（仅 design 侧有）
 */

import { isRenderableNonTextNode, hasBackgroundColor } from '../../utils/nodeVisibility.js'
import { comparePaths } from '../../utils/pathOrder.js'
import { deduplicateRootNodes } from '../../utils/deduplicateRootNodes.js'
import { isTransparent } from '../../utils/colorUtils.js'

export function flattenDesignTree(root, canvasWidth, canvasHeight, origCanvasWidth, origCanvasHeight) {
  const nodes = []
  if (!root || !Array.isArray(root.children)) return nodes
  for (const child of root.children) dfs(child, nodes)

  // 同 rect 容器去重：同 x/y/w/h 的 container 节点组，只保留一个
  deduplicateContainersByRect(nodes)

  // 传入了画布尺寸时，对画布大小的根节点做去重，无则补充 design-root
  if (canvasWidth != null) {
    return deduplicateRootNodes(nodes, canvasWidth, canvasHeight, 'design-root', origCanvasWidth, origCanvasHeight)
  }
  return nodes
}

function deduplicateContainersByRect(nodes) {
  const groups = new Map()
  for (const n of nodes) {
    if (n.type !== 'container') continue
    const { x = 0, y = 0, w = 0, h = 0 } = n.rect || {}
    const key = `${x},${y},${w},${h}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(n)
  }

  const toRemove = new Set()
  for (const [, group] of groups) {
    if (group.length < 2) continue

    let best = group[0]
    for (const n of group) {
      const nVis = isRenderableNonTextNode(n)
      const bVis = isRenderableNonTextNode(best)
      if (nVis && !bVis) { best = n; continue }
      if (!nVis && bVis) continue

      const nHasBg = hasBackgroundColor(n) && !isTransparent(n.style?.backgroundColor)
      const bHasBg = hasBackgroundColor(best) && !isTransparent(best.style?.backgroundColor)
      if (nHasBg && !bHasBg) { best = n; continue }
      if (!nHasBg && bHasBg) continue

      const nLen = n.path?.length ?? Infinity
      const bLen = best.path?.length ?? Infinity
      if (nLen > bLen) { best = n; continue }
      if (nLen === bLen && comparePaths(n.path, best.path) < 0) { best = n }
    }

    for (const n of group) {
      if (n !== best) toRemove.add(n)
    }
  }

  let writeIdx = 0
  for (const n of nodes) {
    if (!toRemove.has(n)) {
      nodes[writeIdx++] = n
    }
  }
  nodes.length = writeIdx
}

function dfs(node, out) {
  if (!node) return
  out.push(stripInternal(node))
  if (Array.isArray(node.children)) {
    for (const c of node.children) dfs(c, out)
  }
}

function stripInternal(node) {
  const { children, _raw, _prunedReason, ...clean } = node
  return clean
}
