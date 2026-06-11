/**
 * Pass 4 前置：同行强锚点桥接（anchor-row-bridge）
 *
 * 解决的问题（模式 B）：
 *   设计侧与开发侧各有一列「同 rawType + 等距」的图标/容器，两侧整体存在系统性 y 偏移，
 *   且偏移量 ≈ 行间距。此时 Pass 4 用 relDist / 任何绝对坐标残差都会「差一格更吻合」，
 *   把整列错位（off-by-N）。坐标本身无法消歧。
 *
 * 核心思路：不用任何绝对/归一化坐标残差，纯靠强锚点的「同行 + 相对方向」拓扑关系桥接。
 *   一个图标与它同行的文本标签（已被 Pass 1 匹配成强锚点）严格共处一行（y 区间重叠是硬约束），
 *   该锚点已知对端；到对端那一行、同一侧方向，找类型兼容、尺寸相近的未匹配候选即可唯一确定。
 *   行间距大小、两侧画布高度差、系统偏移量全部与结论无关 —— 同行关系不会「差一格」。
 *
 * 流程：对每个未匹配、有视觉性的 container 节点 d
 *   1. 找与 d 同行（normRect y 区间重叠 > 0.5·min(h)）的已匹配 pair 作锚点，取水平最近的
 *   2. 记 d 相对锚点 design 侧的水平方向 dir（左/右）
 *   3. 到对端：取与 anchor.arkui 同行、且在 dir 方向、类型兼容、未匹配的候选，按离锚点水平距离升序
 *   4. 取最近的候选 a，若 d 也是 design 侧锚点该方向最近的同类候选（无歧义）且尺寸比 ≥0.5 → 锁定
 *
 * confidence='high'，matchType 复用 'anchor-topology'，可覆盖 Pass 4 的错配。
 */
import { sizeRatio } from '../utils/matchGeometry.js'
import { isCompatibleType, isRenderableNonTextNode, hasVisualDecoration } from '../utils/nodeVisibility.js'
import { makePair } from './matchStrategies.js'

const ROW_OVERLAP_RATIO = 0.5    // 同行：y 区间重叠 / min(h) 阈值
const PAIR_SIZE_RATIO_MIN = 0.50 // 桥接候选最小尺寸比

export function matchByAnchorRowBridge(designNodes, arkuiNodes, pairs, usedArkui, matchedDesignIds) {
  const result = []
  const consumedArkui = new Set()  // 本 matcher 内防止两个 design 节点桥接到同一 arkui
  // 取有视觉性的容器（图标/形状），排除纯结构容器，避免空壳节点抢匹配
  const targets = designNodes.filter(d =>
    !matchedDesignIds.has(d.id) &&
    d.type === 'container' &&
    (isRenderableNonTextNode(d) || hasVisualDecoration(d))
  )

  for (const d of targets) {
    // 1. 同行锚点（design 侧），按与 d 的水平距离升序
    const rowAnchors = pairs
      .filter(p => sameRow(d, p.design))
      .map(p => ({ p, hdist: Math.abs(centerX(d) - centerX(p.design)) }))
      .sort((a, b) => a.hdist - b.hdist)
    if (rowAnchors.length === 0) continue

    let matched = null
    for (const { p: anchor } of rowAnchors) {
      const dir = Math.sign(centerX(d) - centerX(anchor.design))
      if (dir === 0) continue

      // 2. design 侧：锚点同方向、同行、与 d 类型兼容的其他视觉容器
      //    —— 若 d 不是该方向最近的那个，说明这一行有多个候选，存在歧义，换下个锚点
      const designRivals = targets.filter(x =>
        x !== d &&
        sameRow(x, anchor.design) &&
        Math.sign(centerX(x) - centerX(anchor.design)) === dir &&
        isCompatibleType(x, d)
      )
      const dHdist = Math.abs(centerX(d) - centerX(anchor.design))
      if (designRivals.some(x => Math.abs(centerX(x) - centerX(anchor.design)) < dHdist)) continue

      // 3. 对端：anchor.arkui 同行、同方向、未匹配、类型兼容、且尺寸量级相近的候选，取水平最近
      //    尺寸约束放进过滤是关键 —— 否则包住整行的大容器(scroll/list)也"同行"会挤掉真正的图标
      const cand = arkuiNodes
        .filter(a =>
          !usedArkui.has(a.id) &&
          !consumedArkui.has(a.id) &&
          isCompatibleType(d, a) &&
          sameRow(a, anchor.arkui) &&
          Math.sign(centerX(a) - centerX(anchor.arkui)) === dir &&
          Math.min(sizeRatio(d.normRect.w, a.normRect.w), sizeRatio(d.normRect.h, a.normRect.h)) >= PAIR_SIZE_RATIO_MIN
        )
        .map(a => ({ a, hdist: Math.abs(centerX(a) - centerX(anchor.arkui)) }))
        .sort((x, y) => x.hdist - y.hdist)
      if (cand.length === 0) continue

      matched = cand[0].a
      break
    }

    if (matched) {
      result.push(makePair(d, matched, 'anchor-topology', {
        confidence: 'high',
        topologyScore: 1.0,
      }))
      consumedArkui.add(matched.id)
    }
  }
  return result
}

// 同一行：两节点 normRect 的 y 区间重叠超过较小高度的一半
function sameRow(a, b) {
  const ay0 = a.normRect.y, ay1 = ay0 + a.normRect.h
  const by0 = b.normRect.y, by1 = by0 + b.normRect.h
  const ov = Math.min(ay1, by1) - Math.max(ay0, by0)
  return ov > ROW_OVERLAP_RATIO * Math.min(a.normRect.h, b.normRect.h)
}

const centerX = n => n.normRect.x + n.normRect.w / 2
