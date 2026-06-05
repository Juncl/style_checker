/**
 * ArkUI Step 1: 原始 $children 树 → UnifiedNode 树
 *
 * 职责：只做"结构转换 + 字段统一"，不做任何过滤或剪枝。
 * 输出的树包含所有原始节点（哪怕是 hidden / opacity=0 / 越界 / 框架节点），
 * 由后续 step2 pruneTree 统一处理。
 *
 * 每个树节点形状（UnifiedNode + 调试用的下划线字段）：
 *   {
 *     id, source: 'arkui', type, rawType, name, path,
 *     rect, normRect, visible, style, textContent?,
 *     children: [],
 *     _frameworkType: bool,        // root/Navigation/NavBar/... 等框架节点
 *     _spanType: bool,             // Span
 *     _blankType: bool,            // Blank
 *     _attrs: object,              // 原始 $attrs，供 step2/3 使用
 *     _rectRaw: object | null,     // 原始 $rect 解析结果（物理像素 + 单位）
 *   }
 */

import {
  parseVp,
  normalizeArkuiFontWeight,
  normalizeTextAlign,
  parseBorderRadius,
  parsePadding,
  parseArkuiRect,
  toVpRect,
} from '../../utils/unitUtils.js'
import { normalizeArkuiColor, isTransparent } from '../../utils/colorUtils.js'

const TEXT_TYPES = new Set(['Text'])
const FRAMEWORK_TYPES = new Set([
  'root', 'JsView', 'Navigation', 'NavBar', 'NavigationContent',
  'Divider', 'ScrollBar', 'NavBarContent', 'NavigationMenu',
  '__Common__', 'TitleBar', 'ToolBar', 'BackButton',
])
const SPAN_TYPES = new Set(['Span'])

// ArkUI GradientDirection 枚举 → CSS linear-gradient 角度（deg）
const GRADIENT_DIRECTION_DEG = {
  'GradientDirection.Top': 0,
  'GradientDirection.RightTop': 45,
  'GradientDirection.Right': 90,
  'GradientDirection.RightBottom': 135,
  'GradientDirection.Bottom': 180,
  'GradientDirection.LeftBottom': 225,
  'GradientDirection.Left': 270,
  'GradientDirection.LeftTop': 315,
}

/**
 * @param {object} arkuiJson 原始 arkui.json
 * @returns {{ canvasWidthVp, canvasHeightVp, resolution, root }} root 为树根
 */
export function buildArkuiTree(arkuiJson) {
  const content = arkuiJson?.content || {}
  const resolution = parseFloat(content['$resolution']) || 3.5
  const canvasWidthPx = parseFloat(content['width']) || 1316
  const canvasHeightPx = parseFloat(content['height']) || 2832
  const canvasWidthVp = canvasWidthPx / resolution
  const canvasHeightVp = canvasHeightPx / resolution

  const root = walk(content, resolution, canvasWidthVp, canvasHeightVp, [0])

  return { canvasWidthVp, canvasHeightVp, resolution, root }
}

