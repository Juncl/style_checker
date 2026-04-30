import { normalizeFontWeight } from './textSemantics.js'

export function textAttributeFingerprint(node) {
  const s = node?.style || {}
  return [
    node?.type || '',
    bucket(s.fontSize ?? s.actualFontSize, 1),
    bucket(normalizeFontWeight(s.fontWeight), 100),
    normalizeColor(s.fontColor),
    String(s.textAlign || '').toLowerCase(),
    bucket(s.letterSpacing, 0.25),
  ].join('|')
}

export function hasSameTextAttributeFingerprint(a, b) {
  if (!a || !b) return false
  return textAttributeFingerprint(a) === textAttributeFingerprint(b)
}

function bucket(value, step) {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n) || !step) return String(value)
  return String(Math.round(n / step) * step)
}

function normalizeColor(value) {
  return String(value || '').trim().toLowerCase()
}
