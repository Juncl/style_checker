/**
 * ArkUI Step 4: 树 → 扁平 UnifiedNode[]（DFS 顺序）
 *
 * - 不包含 root 节点本身（root 仅作树根容器）
 * - 去掉树构建期的内部字段（_attrs / _rectRaw / _frameworkType / _spanType / _blankType / _prunedReason / children）
 * - paintIndex 概念已移除：下游一律按 path 字典序（utils/pathOrder.js）排序
 * - canvasWidthVp/canvasHeightVp 传参时做根节点去重
 * - 同 rect 语义折叠：rect 精确相同且有祖先-后代关系的 container 组，
 *   外层的 shadow / backgroundColor / opacity 合并到最内层节点，外层节点删除
 */

import { deduplicateRootNodes } from '../../utils/deduplicateRootNodes.js'

export function flattenArkuiTree(root, canvasWidthVp, canvasHeightVp) {
  const nodes = []
  if (!root || !Array.isArray(root.children)) return nodes
  for (const child of root.children) dfs(child, nodes)

  // 同 rect 语义折叠
  deduplicateSameRectContainers(nodes)

  // 传入了画布尺寸时，对画布大小的根节点做去重，无则补充 dev-root
  if (canvasWidthVp != null) {
    return deduplicateRootNodes(nodes, canvasWidthVp, canvasHeightVp, 'dev-root')
  }
  return nodes
}

// ─── 同 rect 语义折叠 ──────────────────────────────────────────────────────────

function deduplicateSameRectContainers(nodes) {
  // 第一步：按精确 rect key 分组（x/y/w/h 完全一致）
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

    // 第二步：在组内找出有祖先-后代关系的节点，用 Union-Find 聚合成合并组
    const parentMap = new Map()
    const find = (x) => {
      if (!parentMap.has(x)) return x
      const r = find(parentMap.get(x))
      parentMap.set(x, r)
      return r
    }
    const union = (a, b) => {
      const ra = find(a), rb = find(b)
      if (ra !== rb) parentMap.set(ra, rb)
    }

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (isAncestorPath(group[i].path, group[j].path) ||
            isAncestorPath(group[j].path, group[i].path)) {
          union(group[i], group[j])
        }
      }
    }

    // 按合并组聚合
    const mergeGroups = new Map()
    for (const n of group) {
      const root = find(n)
      if (!mergeGroups.has(root)) mergeGroups.set(root, [])
      mergeGroups.get(root).push(n)
    }

    for (const [, mg] of mergeGroups) {
      if (mg.length < 2) continue

      // 第三步：选主节点（path 最长 = 最内层节点）
      mg.sort((a, b) => b.path.length - a.path.length)
      const main = mg[0]
      // outers 按 path 长度降序：outers[0] 最靠近主节点，outers[last] 最外层
      const outers = mg.slice(1)

      // 第四步：外层属性合并到主节点（只补空，不覆盖）
      const s = { ...main.style }

      // shadow：主节点无阴影时，取最外层（path 最短）有阴影的外层
      if (!s.shadow) {
        const src = [...outers].reverse().find(n => n.style.shadow)
        if (src) s.shadow = src.style.shadow
      }

      // backgroundColor：image 节点无视觉背景色语义，清空自身并跳过继承
      // 其他主节点无背景色或为透明时，取最靠近主节点（path 最长）的外层非透明色
      if (main.rawType === 'image' || main.rawType === 'video') {
        delete s.backgroundColor
      } else if (isTransparentColor(s.backgroundColor)) {
        const src = outers.find(n => !isTransparentColor(n.style.backgroundColor))
        if (src) s.backgroundColor = src.style.backgroundColor
      }

      // opacity：外层有 opacity < 1 时连乘透传
      const outerOpacity = outers.reduce((acc, n) => {
        const op = n.style?.opacity
        return (op !== undefined && op < 1) ? acc * op : acc
      }, 1)
      if (outerOpacity < 1) {
        s.opacity = (s.opacity ?? 1) * outerOpacity
      }

      main.style = s

      // 第五步：删除所有外层节点
      for (const n of outers) toRemove.add(n)
    }
  }

  // 原地过滤
  let wi = 0
  for (const n of nodes) {
    if (!toRemove.has(n)) nodes[wi++] = n
  }
  nodes.length = wi
}

// A 是 B 的严格祖先：A.path 是 B.path 的严格前缀
function isAncestorPath(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length >= b.length) return false
  return a.every((v, i) => v === b[i])
}

// ArkUI 颜色格式 #AARRGGBB，AA='00' 为完全透明
function isTransparentColor(color) {
  return !color || color.startsWith('#00')
}

// ─── DFS / stripInternal ───────────────────────────────────────────────────────

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
