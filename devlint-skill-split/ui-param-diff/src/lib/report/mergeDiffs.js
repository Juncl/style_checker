/**
 * 节点级合并去重
 *
 * 把三类来源差异合并到统一结构 UnifiedIssue[]:
 *   1. nodeDiffs:server /check/upload 返回的节点属性差异(diffs[])
 *   2. pixelBlocks:server /check/pixel-diff 返回的像素差异块(diffBlocks[])
 *   3. textIssues:文案走查结果(预留,当前恒空)
 *
 * 合并规则(节点级):
 *   - 以 designNodeId 为主键归并
 *   - 节点属性差异 + 命中该节点的像素差异 → 合并为一条,issueType 含「属性+像素」
 *   - 文案差异同理 → 「属性+文案」/「属性+像素+文案」
 *   - 像素差异块若无关联节点(matchedNodeId === null)→ 独立成条,模块=位置描述
 *
 * 输出按 y 坐标排序(与现有 report.js 一致),供 Excel/md 复用。
 */

// 严重等级排序(取最高)
const SEV_RANK = { high: 3, mid: 2, low: 1 }

// property → 问题分类映射(用于节点对比 tab 的"问题类型"列)
const PROPERTY_CATEGORY = {
  fontSize:       '字号',
  'fontSize.scale':'字号',
  fontWeight:     '字重',
  fontColor:      '字体颜色',
  fontFamily:     '字体',
  lineHeight:     '行高',
  letterSpacing:  '字间距',
  textAlign:      '文字对齐',
  backgroundColor:'填充',
  borderRadius:   '圆角',
  border:         '描边',
  borderWidth:    '描边宽度',
  borderColor:    '描边颜色',
  padding:        '内边距',
  itemSpacing:    '元素间距',
  opacity:        '透明度',
  blur:           '模糊',
  shadow:         '投影',
  width:          '宽度',
  height:         '高度',
}

function categoryOf(property) {
  return PROPERTY_CATEGORY[property] || '属性'
}

function maxSeverity(arr) {
  return arr.reduce((max, s) => (SEV_RANK[s] > SEV_RANK[max] ? s : max), 'low')
}

/**
 * 位置描述(与 report.js describePosition 同语义,纯像素场景给无节点的像素块用)
 */
function describePosition(bbox) {
  if (!bbox) return ''
  const { x, y, w, h } = bbox
  return `坐标 (${Math.round(x)}, ${Math.round(y)}),尺寸 ${Math.round(w)}×${Math.round(h)}`
}

/**
 * 把节点属性差异 diff 对象标准化为 issue 片段
 */
function extractIssue(d) {
  return {
    property: d.property,
    description: d.description || null,
    expected: d.designValue,
    actual: d.arkuiValue,
  }
}

/**
 * 主合并函数
 * @param {Array} nodeDiffs   - server /check/upload 返回的 result.diffs
 * @param {Array} pixelBlocks - server /check/pixel-diff 返回的 diffBlocks
 * @param {Array} [textIssues=[]] - 文案走查结果(预留)
 * @param {Object} [ctx] - 上下文 { arkuiByPath, arkuiById, designRectMap, allArkuiNodes, allDesignNodes } 用于补 componentChain
 * @returns {Array<UnifiedIssue>}
 */
export function mergeDiffs(nodeDiffs = [], pixelBlocks = [], textIssues = [], ctx = {}) {
  const byKey = new Map() // key: arkuiNodeId 或 'PX-xxx' 或 'TXT-xxx'

  // 1. 节点属性差异先入桶(统一用开发侧 arkuiNodeId 作主键)
  for (const d of nodeDiffs) {
    if (d.severity !== 'error') continue
    const id = d.arkuiNodeId
    if (!byKey.has(id)) {
      const devRect = ctx.arkuiRectMap?.get(d.designNodeId) || ctx.designRectMap?.get(id) || { y: 0, x: 0, w: 0, h: 0 }
      const designRect = ctx.designRectMap?.get(d.designNodeId) || devRect
      byKey.set(id, {
        id,
        nodeId: id,
        nodeName: d.arkuiName || d.textContent || null,
        page: '-',
        module: ctx.arkuiByPath ? buildComponentChain(ctx.arkuiByPath, findPathByNodeId(ctx.allArkuiNodes, id)) : null,
        sources: { property: true, pixel: false, text: false },
        propertyIssues: [],
        pixelBlocks: [],
        textIssues: [],
        rect: devRect,
        designRect,
        devRect,
        _sortY: devRect.y,
      })
    }
    byKey.get(id).propertyIssues.push(extractIssue(d))
  }

  // 2. 局部图差异块归并(始终独立成条,不合并进属性节点)
  for (const pb of pixelBlocks) {
    const key = pb.id || `PX-${byKey.size + 1}`
    // 用 designToArkuiId 把 design 侧 matchedNodeId 转成开发侧 id
    const arkuiId = (pb.matchedNodeId && ctx.designToArkuiId?.get(pb.matchedNodeId)) || null
    byKey.set(key, {
      id: key,
      nodeId: arkuiId,
      nodeName: pb.matchedNodeName || null,
      page: '-',
      // 有节点关联时用节点名,无则用位置描述
      module: pb.matchedNodeName || describePosition(pb.bbox),
      sources: { property: false, pixel: true, text: false },
      propertyIssues: [],
      pixelBlocks: [pb],
      textIssues: [],
      rect: pb.bbox,
      designRect: pb.designBbox || pb.bbox,    // design 原图像素坐标(切 design.png 用)
      devRect: pb.devBbox || pb.bbox,           // dev 原图像素坐标(切 arkui.png 用)
      _sortY: pb.bbox?.y ?? 0,
    })
  }

  // 3. 文案差异不并入 unified(独立走 Excel 第三工作表)

  // 4. 展平为 UnifiedIssue
  const unified = [...byKey.values()]
  unified.sort((a, b) => (a._sortY || 0) - (b._sortY || 0))

  return unified.map(item => toUnifiedIssue(item))
}