// clipRadius：最近一层 clip=true 祖先的 borderRadius，DFS 向下传播
// compType：最近一层语义组件祖先的类型标记（如 'titlebar'），DFS 向下传播给所有后代
// rotationChain：祖先链上所有 rotate 的纯旋转（外到内），把布局矩形旋转到真实渲染位置
// layoutRect：当前节点的布局矩形；在旋转影响区内时由父容器布局规则推断，否则为 null
function walk(node, resolution, canvasW, canvasH, path, clipRadius = null, compType = null, rotationChain = null, layoutRect = null) {
  const type = node['$type'] || ''
  const attrs = node['$attrs'] || {}
  const rectRaw = parseArkuiRect(node['$rect'])
  const rawVpRect = rectRaw ? toVpRect(rectRaw, resolution) : null

  // 旋转修正：ArkUI 对受 rotate 影响的节点导出的 $rect 不可信（位置偏移、w/h 也错）。
  // 由于 rotate 不影响布局，节点真实的布局矩形由父容器布局规则递归推断（layoutRect，
  // 来自下方 children 循环的 inferChildLayoutRect）；最终渲染位置 = 布局矩形应用旋转链。
  const baseRect = layoutRect || rawVpRect
  const ownRotation = parseOwnRotation(attrs.rotate, baseRect)
  const nextRotationChain = ownRotation
    ? [...(rotationChain || []), ownRotation]
    : rotationChain
  let vpRect = baseRect
  if (vpRect && nextRotationChain && nextRotationChain.length > 0) {
    vpRect = applyRotationChain(baseRect, nextRotationChain)
  }
  // 修正后同步 _rectRaw（step2 以 _rectRaw 判定 no-rect）
  const effectiveRectRaw = (vpRect !== rawVpRect && vpRect && rectRaw)
    ? { ...rectRaw, x: vpRect.x * resolution, y: vpRect.y * resolution, w: vpRect.w * resolution, h: vpRect.h * resolution }
    : rectRaw

  const style = extractArkuiStyle(type, attrs, resolution, vpRect)

  // 当前节点是否产生新的 clip 上下文：clip=true 且自身有非零 borderRadius
  const isClip = attrs.clip === 'true' || attrs.clip === true
  const styleBrNonZero = style.borderRadius && Object.values(style.borderRadius).some(v => v > 0)
  const nextClipRadius = (isClip && styleBrNonZero) ? style.borderRadius : clipRadius

  // 非文本节点：自身无圆角时，继承最近 clip 祖先的 borderRadius。
  // 能收到 clipRadius 说明从 clip 祖先一路同 rect（由 children 循环的 clipRectsMatch
  // 保证），视觉上等同被裁圆角。继承后该节点会拥有视觉装饰，参与下游匹配/比对。
  if (!TEXT_TYPES.has(type) && !SPAN_TYPES.has(type) && !styleBrNonZero && nextClipRadius) {
    style.borderRadius = { ...nextClipRadius }
  }

  // TitleBar 节点本身不写 compType，但向其后代传播 'titlebar'
  const nextCompType = type === 'TitleBar' ? 'titlebar' : compType

  const unified = {
    id: String(node['$ID'] ?? `arkui:${path.join('.')}`),
    source: 'arkui',
    type: TEXT_TYPES.has(type) ? 'text' : 'container',
    rawType: String(type || '').toLowerCase(),
    name: type,
    path,
    rect: vpRect
      ? { x: vpRect.x, y: vpRect.y, w: vpRect.w, h: vpRect.h }
      : { x: 0, y: 0, w: 0, h: 0 },
    // arkui 无"缩放前"概念，size 与 rect 同值，仅为与 design 字段对齐
    size: vpRect
      ? { x: vpRect.x, y: vpRect.y, w: vpRect.w, h: vpRect.h }
      : { x: 0, y: 0, w: 0, h: 0 },
    normRect: vpRect
      ? {
        x: vpRect.x / canvasW,
        y: vpRect.y / canvasH,
        w: vpRect.w / canvasW,
        h: vpRect.h / canvasH,
      }
      : { x: 0, y: 0, w: 0, h: 0 },
    visible: true,
    style,
    children: [],
    _frameworkType: FRAMEWORK_TYPES.has(type) || type === 'root',
    _spanType: SPAN_TYPES.has(type),
    _blankType: type === 'Blank',
    _attrs: attrs,
    _rectRaw: effectiveRectRaw,
  }

  if (compType) unified.compType = compType

  const text = getArkuiTextContent(attrs)
  if (text) unified.textContent = text

  const children = node['$children'] || []
  // 旋转影响区：当前节点在旋转链内，其整棵子树的 $rect 都被 ArkUI 污染。
  const inRotatedZone = !!(nextRotationChain && nextRotationChain.length > 0)
  for (let i = 0; i < children.length; i++) {
    const childAttrs = children[i]['$attrs'] || {}
    const childAngle = parseFloat(childAttrs.rotate?.angle)
    const childSelfRotated = Number.isFinite(childAngle) && childAngle !== 0
    // 子节点 $rect 被污染（在旋转区内，或自身带 rotate）时，递归推断其布局矩形
    const childLayoutRect = (inRotatedZone || childSelfRotated)
      ? inferChildLayoutRect(type, baseRect, attrs, childAttrs)
      : null
    if (nextClipRadius) {
      const childRectRaw = parseArkuiRect(children[i]['$rect'])
      const childVpRect = childRectRaw ? toVpRect(childRectRaw, resolution) : null
      if (vpRect && childVpRect && clipRectsMatch(vpRect, childVpRect)) {
        unified.children.push(walk(children[i], resolution, canvasW, canvasH, [...path, i], nextClipRadius, nextCompType, nextRotationChain, childLayoutRect))
        continue
      }
    }
    unified.children.push(walk(children[i], resolution, canvasW, canvasH, [...path, i], null, nextCompType, nextRotationChain, childLayoutRect))
  }

  // Button / TextInput：拆分出虚拟文本子节点（便于与设计侧匹配）
  const splitText = maybeBuildSplitTextChild(unified, type, attrs, vpRect, resolution, canvasW, canvasH, path)
  if (splitText) {
    if (nextCompType) splitText.compType = nextCompType
    unified.children.push(splitText)
  }

  return unified
}

