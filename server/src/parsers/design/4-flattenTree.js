/**
 * Design Step 4: 树 → 扁平 UnifiedNode[]（DFS 顺序）
 *
 * - 不包含 root 节点本身（root 仅作树根容器）
 * - 去掉树构建期的内部字段（_raw / _prunedReason / children）
 * - paintIndex 概念已移除：下游一律按 path 字典序（utils/pathOrder.js）排序
 * - canvasWidth/canvasHeight 传参时做根节点去重
 * - origCanvasWidth/origCanvasHeight 为原始 dp 画布尺寸（仅 design 侧有）
 */

import { deduplicateRootNodes } from '../../utils/deduplicateRootNodes.js'

export function flattenDesignTree(root, canvasWidth, canvasHeight, origCanvasWidth, origCanvasHeight) {
  const nodes = []
  if (!root || !Array.isArray(root.children)) return nodes
  for (const child of root.children) dfs(child, nodes)

  // 传入了画布尺寸时，对画布大小的根节点做去重，无则补充 design-root
  if (canvasWidth != null) {
    return deduplicateRootNodes(nodes, canvasWidth, canvasHeight, 'design-root', origCanvasWidth, origCanvasHeight)
  }
  return nodes
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
