/**
 * 样式比对器
 * 对每对匹配节点逐属性对比，生成结构化差异列表
 */

import { colorDelta, toDisplayColor } from '../utils/colorUtils.js'
import { isEquivalentFont } from '../utils/unitUtils.js'

// 容差配置（单位 vp 或绝对值）
const TOLERANCE = {
  fontSize:      0,    // 零容差：任何字号偏差都报
  lineHeight:    0.5,
  letterSpacing: 0.5,
  borderRadius:  0,    // 零容差：任何圆角偏差都报
  padding:       1.0,
  opacity:       0.02,
  blur:          0,    // 零容差：任何偏差都报
  shadowRadius:  0,    // 零容差：任何偏差都报
  shadowOffset:  0,    // 零容差：任何偏差都报
  colorDelta:    0,    // 颜色欧氏距离（0-442 范围）；0 表示完全精确匹配
}

// 硬豁免：节点 rawType 在以下集合时，无论有无 backgroundColor 都不参与填充对比
// - image / img：填充语义在 ArkUI 是 fillColor / objectFit，不是 backgroundColor
// - canvas：canvas 背景色无展示意义，对比无意义
const HARD_IGNORE_BACKGROUND_TYPES = new Set([
  'image',
  'img',
  'canvas',
])

// 软豁免：仅当"该侧节点"本身没有填充值（缺失或透明）时，才跳过该侧驱动的填充对比
const SOFT_IGNORE_BACKGROUND_TYPES = new Set([
  'button',
  'path',
  'divider',
  'progress',
  'swiperindicator',
  'icon',
  'video',
])

/**
 * 比对一对匹配节点的样式
 * @param {object} pair
 * @param {object} [opts]
 * @param {string} [opts.platform] 平台 key（hmPhone/hmWatch/web）；web 平台跳过 padding 比对
 * @returns {StyleDiff[]}
 */
export function compareStyles(pair, opts = {}) {
  const { design: dn, arkui: an, matchType } = pair
  const platform = opts.platform || 'hmPhone'
  const diffs = []
  const ds = dn.style || {}
  const as_ = an.style || {}

  const ctx = {
    nodeType:    dn.type,
    textContent: dn.textContent,
    designName:  dn.name,
    arkuiName:   an.name,
    matchType,
    confidence:  pair.confidence || 'medium',
    iou:         pair.iou ?? null,
    topologyScore: pair.topologyScore ?? null,
    regionScore: pair.regionScore ?? null,
  }
  // ── 文字节点属性 ──────────────────────────────────────────────────────────
  if (dn.type === 'text' && an.type === 'text') {
    if (!isTitlebarType(an)) {
      diffNumber(diffs, ctx, 'fontSize', ds.fontSize, as_.fontSize, 'dp/vp', TOLERANCE.fontSize, '字号', 2)
    }
    diffFontWeight(diffs, ctx, ds.fontWeight, as_.fontWeight)
    diffColor(diffs, ctx, 'fontColor',       ds.fontColor,   as_.fontColor,   '颜色')
    if (platform !== 'web') diffFontFamily(diffs, ctx, ds.fontFamily, as_.fontFamily)
    diffBlur(diffs, ctx, ds.blur, as_.blur, 'blur', '模糊')
    diffShadow(diffs, ctx, ds.shadow, as_.shadow)
    diffOpacity(diffs, ctx, ds.opacity, as_.opacity)
  }

  // ── 非文本节点属性 ────────────────────────────────────────────────────────
  if (dn.type !== 'text' && an.type !== 'text') {
    diffBackgroundColor(diffs, ctx, dn, an, ds.backgroundColor, as_.backgroundColor)
    diffBorderRadius(diffs, ctx, dn, an, ds.borderRadius, as_.borderRadius)
    diffBorder(diffs, ctx, ds.border, as_.border)
    diffOpacity(diffs, ctx, ds.opacity, as_.opacity)
    diffBlur(diffs, ctx, ds.blur, as_.blur, 'blur', '模糊')
    diffShadow(diffs, ctx, ds.shadow, as_.shadow)
  }

  return diffs
}

/**
 * 批量处理所有 pair，汇总结果
 * @param {Array} pairs
 * @param {object} [opts]
 * @param {string} [opts.platform] 平台 key，透传给 compareStyles
 */
