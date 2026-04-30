import { rectCenter } from '../matchers/matchGeometry.js'

/**
 * 空间关系差异
 * 只比较已经匹配成功的图层关系，优先看兄弟节点，其次看父子节点。
 * 返回的 diff 带有 relationRects，供前端高亮两层之间的空间。
 */
export function compareSpatialRelations(pairs) {
  const pairByDesignPath = new Map()
  const pairByArkuiPath = new Map()

  for (const pair of pairs) {
    if (Array.isArray(pair.design?.path)) pairByDesignPath.set(pathKey(pair.design.path), pair)
    if (Array.isArray(pair.arkui?.path)) pairByArkuiPath.set(pathKey(pair.arkui.path), pair)
  }

  const groups = new Map()
  for (const pair of pairs) {
    const parentPair = getMatchedParentPair(pair, pairByDesignPath, pairByArkuiPath)
    if (!parentPair) continue
    const key = `${parentPair.design.id}::${parentPair.arkui.id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(pair)
  }

  const diffs = []
  for (const group of groups.values()) {
    const siblings = [...group].sort((a, b) => {
      const dp = (a.design.paintIndex ?? 0) - (b.design.paintIndex ?? 0)
      if (dp !== 0) return dp
      return (a.design.path?.length ?? 0) - (b.design.path?.length ?? 0)
    })

    if (siblings.length >= 2) {
      diffs.push(...compareSiblingRelations(siblings))
    } else if (siblings.length === 1) {
      const parentPair = getMatchedParentPair(siblings[0], pairByDesignPath, pairByArkuiPath)
      if (parentPair) {
        const diff = compareParentChildRelation(parentPair, siblings[0])
        if (diff) diffs.push(diff)
      }
    }
  }

  return diffs
}

function compareSiblingRelations(siblings) {
  const diffs = []
  for (let i = 0; i < siblings.length - 1; i++) {
    const left = siblings[i]
    const right = siblings[i + 1]
    const axis = dominantAxis(left.design.rect, right.design.rect)
    const d = relationMetrics(left.design.rect, right.design.rect, axis)
    const a = relationMetrics(left.arkui.rect, right.arkui.rect, axis)

    const gapDelta = Math.abs(d.gap - a.gap)
    const alignDelta = Math.abs(d.crossOffset - a.crossOffset)

    if (gapDelta > 0.015 || alignDelta > 0.02) {
      diffs.push(makeSpatialDiff({
        property: axis === 'horizontal' ? 'spacing.horizontal' : 'spacing.vertical',
        severity: gapDelta > 0.03 ? 'warning' : 'info',
        description: axis === 'horizontal'
          ? `兄弟节点横向间距偏差 ${toVpDelta(d.gap - a.gap)}`
          : `兄弟节点纵向间距偏差 ${toVpDelta(d.gap - a.gap)}`,
        designValue: formatRelationValue(d),
        arkuiValue: formatRelationValue(a),
        designNodeId: left.design.id,
        arkuiNodeId: left.arkui.id,
        relatedDesignNodeId: right.design.id,
        relatedArkuiNodeId: right.arkui.id,
        designName: left.design.name,
        arkuiName: left.arkui.name,
        relatedDesignName: right.design.name,
        relatedArkuiName: right.arkui.name,
        relationKind: 'sibling',
        relationAxis: axis,
        relationRects: {
          design: [left.design.rect, right.design.rect],
          arkui: [left.arkui.rect, right.arkui.rect],
          axis,
        },
      }))
    }

    const alignDiff = Math.abs(d.crossOffset - a.crossOffset)
    if (alignDiff > 0.03) {
      diffs.push(makeSpatialDiff({
        property: axis === 'horizontal' ? 'alignment.vertical' : 'alignment.horizontal',
        severity: 'info',
        description: axis === 'horizontal'
          ? `兄弟节点纵向对齐偏差 ${toVpDelta(d.crossOffset - a.crossOffset)}`
          : `兄弟节点横向对齐偏差 ${toVpDelta(d.crossOffset - a.crossOffset)}`,
        designValue: formatAlignValue(d),
        arkuiValue: formatAlignValue(a),
        designNodeId: left.design.id,
        arkuiNodeId: left.arkui.id,
        relatedDesignNodeId: right.design.id,
        relatedArkuiNodeId: right.arkui.id,
        designName: left.design.name,
        arkuiName: left.arkui.name,
        relatedDesignName: right.design.name,
        relatedArkuiName: right.arkui.name,
        relationKind: 'sibling',
        relationAxis: axis,
        relationRects: {
          design: [left.design.rect, right.design.rect],
          arkui: [left.arkui.rect, right.arkui.rect],
          axis,
        },
      }))
    }
  }
  return diffs
}

function compareParentChildRelation(parentPair, childPair) {
  const d = parentChildMetrics(parentPair.design.rect, childPair.design.rect)
  const a = parentChildMetrics(parentPair.arkui.rect, childPair.arkui.rect)
  const insetDelta = Math.max(
    Math.abs(d.left - a.left),
    Math.abs(d.top - a.top),
    Math.abs(d.right - a.right),
    Math.abs(d.bottom - a.bottom),
  )
  if (insetDelta <= 0.02) return null
  return makeSpatialDiff({
    property: 'spacing.parent-child',
    severity: insetDelta > 0.05 ? 'warning' : 'info',
    description: `父子层内边距/对齐偏差 ${toVpDelta(insetDelta)}`,
    designValue: formatInsetValue(d),
    arkuiValue: formatInsetValue(a),
    designNodeId: parentPair.design.id,
    arkuiNodeId: parentPair.arkui.id,
    relatedDesignNodeId: childPair.design.id,
    relatedArkuiNodeId: childPair.arkui.id,
    designName: parentPair.design.name,
    arkuiName: parentPair.arkui.name,
    relatedDesignName: childPair.design.name,
    relatedArkuiName: childPair.arkui.name,
    relationKind: 'parent-child',
    relationAxis: 'mixed',
    relationRects: {
      design: [parentPair.design.rect, childPair.design.rect],
      arkui: [parentPair.arkui.rect, childPair.arkui.rect],
      axis: 'mixed',
    },
  })
}

function getMatchedParentPair(pair, pairByDesignPath, pairByArkuiPath) {
  const dParent = parentPath(pair.design.path)
  const aParent = parentPath(pair.arkui.path)
  if (!dParent || !aParent) return null
  const dParentPair = pairByDesignPath.get(pathKey(dParent))
  const aParentPair = pairByArkuiPath.get(pathKey(aParent))
  if (!dParentPair || !aParentPair) return null
  if (dParentPair.design.id !== aParentPair.design.id || dParentPair.arkui.id !== aParentPair.arkui.id) return null
  return dParentPair
}

function relationMetrics(a, b, axis) {
  if (axis === 'horizontal') {
    return {
      gap: Math.max(0, b.x - (a.x + a.w)),
      crossOffset: Math.abs(rectCenter(a).y - rectCenter(b).y),
    }
  }
  return {
    gap: Math.max(0, b.y - (a.y + a.h)),
    crossOffset: Math.abs(rectCenter(a).x - rectCenter(b).x),
  }
}

function parentChildMetrics(parent, child) {
  return {
    left: child.x - parent.x,
    top: child.y - parent.y,
    right: (parent.x + parent.w) - (child.x + child.w),
    bottom: (parent.y + parent.h) - (child.y + child.h),
  }
}

function dominantAxis(a, b) {
  const horizontalOverlap = overlapRatio(a.y, a.h, b.y, b.h)
  const verticalOverlap = overlapRatio(a.x, a.w, b.x, b.w)
  return horizontalOverlap >= verticalOverlap ? 'horizontal' : 'vertical'
}

function overlapRatio(aStart, aSize, bStart, bSize) {
  const aEnd = aStart + aSize
  const bEnd = bStart + bSize
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
  const basis = Math.min(aSize, bSize) || 1
  return overlap / basis
}

function makeSpatialDiff(payload) {
  return {
    property: payload.property,
    designValue: payload.designValue,
    arkuiValue: payload.arkuiValue,
    severity: payload.severity,
    description: payload.description,
    designNodeId: payload.designNodeId,
    arkuiNodeId: payload.arkuiNodeId,
    relatedDesignNodeId: payload.relatedDesignNodeId,
    relatedArkuiNodeId: payload.relatedArkuiNodeId,
    designName: payload.designName,
    arkuiName: payload.arkuiName,
    relatedDesignName: payload.relatedDesignName,
    relatedArkuiName: payload.relatedArkuiName,
    relationKind: payload.relationKind,
    relationAxis: payload.relationAxis,
    relationRects: payload.relationRects,
  }
}

function formatRelationValue(metrics) {
  return `gap:${toVpDelta(metrics.gap)} cross:${toVpDelta(metrics.crossOffset)}`
}

function formatAlignValue(metrics) {
  return `cross:${toVpDelta(metrics.crossOffset)}`
}

function formatInsetValue(metrics) {
  return `l:${toVpDelta(metrics.left)} t:${toVpDelta(metrics.top)} r:${toVpDelta(metrics.right)} b:${toVpDelta(metrics.bottom)}`
}

function toVpDelta(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}vp`
}

function parentPath(path) {
  if (!Array.isArray(path) || path.length < 2) return null
  return path.slice(0, -1)
}

function pathKey(path) {
  return Array.isArray(path) ? path.join('.') : ''
}
