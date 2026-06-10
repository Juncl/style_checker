/**
 * 扁平节点列表去重：对画布大小的"根节点"只保留一个，没有时补充一个。
 *
 * ── 背景 ──
 * 解析流水线 flatten 之后输出的扁平节点列表中，经常出现 2 个画布大小的节点
 * （如 ArkUI 侧 Navigation + NavDestination，均为 x=0,y=0,w=画布宽,h=画布高）。
 * 它们本质上是同一个"页面背景层"，不应有多个副本进入后续匹配。
 *
 * 但同时也可能完全没有画布大小的节点（prune 阶段被剪掉了）。
 * 前端 hover 节点时需要有一个"根节点"做边距实时计算，因此必须保证至少有一个。
 *
 * ── 策略 ──
 * 1. 从扁平列表中筛选出所有"画布根节点"（rect 与画布完全重合，x/y 均为 0）
 * 2. 如果 = 0: 补充一个合成根节点（id = rootId），为前端提供边距计算参照
 * 3. 如果 = 1: 直接返回原列表，不做改动
 * 4. 如果 ≥ 2: 只保留一个
 *    - 优先保留有 backgroundColor 的（有背景色的更可能是"真实"画布根节点）
 *    - 若多个都有背景色，保留第一个（filter 结果顺序来自 DFS 原序）
 *    - 若都没有背景色，也保留第一个（保证至少留一个节点）
 *
 * ── 匹配阶段的配合 ──
 * 最终保留（或补充）的这一个根节点，会在 nodeMatcher.js 入口处被 isCanvasRoot
 * 过滤掉，不参与节点匹配（页面背景层没有对应的还原元素需要比对）。
 *
 * @param {object[]} nodes    扁平节点列表
 * @param {number}   canvasW  画布宽度（缩放后）
 * @param {number}   canvasH  画布高度（缩放后）
 * @param {string}   rootId   无根节点时补充的合成节点 id（dev-root / design-root）
 * @param {number}   [origW]  原始 dp 画布宽度（仅 design 侧传，dev 侧无此概念）
 * @param {number}   [origH]  原始 dp 画布高度（仅 design 侧传，dev 侧无此概念）
 * @returns {object[]} 去重/补充后的列表
 */
export function deduplicateRootNodes(nodes, canvasW, canvasH, rootId, origW, origH) {
  const rootNodes = []
  const nonRootNodes = []

  for (const n of nodes) {
    if (isCanvasRoot(n, canvasW, canvasH)) {
      rootNodes.push(n)
    } else {
      nonRootNodes.push(n)
    }
  }

  // 完全没有根节点 → 补充一个合成根节点（供前端边距计算用）
  if (rootNodes.length === 0) {
    nonRootNodes.push(createSyntheticRoot(rootId, canvasW, canvasH, origW, origH))
    return nonRootNodes
  }

  // 只有一个根节点 → 不动
  if (rootNodes.length === 1) return nodes

  // 多个根节点 → 优先保留有背景色的，其次保留第一个
  const withBg = rootNodes.filter(n => !!n.style?.backgroundColor)
  const kept = withBg.length > 0 ? withBg[0] : rootNodes[0]
  return [...nonRootNodes, kept]
}

/**
 * 创建一个合成根节点，当前端没有真实画布节点时提供边距计算参照。
 * 该节点会在匹配阶段被 isCanvasRoot 过滤掉，不参与比对。
 *
 * design 侧 rect 和 size 含义不同：
 *   - rect：缩放后坐标（与 arkui 坐标系对齐）
 *   - size：原始 dp 坐标（乘 designScale 后，未做 arkui 等比缩放）
 * 传入了 origW/origH 时用它们填充 size，否则回退为 rect 值（dev 侧 rect=size）。
 */
function createSyntheticRoot(id, canvasW, canvasH, origW, origH) {
  return {
    id: id || 'root',
    source: 'synthetic',
    type: 'container',
    rawType: 'root',
    name: id === 'design-root' ? '设计稿画布' : '开发侧画布',
    rect: { x: 0, y: 0, w: canvasW, h: canvasH },
    normRect: { x: 0, y: 0, w: 1, h: 1 },
    size: origW != null
      ? { x: 0, y: 0, w: origW, h: origH }
      : { x: 0, y: 0, w: canvasW, h: canvasH },
    visible: true,
    style: { opacity: 1 },
    path: [0],
  }
}

/**
 * 判断节点是否为"画布根节点"：即 rect 与画布完全重合，位于 (0,0)。
 *
 * 注意：使用严格相等（===）比较浮点数值，与 normalizeTree.sameBox 风格一致。
 * 两侧解析时 rect 和 canvas 尺寸来自同一运算链，浮点值精确匹配，不需要容差。
 *
 * @param {object} n        节点
 * @param {number} canvasW  画布宽度
 * @param {number} canvasH  画布高度
 * @returns {boolean}
 */
export function isCanvasRoot(n, canvasW, canvasH) {
  if (!n || !n.rect) return false
  const r = n.rect
  return r.x >= -2 && r.x <= 2 && r.y >= -2 && r.y <= 2
    && r.w >= canvasW - 2 && r.h >= canvasH - 2
}
