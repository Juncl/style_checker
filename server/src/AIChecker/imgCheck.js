import axios from 'axios'
import { IMG_CHECKER_SYSTEM_PROMPT } from './systemPrompts.js'
import { DEV_ENV, VLM_CONFIG } from '../config/constants.js'
import { compressImage } from './compressImage.js'

const { model: DEFAULT_MODEL, url: VLM_API_URL, apikey: VLM_AUTH } = VLM_CONFIG[DEV_ENV]

export async function handleImgCheck({ model = DEFAULT_MODEL, messages, stream, ...rest }) {
  if (!messages) {
    const err = new Error('缺少参数！')
    err.statusCode = 400
    throw err
  }

  // 每次对话都注入系统 Prompt
  if (!messages[0] || messages[0].role !== 'system') {
    messages = [{ role: 'system', content: [{ type: 'text', text: IMG_CHECKER_SYSTEM_PROMPT }] }, ...messages]
  }

  // 压缩所有 image_url 中的图片
  await compressMessagesImages(messages)

  const finalMessages = DEV_ENV === 'OUT' ? toGLMMessages(messages) : messages
  return callAI({ model, messages: finalMessages, stream, ...rest })
}

async function compressMessagesImages(messages) {
  let totalBefore = 0
  let totalAfter = 0
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part.type === 'image_url') {
        const url = part.image_url?.url ?? part.image_url ?? part.url
        if (url) {
          totalBefore += url.length
          const compressed = await compressImage(url)
          totalAfter += compressed.length
          if (part.image_url) {
            part.image_url.url = compressed
          } else {
            part.url = compressed
          }
        }
      }
    }
  }
  if (totalBefore > 0) {
    console.log(`[图片压缩] 合计  压缩前: ${totalBefore.toLocaleString()} 字符  →  压缩后: ${totalAfter.toLocaleString()} 字符  |  缩减 ${((1 - totalAfter / totalBefore) * 100).toFixed(1)}%`)
  }
}

async function callAI({ model, messages, stream, ...rest }) {
  const response = await axios.request({
    method: 'post',
    maxBodyLength: Infinity,
    url: VLM_API_URL,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': VLM_AUTH,
    },
    data: JSON.stringify({
      model,
      messages,
      stream,
      max_output_tokens: 3200
    }),
    responseType: stream ? 'stream' : 'json',
  })
  return response.data
}

// ──────────────────────────────────────────────────────────────────────────────
// Markdown → diff 报告 JSON
//
// 把 VLM 按 systemPrompts 约定输出的 Markdown 报告，解析为与 server 算法
// （routes/check.js 的 diffs / unmatchedDesignNodes / unmatchedArkuiNodes）一致
// 的结构，供前端 DiffReport 复用。
// ──────────────────────────────────────────────────────────────────────────────

// "属性"中文标签 → diff.property（与 styleComparator 产出的 property 对齐）
const PROP_LABEL_TO_KEY = {
  字号: 'fontSize',
  字重: 'fontWeight',
  字色: 'fontColor',
  字体颜色: 'fontColor',
  填充: 'backgroundColor',
  填充色: 'backgroundColor',
  背景: 'backgroundColor',
  背景色: 'backgroundColor',
  圆角: 'borderRadius',
  描边颜色: 'borderColor',
  描边色: 'borderColor',
  描边宽度: 'borderWidth',
  描边: 'borderWidth',
  不透明度: 'opacity',
  透明度: 'opacity',
  模糊: 'blur',
  阴影: 'shadow',
  投影: 'shadow',
  内边距: 'padding',
  间距: 'itemSpacing',
  缺失: 'missing',
  多余: 'extra',
}

// 清理元素列中坐标文本的正则（中英文括号 + 裸露坐标块）
const RECT_CLEANUP_RE = /\s*(?:[（(][^）)]*[）)]|[设实]:[\d.,]+(?:;[设实]:[\d.,]+)?)/g

