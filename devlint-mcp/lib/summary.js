/**
 * 从 runCheck 完整结果中提取修改报告
 * 以设计侧节点为维度，列出开发侧需要修改的点
 * 不含评分、匹配覆盖率、检查耗时
 */
export function extractSummary(result) {
  const diffs = result.diffs || []

  // 按设计侧节点 id 分组
  const byDesignNode = new Map()

  for (const d of diffs) {
    const designId = d.designNodeId
    if (!byDesignNode.has(designId)) {
      byDesignNode.set(designId, {
        designNodeId: designId,
        designName: d.designName || null,
        devNodeId: d.arkuiNodeId || null,
        devName: d.arkuiName || null,
        textContent: d.textContent || null,
        nodeType: d.nodeType || null,
        issues: [],
      })
    }

    const node = byDesignNode.get(designId)

    node.issues.push({
      severity: d.severity,
      property: d.property,
      description: d.description || null,
      expected: d.designValue,
      actual: d.arkuiValue,
    })
  }

  // 按设计侧节点在画布上的顺序排序（y 优先，再 x）
  const designRectMap = new Map()
  for (const p of result.pairs || []) {
    designRectMap.set(p.design.id, p.design.rect)
  }
  const nodes = Array.from(byDesignNode.values())
  nodes.sort((a, b) => {
    const ra = designRectMap.get(a.designNodeId) || { y: 0, x: 0 }
    const rb = designRectMap.get(b.designNodeId) || { y: 0, x: 0 }
    return ra.y - rb.y || ra.x - rb.x
  })

  return {
    platform: result.platform,
    nodes,
  }
}
