/**
 * 样式比对器
 * 对每对匹配节点逐属性对比，生成结构化差异列表
 */

import { colorDelta, toDisplayColor } from '../utils/colorUtils.js'
import { isEquivalentFont } from '../utils/unitUtils.js'

// 容差配置（单位 vp 或绝对值）
const TOLERANCE = {
  fontSize:      0.5,
  lineHeight:    0.5,
  letterSpacing: 0.5,
  borderRadius:  1.0,
  padding:       1.0,
  opacity:       0.02,
  blur:          2.0,
  shadowRadius:  2.0,
  shadowOffset:  1.0,
  colorDelta:    8,    // 颜色欧氏距离（0-442 范围）
}

const BACKGROUND_IGNORE_TYPES = new Set([
  'button',
  'path',
  'divider',
  'progress',
  'swiperindicator',
  'icon',
  'image',
  'img',
  'video',
  'canvas',
])

/**
 * 比对一对匹配节点的样式
 * @returns {StyleDiff[]}
 */
export function compareStyles(pair) {
  const { design: dn, arkui: an, matchType } = pair
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
      diffNumber(diffs, ctx, 'fontSize', ds.fontSize, as_.fontSize, 'dp/vp', TOLERANCE.fontSize, '字号')
    }
    diffFontWeight(diffs, ctx, ds.fontWeight, as_.fontWeight)
    diffColor(diffs, ctx, 'fontColor',       ds.fontColor,   as_.fontColor,   '颜色')
    diffFontFamily(diffs, ctx, ds.fontFamily, as_.fontFamily)
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
 */
export function compareAll(pairs) {
  const allDiffs = []
  for (const pair of pairs) {
    const diffs = compareStyles(pair)
    for (const d of diffs) {
      allDiffs.push({ ...d, designNodeId: pair.design.id, arkuiNodeId: pair.arkui.id })
    }
  }
  return allDiffs
}

// ──────────────────────────────────────────────────────────────────────────────
// 各属性比较函数
// ──────────────────────────────────────────────────────────────────────────────

function diffNumber(diffs, ctx, prop, dv, av, unit, tol, label) {
  if (dv === null || dv === undefined || av === null || av === undefined) return
  const delta = Math.abs(dv - av)
  if (delta > tol) {
    diffs.push(makeDiff(ctx, prop, `${dv}${unit}`, `${av}${unit}`,
      delta > tol * 3 ? 'error' : 'warning',
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
    const severity = delta > 40 ? 'error' : 'warning'
    diffs.push(makeDiff(ctx, prop,
      `${dv} (${toDisplayColor(dv)})`,
      `${av} (${toDisplayColor(av)})`,
      severity,
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
  if (!dv || !av) {
    diffs.push(makeDiff(ctx, 'borderRadius', formatRadius(dv), formatRadius(av), 'warning', '圆角：一侧缺失'))
    return
  }
  const keys = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']
  const dEffective = effectiveRadius(dv, designNode.rect)
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

function diffBlur(diffs, ctx, dv, av, prop = 'backdropBlur', label = '背景模糊') {
  if (dv === undefined && av === undefined) return
  if (!dv && !av) return
  const d = dv || 0, a = av || 0
  if (Math.abs(d - a) > TOLERANCE.blur) {
    diffs.push(makeDiff(ctx, prop, `${d}`, `${a}`, 'warning', `${label}偏差 ${(d-a).toFixed(1)}`))
  }
}

function diffShadow(diffs, ctx, dv, av) {
  if (!dv && !av) return
  if (dv && !av) {
    diffs.push(makeDiff(ctx, 'shadow', `radius:${dv.radius}`, '—', 'warning', '投影：实现缺失'))
    return
  }
  if (!dv || !av) return
  if (Math.abs(dv.radius - av.radius) > TOLERANCE.shadowRadius) {
    diffs.push(makeDiff(ctx, 'shadow.radius', String(dv.radius), String(av.radius), 'warning', '投影模糊半径偏差'))
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
  } else if (widthDelta > 0.5) {
    diffs.push(makeDiff(ctx, 'borderWidth', `${dw}dp`, `${aw}vp`,
      widthDelta > 2 ? 'error' : 'warning',
      `描边宽度偏差 ${(dw - aw).toFixed(1)}`))
  }
  diffColor(diffs, ctx, 'borderColor', dv?.color, av?.color, '描边颜色')
}

function diffBackgroundColor(diffs, ctx, designNode, arkuiNode, dv, av) {
  if (shouldIgnoreBackgroundColorNode(designNode) || shouldIgnoreBackgroundColorNode(arkuiNode)) {
    return
  }
  const d = comparableBackground(dv)
  const a = comparableBackground(av)
  if (!d && !a) return
  if (!d || !a) {
    diffs.push(makeDiff(ctx, 'backgroundColor', d || '—', a || '—', 'warning', '填充：一侧缺失'))
    return
  }
  const delta = colorDelta(d, a)
  if (delta > TOLERANCE.colorDelta) {
    const severity = delta > 40 ? 'error' : 'warning'
    diffs.push(makeDiff(ctx, 'backgroundColor',
      `${d} (${toDisplayColor(d)})`,
      `${a} (${toDisplayColor(a)})`,
      severity,
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

function makeDiff(ctx, property, designValue, arkuiValue, severity, description) {
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
  return normalizedNodeType(node) === 'titlebar'
}

function shouldIgnoreBackgroundColorNode(node) {
  if (!node) return false
  const rawType = normalizedNodeType(node)
  return BACKGROUND_IGNORE_TYPES.has(rawType)
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