export function compareAll(pairs, opts = {}) {
  const allDiffs = []
  for (const pair of pairs) {
    const diffs = compareStyles(pair, opts)
    for (const d of diffs) {
      allDiffs.push({ ...d, designNodeId: pair.design.id, arkuiNodeId: pair.arkui.id })
    }
  }
  return allDiffs
}

// ──────────────────────────────────────────────────────────────────────────────
// 各属性比较函数
// ──────────────────────────────────────────────────────────────────────────────

function diffNumber(diffs, ctx, prop, dv, av, unit, tol, label, errorThreshold) {
  if (dv === null || dv === undefined || av === null || av === undefined) return
  const delta = Math.abs(dv - av)
  if (delta > tol) {
    const errThresh = errorThreshold !== undefined ? errorThreshold : tol * 3
    diffs.push(makeDiff(ctx, prop, `${dv}${unit}`, `${av}${unit}`,
      delta > errThresh ? 'error' : 'warning',
      `${label}偏差 ${dv > av ? '+' : ''}${(dv - av).toFixed(1)}${unit}`))
  }
}

function diffFontWeight(diffs, ctx, dv, av) {
  if (dv === null || dv === undefined || av === null || av === undefined) return
  if (dv !== av) {
    diffs.push(makeDiff(ctx, 'fontWeight', String(dv), String(av), 'error', '字重不匹配'))
  }
}

function diffColor(diffs, ctx, prop, dv, av, label) {
  if (!dv && !av) return
  // 两者均透明，不报差异
  if ((!dv || dv === '#00000000') && (!av || av === '#00000000')) return
  if (!dv || !av) {
    diffs.push(makeDiff(ctx, prop, dv || '—', av || '—', 'warning', `${label}：一侧缺失`))
    return
  }
  const delta = colorDelta(dv, av)
  if (delta > TOLERANCE.colorDelta) {
    diffs.push(makeDiff(ctx, prop,
      `${dv} (${toDisplayColor(dv)})`,
      `${av} (${toDisplayColor(av)})`,
      null,
      `${label}不匹配 ΔE≈${delta.toFixed(0)}`
    ))
  }
}

function diffFontFamily(diffs, ctx, dv, av) {
  if (!dv || !av) return
  if (!isEquivalentFont(dv, av)) {
    diffs.push(makeDiff(ctx, 'fontFamily', dv, av, 'warning', '字体不匹配'))
  }
}

function diffTextAlign(diffs, ctx, dv, av) {
  if (!dv || !av) return
  if (dv !== av) {
    diffs.push(makeDiff(ctx, 'textAlign', dv, av, 'info', '文字对齐不匹配'))
  }
}

function diffOpacity(diffs, ctx, dv, av) {
  const d = normalizeOpacityValue(dv)
  const a = normalizeOpacityValue(av)
  if (d === null || a === null) return
  if (d === 0 || a === 0) return
  if (Math.abs(d - a) > TOLERANCE.opacity) {
    diffs.push(makeDiff(ctx, 'opacity', String(d), String(a), 'warning', `透明度偏差`))
  }
}

function diffBorderRadius(diffs, ctx, designNode, arkuiNode, dv, av) {
  if (!dv && !av) return
  if (isCircleOrEllipseLikeNode(designNode) && isCircleOrEllipseLikeNode(arkuiNode)) return
  if (normalizedNodeType(arkuiNode) === 'symbolglyph') return
  // 软豁免：开发侧 image 类型且开发侧无圆角值 → 跳过（Image 圆角由 clip 父节点裁剪实现，自身不设）
  if (normalizedNodeType(arkuiNode) === 'image' && !av) return
  if (!dv || !av) {
    diffs.push(makeDiff(ctx, 'borderRadius', formatRadius(dv), formatRadius(av), 'warning', '圆角：一侧缺失'))
    return
  }
  const keys = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']
  const dEffective = effectiveRadius(dv, designNode.size ?? designNode.rect)
  const aEffective = effectiveRadius(av, arkuiNode.rect)

  const mismatched = keys.filter(k => Math.abs((dEffective[k] || 0) - (aEffective[k] || 0)) > TOLERANCE.borderRadius)
  if (mismatched.length > 0) {
    diffs.push(makeDiff(ctx, 'borderRadius', formatRadius(dv), formatRadius(av), 'warning',
      `圆角不匹配（${mismatched.join(', ')}）`))
  }
}

