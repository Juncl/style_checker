/**
 * 像素对比 - 尺寸归一化对齐
 *
 * 两张图尺寸不一致时,以 devImage 为基准等比缩放 designImage,
 * 避免坐标体系错位(diff 噪声)。鸿蒙截图与设计稿像素比可能不同(designScale),
 * 对齐基准统一取 devImage 尺寸。
 *
 * 返回两侧 sharp 实例 + 统一后的 { width, height }。
 */
import sharp from 'sharp'

/**
 * @param {Buffer} designBuf
 * @param {Buffer} devBuf
 * @returns {Promise<{ design: sharp.Sharp, dev: sharp.Sharp, width: number, height: number }>}
 */
export async function alignImages(designBuf, devBuf) {
  const devMeta = await sharp(devBuf).metadata()
  const designMeta = await sharp(designBuf).metadata()

  const devW = devMeta.width
  const devH = devMeta.height
  const designW = designMeta.width
  const designH = designMeta.height

  // 尺寸一致,直接返回
  if (designW === devW && designH === devH) {
    return {
      design: sharp(designBuf),
      dev: sharp(devBuf),
      width: devW,
      height: devH,
    }
  }

  // 尺寸不一致:把 design 等比缩放到 dev 尺寸(拉伸,保持坐标体系一致)
  // 取 dev 为基准是因为像素块最终要对应到开发侧节点 rect
  const designResized = await sharp(designBuf)
    .resize(devW, devH, { fit: 'fill' })
    .toBuffer()

  return {
    design: sharp(designResized),
    dev: sharp(devBuf),
    width: devW,
    height: devH,
  }
}