// ─── 旋转修正 ──────────────────────────────────────────────────────────────────

/**
 * 解析节点自身的 rotate 属性，返回纯旋转 { cx, cy, angle }（旋转中心绝对坐标 vp）。
 * 仅处理绕 z 轴的 2D 旋转；angle 为 0 或 3D 旋转（x/y 非 0）时返回 null。
 * 旋转中心 centerX/centerY 是相对节点布局矩形 baseRect 的百分比。
 */
function parseOwnRotation(rotateAttr, baseRect) {
  if (!rotateAttr || typeof rotateAttr !== 'object' || !baseRect) return null
  const angle = parseFloat(rotateAttr.angle)
  if (!Number.isFinite(angle) || angle === 0) return null
  const ax = parseFloat(rotateAttr.x) || 0
  const ay = parseFloat(rotateAttr.y) || 0
  if (ax !== 0 || ay !== 0) return null   // 3D 旋转不处理

  const cxPct = parseRotateCenterPercent(rotateAttr.centerX)
  const cyPct = parseRotateCenterPercent(rotateAttr.centerY)
  return {
    cx: baseRect.x + baseRect.w * cxPct,
    cy: baseRect.y + baseRect.h * cyPct,
    angle,
  }
}

// rotate 的 centerX/centerY，形如 "50.00%"，解析为 0-1 比例（缺省 0.5）
function parseRotateCenterPercent(val) {
  if (typeof val === 'string' && val.trim().endsWith('%')) {
    const n = parseFloat(val)
    if (Number.isFinite(n)) return n / 100
  }
  return 0.5
}

// ArkUI Alignment 枚举 → [水平比例, 垂直比例]
const ALIGNMENT_RATIOS = {
  'Alignment.TopStart': [0, 0],
  'Alignment.Top': [0.5, 0],
  'Alignment.TopEnd': [1, 0],
  'Alignment.Start': [0, 0.5],
  'Alignment.Center': [0.5, 0.5],
  'Alignment.End': [1, 0.5],
  'Alignment.BottomStart': [0, 1],
  'Alignment.Bottom': [0.5, 1],
  'Alignment.BottomEnd': [1, 1],
}

/**
 * 推断带旋转子节点的未旋转布局位置。
 * rotate 不影响 ArkUI 布局，子节点布局位置由父容器布局规则决定 ——
 * 与父容器（不旋转、$rect 可信）的 contentRect、子 size/margin、对齐方式相关，
 * 不依赖任何兄弟节点。目前仅支持父为 Stack（层叠布局）：
 * 子节点连同自身 margin 组成 margin-box，按父 Stack 的 alignContent 对齐。
 */