function diffPadding(diffs, ctx, dv, av) {
  if (!dv && !av) return
  if (!dv || !av) return
  const keys = ['top', 'right', 'bottom', 'left']
  const mismatched = keys.filter(k => Math.abs((dv[k] || 0) - (av[k] || 0)) > TOLERANCE.padding)
  if (mismatched.length > 0) {
    diffs.push(makeDiff(ctx, 'padding', formatPadding(dv), formatPadding(av), 'warning',
      `内边距不匹配（${mismatched.join(', ')}）`))
  }
}

function diffBlur(diffs, ctx, dv, av, prop = 'blur', label = '模糊') {
  if (!dv && !av) return

  if (dv && !av) {
    diffs.push(makeDiff(ctx, prop, dv, '—', 'warning', `${label}：实现缺失`))
    return
  }

  if (!dv || !av) return

  const parseBlur = s => {
    const m = String(s).match(/^(背景模糊|高斯模糊)\s+([\d.]+)px$/)
    return m ? { type: m[1], value: parseFloat(m[2]) } : null
  }
  const d = parseBlur(dv), a = parseBlur(av)

  if (!d || !a) {
    diffs.push(makeDiff(ctx, prop, dv, av, 'warning', `${label}格式异常`))
    return
  }
  if (d.type !== a.type) {
    diffs.push(makeDiff(ctx, prop, dv, av, 'warning', `${label}类型不匹配`))
    return
  }
  if (d.value !== a.value) {
    diffs.push(makeDiff(ctx, prop, dv, av, 'warning',
      `${label}偏差 ${(d.value - a.value).toFixed(1)}px`))
  }
}

function diffShadow(diffs, ctx, dv, av) {
  if (!dv && !av) return

  if (dv && !av) {
    diffs.push(makeDiff(ctx, 'shadow', dv, '—', 'warning', '投影：实现缺失'))
    return
  }

  if (!dv || !av) return

  const parseShadow = s => {
    const m = String(s).match(
      /^(外阴影|内阴影)\s+(\S+)\s+([\d.]+)px\s+X:([-\d.]+),\s*Y:([-\d.]+)$/
    )
    return m
      ? { type: m[1], color: m[2], radius: parseFloat(m[3]), offsetX: parseFloat(m[4]), offsetY: parseFloat(m[5]) }
      : null
  }
  const d = parseShadow(dv), a = parseShadow(av)

  if (!d || !a) {
    diffs.push(makeDiff(ctx, 'shadow', dv, av, 'warning', '投影格式异常'))
    return
  }
  const issues = []
  if (d.type !== a.type) issues.push('类型不匹配')
  if (d.radius !== a.radius) issues.push(`radius偏差 ${(d.radius - a.radius).toFixed(1)}px`)
  if (d.offsetX !== a.offsetX || d.offsetY !== a.offsetY) issues.push('偏移偏差')
  if (issues.length > 0) {
    diffs.push(makeDiff(ctx, 'shadow', dv, av, 'warning', `投影不匹配：${issues.join('，')}`))
  }
}

function diffBorder(diffs, ctx, dv, av) {
  if (!dv && !av) return
  const dw = dv?.width
  const aw = av?.width
  const widthDelta = Math.abs((dw ?? 0) - (aw ?? 0))
  if (dw == null && aw == null) {
    // 两边都没有描边宽度，按规则忽略。
  } else if (dw == null || aw == null) {
    diffs.push(makeDiff(ctx, 'borderWidth', formatBorderWidth(dv), formatBorderWidth(av), 'warning', '描边宽度：一侧缺失'))
  } else if (widthDelta > 0) {
    diffs.push(makeDiff(ctx, 'borderWidth', `${dw}dp`, `${aw}vp`,
      widthDelta > 2 ? 'error' : 'warning',
      `描边宽度偏差 ${(dw - aw).toFixed(1)}`))
  }
  diffColor(diffs, ctx, 'borderColor', dv?.color, av?.color, '描边颜色')
}

