/**
 * Inspector 自定义对比行的输入校验、值解析工具函数。
 * 每个属性有独立的格式规则；解析结果与节点 style 内部格式保持一致。
 */

export interface ValidateResult {
  ok:     boolean
  error?: string
}

// ── 属性分组 ──────────────────────────────────────────────────────────────────
// 仅保留人工可加属性（TEXT_STYLE_OPTIONS / CONTAINER_STYLE_OPTIONS）中存在的条目，
// 走不到的孤儿条目（lineHeight / itemSpacing / letterSpacing / padding / textAlign）已移除。

const POSITIVE_NUM_PROPS = new Set([
  'fontSize', 'borderWidth',
])

const NON_NEGATIVE_NUM_PROPS = new Set([
  'opacity',
])

// blur：与 server 端格式一致，字符串 "高斯模糊 Xpx" 或 "背景模糊 Xpx"
const BLUR_PROPS = new Set(['blur'])
const BLUR_REGEX = /^(背景模糊|高斯模糊)\s+([\d.]+)\s*px$/

const COLOR_PROPS = new Set([
  'fontColor', 'backgroundColor', 'borderColor',
])

const MULTI_NUM_PROPS = new Set([
  'borderRadius',
])

const FONT_WEIGHT_VALS = new Set([
  '100', '200', '300', '400', '500', '600', '700', '800', '900',
  'normal', 'bold', 'light', 'medium', 'semibold', 'thin', 'bolder',
])

// ── 输入校验 ──────────────────────────────────────────────────────────────────

/**
 * 校验用户在自定义行输入的原始字符串是否符合该属性的格式要求。
 */
export function validateOverrideInput(key: string, raw: string): ValidateResult {
  const s = raw.trim()
  if (!s) return { ok: false, error: '不能为空' }

  // 纯正数
  if (POSITIVE_NUM_PROPS.has(key)) {
    const n = Number(s)
    if (isNaN(n) || !/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: '请输入正数，如 14' }
    if (n <= 0) return { ok: false, error: '必须大于 0' }
    if (key === 'fontSize'    && n > 200) return { ok: false, error: '字号过大' }
    if (key === 'borderWidth' && n > 100) return { ok: false, error: '描边宽度过大' }
    return { ok: true }
  }

  // blur：高斯模糊 Xpx / 背景模糊 Xpx
  if (BLUR_PROPS.has(key)) {
    const m = s.match(BLUR_REGEX)
    if (!m) return { ok: false, error: '格式：高斯模糊 5px 或 背景模糊 10px' }
    const n = parseFloat(m[2])
    if (isNaN(n) || n <= 0) return { ok: false, error: '模糊半径须大于 0' }
    return { ok: true }
  }

  // 0-1 范围（不透明度）
  if (NON_NEGATIVE_NUM_PROPS.has(key)) {
    const n = Number(s)
    if (isNaN(n) || !/^\d*\.?\d+$/.test(s)) return { ok: false, error: '请输入数字' }
    if (key === 'opacity' && (n < 0 || n > 1)) return { ok: false, error: '范围 0-1，如 0.5' }
    if (n < 0) return { ok: false, error: '不能为负数' }
    return { ok: true }
  }

  // 颜色
  if (COLOR_PROPS.has(key)) {
    return validateColor(s)
  }

  // 多段数字：单个数字 or "a/b/c/d"
  if (MULTI_NUM_PROPS.has(key)) {
    return validateMultiNum(key, s)
  }

  // 字重枚举
  if (key === 'fontWeight') {
    if (!FONT_WEIGHT_VALS.has(s.toLowerCase())) {
      return { ok: false, error: '如 400、bold、medium' }
    }
    return { ok: true }
  }

  // shadow：自由字符串，非空即可
  if (key === 'shadow') return { ok: true }

  // fontFamily：自由字符串，非空即可
  if (key === 'fontFamily') return { ok: true }

  return { ok: true }
}

function validateColor(s: string): ValidateResult {
  // hex：6 位或 8 位（带或不带 #）
  const hex = s.startsWith('#') ? s.slice(1) : s
  if (/^[0-9a-fA-F]{6}$/.test(hex) || /^[0-9a-fA-F]{8}$/.test(hex)) {
    return { ok: true }
  }
  // rgb / rgba
  const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)
  if (m) {
    const r = parseFloat(m[1]), g = parseFloat(m[2]), b = parseFloat(m[3])
    if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
      return { ok: false, error: 'RGB 各值须在 0-255 范围内' }
    }
    if (m[4] != null) {
      const a = parseFloat(m[4])
      if (a < 0 || a > 1) return { ok: false, error: 'Alpha 须在 0-1 范围内' }
    }
    return { ok: true }
  }
  return { ok: false, error: '请输入 hex 或 rgb，如 #FF0000 或 rgb(255,0,0)' }
}