function inferChildLayoutRect(parentType, parentRect, parentAttrs, childAttrs) {
  if (parentType !== 'Stack' || !parentRect) return null
  const childW = childAttrs?.size ? parseVp(childAttrs.size.width) : null
  const childH = childAttrs?.size ? parseVp(childAttrs.size.height) : null
  if (childW == null || childH == null || childW <= 0 || childH <= 0) return null
  const pad = parsePadding(parentAttrs?.padding) || { top: 0, right: 0, bottom: 0, left: 0 }
  const mar = parsePadding(childAttrs?.margin) || { top: 0, right: 0, bottom: 0, left: 0 }
  // 父 Stack 的 contentRect（扣父 padding）
  const cx0 = parentRect.x + (pad.left || 0)
  const cy0 = parentRect.y + (pad.top || 0)
  const cw = parentRect.w - (pad.left || 0) - (pad.right || 0)
  const ch = parentRect.h - (pad.top || 0) - (pad.bottom || 0)
  const [hRatio, vRatio] = ALIGNMENT_RATIOS[parentAttrs?.alignContent] || [0.5, 0.5]
  // 子节点连同 margin 组成 margin-box，按对齐放置后子节点在 box 内偏移 margin
  const mboxW = childW + (mar.left || 0) + (mar.right || 0)
  const mboxH = childH + (mar.top || 0) + (mar.bottom || 0)
  return {
    x: cx0 + (cw - mboxW) * hRatio + (mar.left || 0),
    y: cy0 + (ch - mboxH) * vRatio + (mar.top || 0),
    w: childW,
    h: childH,
  }
}

// 把点 (px,py) 绕 (cx,cy) 旋转 angleDeg（ArkUI rotate 正角度方向，取负号对齐）
function rotatePoint(px, py, cx, cy, angleDeg) {
  const rad = -angleDeg * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = px - cx
  const dy = py - cy
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  }
}

// 依次应用旋转链修正 rect：保持 w/h，把中心点绕各级旋转中心旋转后回填 xy
// chain 自外向内排列，点变换需自内向外应用（从末尾向前）
function applyRotationChain(rect, chain) {
  let cx = rect.x + rect.w / 2
  let cy = rect.y + rect.h / 2
  for (let i = chain.length - 1; i >= 0; i--) {
    const r = chain[i]
    const p = rotatePoint(cx, cy, r.cx, r.cy, r.angle)
    cx = p.x
    cy = p.y
  }
  return { x: cx - rect.w / 2, y: cy - rect.h / 2, w: rect.w, h: rect.h }
}

/**
 * 对 Button / TextInput 节点拆分出一个虚拟 Text 子节点
 * - Button: $attrs.label 存在 → 用 label 作为内容，默认居中对齐
 * - TextInput: $attrs.text 或 placeholder 存在 → 用 text || placeholder 作为内容，遵循 textAlign
 */
