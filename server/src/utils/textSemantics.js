import { xDistance, yDistance, centerY } from './matchGeometry.js'

// 集合 Jaccard 相似度，被 textSemantics 内部和 matchers/regionContext 使用
export function setJaccard(a, b) {
  if (!a?.size && !b?.size) return 0
  let inter = 0
  for (const item of a) if (b.has(item)) inter += 1
  return inter / (a.size + b.size - inter || 1)
}

// Text gates protect the matcher from pairing unrelated labels that merely share a slot.
export function normalizeText(text) {
  const raw = String(text || '').trim().toLowerCase()
  if (!raw) return ''
  // CJK / numeric labels often differ only by formatting spaces, so treat them as the same token stream.
  if (hasCjk(raw) || /[\d°%/]/.test(raw)) return raw.replace(/\s+/g, '')
  return raw.replace(/\s+/g, ' ')
}

export function textStyleSimilarity(dn, an) {
  const ds = dn.style || {}
  const as = an.style || {}
  let score = 0
  let weight = 0

  if (ds.fontSize != null && as.fontSize != null) {
    weight += 0.34
    score += Math.max(0, 1 - Math.abs(ds.fontSize - as.fontSize) / 6) * 0.34
  }
  if (ds.fontWeight != null && as.fontWeight != null) {
    weight += 0.22
    score += Math.max(0, 1 - Math.abs(ds.fontWeight - as.fontWeight) / 400) * 0.22
  }
  if (ds.fontColor && as.fontColor) {
    weight += 0.28
    score += Math.max(0, 1 - colorDistance(ds.fontColor, as.fontColor) / 180) * 0.28
  }
  if (ds.textAlign && as.textAlign) {
    weight += 0.16
    score += (ds.textAlign === as.textAlign ? 1 : 0.55) * 0.16
  }

  return weight > 0 ? score / weight : 0.75
}

export function textSemanticSimilarity(a, b) {
  const ta = normalizeText(a)
  const tb = normalizeText(b)
  if (!ta || !tb) return 0
  if (ta === tb) return 1

  const typeA = textFieldType(ta)
  const typeB = textFieldType(tb)

  // 对于 label 类型的中文文本，若共享后缀（≥2字符），给予高分（只比完全相同低一点点）
  if (typeA === 'label' && typeB === 'label' && hasCjk(ta) && hasCjk(tb)) {
    const suffixBoost = cjkCommonSuffixBoost(ta, tb)
    if (suffixBoost > 0) return suffixBoost
  }

  const typeScore = typeA !== 'label' && typeA === typeB && (typeA !== 'number' || numericTextCompatible(ta, tb)) ? 0.72 : 0
  const charScore = charJaccard(ta, tb)
  const bigramScore = bigramJaccard(ta, tb)
  const prefixScore = cjkCommonPrefixScore(ta, tb)
  const suffixScore = cjkCommonSuffixScore(ta, tb)

  return Math.max(typeScore, prefixScore, suffixScore, charScore * 0.45 + bigramScore * 0.55)
}

export function passesTextSemanticGate(a, b, semantic) {
  if (!a || !b) return true
  const ta = normalizeText(a)
  const tb = normalizeText(b)
  if (!ta || !tb || ta === tb) return true
  const typeA = textFieldType(ta)
  const typeB = textFieldType(tb)
  if (typeA !== 'label' || typeB !== 'label') {
    if (typeA === 'number' || typeB === 'number') return typeA === typeB && numericTextCompatible(ta, tb)
    return typeA === typeB || semantic >= 0.45
  }

  // Short stable Chinese labels should not be matched purely by position/topology.
  if (hasCjk(ta) && hasCjk(tb) && Math.min(ta.length, tb.length) <= 4) return semantic >= 0.24
  return semantic >= 0.22
}

export function allowsTextPositionFallback(a, b, semantic) {
  if (passesTextSemanticGate(a, b, semantic)) return true
  const ta = normalizeText(a)
  const tb = normalizeText(b)
  if (!ta || !tb) return false
  if (isAmbiguousUnitText(ta) || isAmbiguousUnitText(tb)) return false
  if (hasNumericSignal(ta) || hasNumericSignal(tb)) return false
  if (textFieldType(ta) !== 'label' || textFieldType(tb) !== 'label') return textFieldType(ta) === textFieldType(tb)
  // Longer mock descriptions often differ in content but keep layout and style.
  return Math.min(ta.length, tb.length) >= 5
}

export function textRoleMatchScore(dn, an) {
  const roleA = inferTextRole(dn)
  const roleB = inferTextRole(an)
  if (roleA === 'body' || !isCompatibleTextRole(roleA, roleB)) return 0

  const dr = dn.normRect
  const ar = an.normRect
  const dx = Math.abs(dr.x - ar.x)
  const dy = Math.abs(centerY(dr) - centerY(ar))
  const style = textStyleSimilarity(dn, an)

  if (dx > 0.08 || dy > 0.08 || style < 0.72) return 0

  const xScore = Math.max(0, 1 - dx / 0.08)
  const yScore = Math.max(0, 1 - dy / 0.08)
  return xScore * 0.30 + yScore * 0.40 + style * 0.30
}

