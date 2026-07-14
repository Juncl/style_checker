import { ref } from 'vue'

// 生成时间字符串，格式：2026年6月3号 12:00:00
export function formatDateTime(date: Date): string {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate()
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${y}年${m}月${d}号 ${hh}:${mm}:${ss}`
}

// File 对象 → Base64 DataURL 字符串
export function fileToBase64(file: File | null | undefined): Promise<string> {
  return new Promise((resolve) => {
    if (!file) return resolve('')
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = () => resolve('')
    reader.readAsDataURL(file)
  })
}

// File 对象 → 文本字符串
export function fileToText(file: File | null | undefined): Promise<string> {
  return new Promise((resolve) => {
    if (!file) return resolve('')
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = () => resolve('')
    reader.readAsText(file)
  })
}

// 字节转可读大小（KB/MB）
export function formatFileSize(bytes: number): string {
  const kb = bytes / 1024
  if (kb >= 1024) return (kb / 1024).toFixed(3) + 'MB'
  return kb.toFixed(3) + 'KB'
}

// Base64 DataURL → File 对象
export function base64ToFile(base64: string, filename: string): File {
  const [meta, data] = base64.split(',')
  const mime = meta.match(/:(.*?);/)?.[1] ?? 'application/octet-stream'
  const bytes = atob(data)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new File([arr], filename, { type: mime })
}

// 将图片数据（base64 DataURL 或 URL）转为 File 对象
// 旧数据兼容：历史版本的图片字段可能是 base64 字符串或图片 URL
export async function resolveImageFile(
  imageData: string | null | undefined,
  filename: string,
  baseUrl?: string,
): Promise<File | null> {
  if (!imageData) return null
  // base64 DataURL：data:image/png;base64,...
  if (imageData.startsWith('data:')) return base64ToFile(imageData, filename)
  // 普通 URL：fetch 后转为 File
  const url = imageData.startsWith('//') && baseUrl ? `${baseUrl}${imageData}` : imageData
  const res = await fetch(url)
  if (!res.ok) throw new Error(`resolveImageFile fetch failed: ${res.status} ${url}`)
  const blob = await res.blob()
  return new File([blob], filename, { type: blob.type || 'image/png' })
}

// JSON 对象 → File 对象
export function jsonToFile(json: unknown, filename: string): File {
  const text = typeof json === 'string' ? json : JSON.stringify(json)
  return new File([text], filename, { type: 'application/json' })
}

// 从算法结果中提取 problems 列表，同时返回 nodeMatchs
// opts.diffs 传入时优先使用（如合并后的 mergedDiffs），否则取 res.diffs
// opts.nodeManualAttr 传入时合并到 nodeMatchs 中
export function buildProblems(
  res: any,
  opts?: { diffs?: any[]; nodeManualAttr?: Record<string, any> },
): { problems: object[]; nodeMatchs: string } {
  const diffs = opts?.diffs ?? res?.diffs ?? []
  const problems = diffs.map((d: any) => ({
    id:   `${d.arkuiNodeId}-${d.property}`,
    key:  d.nodeType || 'container',
    type: d.property || '',
    desc: d.description || '',
    data: JSON.stringify(d),
  }))

  const pairIds = (res?.pairs ?? [])
    .map((p: any) => [p.arkui?.id, p.design?.id])
    .filter(([a, d]: [string, string]) => a && d)
  const nodeMatchsObj: any = { matchedPairIds: pairIds }
  if (opts?.nodeManualAttr) {
    nodeMatchsObj.nodeManualAttr = opts.nodeManualAttr
  }
  const nodeMatchs = JSON.stringify(nodeMatchsObj)

  return { problems, nodeMatchs }
}

// 旧格式 problems（内网后台存量数据）兼容转换
// 识别依据：JSON.parse(p.data) 含 hmNodeStyle 字段
export function adaptLegacyProblem(p: any): any {
  let raw: any
  try { raw = JSON.parse(p.data) } catch { return p }
  if (!raw?.hmNodeStyle) return p

  const hm = raw.hmNodeStyle
  const de = raw.deNodeStyle
  const isNotProblem = p.isNotProblem === 1
  const outerType: string = p.type

  let newDiff: any

  if (outerType === 'space') {
    const hmSpace = hm.space
    const deSpace = de.space
    const isX = (p.id as string).endsWith('-x')
    newDiff = {
      property:            isX ? 'spacing.left' : 'spacing.top',
      severity:            'warning',
      confidence:          'low',
      description:         '',
      designValue:         String(deSpace.distance),
      arkuiValue:          String(hmSpace.distance),
      spaceId:             hmSpace.spaceId,
      designSpaceId:       deSpace.spaceId,
      designNodeId:        String(hmSpace.mapNodeId),
      arkuiNodeId:         String(hmSpace.nodeId),
      relatedArkuiNodeId:  String(hmSpace.nodeLeftId  ?? hmSpace.nodeTopId  ?? ''),
      relatedDesignNodeId: String(hmSpace.mapLeftNodeId ?? hmSpace.mapTopNodeId ?? ''),
      relationKind:        hmSpace.rel === 'c' ? 'parent-child' : 'sibling',
      relationAxis:        isX ? 'horizontal' : 'vertical',
    }
  } else {
    const finalScore = hm.finalScore ?? 0
    const confidence = finalScore >= 0.8 ? 'high' : finalScore >= 0.6 ? 'medium' : 'low'
    newDiff = {
      property:      outerType,
      designValue:   de[outerType] ?? null,
      arkuiValue:    hm[outerType] ?? null,
      severity:      confidence === 'low' ? 'warning' : 'error',
      description:   '',
      nodeType:      p.key === 'text' ? 'text' : 'container',
      textContent:   hm.content ?? null,
      designName:    null,
      arkuiName:     null,
      matchType:     hm.matchSource ?? null,
      confidence,
      iou:           null,
      topologyScore: null,
      regionScore:   null,
      designNodeId:  String(de.id),
      arkuiNodeId:   String(hm.id),
      designRect:    null,
      arkuiRect:     null,
    }
  }

  if (isNotProblem) newDiff._isNotProblem = true

  return { ...p, data: JSON.stringify(newDiff) }
}

// ── 节点过滤工具 ──────────────────────────────────────────────────────────────

// ArkUI Blank 组件在解析后 type/name 均为 "blank"，视为不可见占位节点，不参与画布交互
export function isBlankLikeNode(node: any): boolean {
  return String(node?.type || node?.name || '').trim().toLowerCase() === 'blank'
}

// 被隐藏的框架文本节点：type=text 且祖先为不可见的框架容器（hiddenFrameworkAncestor 由解析阶段标注）
function isHiddenFrameworkTextNode(node: any): boolean {
  return !!(node && node.type === 'text' && node.hiddenFrameworkAncestor)
}

// OCR 判定为不可见的文本节点：被遮挡（visualOccluded）或 OCR 标注为不可见
function isOcrHiddenTextNode(node: any): boolean {
  return !!(node &&
    node.type === 'text' &&
    (node.visualOccluded || node.ocrVisibility?.visible === false))
}

// 判断节点是否可在画布上交互（可点击/高亮）：排除 Blank、不可见、被遮挡、极小节点
export function isInteractiveImageNode(node: any): boolean {
  return !!(node &&
    !isBlankLikeNode(node) &&
    node.visible !== false &&
    !isHiddenFrameworkTextNode(node) &&
    !isOcrHiddenTextNode(node) &&
    !node.visualOccluded &&
    node.rect &&
    node.rect.w > 4 &&
    node.rect.h > 4)
}

// 判断节点是否可被用户点击选中（用于节点点击事件的门控检查）
export function isSelectableNode(node: any): boolean {
  return !!(node &&
    node.visible !== false &&
    !isHiddenFrameworkTextNode(node) &&
    !isOcrHiddenTextNode(node) &&
    !node.visualOccluded &&
    node.rect?.w > 4 &&
    node.rect?.h > 4)
}

// 去除所有空白字符后的文本，用于宽松文本相等判断（忽略空格、换行差异）
function normalizeLooseText(text: any): string {
  return String(text || '').replace(/\s+/g, '').trim()
}

// 判断 prefix 是否为 path 的严格前缀（prefix 长度必须小于 path）
function isPathPrefix(prefix: any, path: any): boolean {
  if (!Array.isArray(prefix) || !Array.isArray(path)) return false
  if (prefix.length >= path.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== path[i]) return false
  }
  return true
}

// 从节点列表中解析出 nodeId 对应的可选中节点。
// 若目标是含 textContent 的容器节点，会优先返回其子树中文本内容匹配、路径最深且面积最小的文本后代，
// 以保证点击容器时选中的是最具代表性的叶子文本节点。
export function resolveSelectableNode(nodes: any[], nodeId: string): any {
  const node = nodes.find((n: any) => n.id === nodeId)
  if (!node) return null
  if (isHiddenFrameworkTextNode(node) || isOcrHiddenTextNode(node)) return null
  if (node.type === 'text' || !node.textContent) return node

  const targetText = normalizeLooseText(node.textContent)
  if (!targetText) return node

  const descendants = nodes.filter((n: any) =>
    n.type === 'text' &&
    normalizeLooseText(n.textContent) === targetText &&
    isPathPrefix(node.path, n.path) &&
    n.visible !== false &&
    !n.visualOccluded &&
    !isHiddenFrameworkTextNode(n) &&
    !isOcrHiddenTextNode(n)
  )

  if (!descendants.length) return node
  return descendants.sort((a: any, b: any) => {
    const da = (a.path?.length ?? 0) - (node.path?.length ?? 0)
    const db = (b.path?.length ?? 0) - (node.path?.length ?? 0)
    if (da !== db) return db - da
    return (a.rect.w * a.rect.h) - (b.rect.w * b.rect.h)
  })[0]
}

// 从 localStorage 的 userInfo JSON 中解析 account 字段，解析失败返回 ''
export function getUserAccount(): string {
  try {
    const raw = JSON.parse(localStorage.getItem('userInfo') || '{}')
    if (raw && typeof raw === 'object' && raw.account) return raw.account
  } catch {}
  return ''
}

// 判断页面是否在 iframe 中运行
export function inIframe(): boolean {
  return window.self !== window.top
}

// ── 报告/调试工具 ─────────────────────────────────────────────────────────────

// Debugger 映射列表中，不同验证状态对应的行背景色
// wrong=红（匹配错误）/ extra=黄（多余匹配）/ missing=灰（漏匹配）
export function validationBg(status: string | null): string {
  if (status === 'wrong')   return 'rgba(239, 68, 68, 0.18)'
  if (status === 'extra')   return 'rgba(234, 179, 8, 0.18)'
  if (status === 'missing') return 'rgba(150, 150, 150, 0.18)'
  return 'transparent'
}

// 匹配置信度 → 中文标签文本（用于 Debugger 悬浮框）
export function confidenceText(c: string): string {
  if (c === 'high')   return '高置信'
  if (c === 'medium') return '中置信'
  if (c === 'low')    return '低置信'
  return c
}

// ── 颜色格式转换 ──────────────────────────────────────────────────────────────

/**
 * 将字符串中所有 #AARRGGBB（ARGB）格式的 8 位 hex 转为 #RRGGBBAA（RGBA）。
 * 适用于 web 平台的颜色值展示（纯色、渐变色、阴影字符串均支持）。
 * 非 web 平台直接返回原字符串。
 *
 * @param text     待转换的颜色字符串
 * @param platform 当前平台（'web' 时才转换）
 */
export function toWebColorDisplay(text: string, platform: string): string {
  if (platform !== 'web') return text
  return text.replace(/#([0-9A-Fa-f]{8})\b/g, (_, h) => `#${h.slice(2)}${h.slice(0, 2)}`)
}