function maybeBuildSplitTextChild(parentUnified, type, attrs, vpRect, resolution, canvasW, canvasH, path) {
  if (!vpRect || vpRect.w <= 0 || vpRect.h <= 0) return null

  let content = ''
  let textAlign = 'center'
  let fontSize = null
  let fontWeight = null
  let fontColor = null
  let fontFamily = null

  if (type === 'Button') {
    if (!attrs.label) return null
    content = String(attrs.label)
    fontSize = parseVp(attrs.fontSize)
    // labelStyle.maxFontSize 是自适应字号的实际渲染上限，优先于 fontSize
    if (attrs.labelStyle) {
      try {
        const ls = typeof attrs.labelStyle === 'string' ? JSON.parse(attrs.labelStyle) : attrs.labelStyle
        const maxFs = parseVp(ls.maxFontSize)
        if (maxFs > 0 && maxFs < fontSize) fontSize = maxFs
      } catch {}
    }
    fontWeight = attrs.fontWeight
    fontColor = attrs.fontColor
    fontFamily = attrs.fontFamily
    textAlign = 'center'
  } else if (type === 'TextInput') {
    const textVal = attrs.text
    const placeholder = attrs.placeholder
    const hasText = textVal !== undefined && textVal !== null && String(textVal).length > 0
    const hasPlaceholder = placeholder !== undefined && placeholder !== null && String(placeholder).length > 0
    if (!hasText && !hasPlaceholder) return null
    content = hasText ? String(textVal) : String(placeholder)
    fontSize = parseVp(attrs.fontSize)
    fontWeight = attrs.fontWeight
    fontColor = hasText ? attrs.fontColor : (attrs.placeholderColor || attrs.fontColor)
    fontFamily = attrs.fontFamily
    textAlign = normalizeArkuiTextAlignRaw(attrs.textAlign) || 'start'
  } else {
    return null
  }

  if (!content || !fontSize || fontSize <= 0) return null

  const textRect = computeTextRect(vpRect, content, fontSize, textAlign, attrs.padding)

  const childPath = [...path, parentUnified.children.length]
  const childStyle = {
    width: textRect.w,
    height: textRect.h,
    fontSize,
  }
  const fw = normalizeArkuiFontWeight(fontWeight)
  if (fw !== null) childStyle.fontWeight = fw
  if (fontColor) childStyle.fontColor = normalizeArkuiColor(fontColor)
  if (fontFamily) childStyle.fontFamily = fontFamily
  childStyle.textAlign = normalizeTextAlign(textAlign === 'center' ? 'TextAlign.Center' : textAlign === 'end' ? 'TextAlign.End' : 'TextAlign.Start')

  return {
    id: `${parentUnified.id}:t`,
    source: 'arkui',
    type: 'text',
    rawType: 'text',
    name: 'Text',
    path: childPath,
    rect: { x: textRect.x, y: textRect.y, w: textRect.w, h: textRect.h },
    size: { x: textRect.x, y: textRect.y, w: textRect.w, h: textRect.h },
    normRect: {
      x: textRect.x / canvasW,
      y: textRect.y / canvasH,
      w: textRect.w / canvasW,
      h: textRect.h / canvasH,
    },
    visible: true,
    style: childStyle,
    textContent: content,
    children: [],
    _frameworkType: false,
    _spanType: false,
    _blankType: false,
    _attrs: { content, fontSize: String(fontSize), fontColor, fontFamily, textAlign },
    _rectRaw: { x: textRect.x * resolution, y: textRect.y * resolution, w: textRect.w * resolution, h: textRect.h * resolution },
    _splitFromParent: true,
  }
}

/**
 * 估算文本宽度（vp）：中文字符按 fontSize 算，其他字符按 fontSize*0.55 算
 */
function estimateTextWidth(content, fontSize) {
  let w = 0
  for (const ch of String(content)) {
    if (/[一-龥　-〿＀-￯]/.test(ch)) {
      w += fontSize
    } else {
      w += fontSize * 0.55
    }
  }
  return w
}

/**
 * 计算文本子节点在父节点内的 rect（vp 单位、绝对坐标）
 * - 文本垂直居中
 * - 水平方向按 textAlign 对齐，考虑 padding（如有）
 */
function computeTextRect(parentRect, content, fontSize, textAlign, paddingRaw) {
  const padding = parsePadding(paddingRaw) || { top: 0, right: 0, bottom: 0, left: 0 }
  const innerLeft = parentRect.x + (padding.left || 0)
  const innerRight = parentRect.x + parentRect.w - (padding.right || 0)
  const innerWidth = Math.max(0, innerRight - innerLeft)

  const textWidth = Math.min(estimateTextWidth(content, fontSize), innerWidth || parentRect.w)
  const textHeight = fontSize

  let x = innerLeft
  if (textAlign === 'center') {
    x = innerLeft + (innerWidth - textWidth) / 2
  } else if (textAlign === 'end' || textAlign === 'right') {
    x = innerRight - textWidth
  }
  const y = parentRect.y + (parentRect.h - textHeight) / 2

  return { x, y, w: textWidth, h: textHeight }
}

/**
 * 从 ArkUI 的 textAlign 枚举提取出简化值（start / center / end）
 * 注：normalizeTextAlign 输出的是 left/center/right，这里只用作内部判断
 */