export function isStrongTitleSlotMatch(dn, an, score = 0) {
  const roleA = inferTextRole(dn)
  const roleB = inferTextRole(an)
  if (!isTitleLikeRole(roleA) || !isTitleLikeRole(roleB)) return false
  const dx = Math.abs(dn.normRect.x - an.normRect.x)
  const dy = Math.abs(centerY(dn.normRect) - centerY(an.normRect))
  const style = textStyleSimilarity(dn, an)
  const maxDx = roleA === 'page-title' ? 0.055 : 0.04
  const maxDy = roleA === 'page-title' ? 0.045 : 0.05
  const minScore = roleA === 'page-title' ? 0.75 : 0.78
  return score >= minScore && dx < maxDx && dy < maxDy && style > 0.82
}

export function inferTextRole(node) {
  const text = normalizeText(node?.textContent)
  const s = node?.style || {}
  const fontSize = Number(s.fontSize || s.actualFontSize || 0)
  const fontWeight = normalizeFontWeight(s.fontWeight)
  if (!text || textFieldType(text) !== 'label') return 'body'
  if (isTopPageTitleNode(node, text, fontSize, fontWeight)) return 'page-title'
  if (fontSize >= 15 && fontWeight >= 450) return 'title'
  if (fontSize >= 14 && fontWeight >= 400 && text.length >= 5) return 'subtitle'
  return 'body'
}

export function isTopPageTitleNode(node, text, fontSize, fontWeight) {
  const r = node?.normRect
  if (!r) return false
  if (hasNumericSignal(text) || isAmbiguousUnitText(text)) return false
  if (text.length > 12) return false
  const topBand = r.y < 0.16 && centerY(r) < 0.20
  const visuallyTitle = fontSize >= 17 || (fontSize >= 15 && fontWeight >= 600)
  return topBand && visuallyTitle
}

export function isTitleLikeRole(role) {
  return role === 'page-title' || role === 'title'
}

export function isCompatibleTextRole(roleA, roleB) {
  if (roleA === roleB) return true
  return isTitleLikeRole(roleA) && isTitleLikeRole(roleB)
}

export function normalizeFontWeight(value) {
  if (value == null) return 400
  if (typeof value === 'number') return value
  const text = String(value).toLowerCase()
  if (text.includes('bold')) return 700
  if (text.includes('medium')) return 500
  const n = Number(text)
  return Number.isFinite(n) ? n : 400
}

export function textFieldType(text) {
  if (/^(现在|上午|中午|下午|晚上)?\s*\d{1,2}:\d{2}$/.test(text) || text === '现在') return 'time'
  if (/^(周|星期)[一二三四五六日天]$/.test(text)) return 'weekday'
  if (isDurationText(text)) return 'duration'
  if (/^-?\d+(\.\d+)?%$/.test(text)) return 'percent'
  if (/^-?\d+(\.\d+)?°$/.test(text)) return 'temperature'
  if (/^\/?-?\d+(\.\d+)?\s*(w\+|万|k|km|m|kcal|cal|千卡|步|次|小时|分钟|分)?$/i.test(text)) return 'number'
  if (/[年月日周星期]/.test(text) && /\d/.test(text)) return 'date'
  return 'label'
}

export function isDurationText(text) {
  const t = normalizeText(text).replace(/\s+/g, '')
  return /^\d+(\.\d+)?(小时|分钟|分|秒)$/.test(t) ||
    /^(\d+(\.\d+)?小时)?\d+(\.\d+)?(分钟|分|秒)$/.test(t)
}

export function isAmbiguousUnitText(text) {
  return /^(分钟|小时|天|步|次|分|秒|千卡|kcal|cal|km|m|%|°)$/i.test(normalizeText(text))
}

export function isAmbiguousShortNumberText(text) {
  return /^\/?\d{1,2}$/.test(normalizeText(text).replace(/\s+/g, ''))
}

export function isShortCjkLabelPair(a, b) {
  return isShortCjkLabel(a) && isShortCjkLabel(b)
}

export function isShortCjkLabel(text) {
  const t = normalizeText(text)
  return textFieldType(t) === 'label' &&
    hasCjk(t) &&
    !hasNumericSignal(t) &&
    t.length >= 2 &&
    t.length <= 2
}

export function isNearSameLineSlot(a, b, maxX = 0.10, maxY = 0.045) {
  if (!a?.normRect || !b?.normRect) return false
  return xDistance(a.normRect, b.normRect) <= maxX && yDistance(a.normRect, b.normRect) <= maxY
}

export function hasNumericSignal(text) {
  return /(\d|\/|%|°|千卡|kcal|cal|km|公里|米|m\b|分钟|小时|步|次)/i.test(normalizeText(text))
}

export function numericTextCompatible(a, b) {
  const na = normalizeNumericText(a)
  const nb = normalizeNumericText(b)
  if (!na || !nb) return false
  if (na.raw === nb.raw) return true
  if (na.unit !== nb.unit) return false
  return na.value === nb.value && na.prefix === nb.prefix
}

