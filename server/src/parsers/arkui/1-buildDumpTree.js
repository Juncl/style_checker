/**
 * ArkUI Dump Step 1: dump 文本 → UnifiedNode 树
 *
 * dump 是 HarmonyOS ArkUI Inspector 的另一种导出格式（文本树，非 JSON）。
 * 输出格式与 buildArkuiTree 完全一致，后续 step2/3/4 直接复用。
 *
 * dump 格式规律：
 *   - 节点头：`(indent)|-> Type childSize:N`，indent = (depth-1)*2 空格
 *   - 非叶节点属性：indent+4 空格 + `| key: value`
 *   - 叶节点属性：  indent+6 空格 + `key: value`（无 | 前缀）
 *   - `top: Y left: X`      → 绝对物理像素位置
 *   - `FrameRect: RectT (x,y) - [w x h]` → 取 w/h 作为尺寸（x/y 不可靠）
 *   - root 节点的 `dpi: N`  → resolution
 */

import { normalizeArkuiColor, isTransparent } from '../../utils/colorUtils.js'

const r4 = v => Math.round(v * 10000) / 10000

const TEXT_TYPES      = new Set(['Text'])
const SPAN_TYPES      = new Set(['Span'])
// 注意：未在此列表的语法节点（如 SyntaxItem、ContentSlot 等）也会被自动当作
// wrapper 处理 —— 见 2-pruneTree.js 中 "无 rect 但有 children" 的通用 unwrap 规则。
// 此白名单只用于"有 rect 但仍需 unwrap"的节点。
const FRAMEWORK_TYPES = new Set([
  'root', 'stage', 'page', 'JsView',
  'IfElse', 'ForEach', 'LazyForEach',
  'Navigation', 'NavBar', 'NavigationContent', 'Divider',
  'ScrollBar', 'NavBarContent', 'NavigationMenu',
  '__Common__', 'TitleBar', 'ToolBar', 'BackButton',
])

/**
 * @param {string} dumpText .dump 文件原始文本
 * @returns {{ canvasWidthVp, canvasHeightVp, resolution, root }}
 */
export function buildDumpTree(dumpText) {
  const rawRoot = parseDumpText(dumpText)
  if (!rawRoot) throw new Error('dump 解析失败：找不到 root 节点')

  const resolution     = parseFloat(getProp(rawRoot.props, /^dpi:\s*([\d.]+)/)) || 3.5
  const frameRect      = parseFrameRect(rawRoot.props)
  const canvasWidthPx  = frameRect?.w || 1316
  const canvasHeightPx = frameRect?.h || 2832
  const canvasWidthVp  = canvasWidthPx / resolution
  const canvasHeightVp = canvasHeightPx / resolution

  const walked = convertNode(rawRoot, resolution, canvasWidthVp, canvasHeightVp, [0], { x: 0, y: 0 })
  // convertNode 对富文本 Text（含 Span 子节点）返回节点数组；root 为框架节点，仅作防御
  const root = Array.isArray(walked) ? walked[0] : walked
  return { canvasWidthVp, canvasHeightVp, resolution, root }
}

/**
 * 接收 dump-to-json 接口返回的初版 JSON（带 _sourceFormat: 'dump'），
 * 直接解构返回，供 parseArkui 流水线后续步骤使用。
 * @param {{ _sourceFormat: string, canvasWidthVp: number, canvasHeightVp: number, resolution: number, root: object }} initJson
 * @returns {{ canvasWidthVp, canvasHeightVp, resolution, root }}
 */
export function buildDumpTreeFromJson(initJson) {
  const { canvasWidthVp, canvasHeightVp, resolution, root } = initJson
  return { canvasWidthVp, canvasHeightVp, resolution, root }
}

// ─── 文本树解析 ────────────────────────────────────────────────────────────────

