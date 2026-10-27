/**
 * 像素对比主流程
 *
 * 两种模式:
 *   A. 无 pairs(纯图): 全局连通域聚类,像素块再做节点关联(或无关联)
 *   B. 有 pairs(JSON+图): 按每个 pair 的 rect 区域分别裁图对比,天然绑定节点
 *
 * 入参:
 *   - designImageBuffer: 设计稿截图 Buffer
 *   - devImageBuffer: 开发侧截图 Buffer
 *   - platform
 *   - pairs: 可选,匹配节点对(仅 B 模式)
 *   - designCanvas: 可选,设计侧画布尺寸 {w,h}(B 模式必需)
 *   - arkuiCanvas: 可选,开发侧画布尺寸 {w,h}(B 模式必需)
 *   - designNodes/arkuiNodes/canvas: A 模式节点关联参数(兼容旧调用)
 *
 * 返回:
 *   { platform, diffBlocks, totalBlocks, canvas }
 */
import { alignImages } from './align.js'
import { extractDiffBlocks } from './extractBlocks.js'
import { mapDiffBlocksToNodes } from './mapToNode.js'
import { compareByNodes } from './compareByNodes.js'
import sharp from 'sharp'

export async function runPixelDiff({
  designImageBuffer,
  devImageBuffer,
  platform,
  pairs,
  designCanvas,
  arkuiCanvas,
  designNodes,
  arkuiNodes,
  canvas,
}) {
  if (!designImageBuffer) throw new Error('缺少 designImageBuffer')
  if (!devImageBuffer) throw new Error('缺少 devImageBuffer')

  // ── B 模式: 有节点匹配结果,按节点 rect 区域逐个对比 ──
  if (Array.isArray(pairs) && pairs.length > 0 && designCanvas && arkuiCanvas) {
    return compareByNodes({
      designImageBuffer,
      devImageBuffer,
      platform,
      pairs,
      designCanvas,
      arkuiCanvas,
    })
  }

  // ── A 模式: 纯图,全局连通域聚类 + (可选)节点关联 ──
  const devMeta = await sharp(devImageBuffer).metadata()
  const designMeta = await sharp(designImageBuffer).metadata()
  const devOrig = { w: devMeta.width, h: devMeta.height }
  const designOrig = { w: designMeta.width, h: designMeta.height }

  const { design: designImg, dev: devImg, width, height } =
    await alignImages(designImageBuffer, devImageBuffer)

  let diffBlocks = await extractDiffBlocks(designImg, devImg, width, height)

  // 尺寸不一致时,bbox 基于对齐后(=dev)坐标,补 designBbox 换算到 design 原图坐标,
  // 供 skill 侧切 design.png 用(避免坐标超界)
  if (designOrig.w !== devOrig.w || designOrig.h !== devOrig.h) {
    const sx = designOrig.w / width
    const sy = designOrig.h / height
    for (const b of diffBlocks) {
      b.devBbox = b.bbox  // dev 原图坐标 = 对齐后坐标(dev 为基准)
      b.designBbox = {    // 换算到 design 原图坐标
        x: b.bbox.x * sx,
        y: b.bbox.y * sy,
        w: b.bbox.w * sx,
        h: b.bbox.h * sy,
      }
    }
  } else {
    for (const b of diffBlocks) {
      b.devBbox = b.bbox
      b.designBbox = b.bbox
    }
  }

  // 可选:像素块 → 节点关联(旧路径,canvas 字段兼容)
  if (Array.isArray(designNodes) && designNodes.length > 0 && canvas) {
    diffBlocks = mapDiffBlocksToNodes(
      diffBlocks,
      designNodes,
      canvas,
      { w: width, h: height },
    )
  }

  return {
    platform,
    diffBlocks,
    totalBlocks: diffBlocks.length,
    canvas: { w: width, h: height },
  }
}
