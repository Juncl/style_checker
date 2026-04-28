/**
 * 颜色格式转换工具
 * Design: #RRGGBBaa（小写alpha在末尾）
 * ArkUI:  #AARRGGBB（大写alpha在首位）
 */

export function normalizeDesignColor(hex) {
  if (!hex || typeof hex !== 'string') return null
  const h = hex.replace('#', '').trim()
  if (h.length === 8) {
    const aa = h.slice(6, 8).toUpperCase()
    const rrggbb = h.slice(0, 6).toUpperCase()
    return `#${aa}${rrggbb}`
  }
  if (h.length === 6) return `#FF${h.toUpperCase()}`
  return hex.toUpperCase()
}

export function normalizeArkuiColor(hex) {
  if (!hex || typeof hex !== 'string') return null
  return hex.toUpperCase()
}

/** 解析 #AARRGGBB 为 {a,r,g,b} 各分量（0-255） */
function parseARGB(hex) {
  const h = hex.replace('#', '')
  if (h.length === 8) {
    return {
      a: parseInt(h.slice(0, 2), 16),
      r: parseInt(h.slice(2, 4), 16),
      g: parseInt(h.slice(4, 6), 16),
      b: parseInt(h.slice(6, 8), 16),
    }
  }
  if (h.length === 6) {
    return {
      a: 255,
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    }
  }
  return null
}

/** 欧氏距离，值越小越接近 */
export function colorDelta(c1, c2) {
  try {
    const p1 = parseARGB(c1)
    const p2 = parseARGB(c2)
    if (!p1 || !p2) return 999
    return Math.sqrt(
      (p1.r - p2.r) ** 2 +
      (p1.g - p2.g) ** 2 +
      (p1.b - p2.b) ** 2 +
      (p1.a - p2.a) ** 2
    )
  } catch {
    return 999
  }
}

export function isTransparent(color) {
  if (!color) return true
  const h = color.replace('#', '')
  if (h.length === 8) return parseInt(h.slice(0, 2), 16) === 0
  return false
}

/** 将 #AARRGGBB 转换为 rgba(r,g,b,a%) 便于展示 */
export function toDisplayColor(hex) {
  if (!hex) return ''
  try {
    const c = parseARGB(hex)
    if (!c) return hex
    const alpha = Math.round((c.a / 255) * 100)
    return `rgba(${c.r},${c.g},${c.b},${alpha}%)`
  } catch {
    return hex
  }
}