function normalizeArkuiTextAlignRaw(value) {
  if (!value) return null
  const v = String(value)
  if (v.includes('Center')) return 'center'
  if (v.includes('End') || v.includes('Right')) return 'end'
  if (v.includes('Start') || v.includes('Left')) return 'start'
  return null
}

function getArkuiTextContent(attrs) {
  return attrs.content || attrs.accessibilityText || ''
}

function extractArkuiStyle(type, attrs, resolution, vpRect) {
  const s = {}

  // 不透明度
  if (attrs.opacity !== undefined && attrs.opacity !== null) {
    s.opacity = parseFloat(attrs.opacity)
  }

  // 填充（非透明才记录）
  const shapeFill = type === 'Circle' || type === 'Ellipse' || type === 'Rect'
    ? attrs.fill || attrs.foregroundColor
    : type === 'SymbolGlyph'
      ? attrs.fontColor
      : null
  const bgColor = shapeFill || attrs.backgroundColor
  if (bgColor && !isTransparent(bgColor)) {
    s.backgroundColor = normalizeArkuiColor(bgColor)
  }
  // 渐变填充：无有效纯色背景时，提取 linearGradient 为 linear-gradient 字符串
  if (!s.backgroundColor) {
    const grad = buildLinearGradient(attrs.linearGradient)
    if (grad) s.backgroundColor = grad
  }

  // 尺寸信息
  let sizeWidth = null
  let sizeHeight = null
  if (attrs.size && typeof attrs.size === 'object') {
    sizeWidth = parseVp(attrs.size.width)
    sizeHeight = parseVp(attrs.size.height)
  }
  if (sizeWidth === null || sizeWidth === undefined) {
    sizeWidth = vpRect ? Math.round(vpRect.w) : null
  }
  if (sizeHeight === null || sizeHeight === undefined) {
    sizeHeight = vpRect ? Math.round(vpRect.h) : null
  }
  if (sizeWidth !== null && sizeWidth > 0) s.width = sizeWidth
  if (sizeHeight !== null && sizeHeight > 0) s.height = sizeHeight

  // 圆角
  let brRaw = null
  if (attrs.borderRadius && typeof attrs.borderRadius === 'object') {
    brRaw = parseBorderRadius(attrs.borderRadius, sizeWidth, sizeHeight)
  } else if (typeof attrs.borderRadius === 'string') {
    const val = parseVp(attrs.borderRadius)
    if (val !== null && val > 0) {
      brRaw = { topLeft: val, topRight: val, bottomRight: val, bottomLeft: val }
    }
  }
  if (brRaw && Object.values(brRaw).some(v => v > 0)) {
    if (sizeWidth !== null && sizeHeight !== null && sizeWidth > 0 && sizeHeight > 0) {
      const maxBr = Math.min(sizeWidth, sizeHeight) / 2
      s.borderRadius = {
        topLeft:     Math.min(brRaw.topLeft,     maxBr),
        topRight:    Math.min(brRaw.topRight,    maxBr),
        bottomRight: Math.min(brRaw.bottomRight, maxBr),
        bottomLeft:  Math.min(brRaw.bottomLeft,  maxBr),
      }
    } else {
      s.borderRadius = brRaw
    }
  }

  // 描边
  const borderWidth = parseVp(attrs.borderWidth)
  if (borderWidth && borderWidth > 0) {
    s.border = {
      width: borderWidth,
      color: normalizeArkuiColor(attrs.borderColor),
      style: attrs.borderStyle || 'BorderStyle.Solid',
    }
  }

  // 模糊（统一用 blur 字符串字段，背景模糊优先）
  const blur = parseFloat(attrs.blur)
  if (!isNaN(blur) && blur > 0) s.blur = `高斯模糊 ${blur}px`

  const backdropBlur = parseFloat(attrs.backdropBlur)
  if (!isNaN(backdropBlur) && backdropBlur > 0) s.blur = `背景模糊 ${backdropBlur}px`

  // 投影
  if (attrs.shadow && typeof attrs.shadow === 'object') {
    const sh      = attrs.shadow
    const radius  = Number(sh.radius)
    const offsetX = Number(sh.offsetX)
    const offsetY = Number(sh.offsetY)
    const color   = normalizeArkuiColor(sh.color)
    const needShadow = radius > 0
      && (offsetX !== 0 || offsetY !== 0)
      && color
      && !color.startsWith('#00')
    if (needShadow) {
      const typeName = sh.type === '0' ? '外阴影' : '内阴影'
      s.shadow = `${typeName} ${color} ${radius}px X:${offsetX}, Y:${offsetY}`
    }
  }

  // 内/外边距
  const padding = parsePadding(attrs.padding)
  if (padding && Object.values(padding).some(v => v > 0)) s.padding = padding
  const margin = parsePadding(attrs.margin)
  if (margin && Object.values(margin).some(v => v !== 0)) s.margin = margin

  // 子元素间距
  if (['Row', 'Column', 'Flex'].includes(type) && attrs.space !== undefined) {
    const space = parseVp(attrs.space)
    if (space !== null && space > 0) s.itemSpacing = space
  }

  // 混合模式
  const blendMode = parseInt(attrs.blendMode, 10)
  if (!isNaN(blendMode) && blendMode !== 0) s.blendMode = blendMode

  // 文字相关
  if (TEXT_TYPES.has(type)) {
    const declaredFontSize = parseVp(attrs.fontSize)

    const fw = normalizeArkuiFontWeight(attrs.fontWeight)
    if (fw !== null) s.fontWeight = fw

    if (attrs.fontColor) s.fontColor = normalizeArkuiColor(attrs.fontColor)
    if (attrs.fontFamily) s.fontFamily = attrs.fontFamily

    const lh = parseVp(attrs.lineHeight)
    if (lh !== null && lh > 0) s.lineHeight = lh

    const ls = parseVp(attrs.letterSpacing)
    if (ls !== null) s.letterSpacing = ls

    if (attrs.textAlign) s.textAlign = normalizeTextAlign(attrs.textAlign)

    const actualFontSize = parseActualFontSize(attrs.actualFontSize, resolution)
    if (actualFontSize !== null) {
      s.actualFontSize = actualFontSize
      s.fontSize = actualFontSize
      if (declaredFontSize !== null) s.declaredFontSize = declaredFontSize
    } else if (declaredFontSize !== null) {
      s.fontSize = declaredFontSize
    }
  }

  // Image 节点的 backgroundColor 是加载失败时的占位色，图片正常渲染时不显示，不参与样式比对
  if (type === 'Image') {
    delete s.backgroundColor
  }

  return s
}

