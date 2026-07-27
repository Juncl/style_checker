/**
 * 从 runCheck 完整结果中提取修改报告
 * 以设计侧节点为维度，列出开发侧需要修改的点
 * 只含精准检查结果（error），不含模糊比对（warning）
 * 不含评分、匹配覆盖率、检查耗时
 */
export function extractSummary(result) {
  const diffs = result.diffs || []

  // 构建 path 字符串 → node 映射，用于还原组件层级链
  const arkuiByPath = new Map()
  for (const n of result.allArkuiNodes || []) {
    arkuiByPath.set(pathKey(n.path), n)
  }
  const designByPath = new Map()
  for (const n of result.allDesignNodes || []) {
    designByPath.set(pathKey(n.path), n)
  }

  // 记录设计侧节点坐标，用于排序
  const designRectMap = new Map()
  for (const p of result.pairs || []) {
    designRectMap.set(p.design.id, p.design.rect)
  }

  // 按设计侧节点 id 分组
  const byDesignNode = new Map()

  for (const d of diffs) {
    // 只取精准检查结果（error），跳过模糊比对（warning）
    if (d.severity !== 'error') continue

    const designId = d.designNodeId
    if (!byDesignNode.has(designId)) {
      const arkuiNode = arkuiByPath.values().next().value // 占位，下面实际查
      const rect = designRectMap.get(designId) || { y: 0, x: 0 }

      byDesignNode.set(designId, {
        designName: d.designName || null,
        textContent: d.textContent || null,
        nodeType: d.nodeType || null,
        // 节点相对位置（画布坐标）
        designRect: rect,
        // 组件层级链，帮助开发者定位代码
        componentChain: buildComponentChain(
          arkuiByPath,
          findPathByNodeId(result.allArkuiNodes, d.arkuiNodeId),
        ),
        // web 侧 name 即 className，arkui 侧 name 为组件类型
        devClassName: d.arkuiName || null,
        issues: [],
        _rect: rect,
      })
    }

    byDesignNode.get(designId).issues.push({
      property: d.property,
      description: d.description || null,
      expected: d.designValue,
      actual: d.arkuiValue,
    })
  }

  // 按设计侧节点在画布上的顺序排序（y 优先，再 x）
  const nodes = Array.from(byDesignNode.values())
  nodes.sort((a, b) => a._rect.y - b._rect.y || a._rect.x - b._rect.x)
  // 去掉内部排序字段
  for (const n of nodes) delete n._rect

  return {
    platform: result.platform,
    nodes,
  }
}

/**
 * path 数组 → 字符串 key
 */
function pathKey(path) {
  return Array.isArray(path) ? path.join('.') : ''
}

/**
 * 通过节点 id 查找 path
 */
function findPathByNodeId(nodes, id) {
  if (!nodes || !id) return null
  for (const n of nodes) {
    if (n.id === id) return n.path
  }
  return null
}

/**
 * 根据 path 构建组件层级链
 * 如 path=[0,0,0,0,1,0] → "Navigation > NavBar > TitleBar > HdsTitleBar > Text"
 */
function buildComponentChain(byPathMap, path) {
  if (!path || !Array.isArray(path) || path.length === 0) return null

  const chain = []
  for (let i = 1; i <= path.length; i++) {
    const subPath = path.slice(0, i)
    const node = byPathMap.get(subPath.join('.'))
    if (node && node.name) {
      // 带上 textContent 帮助区分同名组件
      const label = node.textContent
        ? `${node.name}("${truncate(node.textContent, 15)}")`
        : node.name
      chain.push(label)
    }
  }
  return chain.length ? chain.join(' > ') : null
}

/**
 * 截断文本
 */
function truncate(text, max) {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '...' : text
}
