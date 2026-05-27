/**
 * 单位换算与枚举归一化工具
 */

// ArkUI 字重枚举 → 数值
const FW_MAP = {
  'FontWeight.Lighter': 300,
  'FontWeight.Normal': 400,
  'FontWeight.Regular': 400,
  'FontWeight.Medium': 500,
  'FontWeight.Bold': 700,
  'FontWeight.Bolder': 900,
}

// 字体别名等价表（Design名 → Set<ArkUI等价名>）
const FONT_ALIASES = new Map([
  ['HarmonyHeiTi',      new Set(['HarmonyOS Sans', 'HwChinese-medium', 'HarmonyHeiTi-Medium', 'HarmonyHeiTi'])],
  ['HarmonyOS Sans SC', new Set(['HarmonyOS_Sans_SC', 'HarmonyOS_Sans_SC_Bold', 'HarmonyOS Sans SC'])],
  ['HarmonyOS Digit',   new Set(['hw-digit-bold-LL', 'HarmonyOS Digit'])],
  ['HM Symbol',         new Set(['HM Symbol'])],
  ['Helvetica',         new Set(['Helvetica'])],
])

// 文字对齐映射
const TEXT_ALIGN_MAP = {
  'TextAlign.Start':   'left',
  'TextAlign.Center':  'center',
  'TextAlign.End':     'right',
  'TextAlign.JUSTIFY': 'justify',
}

/** 解析 ArkUI 带单位字符串，返回数值（vp/fp/px）
 *  "16.00fp" → 16.0, "0.00vp" → 0, "100.00%" → null（百分比暂不处理）
 */
export function parseVp(str) {
  if (typeof str === 'number') return str
  if (!str) return null
  const m = String(str).match(/^(-?[\d.]+)(fp|vp|px)?$/)
  return m ? parseFloat(m[1]) : null
}

/** ArkUI fontWeight 枚举/字符串 → 数值 */
export function normalizeArkuiFontWeight(fw) {
  if (fw === null || fw === undefined) return null
  return FW_MAP[fw] ?? (parseInt(String(fw)) || null)
}

/** Design fontWeight 数值（可能为 0）→ 标准数值 */
export function normalizeDesignFontWeight(fw) {
  // 0 在设计导出里表示未显式给出字重，不能等同于 Regular(400)。
  if (fw === 0 || fw === null || fw === undefined || fw === '') return null
  return fw
}

/** ArkUI textAlign 枚举 → 'left'|'center'|'right' */
export function normalizeTextAlign(align) {
  return TEXT_ALIGN_MAP[align] || align || 'left'
}

/** 判断两个字体是否等价 */
export function isEquivalentFont(designFont, arkuiFont) {
  if (!designFont || !arkuiFont) return false
  if (designFont === arkuiFont) return true
  const aliases = FONT_ALIASES.get(designFont)
  if (aliases && aliases.has(arkuiFont)) return true
  // 反向查找（design 中可能用了 ArkUI 名称）
  for (const [, set] of FONT_ALIASES) {
    if (set.has(designFont) && set.has(arkuiFont)) return true
  }
  return false
}

/** 解析 ArkUI borderRadius 对象 → 统一格式（单位 vp）
 *  w/h：节点宽高（vp），用于将百分比圆角换算为绝对值 */
export function parseBorderRadius(br, w = null, h = null) {
  if (!br || typeof br !== 'object') return null
  const parseOne = str => {
    const vp = parseVp(str)
    if (vp !== null) return vp
    if (typeof str === 'string' && str.includes('%') && w !== null && h !== null) {
      const pct = parseFloat(str)
      if (!isNaN(pct)) return pct * Math.min(w, h) / 100
    }
    return 0
  }
  return {
    topLeft:     parseOne(br.topLeft),
    topRight:    parseOne(br.topRight),
    bottomRight: parseOne(br.bottomRight),
    bottomLeft:  parseOne(br.bottomLeft),
  }
}

/** Design borderRadius 数组 [tl,tr,br,bl] → 统一格式（单位 dp≈vp） */
export function parseDesignBorderRadius(arr) {
  if (!Array.isArray(arr) || arr.length < 4) return null
  return {
    topLeft:     arr[0] ?? 0,
    topRight:    arr[1] ?? 0,
    bottomRight: arr[2] ?? 0,
    bottomLeft:  arr[3] ?? 0,
  }
}

/** 解析 ArkUI padding 字符串或对象 → {top,right,bottom,left}（vp） */
export function parsePadding(padding) {
  if (!padding) return null
  if (typeof padding === 'string') {
    if (padding.startsWith('{')) {
      try {
        const obj = JSON.parse(padding)
        return {
          top:    parseVp(obj.top)    ?? 0,
          right:  parseVp(obj.right)  ?? 0,
          bottom: parseVp(obj.bottom) ?? 0,
          left:   parseVp(obj.left)   ?? 0,
        }
      } catch { /* fall through */ }
    }
    const v = parseVp(padding)
    return v !== null ? { top: v, right: v, bottom: v, left: v } : null
  }
  return null
}

/** 解析 Design container.padding 数组 [top,right,bottom,left]（dp） */
export function parseDesignPadding(arr) {
  if (!Array.isArray(arr) || arr.length < 4) return null
  return { top: arr[0], right: arr[1], bottom: arr[2], left: arr[3] }
}

/** 解析 ArkUI $rect 字符串 "[x1, y1],[x2,y2]" → {x1,y1,x2,y2}（物理像素） */
export function parseArkuiRect(rectStr) {
  if (!rectStr) return null
  const nums = rectStr.replace(/[\[\]]/g, '').split(',').map(s => parseFloat(s.trim()))
  if (nums.length < 4 || nums.some(isNaN)) return null
  return { x1: nums[0], y1: nums[1], x2: nums[2], y2: nums[3] }
}

/** 将 ArkUI 物理像素 rect 转换为 vp 坐标 */
export function toVpRect(arkuiRect, resolution) {
  if (!arkuiRect) return null
  const { x1, y1, x2, y2 } = arkuiRect
  return {
    x: x1 / resolution,
    y: y1 / resolution,
    w: (x2 - x1) / resolution,
    h: (y2 - y1) / resolution,
  }
}
