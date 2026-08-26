import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getSessionDir, getSessionTimestamp } from './session.js'

// ── 公共辅助函数 ──────────────────────────────────────

/**
 * 从 runCheck 原始结果构建 path/id → node 映射
 */
function buildPathMaps(result) {
  const arkuiByPath = new Map()
  const arkuiById = new Map()
  for (const n of result.allArkuiNodes || []) {
    const key = Array.isArray(n.path) ? n.path.join('.') : ''
    arkuiByPath.set(key, n)
    if (n.id) arkuiById.set(n.id, n)
  }
  const designRectMap = new Map()
  for (const p of result.pairs || []) {
    designRectMap.set(p.design.id, p.design.rect)
  }
  return { arkuiByPath, arkuiById, designRectMap }
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

function formatVal(v) {
  if (v === null || v === undefined) return '-'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * 根据节点 rect 描述页面中的相对位置
 * 用 y 坐标判断垂直区域（顶部/中部/底部），x 判断水平区域（左侧/中间/右侧）
 */
function describePosition(rect) {
  if (!rect || (rect.x === 0 && rect.y === 0 && rect.w === 0 && rect.h === 0)) return ''
  const x = rect.x || 0
  const y = rect.y || 0
  const w = rect.w || 0
  const h = rect.h || 0

  let vPos = '页面中部'
  if (y < 100) vPos = '页面顶部'
  else if (y > 600) vPos = '页面底部'

  let hPos = '中间'
  if (x < 100) hPos = '左侧'
  else if (x + w > 1820) hPos = '右侧'

  return `${vPos}（${hPos}），坐标 (${Math.round(x)}, ${Math.round(y)})，尺寸 ${Math.round(w)}×${Math.round(h)}`
}

// ── 结果提取与报告生成 ──────────────────────────────────────

/**
 * 从 runCheck 完整结果中提取精简摘要（返回给 AI）
 *
 * 以设计侧节点为维度，只含精准检查结果（error），不含模糊比对（warning）。
 * 不含评分、匹配覆盖率、检查耗时等统计信息。
 *
 * @param {Object} result - server /check/upload 返回的完整结果
 * @returns {{ platform: string, nodes: Array }}
 */
export function extractSummary(result) {
  const diffs = result.diffs || []
  const { arkuiByPath, designRectMap } = buildPathMaps(result)

  // 按设计侧节点 id 分组
  const byDesignNode = new Map()

  for (const d of diffs) {
    // 只取精准检查结果（error），跳过模糊比对（warning）
    if (d.severity !== 'error') continue

    const designId = d.designNodeId
    if (!byDesignNode.has(designId)) {
      const rect = designRectMap.get(designId) || { y: 0, x: 0 }

      byDesignNode.set(designId, {
        nodeName: (d.textContent || d.arkuiName) || null,
        textContent: d.textContent || null,
        nodeType: d.nodeType || null,
        designRect: rect,
        componentChain: buildComponentChain(
          arkuiByPath,
          findPathByNodeId(result.allArkuiNodes, d.arkuiNodeId),
        ),
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
  for (const n of nodes) delete n._rect

  return {
    platform: result.platform,
    nodes,
  }
}

/**
 * 将 runCheck 原始结果生成 Markdown 报告，写入当前会话目录
 * 包含所有 diffs（error + warning），以开发侧节点为维度组织
 *
 * @param {Object} result - server /check/upload 返回的完整结果
 * @param {string} [dir] - 输出目录，默认当前会话目录（.devlint/<年月日_时分秒>）
 * @returns {string} md 文件路径
 */
export function generateReport(result, dir) {
  const outDir = dir || getSessionDir()
  mkdirSync(outDir, { recursive: true })

  const diffs = result.diffs || []
  const { arkuiByPath, arkuiById, designRectMap } = buildPathMaps(result)

  // 按开发侧节点 id 分组（改的是开发代码，以开发侧节点为主维度）
  const byDevNode = new Map()

  for (const d of diffs) {
    const devId = d.arkuiNodeId
    if (!byDevNode.has(devId)) {
      const devNode = arkuiById.get(devId)
      const rect = (devNode && devNode.rect) || designRectMap.get(d.designNodeId) || { y: 0, x: 0, w: 0, h: 0 }
      byDevNode.set(devId, {
        nodeName: (d.textContent || d.arkuiName) || null,
        textContent: d.textContent || null,
        devRect: rect,
        componentChain: buildComponentChain(
          arkuiByPath,
          findPathByNodeId(result.allArkuiNodes, devId),
        ),
        devClassName: d.arkuiName || null,
        issues: [],
        _rect: rect,
      })
    }

    byDevNode.get(devId).issues.push({
      property: d.property,
      description: d.description || null,
      expected: d.designValue,
      actual: d.arkuiValue,
    })
  }

  // 按开发侧节点在画布上的顺序排序（y 优先，再 x）
  const nodes = Array.from(byDevNode.values())
  nodes.sort((a, b) => a._rect.y - b._rect.y || a._rect.x - b._rect.x)
  for (const n of nodes) delete n._rect

  // 统计
  const errorCount = diffs.filter(d => d.severity === 'error').length
  const warningCount = diffs.filter(d => d.severity === 'warning').length

  const lines = []

  lines.push('# UI 一致性检查报告')
  lines.push('')
  lines.push(`- 平台：${result.platform || 'unknown'}`)
  lines.push(`- 问题节点数：${nodes.length}`)
  lines.push(`- 差异项总数：${diffs.length}（error ${errorCount}，warning ${warningCount}）`)
  lines.push(`- 生成时间：${new Date().toLocaleString('zh-CN')}`)
  lines.push('')
  lines.push('> 本报告以修改代码为目的，按开发侧节点维度组织，每个节点列出需修改的属性及目标值。')
  lines.push('> 定位代码时优先使用「组件层级链」和「className/组件类型」，结合位置信息快速定位。')
  lines.push('')
  lines.push('---')
  lines.push('')

  if (nodes.length === 0) {
    lines.push('开发侧与设计稿一致，无需修改')
  } else {
    nodes.forEach((node, i) => {
      const rect = node.devRect || {}
      const posDesc = describePosition(rect)

      lines.push(`## ${i + 1}. ${node.nodeName || '(未命名)'}`)
      lines.push('')
      if (node.componentChain) {
        lines.push(`> 定位：${node.componentChain}`)
      }
      if (node.textContent && node.devClassName) {
        const isWeb = result.platform === 'web'
        const label = isWeb ? 'className' : '组件类型'
        lines.push(`> ${label}：\`${node.devClassName}\``)
      }
      if (posDesc) {
        lines.push(`> 位置：${posDesc}`)
      }
      lines.push('')

      if (node.issues && node.issues.length > 0) {
        lines.push('| 属性 | 描述 | 设计值 | 开发值 | 修改建议 |')
        lines.push('|------|------|--------|--------|----------|')
        node.issues.forEach((issue) => {
          const suggest = `将 ${issue.property} 从 \`${formatVal(issue.actual)}\` 改为 \`${formatVal(issue.expected)}\``
          lines.push(`| ${issue.property || ''} | ${issue.description || ''} | ${formatVal(issue.expected)} | ${formatVal(issue.actual)} | ${suggest} |`)
        })
      } else {
        lines.push('（无具体差异项）')
      }
      lines.push('')
      lines.push('---')
      lines.push('')
    })
  }

  const mdPath = join(outDir, `octo_uxlint_result_${getSessionTimestamp()}.md`)
  writeFileSync(mdPath, lines.join('\n'), 'utf-8')
  return mdPath
}
