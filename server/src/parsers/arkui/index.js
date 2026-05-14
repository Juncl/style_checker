/**
 * ArkUI 解析流水线编排：
 *   step1 buildArkuiTree      原始 $children 树 → UnifiedNode 树
 *   step2 pruneArkuiTree      硬剪枝 + 软剪枝
 *   step2.5 normalizeTree     消除"父子尺寸完全一致 + 无装饰"的冗余包装
 *   step3 annotateArkuiTree   像素 / OCR / 后项杀前项 标注 + 剔除
 *   step4 flattenArkuiTree    树 → 扁平 UnifiedNode[]
 *
 * 入口：parseArkui(arkuiJson, { imageBuffer }) → 直接对接 match 阶段
 */

import { buildArkuiTree } from './1-buildTree.js'
import { pruneArkuiTree } from './2-pruneTree.js'
import { annotateArkuiTree } from './3-annotateTree.js'
import { flattenArkuiTree } from './4-flattenTree.js'
import { normalizeTree } from '../../utils/normalizeTree.js'

export async function parseArkui(arkuiJson, opts = {}) {
  const { imageBuffer } = opts

  // step 1: 建树
  const { canvasWidthVp, canvasHeightVp, resolution, root } = buildArkuiTree(arkuiJson)

  // step 2: 剪枝（先硬后软）
  pruneArkuiTree(root, canvasWidthVp, canvasHeightVp)

  // step 2.5: 就地规整（父子同框纯包装层）
  normalizeTree(root)

  // step 3: 标注 + 剔除
  const { stats: annotateStats } = await annotateArkuiTree(root, {
    imageBuffer,
    canvasWidthVp,
    canvasHeightVp,
  })

  // step 4: 扁平化
  const nodes = flattenArkuiTree(root)

  return {
    canvasWidthVp,
    canvasHeightVp,
    resolution,
    nodes,
    annotateStats,
    // 可选：调试需要时把树根带出去
    _root: root,
  }
}
