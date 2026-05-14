/**
 * Design 解析流水线编排：
 *   step1 buildDesignTree     扁平 data[] + path → UnifiedNode 树
 *   step2 pruneDesignTree     硬剪枝 + 语义折叠 + boolean_operation 后代清空 + 软剪枝
 *   step2.5 normalizeTree     消除"父子尺寸完全一致 + 无装饰"的冗余包装
 *   step3 annotateDesignTree  像素可见性标注 + 剔除
 *   step4 flattenDesignTree   树 → 扁平 UnifiedNode[]
 *
 * 入口：parseDesign(designJson, { imageBuffer }) → 直接对接 match 阶段
 *
 * 注：design 侧 step3 没有 OCR、没有后项杀前项，整体同步即可；
 * 为与 ArkUI 流水线 API 对称仍返回 Promise。
 */

import { buildDesignTree } from './1-buildTree.js'
import { pruneDesignTree } from './2-pruneTree.js'
import { annotateDesignTree } from './3-annotateTree.js'
import { flattenDesignTree } from './4-flattenTree.js'
import { normalizeTree } from '../../utils/normalizeTree.js'

export async function parseDesign(designJson, opts = {}) {
  const { imageBuffer } = opts

  const { canvasWidth, canvasHeight, root } = buildDesignTree(designJson)

  pruneDesignTree(root, canvasWidth, canvasHeight)
  normalizeTree(root)

  const { stats: annotateStats } = annotateDesignTree(root, {
    imageBuffer,
    canvasWidth,
    canvasHeight,
  })

  const nodes = flattenDesignTree(root)

  return {
    canvasWidth,
    canvasHeight,
    nodes,
    annotateStats,
    _root: root,
  }
}