function parseDumpText(text) {
  const lines   = text.split('\n')
  const stack   = []   // [{ node, headerIndent }]
  let   rawRoot = null

  for (const line of lines) {
    const raw     = line.replace(/\r$/, '')
    const trimmed = raw.trimStart()
    if (!trimmed) continue

    const headerMatch = trimmed.match(/^\|->\s+(\S+)\s+childSize:(\d+)/)
    if (headerMatch) {
      const indent  = raw.length - trimmed.length
      const type    = headerMatch[1]

      // 弹出缩进 >= 当前层级的所有节点
      while (stack.length > 0 && stack[stack.length - 1].headerIndent >= indent) {
        stack.pop()
      }

      const rawNode = { type, headerIndent: indent, props: [], children: [] }
      if (stack.length > 0) {
        stack[stack.length - 1].node.children.push(rawNode)
      } else {
        rawRoot = rawNode
      }
      stack.push({ node: rawNode, headerIndent: indent })
    } else if (stack.length > 0) {
      // 属性行：去掉 `| ` 或 `|` 前缀
      const prop = trimmed.startsWith('| ') ? trimmed.slice(2)
        : trimmed.startsWith('|')           ? trimmed.slice(1)
        : trimmed
      if (prop.trim()) stack[stack.length - 1].node.props.push(prop.trim())
    }
  }

  return rawRoot
}

// ─── RawNode → UnifiedNode ────────────────────────────────────────────────────

function convertNode(rawNode, resolution, canvasW, canvasH, path, accumTranslate) {
  const { type, props, children } = rawNode
  const isFramework = FRAMEWORK_TYPES.has(type)
  const isSpan      = SPAN_TYPES.has(type)
  const isText      = TEXT_TYPES.has(type)

  // 累积 translate：祖先链上所有 translate(x,y) 之和 + 自身 translate。
  // ArkUI translate 是 CSS transform 类似的渲染时变换，影响自己和所有后代的实际渲染位置。
  // dump 里 top/left 是 layout 位置（不含 translate），需要手动叠加。
  const selfTranslate = parseTranslate(props) || { x: 0, y: 0 }
  const newAccum = {
    x: accumTranslate.x + selfTranslate.x,
    y: accumTranslate.y + selfTranslate.y,
  }

  // 绝对物理像素坐标（top/left 为绝对值，FrameRect 取 w/h），叠加累积 translate
  const topLeft   = parseTopLeft(props)
  const frameRect = parseFrameRect(props)
  const absPx = topLeft && frameRect
    ? { x: topLeft.left + newAccum.x, y: topLeft.top + newAccum.y, w: frameRect.w, h: frameRect.h }
    : frameRect
      ? { x: frameRect.x + newAccum.x, y: frameRect.y + newAccum.y, w: frameRect.w, h: frameRect.h }
      : null

  const vpRect = absPx
    ? { x: r4(absPx.x / resolution), y: r4(absPx.y / resolution),
        w: r4(absPx.w / resolution), h: r4(absPx.h / resolution) }
    : null

  const style = extractDumpStyle(type, props, resolution, vpRect)

  // Text 内容（含 Span 子节点聚合）
  let textContent = ''
  if (isText)      textContent = getDumpTextContent(props, children)
  else if (isSpan) textContent = getSpanContent(props)

  // _attrs 只需填 pruneTree 会读的字段
  const visible2 = getProp(props, /^Visible:\s*(\d+)/)
  const _attrs   = {}
  if (visible2 === '2') _attrs.visibility = 'Visibility.Hidden'

  const nodeId = getProp(props, /^ID:\s*(\d+)/) || path.join('.')

  const unified = {
    id:       nodeId,
    source:   'arkui',
    type:     isText ? 'text' : 'container',
    rawType:  String(type || '').toLowerCase(),
    name:     type,
    path,
    rect: vpRect
      ? { x: vpRect.x, y: vpRect.y, w: vpRect.w, h: vpRect.h }
      : { x: 0, y: 0, w: 0, h: 0 },
    // arkui 无"缩放前"概念，size 与 rect 同值，仅为与 design 字段对齐
    size: vpRect
      ? { x: vpRect.x, y: vpRect.y, w: vpRect.w, h: vpRect.h }
      : { x: 0, y: 0, w: 0, h: 0 },
    normRect: vpRect
      ? { x: vpRect.x / canvasW, y: vpRect.y / canvasH, w: vpRect.w / canvasW, h: vpRect.h / canvasH }
      : { x: 0, y: 0, w: 0, h: 0 },
    visible:        true,
    style,
    children:       [],
    _frameworkType: isFramework,
    _spanType:      isSpan,
    _blankType:     type === 'Blank',
    _attrs,
    _rectRaw: absPx
      ? { x1: absPx.x, y1: absPx.y, x2: absPx.x + absPx.w, y2: absPx.y + absPx.h }
      : null,
  }

  if (textContent) unified.textContent = textContent

  // 富文本域预扫描：直接 Span + 语法 wrapper（IfElse 等）子树内的 Span
  const textSpanDomain = isText ? collectTextSpans(children) : null

  // 递归子节点（富文本域内的 Span 由 buildDumpSpanNodes 统一处理，不在此递归）。
  // 传 newAccum 让 translate 向下传播。
  let ci = 0
  for (const child of children) {
    if (textSpanDomain && textSpanDomain.skipChildren.has(child)) continue
    const converted = convertNode(child, resolution, canvasW, canvasH, [...path, ci++], newAccum)
    if (Array.isArray(converted)) {
      for (const n of converted) unified.children.push(n)
    } else {
      unified.children.push(converted)
    }
  }

  // Button / TextInput：拆分虚拟文本子节点（与 JSON 路径保持一致）
  if (type === 'Button' || type === 'TextInput') {
    const splitChild = maybeSplitTextChild(unified, type, props, vpRect, resolution, canvasW, canvasH, path)
    if (splitChild) unified.children.push(splitChild)
  }

  // 富文本拆分：Text + 富文本域内的 Span → N 个独立文本节点（与 JSON 路径保持一致）。
  // 拆分以 Span 列表为准，父 Text 删除、Span 节点顶替原位，类型统一改为 text。
  if (textSpanDomain && textSpanDomain.spans.length > 0) {
    const spanNodes = buildDumpSpanNodes(unified, props, textSpanDomain.spans, resolution, canvasW, canvasH, path)
    if (spanNodes) return spanNodes
  }

  return unified
}

