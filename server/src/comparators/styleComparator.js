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
    visualScore: pair.visualScore ?? null,
  }

  // ── 文字节点属性 ──────────────────────────────────────────────────────────
  if (dn.type === 'text' && an.type === 'text') {
    diffNumber(diffs, ctx, 'fontSize',      ds.fontSize,    as_.fontSize,    'dp/vp', TOLERANCE.fontSize,     '字号')
    diffFontWeight(diffs, ctx, ds.fontWeight, as_.fontWeight)
    diffColor(diffs, ctx, 'fontColor',       ds.fontColor,   as_.fontColor,   '字色')
    diffFontFamily(diffs, ctx, ds.fontFamily, as_.fontFamily)
    diffTextAlign(diffs, ctx,  ds.textAlign,  as_.textAlign)
    if (ds.lineHeight && as_.lineHeight) {
      diffNumber(diffs, ctx, 'lineHeight', ds.lineHeight, as_.lineHeight, 'vp', TOLERANCE.lineHeight, '行高')
    }
    if (ds.letterSpacing !== null && as_.letterSpacing !== null) {
      diffNumber(diffs, ctx, 'letterSpacing', ds.letterSpacing, as_.letterSpacing, 'px', TOLERANCE.letterSpacing, '字间距')
    }
  }

  // ── 通用属性（文字 + 容器都有）────────────────────────────────────────────
  diffOpacity(diffs, ctx, ds.opacity, as_.opacity)
  diffColor(diffs, ctx, 'backgroundColor', comparableBackground(ds.backgroundColor), comparableBackground(as_.backgroundColor), '背景色')
  diffBorderRadius(diffs, ctx, dn, an, ds.borderRadius, as_.borderRadius)
  diffPadding(diffs, ctx, ds.padding, as_.padding)
  diffBlur(diffs, ctx, ds.backdropBlur, as_.backdropBlur)
  diffShadow(diffs, ctx, ds.shadow, as_.shadow)

  // ── 新增维度 ──────────────────────────────────────────────────────────────
  diffBorder(diffs, ctx, ds.border, as_.border)
  diffItemSpacing(diffs, ctx, ds.itemSpacing, as_.itemSpacing)
  diffGradient(diffs, ctx, ds.gradient, as_.gradient)

  // 字体缩放（纯 ArkUI 侧检查：实际渲染字号 vs 声明字号）
  if (an.type === 'text') {
    diffFontScale(diffs, ctx, as_.declaredFontSize, as_.actualFontSize)
  }

  // 图标/图片尺寸 + 内容校验
  if (dn.type === 'image' || an.type === 'image') {
    const dw = dn.rect.w, dh = dn.rect.h
    const aw = an.rect.w, ah = an.rect.h
    if (Math.abs(dw - aw) > 2 || Math.abs(dh - ah) > 2) {
      diffs.push(makeDiff(ctx, 'icon.size',
        `${dw.toFixed(0)}×${dh.toFixed(0)}dp`,
        `${aw.toFixed(0)}×${ah.toFixed(0)}vp`,
        'info', '图标尺寸不匹配'))
    }
    if (as_.iconContent) {
      diffs.push(makeDiff(ctx, 'icon.content', dn.name, as_.iconContent, 'info',
        `图标资源：设计层"${dn.name}" | ArkUI unicode ${as_.iconContent}`))
    }
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
    // 一方有颜色一方没有
    if (dv && !av) {
      diffs.push(makeDiff(ctx, prop, dv, '—', 'warning', `${label}：实现缺失`))
    }
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
    diffs.push(makeDiff(ctx, 'fontFamily', dv, av, 'warning', '字体族不匹配'))
  }
}

function diffTextAlign(diffs, ctx, dv, av) {
  if (!dv || !av) return
  if (dv !== av) {
    diffs.push(makeDiff(ctx, 'textAlign', dv, av, 'info', '文字对齐不匹配'))
  }
}

function diffOpacity(diffs, ctx, dv, av) {
  if (dv === null || dv === undefined || av === null || av === undefined) return
  if (Math.abs(dv - av) > TOLERANCE.opacity) {
    diffs.push(makeDiff(ctx, 'opacity', String(dv), String(av), 'warning', `透明度偏差`))
  }
}

