/**
 * 锚点几何工具 + 一致性校验工厂
 *
 * 被 Pass 3 / Pass 3.5 / Pass 5.3 共用，从 anchorTopology.js 抽离以消除重复依赖。
 *
 * 导出概览：
 *   EPS              — rect 判定容差，所有几何计算共享同一值
 *   center           — rect 中心点
 *   rectContains     — 二元包含判定（带 EPS 容差）
 *   nodeAnchorRelation — 节点与锚点的四态关系（contain / contain_by / cross / disjoint）
 *   relation         — 节点相对锚点的方向（contain / left / right / up / down / diagonal / null）
 *   makeAnchorCheck  — 锚点一致性校验工厂，返回 (an, dn) => boolean
 */

import { MatchTools } from './tools.js'

// ── 基础常量 ───────────────────────────────────────────────────────────────────

// Pass 1–6 全部使用 rect 绝对坐标（dp/vp），EPS 统一为 0.5，避免各处各自定义出现偏差
export const EPS = 0.5

// ── 几何小工具 ─────────────────────────────────────────────────────────────────

export const center = MatchTools.center

// outer 是否包住 inner（四边都留 EPS 容差，避免浮点误差导致边缘节点漏判）
export function rectContains(outer, inner) {
  return outer.x <= inner.x + EPS &&
         outer.y <= inner.y + EPS &&
         outer.x + outer.w >= inner.x + inner.w - EPS &&
         outer.y + outer.h >= inner.y + inner.h - EPS
}

// 两 rect 本体是否完全分离（不相交）
function rectsDisjoint(a, b) {
  return a.x + a.w <= b.x + EPS || b.x + b.w <= a.x + EPS ||
         a.y + a.h <= b.y + EPS || b.y + b.h <= a.y + EPS
}

// x / y 投影是否有实质交叠（用于判定左右 / 上下同行带）
const xOverlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > EPS
const yOverlap = (a, b) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > EPS

// ── 四态包含关系 ───────────────────────────────────────────────────────────────

/**
 * 节点与锚点的四态包含关系。
 *
 * 返回值：
 *   'contain'    交叠/锚点面积 ≥ 90%（node 包住 anchor，锚点是文本叶子时的典型场景）
 *   'contain_by' 交叠/node面积 ≥ 90%（anchor 包住 node，锚点是大容器时的场景）
 *   'disjoint'   交叠/min(两者面积) ≤ 10%（基本脱离）
 *   'cross'      其余（局部交叠，pass3 视为模糊情况不处理）
 */
export function nodeAnchorRelation(nodeRect, anchorRect) {
  const ix = Math.max(0, Math.min(nodeRect.x + nodeRect.w, anchorRect.x + anchorRect.w) - Math.max(nodeRect.x, anchorRect.x))
  const iy = Math.max(0, Math.min(nodeRect.y + nodeRect.h, anchorRect.y + anchorRect.h) - Math.max(nodeRect.y, anchorRect.y))
  const inter = ix * iy
  const anchorArea = anchorRect.w * anchorRect.h
  const nodeArea   = nodeRect.w * nodeRect.h
  if (anchorArea <= 0 || nodeArea <= 0) return 'disjoint'
  if (inter / anchorArea >= 0.9) return 'contain'
  if (inter / nodeArea   >= 0.9) return 'contain_by'
  if (inter / Math.min(anchorArea, nodeArea) <= 0.1) return 'disjoint'
  return 'cross'
}

// ── 方向关系 ───────────────────────────────────────────────────────────────────

/**
 * 判定 nodeRect 相对 anchorRect 的几何关系。
 * pass3 只处理 contain 和四正方向，diagonal（斜对角）不参与配对，
 * null（相交非包含）始终不碰——相交节点的归属太模糊，强行配对会引入误匹配。
 *
 * 返回值：
 *   'contain'            node 包住 anchor（视觉祖先方向）
 *   'left'/'right'       本体脱离 + y 投影有重叠（同行带）
 *   'up'/'down'          本体脱离 + x 投影有重叠（同列带）
 *   'diagonal'           本体脱离但斜对角
 *   null                 相交但非包含
 */
export function relation(nodeRect, anchorRect) {
  if (rectContains(nodeRect, anchorRect)) return 'contain'
  if (!rectsDisjoint(nodeRect, anchorRect)) return null
  const nc = center(nodeRect), ac = center(anchorRect)
  if (yOverlap(nodeRect, anchorRect)) return nc.x < ac.x ? 'left' : 'right'
  if (xOverlap(nodeRect, anchorRect)) return nc.y < ac.y ? 'up' : 'down'
  return 'diagonal'
}

// ── 锚点一致性校验工厂 ─────────────────────────────────────────────────────────

// 方向反义表，用于检测「反向矛盾」（上↔下、左↔右）
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' }

/**
 * 生成一个锚点一致性校验函数 (an, dn) => boolean。
 * 校验候选对 (an, dn) 是否与已知锚点集合在几何上自洽，分两道门：
 *
 *   ① 四态包含一致（containSet）
 *      对每个参照锚点 s，an 与 s.arkui 的四态关系 必须等于 dn 与 s.design 的四态关系。
 *      用 nodeAnchorRelation（交叠比例）而非 rectContains，是为了容忍
 *      「一侧恰好边缘压线」的 cross 情况，不被 contain/disjoint 的二元判定误卡。
 *
 *   ② 方向不得反向矛盾（dirSet）
 *      对每个参照锚点 s，若 an 与 s.arkui 呈脱离方向（非 null / contain），
 *      则 dn 与 s.design 不得呈正相反的方向（如 an 在锚点左边，dn 不得在锚点右边）。
 *      放行：同向、斜向、包含关系——这些布局微差属正常，不应误杀。
 *
 * @param {Array} containSet  四态包含一致性参照锚点组（通常包含容器配对 + 文本锚点）
 * @param {Array} dirSet      方向一致性参照锚点组（通常只用 pass1 文本强锚点）
 * @returns {(an, dn) => boolean}
 */
export function makeAnchorCheck(containSet, dirSet) {
  return (an, dn) => {
    // 门①：四态包含一致
    for (const s of containSet) {
      if (s.arkui.id === an.id || s.design.id === dn.id) continue
      if (nodeAnchorRelation(an.rect, s.arkui.rect) !== nodeAnchorRelation(dn.rect, s.design.rect)) return false
    }
    // 门②：方向不得反向矛盾
    for (const s of dirSet) {
      if (s.arkui.id === an.id || s.design.id === dn.id) continue
      const ra = relation(an.rect, s.arkui.rect)
      if (ra === null || ra === 'contain') continue   // 相交或包含，放行
      const rd = relation(dn.rect, s.design.rect)
      if (rd === null) return false                   // 一侧脱离、另一侧相交 → 矛盾
      if (rd === OPPOSITE[ra]) return false           // 方向正相反 → 矛盾
    }
    return true
  }
}
