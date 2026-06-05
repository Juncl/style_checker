/**
 * Web Step 1: 原始 DOM 树 → UnifiedNode 树
 *
 * Web 数据已经是结构化扁平字段，转换最直接：
 *   - 顶层 viewport → canvas 尺寸
 *   - type='text'  → UnifiedNode type='text'
 *   - type='img'   → type='container', rawType='image'（命中 INTRINSIC_VISUAL_RAW_TYPES）
 *   - 其余 HTML 标签（div/span/ul/li/body/iframe/input/i …）→ type='container', rawType=标签名
 *
 * 坐标单位即 CSS px（resolution=1），无 vp 转换。
 * padding/margin 不解析；border 仅在 width>0 且 style!='none' 时保留。
 */

const TEXT_TYPE = 'text'
const IMG_TYPE  = 'img'

/**
 * @param {object} webJson 原始 web.json（顶层 viewport 节点）
 * @returns {{ canvasWidthVp, canvasHeightVp, resolution, root }}
 */
export function buildWebTree(webJson) {
  const rootRaw = webJson || {}
  const canvasWidthVp  = Number(rootRaw.w ?? rootRaw.rect?.w ?? 1920) || 1920
  const canvasHeightVp = Number(rootRaw.h ?? rootRaw.rect?.h ?? 1080) || 1080
  const resolution = 1

  const root = walk(rootRaw, canvasWidthVp, canvasHeightVp, [0])

  return { canvasWidthVp, canvasHeightVp, resolution, root }
}

function walk(node, canvasW, canvasH, path) {
  if (!node || typeof node !== 'object') return null

  const rawType = String(node.type || '').toLowerCase()
  const isText = rawType === TEXT_TYPE
  const isImg  = rawType === IMG_TYPE

  const rx = Number(node.x ?? node.rect?.x ?? 0) || 0
  const ry = Number(node.y ?? node.rect?.y ?? 0) || 0
  const rw = Number(node.w ?? node.rect?.w ?? 0) || 0
  const rh = Number(node.h ?? node.rect?.h ?? 0) || 0

  const unified = {
    id: String(node.id != null ? node.id : `web:${path.join('.')}`),
    source: 'web',
    type: isText ? 'text' : 'container',
    // 把 img 统一为 'image'，让 INTRINSIC_VISUAL_RAW_TYPES 命中
    rawType: isImg ? 'image' : rawType,
    name: node.className || node.name || rawType || '',
    path,
    rect: { x: rx, y: ry, w: rw, h: rh },
    // web 无"缩放前"概念，size 与 rect 同值，仅为与 design 字段对齐
    size: { x: rx, y: ry, w: rw, h: rh },
    normRect: {
      x: canvasW ? rx / canvasW : 0,
      y: canvasH ? ry / canvasH : 0,
      w: canvasW ? rw / canvasW : 0,
      h: canvasH ? rh / canvasH : 0,
    },
    visible: true,
    style: extractWebStyle(node, isText),
    children: [],
    _raw: node,
  }

  if (isText) {
    unified.textContent = String(node.content ?? '')
  }

  const children = Array.isArray(node.children) ? node.children : []
  for (let i = 0; i < children.length; i++) {
    const childNode = walk(children[i], canvasW, canvasH, [...path, i])
    if (childNode) unified.children.push(childNode)
  }

  return unified
}

function extractWebStyle(node, isText) {
  const result = {}

  if (typeof node.opacity === 'number' && node.opacity !== 1) {
    result.opacity = node.opacity
  }

  if (isText) {
    // 文本节点字段
    if (node.fontColor && !isTransparentColor(node.fontColor)) {
      result.fontColor = node.fontColor
    }
    if (typeof node.fontSize === 'number' && node.fontSize > 0) {
      result.fontSize = node.fontSize
    }
    if (typeof node.fontWeight === 'number' || typeof node.fontWeight === 'string') {
      result.fontWeight = normalizeWebFontWeight(node.fontWeight)
    }
    if (typeof node.fontFamily === 'string' && node.fontFamily) {
      result.fontFamily = node.fontFamily
    }
    if (node.textAlign) {
      result.textAlign = mapTextAlign(node.textAlign)
    }
    return result
  }

  // 容器节点字段
  if (node.backgroundColor && !isTransparentColor(node.backgroundColor)) {
    result.backgroundColor = node.backgroundColor
  }

  // borderRadius：web 是单个数字，扩展到四角
  const br = Number(node.borderRadius || 0)
  if (br > 0) {
    result.borderRadius = {
      topLeft: br, topRight: br, bottomRight: br, bottomLeft: br,
    }
  }

  const bw = Number(node.borderWidth || 0)
  const bs = String(node.borderStyle || '').toLowerCase()
  const bc = node.borderColor
  if (bw > 0 && bs && bs !== 'none' && bc && !isTransparentColor(bc)) {
    result.border = {
      color: bc,
      width: bw,
      style: bs,
    }
  }

  return result
}

// Web 颜色一律 #AARRGGBB；alpha=00 视为透明
function isTransparentColor(color) {
  if (!color || typeof color !== 'string') return true
  const c = color.trim().toLowerCase()
  if (!c) return true
  if (c === 'transparent' || c === 'none') return true
  // #AARRGGBB 8位
  if (/^#[0-9a-f]{8}$/.test(c)) return c.startsWith('#00')
  // #RRGGBB 6位 → 不透明
  if (/^#[0-9a-f]{6}$/.test(c)) return false
  return false
}

function normalizeWebFontWeight(w) {
  if (typeof w === 'number') return w
  const map = { normal: 400, bold: 700, bolder: 700, lighter: 300 }
  return map[String(w).toLowerCase()] ?? Number(w) ?? 400
}

function mapTextAlign(align) {
  const a = String(align).toLowerCase()
  if (a === 'left' || a === 'start') return 'left'
  if (a === 'right' || a === 'end') return 'right'
  if (a === 'center') return 'center'
  return a || 'left'
}
