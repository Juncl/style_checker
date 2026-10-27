/**
 * 像素对比 - 按节点匹配结果逐区域对比
 *
 * 仅 JSON + 图 场景使用:不再全局做连通域聚类,
 * 而是针对每个匹配节点对(pair)的 rect 区域分别裁图对比。
 *
 * 流程(每个 pair):
 *   1. design.rect(dp 坐标)→ 按 designCanvas 换算到 design.png 像素坐标 → 裁 design.png 一块
 *   2. arkui.rect(vp 坐标)→ 按 arkuiCanvas 换算到 arkui.png 像素坐标 → 裁 arkui.png 一块
 *   3. 两块缩放到相同尺寸(取较大边)→ 灰度逐像素 diff → diffRatio
 *   4. diffRatio 超阈值才输出(无差异的节点不报)
 *
 * 输出 diffBlock 天然带 matchedNodeId(= pair.design.id),无需再做节点关联。
 * bbox 用 design 侧像素坐标(便于 skill 侧用 design.png 切图);
 * 同时带 devBbox(arkui 侧像素坐标,便于用 arkui.png 切图)。
 */
import sharp from 'sharp'

const DIFF_THRESHOLD = 30   // 灰度差阈值
const MIN_DIFF_RATIO = 0.35 // 最小差异率,低于 35% 不报(认为该节点视觉一致)
const SEVERITY_HIGH = 0.85
const SEVERITY_MID = 0.6

function classifySeverity(diffRatio) {
  if (diffRatio > SEVERITY_HIGH) return 'high'
  if (diffRatio > SEVERITY_MID) return 'mid'
  return 'low'
}

/**
 * 画布坐标 rect → 截图像素坐标
 * @param {{x,y,w,h}} rect - 画布坐标(dp/vp)
 * @param {{w,h}} canvas - 画布尺寸(与 rect 同单位)
 * @param {{w,h}} imgSize - 截图像素尺寸
 */
function rectToPixel(rect, canvas, imgSize) {
  if (!rect || !canvas || !imgSize) return { x: 0, y: 0, w: 0, h: 0 }
  return {
    x: (rect.x / canvas.w) * imgSize.w,
    y: (rect.y / canvas.h) * imgSize.h,
    w: (rect.w / canvas.w) * imgSize.w,
    h: (rect.h / canvas.h) * imgSize.h,
  }
}

/**
 * 裁剪图片指定像素区域(带边界 clamp)
 * @param {Buffer} imgBuf
 * @param {{x,y,w,h}} pxRect - 像素坐标
 * @returns {Promise<Buffer|null>} PNG buffer
 */
async function cropRegion(imgBuf, pxRect) {
  const meta = await sharp(imgBuf).metadata()
  const left = Math.max(0, Math.floor(pxRect.x))
  const top = Math.max(0, Math.floor(pxRect.y))
  const right = Math.min(meta.width, Math.ceil(pxRect.x + pxRect.w))
  const bottom = Math.min(meta.height, Math.ceil(pxRect.y + pxRect.h))
  const w = right - left
  const h = bottom - top
  if (w <= 0 || h <= 0) return null
  return sharp(imgBuf).extract({ left, top, width: w, height: h }).png().toBuffer()
}

/**
 * 两块图缩放到相同尺寸后做灰度 diff,返回 diffRatio
 * @param {Buffer} bufA
 * @param {Buffer} bufB
 * @returns {Promise<number>} 0~1
 */
async function regionDiffRatio(bufA, bufB) {
  const metaA = await sharp(bufA).metadata()
  const metaB = await sharp(bufB).metadata()
  // 缩放到较大尺寸(保持坐标体系一致)
  const w = Math.max(metaA.width, metaB.width)
  const h = Math.max(metaA.height, metaB.height)

  const a = await sharp(bufA).resize(w, h, { fit: 'fill' }).greyscale().raw().toBuffer()
  const b = await sharp(bufB).resize(w, h, { fit: 'fill' }).greyscale().raw().toBuffer()

  let diff = 0
  const total = w * h
  for (let i = 0; i < total; i++) {
    if (Math.abs(a[i] - b[i]) > DIFF_THRESHOLD) diff++
  }
  return total > 0 ? diff / total : 0
}

/**
 * 按节点匹配结果逐区域对比
 *
 * @param {Object} opts
 * @param {Buffer} opts.designImageBuffer
 * @param {Buffer} opts.devImageBuffer
 * @param {string} opts.platform
 * @param {Array} opts.pairs - /check/upload 响应的 pairs(含 design.rect + arkui.rect)
 * @param {{w,h}} opts.designCanvas - 设计侧画布尺寸(dp)
 * @param {{w,h}} opts.arkuiCanvas - 开发侧画布尺寸(vp)
 * @returns {Promise<Object>} { platform, diffBlocks, totalBlocks, canvas }
 */
export async function compareByNodes({
  designImageBuffer,
  devImageBuffer,
  platform,
  pairs,
  designCanvas,
  arkuiCanvas,
}) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return { platform, diffBlocks: [], totalBlocks: 0, canvas: null }
  }

  const designMeta = await sharp(designImageBuffer).metadata()
  const devMeta = await sharp(devImageBuffer).metadata()
  const designImgSize = { w: designMeta.width, h: designMeta.height }
  const devImgSize = { w: devMeta.width, h: devMeta.height }

  const diffBlocks = []
  let idx = 0

  for (const pair of pairs) {
    const dRect = pair.design?.rect
    const aRect = pair.arkui?.rect
    if (!dRect || !aRect) continue

    const dPixel = rectToPixel(dRect, designCanvas, designImgSize)
    const aPixel = rectToPixel(aRect, arkuiCanvas, devImgSize)

    // 裁两侧
    const [dBuf, aBuf] = await Promise.all([
      cropRegion(designImageBuffer, dPixel),
      cropRegion(devImageBuffer, aPixel),
    ])
    if (!dBuf || !aBuf) continue

    const ratio = await regionDiffRatio(dBuf, aBuf)
    if (ratio < MIN_DIFF_RATIO) continue

    idx++
    diffBlocks.push({
      id: `PX-${String(idx).padStart(3, '0')}`,
      bbox: dPixel,                 // design 侧像素坐标(供 skill 用 design.png 切图)
      devBbox: aPixel,              // arkui 侧像素坐标(供 skill 用 arkui.png 切图)
      area: Math.round(ratio * dPixel.w * dPixel.h),
      diffRatio: Number(ratio.toFixed(4)),
      severity: classifySeverity(ratio),
      matchedNodeId: pair.design.id,    // 天然绑定节点
      matchedNodeName: pair.design.name || pair.design.textContent || null,
    })
  }

  return {
    platform,
    diffBlocks,
    totalBlocks: diffBlocks.length,
    canvas: { w: designImgSize.w, h: designImgSize.h },
  }
}