/**
 * 内部结构 → 对外 UnifiedIssue
 */
function toUnifiedIssue(item) {
  const sources = item.sources
  // 问题类型:属性差异用具体分类(字号/字体/颜色等),局部图/文案保持原名
  const types = []
  if (sources.property) {
    const cats = [...new Set(item.propertyIssues.map(is => categoryOf(is.property)))]
    types.push(...cats)
  }
  if (sources.pixel) types.push('局部图')
  if (sources.text) types.push('文案')
  const issueType = types.join('+')

  const sevList = []
  if (sources.pixel) sevList.push(...item.pixelBlocks.map(p => p.severity))
  if (sources.text) sevList.push(...item.textIssues.map(t => t.severity))
  if (sources.property) sevList.push('high') // error 级属性差异按 high 计
  const severity = maxSeverity(sevList.length ? sevList : ['low'])

  // 问题描述 + 差异 + 修复建议
  const descParts = []
  const diffParts = []
  const suggestParts = []

  if (sources.property) {
    for (const is of item.propertyIssues) {
      descParts.push(`${is.property}: ${is.description || ''}`)
      diffParts.push(`expected:${formatVal(is.expected)} / actual:${formatVal(is.actual)}`)
      suggestParts.push(`将 ${is.property} 从 ${formatVal(is.actual)} 改为 ${formatVal(is.expected)}`)
    }
  }

  if (sources.pixel) {
    for (const pb of item.pixelBlocks) {
      descParts.push(`局部图差异率 ${(pb.diffRatio * 100).toFixed(1)}%`)
      diffParts.push(`bbox:${JSON.stringify(pb.bbox)} area:${pb.area}`)
      suggestParts.push('核对渲染结果与设计稿视觉')
    }
  }

  if (sources.text) {
    for (const ti of item.textIssues) {
      descParts.push(`文案规则: ${ti.ruleText}`)
      if (ti.textContent) diffParts.push(`design:"${ti.textContent.design}" / dev:"${ti.textContent.dev}"`)
      if (ti.suggestion) suggestParts.push(ti.suggestion)
    }
  }

  return {
    id: item.id,
    nodeId: item.nodeId,
    nodeName: item.nodeName,
    page: item.page,
    module: item.module,
    severity,
    issueType,
    description: descParts.join('; '),
    diff: diffParts.join('; '),
    suggestion: suggestParts.join('; '),
    rect: item.rect,
    designRect: item.designRect || item.rect,  // design 侧坐标(切 design.png 用)
    devRect: item.devRect || item.rect,        // dev 侧坐标(切 arkui.png 用)
    diffRatio: sources.pixel ? Math.max(...item.pixelBlocks.map(p => p.diffRatio || 0)) : 0,
  }
}

function formatVal(v) {
  if (v === null || v === undefined) return '-'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * 以下两个函数与 report.js 同实现,复制以避免循环依赖
 * (build.js 从 mcp 拷贝 report.js 时不会带这两个内部函数的导出)
 */
function findPathByNodeId(nodes, id) {
  if (!nodes || !id) return null
  for (const n of nodes) {
    if (n.id === id) return n.path
  }
  return null
}

function buildComponentChain(byPathMap, path) {
  if (!path || !Array.isArray(path) || path.length === 0) return null
  const chain = []
  for (let i = 1; i <= path.length; i++) {
    const subPath = path.slice(0, i)
    const node = byPathMap.get(subPath.join('.'))
    if (node && node.name) {
      const label = node.textContent
        ? `${node.name}("${truncate(node.textContent, 15)}")`
        : node.name
      chain.push(label)
    }
  }
  return chain.length ? chain.join(' > ') : null
}

function truncate(text, max) {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '...' : text
}
