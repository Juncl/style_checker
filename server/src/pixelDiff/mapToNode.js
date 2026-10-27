/**
 * 像素对比 - 像素块 ↔ 节点关联
 *
 * 仅在 JSON + 图 场景调用:server 收到两侧节点列表时,
 * 把每个像素差异块的 bbox(像素坐标)与设计侧节点 rect 做关联,
 * 找到 IoU 最大的节点(IoU >= 阈值才认),写入 matchedNodeId/Name。
 *
 * 坐标换算:
 *   - 像素块 bbox: 基于截图(devImage)的像素坐标
 *   - 节点 rect: 基于画布坐标系(design.json 的 dp / arkui 的 vp)
 *   - 换算: 节点在画布中的相对位置 = node.rect.x / canvasWidthVp
 *           → 像素坐标 = relative * imageWidth
 *           (两侧 canvasWidth/Height 在 /check/upload 响应里已有,这里由调用方传入)
 */

const COVERAGE_THRESHOLD = 0.5  // 差异块至少一半在节点内才认关联

/**
 * 计算两个矩形的交集面积
 */
function intersectArea(a, b) {
  const ix1 = Math.max(a.x, b.x)
  const iy1 = Math.max(a.y, b.y)
  const ix2 = Math.min(a.x + a.w, b.x + b.w)
  const iy2 = Math.min(a.y + a.h, b.y + b.h)
  const iw = Math.max(0, ix2 - ix1)
  const ih = Math.max(0, iy2 - iy1)
  return iw * ih
}

/**
 * 把节点 rect(画布坐标系)换算到像素坐标系
 * @param {{x,y,w,h}} rect - 节点 rect(design 的 dp / arkui 的 vp)
 * @param {number} canvasW - 画布宽度(与 rect 同单位)
 * @param {number} canvasH - 画布高度
 * @param {number} imgW - 截图像素宽度
 * @param {number} imgH - 截图像素高度
 * @returns {{x,y,w,h}} 像素坐标 rect
 */
function rectToPixel(rect, canvasW, canvasH, imgW, imgH) {
  if (!rect || !canvasW || !canvasH) return { x: 0, y: 0, w: 0, h: 0 }
  return {
    x: (rect.x / canvasW) * imgW,
    y: (rect.y / canvasH) * imgH,
    w: (rect.w / canvasW) * imgW,
    h: (rect.h / canvasH) * imgH,
  }
}

/**
 * 把设计侧节点列表里所有节点 rect 转成像素坐标
 * @param {Array} designNodes - /check/upload 响应的 allDesignNodes
 * @param {{width,height}} canvas - 画布尺寸 { width, height }(与 rect 同单位)
 * @param {{w,h}} imgSize - 截图像素尺寸
 * @returns {Map<id, {pixelRect, name}>}
 */
function buildDesignNodePixelMap(designNodes, canvas, imgSize) {
  const map = new Map()
  if (!Array.isArray(designNodes)) return map
  const canvasW = canvas?.w ?? canvas?.width ?? 0
  const canvasH = canvas?.h ?? canvas?.height ?? 0
  for (const n of designNodes) {
    if (!n.rect) continue
    map.set(n.id, {
      pixelRect: rectToPixel(n.rect, canvasW, canvasH, imgSize.w, imgSize.h),
      name: n.name || n.textContent || null,
    })
  }
  return map
}

/**
 * 对每个像素差异块,找到 IoU 最大的设计侧节点
 *
 * @param {Array} diffBlocks - 像素差异块(bbox 为像素坐标)
 * @param {Array} designNodes - 设计侧节点列表
 * @param {{width,height}} canvas - 画布尺寸
 * @param {{w,h}} imgSize - 截图像素尺寸
 * @returns {Array} 写入 matchedNodeId/matchedNodeName 后的 diffBlocks
 */
export function mapDiffBlocksToNodes(diffBlocks, designNodes, canvas, imgSize) {
  const nodeMap = buildDesignNodePixelMap(designNodes, canvas, imgSize)
  if (nodeMap.size === 0) return diffBlocks

  // 预计算每个节点像素面积,用于"最具体节点"选择(面积越小越具体)
  const nodePixelArea = new Map()
  for (const [id, info] of nodeMap) {
    const r = info.pixelRect
    nodePixelArea.set(id, r.w * r.h)
  }
  // 画布总面积,用于过滤根节点(面积占画布 > 80% 视为根节点,不参与关联)
  const canvasArea = imgSize.w * imgSize.h
  const ROOT_RATIO = 0.8

  for (const block of diffBlocks) {
    let bestId = null
    let bestCoverage = 0
    let bestName = null
    let bestArea = Infinity

    const blockArea = block.bbox.w * block.bbox.h
    for (const [id, info] of nodeMap) {
      const nodeArea = nodePixelArea.get(id) || 0
      // 跳过根节点(覆盖整个画布,关联无意义)
      if (nodeArea > canvasArea * ROOT_RATIO) continue

      const inter = intersectArea(block.bbox, info.pixelRect)
      // 覆盖率:差异块被节点包含的比例(差异块通常比节点小,IoU 不适用)
      const coverage = blockArea > 0 ? inter / blockArea : 0
      if (coverage < COVERAGE_THRESHOLD) continue

      // 同样覆盖率下,选面积最小的(最具体的节点)
      if (coverage > bestCoverage || (coverage === bestCoverage && nodeArea < bestArea)) {
        bestCoverage = coverage
        bestId = id
        bestName = info.name
        bestArea = nodeArea
      }
    }

    if (bestId) {
      block.matchedNodeId = bestId
      block.matchedNodeName = bestName
    }
  }
  return diffBlocks
}
