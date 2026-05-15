/**
 * ArkUI Step 4: 树 → 扁平 UnifiedNode[]（DFS 顺序）
 *
 * - 不包含 root 节点本身（root 仅作树根容器）
 * - 去掉树构建期的内部字段（_attrs / _rectRaw / _frameworkType / _spanType / _blankType / _prunedReason / children）
 * - paintIndex 概念已移除：下游一律按 path 字典序（utils/pathOrder.js）排序
 */

export function flattenArkuiTree(root) {
  const out = []
  if (!root || !Array.isArray(root.children)) return out
  for (const child of root.children) dfs(child, out)
  return out
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