export function normalizeNumericText(text) {
  const raw = normalizeText(text).replace(/\s+/g, '')
  const m = raw.match(/^(\/?)(-?\d+(?:\.\d+)?)(w\+|万|k|km|m|kcal|cal|千卡|步|次|小时|分钟|分)?$/i)
  if (!m) return null
  return {
    raw,
    prefix: m[1] || '',
    value: Number(m[2]),
    unit: (m[3] || '').toLowerCase(),
  }
}

export function hasCjk(text) {
  return /[\u4e00-\u9fff]/.test(text)
}

export function charJaccard(a, b) {
  return setJaccard(new Set([...a]), new Set([...b]))
}

export function bigramJaccard(a, b) {
  const grams = (s) => {
    if (s.length <= 1) return new Set([s])
    const result = new Set()
    for (let i = 0; i < s.length - 1; i++) result.add(s.slice(i, i + 2))
    return result
  }
  return setJaccard(grams(a), grams(b))
}

export function cjkCommonPrefixScore(a, b) {
  if (!hasCjk(a) || !hasCjk(b)) return 0
  let len = 0
  const max = Math.min(a.length, b.length)
  while (len < max && a[len] === b[len]) len += 1
  if (len < 2) return 0
  const prefixRatio = len / Math.max(a.length, b.length)
  return Math.min(0.62, 0.32 + prefixRatio * 0.42)
}

export function cjkCommonSuffixScore(a, b) {
  if (!hasCjk(a) || !hasCjk(b)) return 0
  let len = 0
  const max = Math.min(a.length, b.length)
  while (len < max && a[a.length - 1 - len] === b[b.length - 1 - len]) len += 1
  if (len < 2) return 0
  const suffixRatio = len / Math.max(a.length, b.length)
  return Math.min(0.58, 0.30 + suffixRatio * 0.40)
}

function cjkCommonSuffixBoost(a, b) {
  if (!hasCjk(a) || !hasCjk(b)) return 0
  let len = 0
  const max = Math.min(a.length, b.length)
  while (len < max && a[a.length - 1 - len] === b[b.length - 1 - len]) len += 1
  // 当后缀长度≥2个字符时，返回高分（只比完全相同低一点点）
  return len >= 2 ? 0.94 : 0
}

export function colorDistance(c1, c2) {
  const p1 = parseArgb(extractMainTone(c1))
  const p2 = parseArgb(extractMainTone(c2))
  if (!p1 || !p2) return 180
  return Math.sqrt(
    (p1.a - p2.a) ** 2 +
    (p1.r - p2.r) ** 2 +
    (p1.g - p2.g) ** 2 +
    (p1.b - p2.b) ** 2
  )
}

export function parseArgb(hex) {
  if (!hex || typeof hex !== 'string') return null
  const h = hex.replace('#', '')
  if (h.length !== 8) return null
  return {
    a: parseInt(h.slice(0, 2), 16),
    r: parseInt(h.slice(2, 4), 16),
    g: parseInt(h.slice(4, 6), 16),
    b: parseInt(h.slice(6, 8), 16),
  }
}

/**
 * 提取颜色「主色调」用于文本字色对比打分：
 * - 纯色 hex（#AARRGGBB / #RRGGBB）原样返回
 * - linear-gradient(...) 字符串 → 所有 stop 颜色 ARGB 等权平均后的 #AARRGGBB
 * - 解析不到颜色 → 原样返回（由下游 parseArgb 判定无效）
 * 使渐变色能与纯色（或另一段渐变）取得可比较的分数，而不是因解析失败丢失整段权重。
 */
export function extractMainTone(value) {
  if (!value || typeof value !== 'string') return value
  const s = value.trim()
  if (!/^linear-gradient/i.test(s)) return value
  const hexes = s.match(/#[0-9a-fA-F]{6,8}/g)
  if (!hexes || hexes.length === 0) return value
  let sumA = 0, sumR = 0, sumG = 0, sumB = 0, count = 0
  for (const m of hexes) {
    const h = m.slice(1)
    if (h.length === 8) {
      sumA += parseInt(h.slice(0, 2), 16)
      sumR += parseInt(h.slice(2, 4), 16)
      sumG += parseInt(h.slice(4, 6), 16)
      sumB += parseInt(h.slice(6, 8), 16)
    } else if (h.length === 6) {
      sumA += 255
      sumR += parseInt(h.slice(0, 2), 16)
      sumG += parseInt(h.slice(2, 4), 16)
      sumB += parseInt(h.slice(4, 6), 16)
    } else { continue }
    count++
  }
  if (count === 0) return value
  const toHex = n => Math.round(n / count).toString(16).padStart(2, '0').toUpperCase()
  return `#${toHex(sumA)}${toHex(sumR)}${toHex(sumG)}${toHex(sumB)}`
}

export function hasUsableText(node) {
  return !!String(node?.textContent || '').trim()
}
