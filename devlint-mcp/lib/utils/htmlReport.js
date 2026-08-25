import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname, relative } from 'path'
import { fileURLToPath } from 'url'
import { getSessionDir, getSessionTimestamp } from './session.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_PATH = join(__dirname, 'templates', 'report-template.html')

// ── 属性分组（与 client DiffReport.vue issueKey / ISSUE_GROUPS 对齐）──

const ISSUE_GROUPS = [
  { key: 'all', label: '全部' },
  { key: 'fontSize', label: '字号' }, { key: 'fontFamily', label: '字体' }, { key: 'fontWeight', label: '字重' },
  { key: 'color', label: '颜色' }, { key: 'fill', label: '填充' }, { key: 'borderColor', label: '描边颜色' },
  { key: 'borderWidth', label: '描边宽度' }, { key: 'borderRadius', label: '圆角' }, { key: 'shadow', label: '阴影' },
  { key: 'backdropBlur', label: '模糊' }, { key: 'opacity', label: '不透明度' },
  { key: 'padding', label: '内边距' }, { key: 'spacing', label: '间距' },
  { key: 'lineHeight', label: '行高' }, { key: 'letterSpacing', label: '字间距' },
  { key: 'missing', label: '缺失' }, { key: 'extra', label: '多余' }, { key: 'other', label: '其他' },
]

const ISSUE_LABELS = {
  fontSize: '字号', fontFamily: '字体', fontWeight: '字重',
  fontColor: '颜色', backgroundColor: '填充',
  borderColor: '描边颜色', 'border.color': '描边颜色',
  borderWidth: '描边宽度', borderRadius: '圆角',
  shadow: '阴影', blur: '模糊', backdropBlur: '模糊',
  opacity: '不透明度', padding: '内边距',
  itemSpacing: '间距', lineHeight: '行高', letterSpacing: '字间距',
  missing: '缺失', extra: '多余',
}

function issueKey(property = '') {
  const p = String(property)
  if (p === 'fontSize.scale') return 'fontSize.scale'
  if (p === 'textAlign') return '__ignored__'
  if (p === 'fontSize') return 'fontSize'
  if (p === 'fontFamily') return 'fontFamily'
  if (p === 'fontWeight') return 'fontWeight'
  if (p === 'fontColor') return 'color'
  if (p === 'backgroundColor') return 'fill'
  if (p === 'borderColor' || p === 'border.color') return 'borderColor'
  if (p === 'borderWidth') return 'borderWidth'
  if (p === 'borderRadius') return 'borderRadius'
  if (p === 'shadow' || p.startsWith('shadow.')) return 'shadow'
  if (p === 'blur' || p === 'backdropBlur') return 'backdropBlur'
  if (p === 'opacity') return 'opacity'
  if (p === 'padding') return 'padding'
  if (p === 'itemSpacing' || p.startsWith('spacing.')) return 'spacing'
  if (p === 'missing') return 'missing'
  if (p === 'extra') return 'extra'
  if (p === 'lineHeight') return 'lineHeight'
  if (p === 'letterSpacing') return 'letterSpacing'
  return 'other'
}

function issueLabel(property) {
  if (property === 'spacing.top') return '竖向间距'
  if (property === 'spacing.left') return '横向间距'
  if (property === 'fontSize.scale') return '字体缩放'
  return ISSUE_LABELS[property] || property
}

// ── 共享辅助（与 report.js 同逻辑，独立维护避免耦合）──

function buildPathMaps(result) {
  const arkuiByPath = new Map()
  const arkuiById = new Map()
  for (const n of result.allArkuiNodes || []) {
    const key = Array.isArray(n.path) ? n.path.join('.') : ''
    arkuiByPath.set(key, n)
    if (n.id) arkuiById.set(n.id, n)
  }
  const designById = new Map()
  for (const n of result.allDesignNodes || []) {
    if (n.id) designById.set(n.id, n)
  }
  return { arkuiByPath, arkuiById, designById }
}

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
    const node = byPathMap.get(path.slice(0, i).join('.'))
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