/** 将 hex 或 rgb/rgba 字符串统一规范化为大写 hex（#RRGGBB 或 #RRGGBBAA） */
function normalizeColor(s: string): string {
  const str = s.trim()
  // hex → 大写
  const hex = str.startsWith('#') ? str.slice(1) : str
  if (/^[0-9a-fA-F]{6}$/.test(hex) || /^[0-9a-fA-F]{8}$/.test(hex)) {
    return `#${hex.toUpperCase()}`
  }
  // rgb / rgba → hex
  const m = str.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)
  if (m) {
    const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0').toUpperCase()
    const hex6 = toHex(parseFloat(m[1])) + toHex(parseFloat(m[2])) + toHex(parseFloat(m[3]))
    if (m[4] != null) {
      const a = parseFloat(m[4])
      return `#${hex6}${toHex(a * 255)}`
    }
    return `#${hex6}`
  }
  return str
}

function validateMultiNum(key: string, s: string): ValidateResult {
  const label = '圆角'
  const hint  = '如 8 或 8/4/8/4（左上/右上/右下/左下）'

  const parts = s.split('/')
  if (parts.length !== 1 && parts.length !== 4) {
    return { ok: false, error: `${label}格式有误，${hint}` }
  }
  for (const p of parts) {
    const n = Number(p.trim())
    if (isNaN(n) || n < 0) return { ok: false, error: `${label}各值须为非负数，${hint}` }
  }
  return { ok: true }
}

// ── 值解析（字符串 → style 内部格式）────────────────────────────────────────

/**
 * 将用户输入的原始字符串解析为节点 style 中对应字段的内部格式。
 * 调用前应已通过 validateOverrideInput 校验。
 */
export function parseOverrideValue(key: string, raw: string): any {
  const s = raw.trim()

  if (POSITIVE_NUM_PROPS.has(key) || NON_NEGATIVE_NUM_PROPS.has(key)) {
    return parseFloat(s)
  }

  // blur：规范为 "类型 Xpx" 字符串，与 server 端 style.blur 格式一致
  if (BLUR_PROPS.has(key)) {
    const m = s.match(BLUR_REGEX)
    if (!m) return s
    return `${m[1]} ${m[2]}px`
  }

  if (COLOR_PROPS.has(key)) {
    return normalizeColor(s)
  }

  if (key === 'borderRadius') {
    return parseMultiNum(s, ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'])
  }

  if (key === 'fontWeight') {
    const lower = s.toLowerCase()
    // 若是纯数字字符串，保持数字类型；否则保持字符串
    const n = Number(s)
    return isNaN(n) ? lower : n
  }

  // shadow / fontFamily 等自由字符串
  return s
}

function parseMultiNum(s: string, keys: string[]): Record<string, number> {
  const parts = s.split('/').map(p => parseFloat(p.trim()))
  const result: Record<string, number> = {}
  if (parts.length === 1) {
    for (const k of keys) result[k] = parts[0]
  } else {
    keys.forEach((k, i) => { result[k] = parts[i] ?? 0 })
  }
  return result
}

// ── 显示规范化 ────────────────────────────────────────────────────────────────

/**
 * 将用户输入的原始字符串规范化为 Inspector 中显示的字符串。
 * 颜色类统一显示为大写 hex（rgb/rgba 也会转换）；其他属性原样返回。
 * 用于 confirmExtra 写入 savedRows 的 rawValue，保证"显示值"与"对比值"一致。
 */
export function normalizeOverrideDisplay(key: string, raw: string): string {
  const s = raw.trim()
  if (COLOR_PROPS.has(key)) {
    return normalizeColor(s)
  }
  return s
}

// ── 输入提示 ──────────────────────────────────────────────────────────────────

/**
 * 返回各属性对应的输入框 placeholder，帮助用户理解格式要求。
 */
export function getInputPlaceholder(key: string): string {
  if (key === 'blur')       return '高斯模糊 5px 或 背景模糊 10px'
  if (COLOR_PROPS.has(key)) return '#FF0000 或 rgb(255,0,0)'
  if (POSITIVE_NUM_PROPS.has(key)) {
    if (key === 'fontSize')    return '14'
    if (key === 'borderWidth') return '1'
    return '正数'
  }
  if (NON_NEGATIVE_NUM_PROPS.has(key)) return '0-1，如 0.5'
  if (MULTI_NUM_PROPS.has(key))        return '8 或 8/4/8/4'
  if (key === 'fontWeight')   return '400、bold、medium'
  if (key === 'shadow')       return '自由输入'
  if (key === 'fontFamily')   return '字体名称'
  return '请输入内容'
}