// 提取 Markdown 表格：返回从某个标题行之后、连续以 | 开头的表格数据行（已去掉表头与分隔行）
function extractTableRows(lines, startIdx) {
  const rows = []
  let i = startIdx
  // 跳到第一行表格
  while (i < lines.length && !lines[i].trim().startsWith('|')) {
    // 遇到下一个标题就说明这一节没有表格
    if (/^#{1,6}\s/.test(lines[i].trim())) return { rows, next: i }
    i++
  }
  let headerSeen = false
  for (; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t.startsWith('|')) break
    const cells = t.split('|').slice(1, -1).map(c => c.trim())
    // 分隔行（|---|---|）跳过
    if (cells.every(c => /^:?-{2,}:?$/.test(c) || c === '')) continue
    if (!headerSeen) { headerSeen = true; continue } // 第一行是表头
    rows.push(cells)
  }
  return { rows, next: i }
}

// 从"元素"列里提取被『』「」""括起来的文本内容
function extractTextContent(elementCell = '') {
  const m = elementCell.match(/[『「"“]([^』」"”]+)[』」"”]/)
  return m ? m[1].trim() : null
}

// 从"元素"列提取归一化坐标
// 支持格式：(设:x,y,w,h;实:x,y,w,h) — 英文标点 + 中文标点容错
// 也支持仅设计侧 (设:x,y,w,h) 或仅实现侧 (实:x,y,w,h)（缺失/多余节点）
function extractRects(elementCell = '') {
  // 中文全角标点 → 英文半角，统一处理
  // 同时容错 AI 可能输出的多字标签 → 单字
  const norm = String(elementCell)
    .replace(/[：]/g, ':')
    .replace(/[；]/g, ';')
    .replace(/[，、]/g, ',')
    .replace(/[（）]/g, m => m === '（' ? '(' : ')')
    .replace(/[．]/g, '.')
    // 容错多字标签：设计侧/设计/实现侧/实现/开发侧/开发 → 设/实
    .replace(/(设计侧|设计)\s*:/g, '设:')
    .replace(/(实现侧|实现|开发侧|开发)\s*:/g, '实:')

  const BLOCK = /([设实]):\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*/g
  const blocks = [...norm.matchAll(BLOCK)]

  let designRect = null
  let arkuiRect = null
  for (const m of blocks) {
    const rect = { x: +m[2], y: +m[3], w: +m[4], h: +m[5] }
    if (m[1] === '设') designRect = rect
    else if (m[1] === '实') arkuiRect = rect
  }

  return { designRect, arkuiRect }
}

const EMPTY_VALUES = new Set(['', '-', '—', '无', 'N/A', 'n/a', '/', '（空）', '--', '---', '未设置', '无填充', '无描边', '无圆角', '无阴影', '无模糊'])
function normVal(v) {
  const s = (v ?? '').toString().trim()
  return EMPTY_VALUES.has(s) ? '—' : s
}

// 解析一张差异表（明显/轻微）为 diff 数组
// diffIdx: 当前全局 diff 序号（引用传递），每生成一条 diff 自增
function parseDiffTable(rows, severity, diffIdx) {
  const diffs = []
  for (const cells of rows) {
    // 期望列：# | 元素 | 属性 | 设计侧 | 开发做成 | 修改建议
    // 兼容 5 列（无修改建议）和 6 列
    if (cells.length < 4) continue
    const numCell    = cells[0]  // # 列
    const element    = cells[1] || ''
    const propLabel  = cells[2] || ''
    const designVal  = cells[3] || ''
    const arkuiVal   = cells[4] || ''
    const suggestion = cells[5] || ''  // 可能不存在

    const property = PROP_LABEL_TO_KEY[propLabel.replace(/\s/g, '')]
    if (!property) continue

    const rects = extractRects(element)
    // 序号可能是数字或纯文字标记，跳过非数字行
    const seqNum = parseInt(numCell, 10)

    const idx = diffIdx.val++
    diffs.push({
      property,
      designValue: normVal(designVal),
      arkuiValue: normVal(arkuiVal),
      severity,
      suggestion: suggestion.trim() || normVal(arkuiVal),
      description: suggestion.trim() || normVal(arkuiVal),
      nodeType: null,
      textContent: extractTextContent(element),
      designName: element.replace(RECT_CLEANUP_RE, '').trim(),
      arkuiName: element.replace(RECT_CLEANUP_RE, '').trim(),
      matchType: 'ai-visual',
      confidence: severity === 'warning' ? 'low' : 'high',
      iou: null,
      topologyScore: null,
      regionScore: null,
      source: 'ai',
      designNodeId: `ai-d-${idx}`,
      arkuiNodeId:  `ai-a-${idx}`,
      designRect: rects.designRect,
      arkuiRect:  rects.arkuiRect,
    })
  }
  return diffs
}

// 解析缺失/多余表 → 构建单侧 diff 数组
// 缺失（设计有、实现无）：designNodeId 有值，arkuiNodeId = null
// 多余（实现有、设计无）：designNodeId = null，arkuiNodeId 有值
function parseMissingExtraTable(rows, diffIdx) {
  const diffs = []
  for (const cells of rows) {
    // 期望列：# | 类型 | 元素 | 说明（旧格式还有"位置"列）
    if (cells.length < 3) continue
    const kind     = (cells[1] || '').trim()
    const element  = (cells[2] || '').trim()
    const descCol  = cells.slice(3).find(c => c.trim()) || ''
    const isMissing = kind.includes('缺失')
    const isExtra   = kind.includes('多余')
    if (!isMissing && !isExtra) continue

    const rects = extractRects(element)
    const idx = diffIdx.val++
    const name = element.replace(RECT_CLEANUP_RE, '').trim()

    diffs.push({
      property: isMissing ? 'missing' : 'extra',
      designValue: normVal(isMissing ? (name || element) : '—'),
      arkuiValue:  normVal(isExtra   ? (name || element) : '—'),
      severity: 'error',
      suggestion: (descCol || kind).trim(),
      description: (descCol || kind).trim(),
      nodeType: null,
      textContent: extractTextContent(element),
      designName: isMissing ? (name || element) : '',
      arkuiName: isExtra ? (name || element) : '',
      matchType: isMissing ? '缺失' : '多余',
      confidence: 'high',
      iou: null,
      topologyScore: null,
      regionScore: null,
      source: 'ai',
      designNodeId: isMissing ? `ai-u-${idx}` : null,
      arkuiNodeId:  isExtra   ? `ai-u-${idx}` : null,
      designRect: isMissing ? rects.designRect : null,
      arkuiRect:  isExtra   ? rects.arkuiRect  : null,
    })
  }
  return diffs
}

/**
 * 把 VLM 输出的 Markdown 报告转为与 diff 报告一致的 JSON。
 * @param {string} markdown VLM 返回的完整 Markdown 文本
 * @returns {{ markdown:string, overallLevel:string|null, score:number|null,
 *   stats:object, diffs:Array, unmatchedDesignNodes:Array, unmatchedArkuiNodes:Array,
 *   designNodes:Array, devNodes:Array, pairMap:Object }}
 * diffs 中包含 matchType='缺失'|'多余' 的单侧 diff（designNodeId/arkuiNodeId 其一为 null）。
 * designNodes/devNodes 为从 diffs 去重构建的画布渲染节点列表。
 * pairMap 为 { [designNodeId]: { arkuiNodeId } } 跨侧高亮映射。
 */
export function markdownToDiffReport(markdown = '') {
  // 去掉思维链 <think>…</think>
  const clean = String(markdown).replace(/<think>[\s\S]*?<\/think>/gi, '')
  const lines = clean.split('\n')

  let diffs = []
  let unmatchedDesignNodes = []
  let unmatchedArkuiNodes = []
  let overallLevel = null
  let score = null
  let stats = {}
  const diffIdx = { val: 0 }

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t.startsWith('#')) {
      // 总体还原度行：**[高/中/低]**（还原度评分：NN/100）
      const lvl = t.match(/\*\*\[?\s*(高|中|低)\s*\]?\*\*/)
      if (lvl && !overallLevel) overallLevel = lvl[1]
      const sc = t.match(/(\d{1,3})\s*\/\s*100/)
      if (sc && score == null) score = Number(sc[1])
      continue
    }

    if (/明显差异/.test(t)) {
      const { rows } = extractTableRows(lines, i + 1)
      diffs = diffs.concat(parseDiffTable(rows, 'error', diffIdx))
    } else if (/轻微差异/.test(t)) {
      const { rows } = extractTableRows(lines, i + 1)
      diffs = diffs.concat(parseDiffTable(rows, 'warning', diffIdx))
    } else if (/缺失|多余/.test(t) && !/元素匹配/.test(t)) {
      const { rows } = extractTableRows(lines, i + 1)
      diffs = diffs.concat(parseMissingExtraTable(rows, diffIdx))
    } else if (/元素匹配概览/.test(t)) {
      const { rows } = extractTableRows(lines, i + 1)
      const row = rows[0]
      if (row && row.length >= 5) {
        const [d, a, m, miss, extra] = row.map(x => parseInt(x, 10))
        stats = {
          designNodes: Number.isFinite(d) ? d : null,
          arkuiNodes: Number.isFinite(a) ? a : null,
          matchedPairs: Number.isFinite(m) ? m : null,
          unmatchedDesign: Number.isFinite(miss) ? miss : null,
          unmatchedArkui: Number.isFinite(extra) ? extra : null,
        }
      }
    }
  }

  const errorCount = diffs.filter(d => d.severity === 'error').length
  const warningCount = diffs.filter(d => d.severity === 'warning').length
  stats = { ...stats, errorCount, warningCount, infoCount: 0, score }

  // ── 从 diffs 构建渲染节点列表 + 匹配对映射 ──
  const reportStructs = buildReportStructures(diffs)

  return {
    markdown: clean, overallLevel, score, stats, diffs,
    unmatchedDesignNodes, unmatchedArkuiNodes,
    ...reportStructs,
  }
}