/**
 * 把 ArkUI linearGradient 属性转为 CSS linear-gradient 字符串，与设计侧渐变格式对齐。
 * 返回 null 表示无有效渐变（空对象 / 无 colors）。
 */
function buildLinearGradient(lg) {
  if (!lg || typeof lg !== 'object' || !Array.isArray(lg.colors) || lg.colors.length === 0) {
    return null
  }
  const deg = GRADIENT_DIRECTION_DEG[lg.direction] ?? 180
  const stops = []
  for (const c of lg.colors) {
    if (!Array.isArray(c) || c.length === 0) continue
    const color = normalizeArkuiColor(c[0])
    if (!color) continue
    const posNum = parseFloat(c[1])
    const pos = Number.isFinite(posNum) ? `${+(posNum * 100).toFixed(2)}%` : '0%'
    stops.push(`${color} ${pos}`)
  }
  if (stops.length === 0) return null
  return `linear-gradient(${deg}deg, ${stops.join(', ')})`
}

function clipRectsMatch(a, b) {
  if (!a || !b) return false
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 &&
    Math.abs(a.h - b.h) < 0.5
  )
}

function parseActualFontSize(value, resolution) {
  if (value === undefined || value === null || value === '') return null
  const m = String(value).match(/^(-?[\d.]+)(fp|vp|px)?$/)
  if (!m) return null
  const val = parseFloat(m[1])
  if (!Number.isFinite(val) || val <= 0) return null
  const unit = m[2] || 'vp'
  return unit === 'px' ? val / resolution : val
}
