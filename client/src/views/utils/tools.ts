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

// Base64 DataURL → File 对象
export function base64ToFile(base64: string, filename: string): File {
  const [meta, data] = base64.split(',')
  const mime = meta.match(/:(.*?);/)?.[1] ?? 'application/octet-stream'
  const bytes = atob(data)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new File([arr], filename, { type: mime })
}

// JSON 对象 → File 对象
export function jsonToFile(json: unknown, filename: string): File {
  const text = typeof json === 'string' ? json : JSON.stringify(json)
  return new File([text], filename, { type: 'application/json' })
}

// 从算法结果的 diffs 中提取 problems 列表
export function buildProblems(res: any): object[] {
  const problems = (res?.diffs ?? []).map((d: any) => ({
    id:   `${d.arkuiNodeId}-${d.property}`,
    key:  d.nodeType || 'container',
    type: d.property || '',
    desc: d.description || '',
    data: JSON.stringify(d),
  }))

  // 追加全部匹配对 ID，便于历史版本读取时重建完整 pairs
  const pairIds = (res?.pairs ?? [])
    .map((p: any) => [p.arkui?.id, p.design?.id])
    .filter(([a, d]: [string, string]) => a && d)
  if (pairIds.length > 0) {
    problems.push({
      id:   'matchedPairIds',
      key:  'pairIds',
      type: 'obj',
      desc: '',
      data: JSON.stringify(pairIds),
    })
  }

  return problems
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
export function isHiddenFrameworkTextNode(node: any): boolean {
  return !!(node && node.type === 'text' && node.hiddenFrameworkAncestor)
}

// OCR 判定为不可见的文本节点：被遮挡（visualOccluded）或 OCR 标注为不可见
export function isOcrHiddenTextNode(node: any): boolean {
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
export function normalizeLooseText(text: any): string {
  return String(text || '').replace(/\s+/g, '').trim()
}

// 判断 prefix 是否为 path 的严格前缀（prefix 长度必须小于 path）
export function isPathPrefix(prefix: any, path: any): boolean {
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

// 匹配置信度 → Element Plus Tag 的 type 属性（高=绿/中=橙/低=红）
export function confidenceTagType(c: string): string {
  if (c === 'high')   return 'success'
  if (c === 'medium') return 'warning'
  if (c === 'low')    return 'danger'
  return 'info'
}

// matchType 字符串 → 对应的 Pass 阶段标签，用于 Debugger 节点信息条展示
const MATCH_TYPE_PASS: Record<string, string> = {
  'text-content':              'Pass 1',
  'dynamic-text-slot':         'Pass 2',
  'dynamic-number-slot':       'Pass 2',
  'text-row-slot':             'Pass 2',
  'region-text-optimal':       'Pass 3',
  'region-text-global-rescue': 'Pass 3',
  'text-role':                 'Pass 3.5',
  'anchor-topology':           'Pass 4',
  'list-index':                'Pass 4.5',
  'text-position':             'Pass 5',
  'numeric-slot':              'Pass 5b',
  'container-iou':             'Pass 5',
  'container-geometry':        'Pass 6',
  'spatial-bracket':           'Pass 6.5',
  'rescue-iou':                'Pass 7',
}

export function matchTypePass(matchType: string): string | null {
  return MATCH_TYPE_PASS[matchType] ?? null
}