/**
 * 从 diffs 数组构建画布渲染所需的节点列表和匹配对映射。
 * - designNodes / devNodes：去重后的节点，type 由 textContent 推断
 * - pairMap：designNodeId → { arkuiNodeId }，供画布跨侧联动高亮
 */
function buildReportStructures(diffs) {
  const designNodes = []
  const devNodes = []
  const seenDesign = new Set()
  const seenArkui = new Set()
  const pairMap = {}

  for (const d of diffs) {
    if (d.designNodeId && d.designRect && !seenDesign.has(d.designNodeId)) {
      seenDesign.add(d.designNodeId)
      designNodes.push({
        id: d.designNodeId,
        name: d.designName || d.textContent || '',
        type: d.textContent ? 'text' : 'container',
        textContent: d.textContent || null,
        rect: d.designRect,
        visible: true,
      })
    }
    if (d.arkuiNodeId && d.arkuiRect && !seenArkui.has(d.arkuiNodeId)) {
      seenArkui.add(d.arkuiNodeId)
      devNodes.push({
        id: d.arkuiNodeId,
        name: d.arkuiName || d.textContent || '',
        type: d.textContent ? 'text' : 'container',
        textContent: d.textContent || null,
        rect: d.arkuiRect,
        visible: true,
      })
    }
    if (d.designNodeId && d.arkuiNodeId) {
      pairMap[d.designNodeId] = { arkuiNodeId: d.arkuiNodeId }
    }
  }

  return { designNodes, devNodes, pairMap }
}

// 将前端 messages 格式转换为 GLM 标准格式（仅外网使用）
function toGLMMessages(messages) {
  return messages.map(msg => {
    if (typeof msg.content === 'string') return msg

    if (msg.role === 'system') {
      // GLM 要求 system content 为纯字符串
      return { ...msg, content: msg.content.map(c => c.text ?? '').join('') }
    }

    return {
      ...msg,
      content: msg.content.map(c => {
        if (c.type === 'input_text') {
          return { type: 'text', text: c.text }
        }
        if (c.type === 'image_url') {
          const url = c.image_url?.url ?? c.image_url ?? c.url
          return { type: 'image_url', image_url: { url } }
        }
        return c
      }),
    }
  })
}