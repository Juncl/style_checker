/** 前端节点样式对比（用于 debugger 模式手动选节点后的即时对比） */

export interface SimpleNode {
  id: string
  type: 'text' | 'container'
  rawType?: string
  textContent?: string
  name?: string
  style?: Record<string, any>
  rect?: { w: number; h: number }
  size?: { w: number; h: number }
}

export interface NodeDiff {
  property: string
  label: string
  designValue: string
  devValue: string
}

// ── 容差 ──────────────────────────────────────────────────────────────────────

const TOLERANCE = {
  fontSize:      0,
  lineHeight:    0.5,
  letterSpacing: 0.5,
  borderRadius:  0,
  padding:       1.0,
  opacity:       0.02,
  colorDelta:    0,
}

// ── 颜色工具 ──────────────────────────────────────────────────────────────────

interface RGBA { a: number; r: number; g: number; b: number }

function parseColor(color: string): RGBA | null {
  if (!color || typeof color !== 'string') return null
  const h = color.replace('#', '').trim()
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) return null
  if (h.length === 8) {
    return {
      a: parseInt(h.slice(0, 2), 16),
      r: parseInt(h.slice(2, 4), 16),
      g: parseInt(h.slice(4, 6), 16),
      b: parseInt(h.slice(6, 8), 16),
    }
  }
  return {
    a: 255,
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function colorDelta(c1: string, c2: string): number {
  const a = parseColor(c1)
  const b = parseColor(c2)
  if (!a || !b) return 0
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

function isTransparent(color: string): boolean {
  const c = parseColor(color)
  return !!c && c.a === 0
}

// ── 辅助工厂 ──────────────────────────────────────────────────────────────────

function d(property: string, label: string, designValue: string, devValue: string): NodeDiff {
  return { property, label, designValue, devValue }
}

// ── 各属性对比 ────────────────────────────────────────────────────────────────

function diffNumber(
  out: NodeDiff[],
  prop: string,
  label: string,
  dv: number | undefined,
  av: number | undefined,
  tol: number,
) {
  if (dv == null || av == null) return
  if (Math.abs(dv - av) > tol) out.push(d(prop, label, String(dv), String(av)))
}

function diffColor(
  out: NodeDiff[],
  prop: string,
  label: string,
  dv: string | undefined,
  av: string | undefined,
) {
  if (!dv && !av) return
  if ((!dv || isTransparent(dv)) && (!av || isTransparent(av))) return
  if (!dv || !av) { out.push(d(prop, label, dv ?? '—', av ?? '—')); return }
  if (isTransparent(dv) || isTransparent(av)) return
  if (colorDelta(dv, av) > TOLERANCE.colorDelta) out.push(d(prop, label, dv, av))
}

function diffFontWeight(out: NodeDiff[], dv: any, av: any) {
  if (dv == null || av == null) return
  if (String(dv) !== String(av)) out.push(d('fontWeight', '字重', String(dv), String(av)))
}

function diffOpacity(out: NodeDiff[], dv: any, av: any) {
  const dn = (dv == null || dv === '') ? null : Number(dv)
  const an = (av == null || av === '') ? null : Number(av)
  if (dn === null || an === null || dn === 0 || an === 0) return
  if (Math.abs(dn - an) > TOLERANCE.opacity) out.push(d('opacity', '不透明度', String(dn), String(an)))
}

function formatRadius(r: any): string {
  if (!r) return '0'
  const { topLeft: tl = 0, topRight: tr = 0, bottomRight: br = 0, bottomLeft: bl = 0 } = r
  return tl === tr && tr === br && br === bl ? String(tl) : `${tl}/${tr}/${br}/${bl}`
}

function diffBorderRadius(
  out: NodeDiff[],
  designNode: SimpleNode,
  devNode: SimpleNode,
  dv: any,
  av: any,
) {
  if (!dv && !av) return
  const rawDev = String(devNode.rawType || '').toLowerCase()
  if (rawDev === 'circle') return
  if (rawDev === 'image' && !av) return
  if (!dv || !av) { out.push(d('borderRadius', '圆角', formatRadius(dv), formatRadius(av))); return }
  const cap = (rect: any) => rect ? Math.min(rect.w, rect.h) / 2 : Infinity
  const capD = cap(designNode.size ?? designNode.rect)
  const capA = cap(devNode.rect)
  const keys = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const
  const mismatch = keys.filter(k =>
    Math.abs(Math.min(dv[k] || 0, capD) - Math.min(av[k] || 0, capA)) > TOLERANCE.borderRadius
  )
  if (mismatch.length > 0) out.push(d('borderRadius', '圆角', formatRadius(dv), formatRadius(av)))
}

function formatPadding(p: any): string {
  if (!p) return '0'
  return `T:${p.top} R:${p.right} B:${p.bottom} L:${p.left}`
}

function diffPadding(out: NodeDiff[], dv: any, av: any) {
  if (!dv || !av) return
  const keys = ['top', 'right', 'bottom', 'left'] as const
  const mismatch = keys.filter(k => Math.abs((dv[k] || 0) - (av[k] || 0)) > TOLERANCE.padding)
  if (mismatch.length > 0) out.push(d('padding', '内边距', formatPadding(dv), formatPadding(av)))
}

function diffBorder(out: NodeDiff[], dv: any, av: any) {
  if (!dv && !av) return
  const dw = dv?.width, aw = av?.width
  if (dw != null || aw != null) {
    if (dw == null || aw == null) {
      out.push(d('borderWidth', '描边宽度', dw != null ? String(dw) : '—', aw != null ? String(aw) : '—'))
    } else if (Math.abs(dw - aw) > 0) {
      out.push(d('borderWidth', '描边宽度', String(dw), String(aw)))
    }
  }
  if (dv?.color != null) diffColor(out, 'borderColor', '描边颜色', dv?.color, av?.color)
}

function diffBlur(out: NodeDiff[], dv: any, av: any) {
  if (!dv && !av) return
  if (dv && !av) { out.push(d('blur', '模糊', String(dv), '—')); return }
  if (dv && String(dv) !== String(av)) out.push(d('blur', '模糊', String(dv), String(av)))
}

function diffShadow(out: NodeDiff[], dv: any, av: any) {
  if (!dv && !av) return
  if (dv && !av) { out.push(d('shadow', '阴影', String(dv), '—')); return }
  if (dv && String(dv) !== String(av)) out.push(d('shadow', '阴影', String(dv), String(av)))
}

// ── 主函数 ────────────────────────────────────────────────────────────────────

/**
 * 比对设计稿节点与开发侧节点的样式差异
 * @param designNode  设计侧节点
 * @param devNode     开发侧节点
 */
export function compareNodeStyles(designNode: SimpleNode, devNode: SimpleNode): NodeDiff[] {
  const out: NodeDiff[] = []
  const ds = designNode.style || {}
  const as_ = devNode.style || {}
  const isText = designNode.type === 'text' && devNode.type === 'text'

  if (isText) {
    diffNumber(out, 'fontSize',      '字号',   ds.fontSize,      as_.fontSize,      TOLERANCE.fontSize)
    diffFontWeight(out,               ds.fontWeight,  as_.fontWeight)
    diffColor(out,  'fontColor',     '字色',   ds.fontColor,     as_.fontColor)
    diffNumber(out, 'lineHeight',    '行高',   ds.lineHeight,    as_.lineHeight,    TOLERANCE.lineHeight)
    diffNumber(out, 'letterSpacing', '字间距', ds.letterSpacing, as_.letterSpacing, TOLERANCE.letterSpacing)
    diffOpacity(out, ds.opacity, as_.opacity)
    diffBlur(out,   ds.blur,   as_.blur)
    diffShadow(out, ds.shadow, as_.shadow)
  } else {
    diffColor(out,        'backgroundColor', '填充色', ds.backgroundColor, as_.backgroundColor)
    diffBorderRadius(out, designNode, devNode, ds.borderRadius, as_.borderRadius)
    diffBorder(out,       ds.border,  as_.border)
    diffPadding(out,      ds.padding, as_.padding)
    diffOpacity(out,      ds.opacity, as_.opacity)
    diffBlur(out,         ds.blur,    as_.blur)
    diffShadow(out,       ds.shadow,  as_.shadow)
  }

  return out
}