// ─── 样式提取 ─────────────────────────────────────────────────────────────────

function extractDumpStyle(type, props, resolution, vpRect) {
  const s = {}

  // 背景色（仅容器节点）
  if (!TEXT_TYPES.has(type)) {
    const bgRaw = getProp(props, /^BackgroundColor:\s*(#[0-9A-Fa-f]{6,8})/)
    if (bgRaw && !isTransparent(bgRaw)) {
      s.backgroundColor = normalizeArkuiColor(bgRaw)
    }
  }

  // 尺寸
  const w = vpRect?.w ?? 0
  const h = vpRect?.h ?? 0
  if (w > 0) s.width  = Math.round(w)
  if (h > 0) s.height = Math.round(h)

  // 圆角（dump 直接输出 vp，仅容器节点）
  if (!TEXT_TYPES.has(type)) {
    const br = parseDumpBorderRadius(props)
    if (br && Object.values(br).some(v => v > 0)) {
      if (w > 0 && h > 0) {
        const maxBr = Math.min(w, h) / 2
        s.borderRadius = {
          topLeft:     Math.min(br.topLeft,     maxBr),
          topRight:    Math.min(br.topRight,    maxBr),
          bottomRight: Math.min(br.bottomRight, maxBr),
          bottomLeft:  Math.min(br.bottomLeft,  maxBr),
        }
      } else {
        s.borderRadius = br
      }
    }
  }

  // 描边（Border: [top,right,bottom,left] vp，取最大值，仅容器节点）
  if (!TEXT_TYPES.has(type)) {
    const bw = parseDumpBorderWidths(props)
    if (bw) {
      const maxW = Math.max(bw.top, bw.right, bw.bottom, bw.left)
      if (maxW > 0) s.border = { width: maxW, color: null, style: 'BorderStyle.Solid' }
    }
  }

  // 文字属性（仅 Text）
  if (TEXT_TYPES.has(type)) {
    const fc = getProp(props, /^FontColor:\s*(#[0-9A-Fa-f]{6,8})/)
    if (fc) s.fontColor = normalizeArkuiColor(fc)

    // FontSize: 优先 Xfp（= vp when fontScale=1），其次 Xpx / resolution
    const fsFp = getProp(props, /^FontSize:\s*([\d.]+)fp/)
    if (fsFp) {
      s.fontSize = parseFloat(fsFp)
    } else {
      const fsPx = getProp(props, /^FontSize:\s*([\d.]+)px/)
      if (fsPx) s.fontSize = parseFloat(fsPx) / resolution
    }

    const fw = parseDumpFontWeight(props)
    if (fw !== null) s.fontWeight = fw

    // LineHeight：prop: Xfp 优先
    const lhFp = getProp(props, /LineHeight:.*prop:\s*([\d.]+)fp/)
    if (lhFp) {
      const v = parseFloat(lhFp)
      if (v > 0) s.lineHeight = v
    } else {
      const lhPx = getProp(props, /^LineHeight:\s*([\d.]+)px/)
      if (lhPx) {
        const v = parseFloat(lhPx) / resolution
        if (v > 0) s.lineHeight = v
      }
    }

    // LetterSpacing（0 = 默认，不写入）
    const lsPx = getProp(props, /^LetterSpacing:\s*([\d.]+)px/)
    if (lsPx) {
      const v = parseFloat(lsPx) / resolution
      if (v !== 0) s.letterSpacing = v
    }

    // textAlign
    const ta = getProp(props, /^TextAlign:\s*(\w+)/)
    if (ta) s.textAlign = normalizeDumpTextAlign(ta)

    // fontFamily
    const ff = getProp(props, /^fontFamily:\s*(.+?)(?:\s+prop:.*)?$/)
    if (ff) s.fontFamily = ff.trim()
  }

  // Image 节点不参与背景色比对（与 JSON 路径一致）
  if (type === 'Image') delete s.backgroundColor

  return s
}

// ─── 文字内容 ──────────────────────────────────────────────────────────────────

function getDumpTextContent(props, children) {
  // 直接 Content: text（无 Span 时）
  const direct = getProp(props, /^Content:\s*(.+)/)
  if (direct && direct.trim()) return direct.trim()

  // 有 Span 子节点：拼接
  const parts = []
  for (const child of children) {
    if (!SPAN_TYPES.has(child.type)) continue
    const t = getSpanContent(child.props)
    if (t) parts.push(t)
  }
  return parts.join('')
}

function getSpanContent(props) {
  // --------Content: "text",spanItemType:NORMAL
  const m = getProp(props, /^-+Content:\s*"(.*)",spanItemType:/)
  if (m !== null) return m
  return getProp(props, /^Content:\s*(.+)/) || ''
}

// ─── 辅助解析 ─────────────────────────────────────────────────────────────────

function getProp(props, re) {
  for (const p of props) {
    const m = p.match(re)
    if (m) return m[1]
  }
  return null
}

function parseFrameRect(props) {
  for (const p of props) {
    // x/y 可能为负数（如 NavDestinationContent y=-136），w/h 同样允许负数解析后再判断
    const m = p.match(/^FrameRect: RectT \((-?[\d.]+),\s*(-?[\d.]+)\) - \[(-?[\d.]+) x (-?[\d.]+)\]/)
    if (m) {
      const w = parseFloat(m[3]), h = parseFloat(m[4])
      if (w <= 0 || h <= 0) return null  // 负/零 w/h 视为无效尺寸
      return { x: parseFloat(m[1]), y: parseFloat(m[2]), w, h }
    }
  }
  return null
}

function parseTranslate(props) {
  for (const p of props) {
    const m = p.match(/^translate\(x,y\):\s*(-?[\d.]+),\s*(-?[\d.]+)/)
    if (m) {
      const x = parseFloat(m[1]), y = parseFloat(m[2])
      if (x !== 0 || y !== 0) return { x, y }
    }
  }
  return null
}

function parseTopLeft(props) {
  for (const p of props) {
    // top/left 可能为负数（被父容器裁切的偏移）
    const m = p.match(/^top:\s*(-?[\d.]+)\s+left:\s*(-?[\d.]+)/)
    if (m) return { top: parseFloat(m[1]), left: parseFloat(m[2]) }
  }
  return null
}

function parseDumpBorderRadius(props) {
  for (const p of props) {
    const m = p.match(/^BorderRadius: radiusTopLeft: \[([\d.]+)vp\]radiusTopRight: \[([\d.]+)vp\]radiusBottomLeft: \[([\d.]+)vp\]radiusBottomRight: \[([\d.]+)vp\]/)
    if (m) {
      return {
        topLeft:     parseFloat(m[1]),
        topRight:    parseFloat(m[2]),
        bottomLeft:  parseFloat(m[3]),
        bottomRight: parseFloat(m[4]),
      }
    }
  }
  return null
}

function parseDumpBorderWidths(props) {
  for (const p of props) {
    const m = p.match(/^Border: \[([\d.]+)vp,([\d.]+)vp,([\d.]+)vp,([\d.]+)vp\]/)
    if (m) {
      return {
        top: parseFloat(m[1]), right: parseFloat(m[2]),
        bottom: parseFloat(m[3]), left: parseFloat(m[4]),
      }
    }
  }
  return null
}

function parseDumpFontWeight(props) {
  for (const p of props) {
    const m = p.match(/^FontWeight:\s*(\S+)/)
    if (!m) continue
    const raw = m[1].toLowerCase()
    if (raw === 'medium')  return 500
    if (raw === 'bold')    return 700
    if (raw === 'bolder')  return 900
    if (raw === 'lighter') return 300
    if (raw === 'normal' || raw === 'regular') return 400
    const n = parseInt(raw)
    if (!isNaN(n)) return n
  }
  return null
}

function normalizeDumpTextAlign(val) {
  const v = String(val).toUpperCase()
  if (v.includes('CENTER')) return 'center'
  if (v.includes('END') || v.includes('RIGHT')) return 'right'
  return 'left'
}

// ─── Button / TextInput 拆分文本子节点 ────────────────────────────────────────

function maybeSplitTextChild(parentUnified, type, props, vpRect, resolution, canvasW, canvasH, path) {
  if (!vpRect || vpRect.w <= 0 || vpRect.h <= 0) return null

  let content = '', textAlign = 'center', fontSize = null

  if (type === 'Button') {
    content   = getProp(props, /^Content:\s*(.+)/) || ''
    const fsFp = getProp(props, /^FontSize:\s*([\d.]+)fp/) || getProp(props, /^fontSize:\s*([\d.]+)fp/)
    fontSize  = fsFp ? parseFloat(fsFp) : null
  } else if (type === 'TextInput') {
    content   = getProp(props, /^Content:\s*(.+)/) || ''
    const fsFp = getProp(props, /^fontSize:\s*([\d.]+)fp/)
    fontSize  = fsFp ? parseFloat(fsFp) : null
    const ta  = getProp(props, /^TextAlign:\s*(\w+)/)
    textAlign = ta ? normalizeDumpTextAlign(ta) : 'left'
  }

  if (!content || !fontSize || fontSize <= 0) return null

  const tw = estimateTextWidth(content, fontSize)
  const th = fontSize
  let tx = vpRect.x
  if (textAlign === 'center') tx = vpRect.x + (vpRect.w - tw) / 2
  else if (textAlign === 'right') tx = vpRect.x + vpRect.w - tw
  const ty = vpRect.y + (vpRect.h - th) / 2

  const childPath = [...path, parentUnified.children.length]
  return {
    id:       `${parentUnified.id}:t`,
    source:   'arkui',
    type:     'text',
    rawType:  'text',
    name:     'Text',
    path:     childPath,
    rect:     { x: r4(tx), y: r4(ty), w: r4(tw), h: r4(th) },
    size:     { x: r4(tx), y: r4(ty), w: r4(tw), h: r4(th) },
    normRect: { x: tx / canvasW, y: ty / canvasH, w: tw / canvasW, h: th / canvasH },
    visible:  true,
    style:    { width: tw, height: th, fontSize },
    textContent: content,
    children: [],
    _frameworkType: false,
    _spanType:      false,
    _blankType:     false,
    _attrs:         {},
    _rectRaw: { x1: tx * resolution, y1: ty * resolution,
                x2: (tx + tw) * resolution, y2: (ty + th) * resolution },
    _splitFromParent: true,
  }
}

/**
 * 估算文本宽度（vp）：按字符类别取系数（与 JSON 路径一致，对标 HarmonyOS Sans）
 *   中文/全角字符 1.0、数字 0.55、半角空格 0.26、小写字母 0.52、大写字母 0.65、
 *   半角窄标点（, . : ; ! ' ·）0.26、其他半角符号（/ ¥ % - 等）0.55
 */
function estimateTextWidth(content, fontSize) {
  let w = 0
  for (const ch of String(content)) {
    w += charWidthFactor(ch) * fontSize
  }
  return w
}

/** 单字符宽度系数（相对 fontSize 的 em 值） */
function charWidthFactor(ch) {
  if (/[一-龥　-〿＀-￯]/.test(ch)) return 1
  if (ch === ' ') return 0.26
  const code = ch.codePointAt(0)
  if (code >= 0x30 && code <= 0x39) return 0.55
  if (code >= 0x61 && code <= 0x7a) return 0.52
  if (code >= 0x41 && code <= 0x5a) return 0.65
  if (",.:;'!·".includes(ch)) return 0.26                // 半角窄标点
  return 0.55                                            // 其他半角符号（/ ¥ % - ( ) 等）
}

// ─── 富文本 Span 拆分（与 JSON 路径的 buildSpanNodes 逻辑一致） ────────────────

// 语法 wrapper：Text 富文本域内允许存在的无视觉语法节点（其子树内的 Span
// 语义上仍属于外层 Text 的富文本，收集时穿透处理）
const SYNTAX_WRAPPER_TYPES = new Set(['IfElse', 'ForEach', 'LazyForEach'])

/**
 * 收集 Text 富文本域内的所有 Span（直接子节点 + 语法 wrapper 子树内的）。
 * @returns {{ spans: Array, skipChildren: Set }} skipChildren = 需从 children 循环
 *   剔除的直接子节点（Span 及"子树全为富文本域"的语法 wrapper）
 */
function collectTextSpans(children) {
  const spans = []
  const skipChildren = new Set()
  for (const child of children) {
    if (SPAN_TYPES.has(child.type)) {
      spans.push(child)
      skipChildren.add(child)
    } else if (SYNTAX_WRAPPER_TYPES.has(child.type)) {
      const inner = collectTextSpans(child.children || [])
      // wrapper 子树全部属于富文本域 → 整体剔除，内部 Span 收入
      if (inner.spans.length > 0 && inner.skipChildren.size === (child.children || []).length) {
        spans.push(...inner.spans)
        skipChildren.add(child)
      }
      // 部分 Span 的 wrapper 不剔除（保守，其内部 Span 走旧路径被 step2 unwrap）
    }
  }
  return { spans, skipChildren }
}

/**
 * Text + 直接 Span 子节点 → N 个独立文本节点（删父留子，step1 内完成）。
 * 排版规则与 JSON 路径一致：父 rect 内单行水平排版，按父 TextAlign 对齐，
 * 溢出时各段等比压缩；纯空格段不生成节点但宽度计入游标。
 *
 * @param {Array} spanChildren 富文本域内的 Span 原始节点列表（已穿透语法 wrapper）
 * @returns {Array|null} 拆分节点数组；无法拆分返回 null（调用方保留父节点兜底）
 */
function buildDumpSpanNodes(parentUnified, parentProps, spanChildren, resolution, canvasW, canvasH, path) {
  const vpRect = parentUnified.rect
  if (!vpRect || vpRect.w <= 0 || vpRect.h <= 0) return null

  // 收集有效 Span 段（无内容或无字号的跳过，宽度按 0 计）
  const segs = []
  let segIdx = 0
  for (const child of spanChildren) {
    const content = getSpanContent(child.props)
    const fsFp = getProp(child.props, /^FontSize:\s*([\d.]+)fp/)
    const fsPx = getProp(child.props, /^FontSize:\s*([\d.]+)px/)
    const fontSize = fsFp ? parseFloat(fsFp) : (fsPx ? parseFloat(fsPx) / resolution : null)
    if (content && fontSize && fontSize > 0) {
      const id = getProp(child.props, /^ID:\s*(\d+)/)
      const seg = {
        id, props: child.props, content, fontSize,
        estW: estimateTextWidth(content, fontSize),
        pathIdx: segIdx++,
        isBlank: content.trim().length === 0,
      }
      seg.styleKey = dumpSpanStyleKey(child.props, fontSize)
      segs.push(seg)
    }
  }
  if (segs.length === 0) return null

  // 整段与父 rect 的宽度关系决定对齐 / 压缩
  const totalEst = segs.reduce((s, g) => s + g.estW, 0)
  let x0, scale
  if (totalEst <= vpRect.w) {
    const ta = getProp(parentProps, /^TextAlign:\s*(\w+)/)
    const align = ta ? normalizeDumpTextAlign(ta) : 'left'
    if (align === 'center') x0 = vpRect.x + (vpRect.w - totalEst) / 2
    else if (align === 'right') x0 = vpRect.x + vpRect.w - totalEst
    else x0 = vpRect.x
    scale = 1
  } else {
    x0 = vpRect.x
    scale = vpRect.w / totalEst
  }

  // 估算排版：每段分配游标区间（空格段不生成节点但占游标）
  let x = x0
  for (const g of segs) {
    const h = Math.min(g.fontSize, vpRect.h)
    g.layoutRect = { x, y: vpRect.y + (vpRect.h - h) / 2, w: g.estW * scale, h }
    x += g.estW * scale
  }

  // 相邻同样式段合并：文字样式（字号/字重/颜色/字体）完全一致且左右相连
  // （中间仅隔纯空格段，空格不参与样式比较、content 原样拼入）的段合为一个节点
  const groups = []
  let cur = null
  for (const g of segs) {
    if (g.isBlank) {
      if (cur) cur.items.push(g)
      continue
    }
    if (cur && cur.styleKey === g.styleKey) {
      cur.items.push(g)
    } else {
      cur = { styleKey: g.styleKey, items: [g] }
      groups.push(cur)
    }
  }

  const nodes = []
  for (const grp of groups) {
    const items = grp.items
    const vis = items.filter(it => !it.isBlank)
    if (vis.length === 0) continue
    const lead = vis[0]
    const last = vis[vis.length - 1]
    // 合并 rect：首段 x 到尾段右缘（中间空格段宽度已含在游标内）
    const rect = {
      x: lead.layoutRect.x,
      y: lead.layoutRect.y,
      w: (last.layoutRect.x + last.layoutRect.w) - lead.layoutRect.x,
      h: lead.layoutRect.h,
    }
    const mergedContent = items.map(it => it.content).join('')
    nodes.push(makeDumpSpanTextNode({ ...lead, content: mergedContent }, rect, parentUnified, resolution, canvasW, canvasH, [...path, lead.pathIdx]))
  }
  if (nodes.length === 0) return null

  // Text 下非 Span 的遗留子孙（理论不应存在，保守按原序追加）
  nodes.push(...parentUnified.children)
  return nodes
}

/** dump Span 段的归一化样式 key：字号 / 字重 / 颜色 / 字体 四项（均归一化后比较） */
function dumpSpanStyleKey(props, fontSize) {
  const fw = parseDumpFontWeight(props)
  // Span 的颜色字段为 TextColor（Text 节点自身用 FontColor），两者兼容
  const fc = getProp(props, /^FontColor:\s*(#[0-9A-Fa-f]{6,8})/)
    || getProp(props, /^TextColor:\s*(#[0-9A-Fa-f]{6,8})/)
  const ff = getProp(props, /^fontFamily:\s*(.+?)(?:\s+prop:.*)?$/)
  return JSON.stringify([fontSize, fw, fc ? normalizeArkuiColor(fc) : null, ff ? ff.trim() : null])
}

/** 由单条 Span 段生成独立 text 节点（字段约定同 maybeSplitTextChild） */
function makeDumpSpanTextNode(seg, rect, parentUnified, resolution, canvasW, canvasH, path) {
  const { props, content, fontSize } = seg

  const style = { width: rect.w, height: rect.h, fontSize }
  const fw = parseDumpFontWeight(props)
  if (fw !== null) style.fontWeight = fw
  // Span 的颜色字段为 TextColor（Text 节点自身用 FontColor），两者兼容
  const fc = getProp(props, /^FontColor:\s*(#[0-9A-Fa-f]{6,8})/)
    || getProp(props, /^TextColor:\s*(#[0-9A-Fa-f]{6,8})/)
  if (fc) style.fontColor = normalizeArkuiColor(fc)
  const ff = getProp(props, /^fontFamily:\s*(.+?)(?:\s+prop:.*)?$/)
  if (ff) style.fontFamily = ff.trim()
  const lsPx = getProp(props, /^LetterSpacing:\s*([\d.]+)px/)
  if (lsPx) {
    const v = parseFloat(lsPx) / resolution
    if (v !== 0) style.letterSpacing = v
  }
  // 继承父 Text 的整体透明度
  if (parentUnified.style && parentUnified.style.opacity !== undefined) {
    style.opacity = parentUnified.style.opacity
  }

  // _attrs：step2 hardPruneReason 仅读 visibility / opacity，自父继承
  const _attrs = {}
  if (parentUnified._attrs && parentUnified._attrs.visibility) {
    _attrs.visibility = parentUnified._attrs.visibility
  }

  return {
    id: String(seg.id != null ? seg.id : `${parentUnified.id}:s${path[path.length - 1]}`),
    source: 'arkui',
    type: 'text',
    rawType: 'text',
    name: 'Text',
    path,
    rect: { x: r4(rect.x), y: r4(rect.y), w: r4(rect.w), h: r4(rect.h) },
    size: { x: r4(rect.x), y: r4(rect.y), w: r4(rect.w), h: r4(rect.h) },
    normRect: { x: rect.x / canvasW, y: rect.y / canvasH, w: rect.w / canvasW, h: rect.h / canvasH },
    visible: true,
    style,
    textContent: content,
    children: [],
    _frameworkType: false,
    _spanType: false,
    _blankType: false,
    _attrs,
    _rectRaw: {
      x1: rect.x * resolution,
      y1: rect.y * resolution,
      x2: (rect.x + rect.w) * resolution,
      y2: (rect.y + rect.h) * resolution,
    },
    _spanSplit: true,
  }
}
