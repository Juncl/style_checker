/**
 * ArkUI Step 4: 树 → 扁平 UnifiedNode[]（DFS 顺序）
 *
 * - 不包含 root 节点本身（root 仅作树根容器）
 * - 去掉树构建期的内部字段（_attrs / _rectRaw / _frameworkType / _spanType / _blankType / _prunedReason / children）
 * - paintIndex 概念已移除：下游一律按 path 字典序（utils/pathOrder.js）排序
 * - canvasWidthVp/canvasHeightVp 传参时做根节点去重
 */

import { deduplicateRootNodes } from '../../utils/deduplicateRootNodes.js'

export function flattenArkuiTree(root, canvasWidthVp, canvasHeightVp) {
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
  const {
    children, _attrs, _rectRaw, _frameworkType, _spanType, _blankType, _prunedReason,
    ...clean
  } = node
  return clean
}
