/**
 * Web Step 4: 树 → 扁平 UnifiedNode[]（DFS 顺序）
 *
 * - 不包含 root 节点本身（root 仅作树根容器）
 * - 去掉树构建期的内部字段（_raw / _prunedReason / children）
 * - canvasWidthVp/canvasHeightVp 传参时做根节点去重
 */

import { deduplicateRootNodes } from '../../utils/deduplicateRootNodes.js'

export function flattenWebTree(root, canvasWidthVp, canvasHeightVp) {
  const nodes = []
  if (!root || !Array.isArray(root.children)) return nodes
  for (const child of root.children) dfs(child, nodes)

  // 传入了画布尺寸时，对画布大小的根节点做去重，无则补充 dev-root
  if (canvasWidthVp != null) {
    return deduplicateRootNodes(nodes, canvasWidthVp, canvasHeightVp, 'dev-root')
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