// 匹配置信度 → Element Plus Tag 的 type 属性（高=绿/中=黄/低=灰）
export function confidenceTagType(c: string): string {
  if (c === 'high')   return 'success'
  if (c === 'medium') return 'warning'
  if (c === 'low')    return 'info'
  return 'info'
}

/** 防抖异步调用：返回 loading ref 和 run 包装函数，loading 期间自动阻止重复调用 */
export function useDebounceLoading() {
  const loading = ref(false)
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (loading.value) return
    loading.value = true
    try { return await fn() }
    finally { loading.value = false }
  }
  return { loading, run }
}

// 作用：计算两个矩形之间的间距/内边距标注（用于画布悬停时展示尺寸）
// 输入：rectA/rectB 为画布渲染坐标（缩放后，定位标注）；sizeA/sizeB 为展示数值坐标（原始 dp/vp，缺省回退用 rect）
// 输出：标注对象数组（含 type/axis/spaceRect/可选 capFirst/capSecond/value）；无有效间距时返回空数组
export function computeSpacingMarks(rectA: any, rectB: any, sizeA: any, sizeB: any): any[] {
  if (!rectA || !rectB) return []
  const a = rectA, b = rectB
  const sa = sizeA || rectA, sb = sizeB || rectB

  const aContainsB = a.x <= b.x && a.y <= b.y && (a.x + a.w) >= (b.x + b.w) && (a.y + a.h) >= (b.y + b.h)
  const bContainsA = b.x <= a.x && b.y <= a.y && (b.x + b.w) >= (a.x + a.w) && (b.y + b.h) >= (a.y + a.h)
  const overlapsH  = a.x < b.x + b.w && b.x < a.x + a.w
  const overlapsV  = a.y < b.y + b.h && b.y < a.y + a.h

  if (overlapsH && overlapsV && !aContainsB && !bContainsA) return []

  const marks = []

  if (aContainsB || bContainsA) {
    const p  = aContainsB ? a : b,  sp = aContainsB ? sa : sb
    const c  = aContainsB ? b : a,  sc = aContainsB ? sb : sa
    const top    = c.y - p.y,         sTop    = sc.y - sp.y
    const bottom = (p.y + p.h) - (c.y + c.h), sBottom = (sp.y + sp.h) - (sc.y + sc.h)
    const left   = c.x - p.x,         sLeft   = sc.x - sp.x
    const right  = (p.x + p.w) - (c.x + c.w), sRight  = (sp.x + sp.w) - (sc.x + sc.w)
    if (top    > 0) marks.push({ type: 'spacing', axis: 'vertical',   spaceRect: { x: c.x, y: p.y,        w: c.w, h: top    }, value: String(Math.round(sTop))    })
    if (bottom > 0) marks.push({ type: 'spacing', axis: 'vertical',   spaceRect: { x: c.x, y: c.y + c.h, w: c.w, h: bottom }, value: String(Math.round(sBottom)) })
    if (left   > 0) marks.push({ type: 'spacing', axis: 'horizontal', spaceRect: { x: p.x, y: c.y,        w: left,  h: c.h  }, value: String(Math.round(sLeft))   })
    if (right  > 0) marks.push({ type: 'spacing', axis: 'horizontal', spaceRect: { x: c.x + c.w, y: c.y, w: right, h: c.h  }, value: String(Math.round(sRight))  })
  } else {
    if (!overlapsH) {
      const lR = a.x + a.w <= b.x ? a : b, slR = lR === a ? sa : sb
      const rR = lR === a ? b : a,           srR = lR === a ? sb : sa
      const yTop = Math.max(lR.y, rR.y), yBot = Math.min(lR.y + lR.h, rR.y + rR.h)
      const y = yTop < yBot ? yTop : Math.min(lR.y, rR.y)
      const h = yTop < yBot ? (yBot - yTop) : Math.max(lR.h, rR.h)
      const yMid = y + h / 2
      const sGap = srR.x - (slR.x + slR.w)
      marks.push({
        type: 'spacing', axis: 'horizontal',
        spaceRect: { x: lR.x + lR.w, y, w: rR.x - (lR.x + lR.w), h },
        capFirst:  { start: Math.min(lR.y, yMid), end: Math.max(lR.y + lR.h, yMid) },
        capSecond: { start: Math.min(rR.y, yMid), end: Math.max(rR.y + rR.h, yMid) },
        value: String(Math.round(sGap)),
      })
    }
    if (!overlapsV) {
      const tR = a.y + a.h <= b.y ? a : b, stR = tR === a ? sa : sb
      const bR = tR === a ? b : a,           sbR = tR === a ? sb : sa
      const xLeft = Math.max(tR.x, bR.x), xRight = Math.min(tR.x + tR.w, bR.x + bR.w)
      const x = xLeft < xRight ? xLeft : Math.min(tR.x, bR.x)
      const w = xLeft < xRight ? (xRight - xLeft) : Math.max(tR.w, bR.w)
      const xMid = x + w / 2
      const sGap = sbR.y - (stR.y + stR.h)
      marks.push({
        type: 'spacing', axis: 'vertical',
        spaceRect: { x, y: tR.y + tR.h, w, h: bR.y - (tR.y + tR.h) },
        capFirst:  { start: Math.min(tR.x, xMid), end: Math.max(tR.x + tR.w, xMid) },
        capSecond: { start: Math.min(bR.x, xMid), end: Math.max(bR.x + bR.w, xMid) },
        value: String(Math.round(sGap)),
      })
    }
  }
  return marks
}