// ── 数据组装 ──

function buildReportData(result) {
  const diffs = result.diffs || []
  const { arkuiByPath, arkuiById, designById } = buildPathMaps(result)

  const items = diffs.map(d => {
    const devNode = arkuiById.get(d.arkuiNodeId)
    const designNode = designById.get(d.designNodeId)
    const cardName = d.textContent || d.designName || d.relatedDesignName || d.name || '节点'
    return {
      severity: d.severity || 'error',
      property: d.property,
      label: issueLabel(d.property),
      groupKey: issueKey(d.property),
      cardName,
      textContent: d.textContent || '',
      devClassName: d.arkuiName || '',
      componentChain: buildComponentChain(
        arkuiByPath,
        findPathByNodeId(result.allArkuiNodes, d.arkuiNodeId),
      ),
      arkuiValue: d.arkuiValue,
      designValue: d.designValue,
      designNodeId: d.designNodeId,
      arkuiNodeId: d.arkuiNodeId,
    }
  })

  // 按 y→x 排序
  items.sort((a, b) => {
    const ay = (arkuiById.get(a.arkuiNodeId)?.rect?.y) ?? 0
    const by = (arkuiById.get(b.arkuiNodeId)?.rect?.y) ?? 0
    const ax = (arkuiById.get(a.arkuiNodeId)?.rect?.x) ?? 0
    const bx = (arkuiById.get(b.arkuiNodeId)?.rect?.x) ?? 0
    return ay - by || ax - bx
  })

  const errorCount = diffs.filter(d => d.severity === 'error').length
  const warningCount = diffs.filter(d => d.severity === 'warning').length

  // 节点列表（仅 rect + id，供 SVG 圈框用）
  const arkuiNodes = (result.allArkuiNodes || [])
    .filter(n => n.rect)
    .map(n => ({ id: n.id, rect: n.rect }))
  const designNodes = (result.allDesignNodes || [])
    .filter(n => n.rect)
    .map(n => ({ id: n.id, rect: n.rect }))

  // 计算可见分组
  const groupCounts = { all: items.length }
  for (const it of items) {
    if (it.groupKey === '__ignored__') continue
    groupCounts[it.groupKey] = (groupCounts[it.groupKey] || 0) + 1
  }
  const groups = ISSUE_GROUPS.filter(g => g.key === 'all' || groupCounts[g.key])

  return {
    platform: result.platform || 'unknown',
    errorCount,
    warningCount,
    items,
    groups,
    arkuiCanvas: result.canvas?.arkui || null,
    designCanvas: result.canvas?.design || null,
    arkuiNodes,
    designNodes,
    devImgUrl: '',
    designImgUrl: '',
  }
}

// ── 图片路径处理 ──

function resolveImgUrl(imgPath, outDir) {
  if (!imgPath || !existsSync(imgPath)) return ''
  try {
    return relative(outDir, imgPath)
  } catch {
    return imgPath
  }
}

// ── 主函数 ──

/**
 * 生成可视化 HTML 报告
 *
 * @param {Object} result - server /check/upload 返回的完整结果
 * @param {{ designImagePath?: string, devImagePath?: string }} [imagePaths]
 * @param {string} [dir] - 输出目录，默认当前会话目录
 * @returns {string} html 文件路径
 */
export function generateHtmlReport(result, imagePaths = {}, dir) {
  const outDir = dir || getSessionDir()
  mkdirSync(outDir, { recursive: true })

  const data = buildReportData(result)
  data.devImgUrl = resolveImgUrl(imagePaths.devImagePath, outDir)
  data.designImgUrl = resolveImgUrl(imagePaths.designImagePath, outDir)

  const template = readFileSync(TEMPLATE_PATH, 'utf-8')
  const html = template.replace('__REPORT_DATA__', JSON.stringify(data))

  const htmlPath = join(outDir, `devlint_result_${getSessionTimestamp()}.html`)
  writeFileSync(htmlPath, html, 'utf-8')
  return htmlPath
}
