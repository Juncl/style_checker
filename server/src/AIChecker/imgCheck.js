import axios from 'axios'
import { IMG_CHECKER_SYSTEM_PROMPT } from './systemPrompts.js'
import { DEV_ENV, VLM_CONFIG } from '../config/constants.js'

const { model: DEFAULT_MODEL, url: VLM_API_URL, apikey: VLM_AUTH } = VLM_CONFIG[DEV_ENV]

export async function handleImgCheck({ model = DEFAULT_MODEL, messages, stream, ...rest }) {
  if (!messages) {
    const err = new Error('缺少参数！')
    err.statusCode = 400
    throw err
  }

  if (!messages[0] || messages[0].role !== 'system') {
    messages = [{ role: 'system', content: [{ type: 'input_text', text: IMG_CHECKER_SYSTEM_PROMPT }] }, ...messages]
  }

  const finalMessages = DEV_ENV === 'OUT' ? toGLMMessages(messages) : messages
  return callAI({ model, messages: finalMessages, stream, ...rest })
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
    data: JSON.stringify({ model, messages, stream, ...rest }),
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
}

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

const EMPTY_VALUES = new Set(['', '-', '—', '无', 'N/A', 'n/a', '/'])
function normVal(v) {
  const s = (v ?? '').toString().trim()
  return EMPTY_VALUES.has(s) ? '—' : s
}

// 解析一张差异表（明显/轻微）为 diff 数组
function parseDiffTable(rows, severity) {
  const diffs = []
  for (const cells of rows) {
    // 期望列：# | 元素 | 属性 | 设计侧 | 开发做成 | 修改建议
    if (cells.length < 5) continue
    const [, element, propLabel, designValue, arkuiValue, suggestion = ''] = cells
    const property = PROP_LABEL_TO_KEY[(propLabel || '').replace(/\s/g, '')]
    if (!property) continue // 非受控属性标签，跳过（避免脏数据）
    const sug = (suggestion || '').trim()
    diffs.push({
      property,
      designValue: normVal(designValue),
      arkuiValue: normVal(arkuiValue),
      severity,
      suggestion: sug,        // 设计师视角的简短修改建议（目标值/动作）
      description: sug,        // 兼容 diff 报告的 description 字段
      nodeType: null,
      textContent: extractTextContent(element),
      designName: element.trim(),
      arkuiName: element.trim(),
      matchType: 'ai-visual',
      confidence: severity === 'warning' ? 'low' : 'high',
      iou: null,
      topologyScore: null,
      regionScore: null,
      source: 'ai',
    })
  }
  return diffs
}

// 解析缺失/多余表 → { unmatchedDesignNodes, unmatchedArkuiNodes }
function parseMissingExtraTable(rows) {
  const unmatchedDesignNodes = []
  const unmatchedArkuiNodes = []
  for (const cells of rows) {
    // 期望列：# | 类型 | 元素 | 位置 | 说明
    if (cells.length < 3) continue
    const [, kind, element] = cells
    const node = {
      id: null,
      name: (element || '').trim(),
      type: null,
      textContent: extractTextContent(element),
      rect: null,
    }
    if ((kind || '').includes('缺失')) unmatchedDesignNodes.push(node)
    else if ((kind || '').includes('多余')) unmatchedArkuiNodes.push(node)
  }
  return { unmatchedDesignNodes, unmatchedArkuiNodes }
}

/**
 * 把 VLM 输出的 Markdown 报告转为与 diff 报告一致的 JSON。
 * @param {string} markdown VLM 返回的完整 Markdown 文本
 * @returns {{ markdown:string, overallLevel:string|null, score:number|null,
 *   stats:object, diffs:Array, unmatchedDesignNodes:Array, unmatchedArkuiNodes:Array }}
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
      diffs = diffs.concat(parseDiffTable(rows, 'error'))
    } else if (/轻微差异/.test(t)) {
      const { rows } = extractTableRows(lines, i + 1)
      diffs = diffs.concat(parseDiffTable(rows, 'warning'))
    } else if (/缺失|多余/.test(t)) {
      const { rows } = extractTableRows(lines, i + 1)
      const r = parseMissingExtraTable(rows)
      unmatchedDesignNodes = unmatchedDesignNodes.concat(r.unmatchedDesignNodes)
      unmatchedArkuiNodes = unmatchedArkuiNodes.concat(r.unmatchedArkuiNodes)
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

  return { markdown: clean, overallLevel, score, stats, diffs, unmatchedDesignNodes, unmatchedArkuiNodes }
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