function parseGradient(str) {
  if (!str || typeof str !== 'string' || !str.startsWith('linear-gradient(')) return null
  try {
    const inner = str.slice('linear-gradient('.length, -1)
    const parts = inner.split(',').map(s => s.trim())
    if (parts.length < 2) return null

    const angle = parseFloat(parts[0])
    if (!Number.isFinite(angle)) return null

    const stops = []
    for (let i = 1; i < parts.length; i++) {
      const tokens = parts[i].split(/\s+/)
      const color = tokens[0]
      const positionStr = tokens[1]
      const position = parseFloat(positionStr)
      if (!Number.isFinite(position)) continue
      stops.push({ color, position })
    }

    if (stops.length === 0) return null
    return { type: 'linear', angle, stops }
  } catch {
    return null
  }
}

function diffGradient(diffs, ctx, dGrad, aGrad, dv, av) {
  if (!dGrad && !aGrad) return

  // 只有一侧是渐变
  if (!dGrad || !aGrad) {
    const desc = dGrad
      ? '填充：设计侧为渐变色，开发侧为纯色'
      : '填充：设计侧为纯色，开发侧为渐变色'
    diffs.push(makeDiff(ctx, 'backgroundColor', dv || '—', av || '—', 'warning', desc))
    return
  }

  const issues = []

  // 比较角度 (±5°容差)
  if (Math.abs(dGrad.angle - aGrad.angle) > 5) {
    issues.push(`角度 ${dGrad.angle}° vs ${aGrad.angle}°`)
  }

  // 比较停止点数量
  if (dGrad.stops.length !== aGrad.stops.length) {
    issues.push(`节点数 ${dGrad.stops.length} vs ${aGrad.stops.length}`)
  }

  // 逐个比较停止点
  const len = Math.min(dGrad.stops.length, aGrad.stops.length)
  for (let i = 0; i < len; i++) {
    const ds = dGrad.stops[i]
    const as = aGrad.stops[i]

    const delta = colorDelta(ds.color, as.color)
    if (delta > TOLERANCE.colorDelta) {
      issues.push(`节点${i + 1}颜色不匹配`)
    }

    if (Math.abs(ds.position - as.position) > 2) {
      issues.push(`节点${i + 1}位置 ${ds.position}% vs ${as.position}%`)
    }
  }

  if (issues.length > 0) {
    diffs.push(makeDiff(ctx, 'backgroundColor',
      dv,
      av,
      'warning',
      `渐变不匹配: ${issues.join('; ')}`
    ))
  }
}

function diffBackgroundColor(diffs, ctx, designNode, arkuiNode, dv, av) {
  // 规则 1：任一侧是 image / img → 无条件忽略填充对比
  if (isHardIgnoreBackgroundNode(designNode) || isHardIgnoreBackgroundNode(arkuiNode)) {
    return
  }

  const dHasValue = dv && !isTransparentColor(dv)
  const aHasValue = av && !isTransparentColor(av)

  // 规则 2：该侧是软豁免类型且该侧无填充值 → 跳过（按侧豁免）
  if (isSoftIgnoreBackgroundNode(designNode) && !dHasValue) return
  if (isSoftIgnoreBackgroundNode(arkuiNode) && !aHasValue) return

  // 规则 3：开发侧是 symbolglyph → 必须两侧均有非透明填充才对比，否则忽略
  if (normalizedNodeType(arkuiNode) === 'symbolglyph') {
    if (!dHasValue || !aHasValue) return
  }

  // 检查是否为渐变色
  const dGrad = parseGradient(dv)
  const aGrad = parseGradient(av)

  // 如果任一侧是渐变色，走渐变比较逻辑
  if (dGrad || aGrad) {
    diffGradient(diffs, ctx, dGrad, aGrad, dv, av)
    return
  }

  // 原有纯色逻辑
  const d = comparableBackground(dv)
  const a = comparableBackground(av)
  if (!d || !a) return
  const delta = colorDelta(d, a)
  if (delta > TOLERANCE.colorDelta) {
    diffs.push(makeDiff(ctx, 'backgroundColor',
      `${d} (${toDisplayColor(d)})`,
      `${a} (${toDisplayColor(a)})`,
      null,
      `填充不匹配 ΔE≈${delta.toFixed(0)}`
    ))
  }
}

