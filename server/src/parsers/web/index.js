/**
 * Web 解析流水线编排：
 *   step1 buildWebTree     DOM 节点 → UnifiedNode 树
 *   step2 pruneWebTree     硬剪枝 + 软剪枝
 *   step2.5 normalizeTree  消除"父子尺寸完全一致 + 无装饰"的冗余包装
 *   step4 flattenWebTree   树 → 扁平 UnifiedNode[]
 *
 * 入口：parseWeb(webJson, { imageBuffer? }) → 直接对接 match 阶段
 *
 * 与 ArkUI/Design 流水线相比：
 *   - 无 step3 annotateTree（不做 OCR、不做遮挡剪枝）
 *   - 坐标单位即 CSS px（无 resolution 概念），canvasWidthVp == 像素宽度
 *   - padding / margin 不解析（web 不对比 padding）
 */

import { buildWebTree } from './1-buildTree.js'
import { pruneWebTree } from './2-pruneTree.js'
import { flattenWebTree } from './4-flattenTree.js'
import { normalizeTree } from '../../utils/normalizeTree.js'

export async function parseWeb(webJson, _opts = {}) {
  const { canvasWidthVp, canvasHeightVp, resolution, root } = buildWebTree(webJson)

  pruneWebTree(root, canvasWidthVp, canvasHeightVp)
  normalizeTree(root)

  const nodes = flattenWebTree(root, canvasWidthVp, canvasHeightVp)

  return {
    canvasWidthVp,
    canvasHeightVp,
    resolution,
    nodes,
    annotateStats: {},
    _root: root,
  }
}
