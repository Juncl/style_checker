/**
 * 框选节点归一化：将多个节点的 rect 统一到以包围盒左上角为原点的坐标系，
 * 并返回聚合出的虚拟 root rect（x=0, y=0, w/h=包围盒宽高）。
 */

export interface NodeRect {
  x: number
  y: number
  w: number
  h: number
}

export interface NormalizedNode<T extends { rect: NodeRect }> {
  node:    T
  newRect: NodeRect
}

export interface NormalizeResult<T extends { rect: NodeRect }> {
  root:  NodeRect
  items: NormalizedNode<T>[]
}

/**
 * 接受一组框选节点，计算整体包围盒作为虚拟 root（x=0, y=0），
 * 并将每个节点的 rect 坐标相对于包围盒左上角重新偏移。
 *
 * @param nodes 框选收集到的节点，必须包含 rect: { x, y, w, h }
 * @returns root rect 及每个节点对应的新 rect（不修改原始节点）
 */
export function normalizeSelection<T extends { rect: NodeRect }>(
  nodes: T[]
): NormalizeResult<T> {
  if (nodes.length === 0) {
    return { root: { x: 0, y: 0, w: 0, h: 0 }, items: [] }
  }

  let minX = Infinity, minY = Infinity
  let maxX = -Infinity, maxY = -Infinity

  for (const n of nodes) {
    const { x, y, w, h } = n.rect
    if (x          < minX) minX = x
    if (y          < minY) minY = y
    if (x + w      > maxX) maxX = x + w
    if (y + h      > maxY) maxY = y + h
  }

  const root: NodeRect = { x: 0, y: 0, w: maxX - minX, h: maxY - minY }

  const items: NormalizedNode<T>[] = nodes.map(n => ({
    node:    n,
    newRect: {
      x: n.rect.x - minX,
      y: n.rect.y - minY,
      w: n.rect.w,
      h: n.rect.h,
    },
  }))

  return { root, items }
}