function diffItemSpacing(diffs, ctx, dv, av) {
  if (dv === null || dv === undefined) return
  if (av === null || av === undefined) {
    if (dv > 0) {
      diffs.push(makeDiff(ctx, 'itemSpacing', `${dv}dp`, '—', 'warning', '元素间距：实现缺失'))
    }
    return
  }
  const delta = Math.abs(dv - av)
  if (delta > 1.0) {
    diffs.push(makeDiff(ctx, 'itemSpacing', `${dv}dp`, `${av}vp`,
      delta > 4 ? 'error' : 'warning',
      `元素间距偏差 ${(dv - av).toFixed(1)}`))
  }
}

function diffFontScale(diffs, ctx, fontSize, actualFontSize) {
  if (!fontSize || !actualFontSize) return
  const ratio = actualFontSize / fontSize
  if (Math.abs(ratio - 1.0) > 0.1) {
    diffs.push(makeDiff(ctx, 'fontSize.scale',
      `${fontSize}fp`, `${actualFontSize.toFixed(1)}vp`,
      Math.abs(ratio - 1.0) > 0.25 ? 'error' : 'warning',
      `系统字体缩放比 ${(ratio * 100).toFixed(0)}%，需设置 maxFontScale`))
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 工厂函数
// ──────────────────────────────────────────────────────────────────────────────

function makeDiff(ctx, property, designValue, arkuiValue, _severity, description) {
  // severity 不再按差异大小分级，统一按匹配置信度决定：
  //   低置信匹配  → warning（前端"模糊比对"tab）
  //   中/高置信  → error  （前端"精准检查"tab）
  // 调用方传入的 severity 参数被忽略，仅保留签名向后兼容。
  const severity = ctx.confidence === 'low' ? 'warning' : 'error'
  return {
    property,
    designValue,
    arkuiValue,
    severity,
    description,
    nodeType:    ctx.nodeType,
    textContent: ctx.textContent || null,
    designName:  ctx.designName,
    arkuiName:   ctx.arkuiName,
    matchType:   ctx.matchType,
    confidence:  ctx.confidence,
    iou:         ctx.iou,
    topologyScore: ctx.topologyScore,
    regionScore: ctx.regionScore,
  }
}

function comparableBackground(color) {
  if (!color || isTransparentColor(color)) return null
  return color
}

function isTransparentColor(color) {
  const c = parseColor(color)
  return !!c && c.a === 0
}

function parseColor(color) {
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

function isCircleOrEllipseLikeNode(node) {
  const rawType = normalizedNodeType(node)
  return /^(circle|ellipse)$/i.test(rawType)
}

function isTitlebarType(node) {
  return normalizedNodeType(node) === 'titlebar' || node?.compType === 'titlebar'
}

function isHardIgnoreBackgroundNode(node) {
  if (!node) return false
  return HARD_IGNORE_BACKGROUND_TYPES.has(normalizedNodeType(node))
}

function isSoftIgnoreBackgroundNode(node) {
  if (!node) return false
  return SOFT_IGNORE_BACKGROUND_TYPES.has(normalizedNodeType(node))
}

function normalizedNodeType(node) {
  return String(node?.rawType || node?.type || '').toLowerCase()
}

function effectiveRadius(radius, rect) {
  const cap = maxRenderableRadius(rect)
  return {
    topLeft: Math.min(radius.topLeft || 0, cap),
    topRight: Math.min(radius.topRight || 0, cap),
    bottomRight: Math.min(radius.bottomRight || 0, cap),
    bottomLeft: Math.min(radius.bottomLeft || 0, cap),
  }
}

function maxRenderableRadius(rect) {
  return Math.max(0, Math.min(rect?.w || 0, rect?.h || 0) / 2)
}

function formatRadius(r) {
  if (!r) return '0'
  const { topLeft: tl = 0, topRight: tr = 0, bottomRight: br = 0, bottomLeft: bl = 0 } = r
  return tl === tr && tr === br && br === bl ? `${tl}vp` : `${tl}/${tr}/${br}/${bl}vp`
}

function formatPadding(p) {
  if (!p) return '0'
  return `T:${p.top} R:${p.right} B:${p.bottom} L:${p.left}`
}

function formatBorderWidth(border) {
  if (!border || border.width == null) return '—'
  return `${border.width}dp`
}

function normalizeOpacityValue(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
