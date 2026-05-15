// 节点 path 字典序比较：父在前，同层按 path 末位升序，等价于树 DFS 顺序。
// 取代已废弃的 paintIndex 排序。
export function comparePaths(a, b) {
  const aIsArr = Array.isArray(a)
  const bIsArr = Array.isArray(b)
  if (!aIsArr && !bIsArr) return 0
  if (!aIsArr) return 1
  if (!bIsArr) return -1
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}
