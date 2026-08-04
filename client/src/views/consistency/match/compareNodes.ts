/** 前端节点样式对比（用于 edit 模式人工 diff 卡片的生成与格式化） */

import { toWebColorDisplay } from '../../utils/tools'

export interface SimpleNode {
  id: string
  type: 'text' | 'container'
  rawType?: string
  textContent?: string
  name?: string
  style?: Record<string, any>
  manualStyle?: Record<string, any>
  rect?: { w: number; h: number }
  size?: { w: number; h: number }
}

// ── 人工属性对比（edit 模式）────────────────────────────────────────────────────

export interface ManualStyleDiff {
  property:      string
  designValue:   string
  arkuiValue:    string
  severity:      'error' | 'warning'
  confidence:    'high' | 'medium' | 'low'
  designNodeId:  string | null
  arkuiNodeId:   string | null
  _isManual:     true
  diffSource:    string
  textContent:   string
  designName?:   string
}

const COLOR_KEY_SET = new Set(['fontColor', 'backgroundColor', 'borderColor'])

/**
 * 读取节点某属性的有效值：manualStyle 优先 → 原始 style 兜底。
 * borderWidth / borderColor 自动处理 style.border 嵌套。
 */
export function readStyleValue(node: SimpleNode | undefined | null, key: string): any {
  if (!node) return undefined
  if (node.manualStyle?.[key] !== undefined) return node.manualStyle[key]
  if (!node.style) return undefined
  if (key === 'borderWidth') return node.style.border?.width
  if (key === 'borderColor') return node.style.border?.color
  return node.style[key]
}

/**
 * 将原始风格值格式化为用于 diff 卡片展示的字符串。
 */
export function formatStyleValue(key: string, val: any, platform: string): string {
  if (val == null || val === '') return '—'
  if (typeof val === 'object') {
    if (key === 'borderRadius') {
      const { topLeft = 0, topRight = 0, bottomRight = 0, bottomLeft = 0 } = val
      return topLeft === topRight && topRight === bottomRight && bottomRight === bottomLeft
        ? String(topLeft) : `${topLeft}/${topRight}/${bottomRight}/${bottomLeft}`
    }
    if (key === 'padding') {
      const { top = 0, right = 0, bottom = 0, left = 0 } = val
      return top === right && right === bottom && bottom === left
        ? String(top) : `${top}/${right}/${bottom}/${left}`
    }
    return JSON.stringify(val)
  }
  if (COLOR_KEY_SET.has(key)) {
    return toWebColorDisplay(String(val), platform)
  }
  return String(val)
}

/**
 * 为匹配对中指定的属性生成人工覆盖差异卡片。
 * 返回值相等时返回 null（表示无需展示差异）。
 */
export function generateManualDiff(
  pair:     { design?: SimpleNode | null; arkui?: SimpleNode | null },
  key:      string,
  platform: string,
): ManualStyleDiff | null {
  const designHasManual = pair.design?.manualStyle?.[key] !== undefined
  const arkuiHasManual  = pair.arkui?.manualStyle?.[key] !== undefined
  if (!designHasManual && !arkuiHasManual) return null

  const designVal = readStyleValue(pair.design, key)
  const arkuiVal  = readStyleValue(pair.arkui, key)

  const designStr = formatStyleValue(key, designVal, platform)
  const arkuiStr  = formatStyleValue(key, arkuiVal, platform)

  // 两侧值一致 → 返回 null（不生成 diff 卡片），
  // 由 overlayDiffs 用 resolvedKeys 删除算法池对应条目
  // 例外：'other' 类型是用户自定义属性，即使值一致也必须展示
  if (designStr === arkuiStr && key !== 'other') return null

  return {
    property:      key,
    designValue:   designStr,
    arkuiValue:    arkuiStr,
    severity:      'warning',
    confidence:    'high',
    designNodeId:  pair.design?.id ?? null,
    arkuiNodeId:   pair.arkui?.id  ?? null,
    _isManual:     true,
    diffSource:    'edit-diff',
    textContent:   (pair.design?.textContent ?? pair.design?.name ?? pair.arkui?.textContent ?? ''),
    designName:    pair.design?.name,
  }
}
