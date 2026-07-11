/**
 * Inspector 自定义对比行的输入校验、值解析、节点 style patch 工具函数。
 * 每个属性有独立的格式规则；解析结果与节点 style 内部格式保持一致。
 */

import type { SimpleNode } from './compareNodes'

export interface ValidateResult {
  ok:     boolean
  error?: string
}

// ── 属性分组 ──────────────────────────────────────────────────────────────────

const POSITIVE_NUM_PROPS = new Set([
  'fontSize', 'lineHeight', 'borderWidth', 'itemSpacing', 'blur',
])

const NON_NEGATIVE_NUM_PROPS = new Set([
  'opacity',
])

const ANY_NUM_PROPS = new Set([
  'letterSpacing',
])

const COLOR_PROPS = new Set([
  'fontColor', 'backgroundColor', 'borderColor',
])

const MULTI_NUM_PROPS = new Set([
  'borderRadius', 'padding',
])

const FONT_WEIGHT_VALS = new Set([
  '100', '200', '300', '400', '500', '600', '700', '800', '900',
  'normal', 'bold', 'light', 'medium', 'semibold', 'thin', 'bolder',
])

const TEXT_ALIGN_VALS = new Set(['left', 'center', 'right', 'justify'])

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

  // 0-1 范围（不透明度）
  if (NON_NEGATIVE_NUM_PROPS.has(key)) {
    const n = Number(s)
    if (isNaN(n) || !/^\d*\.?\d+$/.test(s)) return { ok: false, error: '请输入数字' }
    if (key === 'opacity' && (n < 0 || n > 1)) return { ok: false, error: '范围 0-1，如 0.5' }
    if (n < 0) return { ok: false, error: '不能为负数' }
    return { ok: true }
  }

  // 任意数字（可负，如字间距）
  if (ANY_NUM_PROPS.has(key)) {
    if (isNaN(Number(s))) return { ok: false, error: '请输入数字，如 -0.5 或 1' }
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

  // 对齐枚举
  if (key === 'textAlign') {
    if (!TEXT_ALIGN_VALS.has(s.toLowerCase())) {
      return { ok: false, error: '可选 left / center / right / justify' }
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
  // 接受 6 位或 8 位 hex（带或不带 #）
  const hex = s.startsWith('#') ? s.slice(1) : s
  if (/^[0-9a-fA-F]{6}$/.test(hex) || /^[0-9a-fA-F]{8}$/.test(hex)) {
    return { ok: true }
  }
  return { ok: false, error: '请输入 hex 颜色，如 #FF0000 或 #FFFF0000' }
}

function validateMultiNum(key: string, s: string): ValidateResult {
  const label = key === 'borderRadius' ? '圆角' : '内边距'
  const hint  = key === 'borderRadius'
    ? '如 8 或 8/4/8/4（左上/右上/右下/左下）'
    : '如 16 或 8/16/8/16（上/右/下/左）'

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

  if (POSITIVE_NUM_PROPS.has(key) || ANY_NUM_PROPS.has(key) || NON_NEGATIVE_NUM_PROPS.has(key)) {
    return parseFloat(s)
  }

  if (COLOR_PROPS.has(key)) {
    return s.startsWith('#') ? s : `#${s}`
  }

  if (key === 'borderRadius') {
    return parseMultiNum(s, ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'])
  }

  if (key === 'padding') {
    return parseMultiNum(s, ['top', 'right', 'bottom', 'left'])
  }

  if (key === 'fontWeight') {
    const lower = s.toLowerCase()
    // 若是纯数字字符串，保持数字类型；否则保持字符串
    const n = Number(s)
    return isNaN(n) ? lower : n
  }

  if (key === 'textAlign') {
    return s.toLowerCase()
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

// ── 节点 style 读取 ───────────────────────────────────────────────────────────

/**
 * 取节点某属性的当前值（处理 borderWidth / borderColor 的嵌套 border 对象）。
 */
export function getNodeStyleRawValue(node: SimpleNode, key: string): any {
  const s = node.style ?? {}
  if (key === 'borderWidth') return s.border?.width
  if (key === 'borderColor') return s.border?.color
  return s[key]
}