function diffBorderRadius(diffs, ctx, designNode, arkuiNode, dv, av) {
  if (!dv && !av) return
  if (!dv || !av) {
    if (dv && !av) {
      const r = Object.values(dv).find(v => v > 0)
      if (!r) return
      if (isVisuallyFullRound(designNode, dv) && isRoundShapeNode(arkuiNode)) return
      const layerLikeSeverity = mayUseLayerImplementedRadius(ctx, designNode, arkuiNode) ? 'info' : 'warning'
      const description = layerLikeSeverity === 'info'
        ? '圆角：实现可能由裁剪、图片或独立图层完成，未在当前节点暴露 borderRadius'
        : '圆角：当前节点未暴露实现值'
      diffs.push(makeDiff(ctx, 'borderRadius', formatRadius(dv), '0', layerLikeSeverity, description))
    }
    return
  }
  const keys = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']
  const dEffective = effectiveRadius(dv, designNode.rect)
  const aEffective = effectiveRadius(av, arkuiNode.rect)
  if (isVisuallyFullRound(designNode, dv) && isVisuallyFullRound(arkuiNode, av)) return

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

function diffBlur(diffs, ctx, dv, av) {
  if (dv === undefined && av === undefined) return
  if (!dv && !av) return
  const d = dv || 0, a = av || 0
  if (Math.abs(d - a) > TOLERANCE.blur) {
    diffs.push(makeDiff(ctx, 'backdropBlur', `${d}`, `${a}`, 'warning', `背景模糊偏差 ${(d-a).toFixed(1)}`))
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
  if (dv && !av) {
    diffs.push(makeDiff(ctx, 'border', `${dv.width}dp ${dv.color}`, '—', 'error', '描边：实现缺失'))
    return
  }
  if (!dv && av) return  // ArkUI 有默认描边但设计无，忽略
  const widthDelta = Math.abs(dv.width - av.width)
  if (widthDelta > 0.5) {
    diffs.push(makeDiff(ctx, 'border.width', `${dv.width}dp`, `${av.width}vp`,
      widthDelta > 2 ? 'error' : 'warning',
      `描边宽度偏差 ${(dv.width - av.width).toFixed(1)}`))
  }
  diffColor(diffs, ctx, 'border.color', dv.color, av.color, '描边色')
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

function diffGradient(diffs, ctx, dv, av) {
  if (!dv && !av) return
  if (dv && !av) {
    diffs.push(makeDiff(ctx, 'gradient', formatGradient(dv), '—', 'warning', '渐变：实现缺失'))
    return
  }
  if (!dv || !av) return
  const dvStops = dv.stops || []
  const avStops = av.stops || []
  if (dvStops.length !== avStops.length) {
    diffs.push(makeDiff(ctx, 'gradient', formatGradient(dv), formatGradient(av), 'warning',
      `渐变色标数量不匹配（设计:${dvStops.length} 实现:${avStops.length}）`))
    return
  }
  let mismatchIdx = -1
  for (let i = 0; i < dvStops.length; i++) {
    if (colorDelta(dvStops[i].color, avStops[i].color) > TOLERANCE.colorDelta) {
      mismatchIdx = i
      break
    }
  }
  if (mismatchIdx >= 0) {
    diffs.push(makeDiff(ctx, 'gradient', formatGradient(dv), formatGradient(av),
      'warning', `渐变第 ${mismatchIdx + 1} 个色标不匹配`))
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
    visualScore: ctx.visualScore,
  }
}

function comparableBackground(color) {
  if (!color || isTransparentColor(color) || isPureWhiteColor(color)) return null
  return color
}

function isTransparentColor(color) {
  const c = parseColor(color)
  return !!c && c.a === 0
}

function isPureWhiteColor(color) {
  const c = parseColor(color)
  return !!c && c.r === 255 && c.g === 255 && c.b === 255
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

function isRoundShapeNode(node) {
  return /^(circle|ellipse)$/i.test(String(node?.name || '')) || node?.type === 'shape'
}

function mayUseLayerImplementedRadius(ctx, designNode, arkuiNode) {
  if (ctx.visualScore != null && ctx.visualScore >= 0.55) return true
  if (['image', 'shape', 'other'].includes(designNode?.type) || ['image', 'shape', 'other'].includes(arkuiNode?.type)) return true
  return ['image-geometry', 'shape-geometry', 'other-geometry', 'gradient-iou'].includes(ctx.matchType)
}

function isVisuallyFullRound(node, radius) {
  if (!radius || !node?.rect) return false
  const cap = maxRenderableRadius(node.rect)
  if (cap <= 0) return false
  return Object.values(effectiveRadius(radius, node.rect)).every(v => Math.abs(v - cap) <= TOLERANCE.borderRadius)
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

function formatGradient(g) {
  if (!g) return '—'
  const stops = (g.stops || []).map(s => s.color).join(' → ')
  return `${g.type}(${stops})`
}
