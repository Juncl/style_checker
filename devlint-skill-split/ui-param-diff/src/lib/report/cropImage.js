/**
 * 节点局部切图
 *
 * 用 sharp 按 rect 裁剪图片,返回 PNG Buffer。
 * 供 Excel 报告的「设计稿截图」「开发截图」列使用。
 *
 * 坐标系:
 *   - UnifiedIssue.rect 可能是:
 *     a) 节点 rect(design.json 的 dp / arkui 的 vp)→ 需按画布/截图比例换算
 *     b) 像素差异块 bbox(已是截图像素坐标)→ 直接用
 *   - 由调用方传入 canvasSize 时按 a 换算,否则按 b
 */
import sharp from 'sharp'

const PADDING = 20 // 切图四周留白,便于观察
const MIN_SIZE = 24 // 最小切图尺寸,避免极小节点切出空白

/**
 * @param {string} imagePath - 图片文件路径
 * @param {{x,y,w,h}} rect - 节点 rect 或像素块 bbox
 * @param {{width,height}} [canvasSize] - 画布尺寸(与 rect 同单位),传入则做比例换算
 * @returns {Promise<Buffer>} PNG Buffer
 */
export async function cropNodeImage(imagePath, rect, canvasSize) {
  if (!rect || !imagePath) return null

  const img = sharp(imagePath)
  const meta = await img.metadata()
  const imgW = meta.width
  const imgH = meta.height

  // 换算到像素坐标
  let px, py, pw, ph
  const cw = canvasSize?.w ?? canvasSize?.width ?? 0
  const ch = canvasSize?.h ?? canvasSize?.height ?? 0
  if (canvasSize && cw && ch) {
    // 节点 rect → 像素坐标
    px = (rect.x / cw) * imgW
    py = (rect.y / ch) * imgH
    pw = (rect.w / cw) * imgW
    ph = (rect.h / ch) * imgH
  } else {
    // 像素块 bbox,直接用
    px = rect.x
    py = rect.y
    pw = rect.w
    ph = rect.h
  }

  // 加 padding 并 clamp 到图片范围
  const left = Math.max(0, Math.floor(px - PADDING))
  const top = Math.max(0, Math.floor(py - PADDING))
  const right = Math.min(imgW, Math.ceil(px + pw + PADDING))
  const bottom = Math.min(imgH, Math.ceil(py + ph + PADDING))

  let w = right - left
  let h = bottom - top
  if (w < MIN_SIZE) w = Math.min(imgW - left, MIN_SIZE)
  if (h < MIN_SIZE) h = Math.min(imgH - top, MIN_SIZE)

  if (w <= 0 || h <= 0) return null

  const buf = await sharp(imagePath)
    .extract({ left, top, width: w, height: h })
    .png()
    .toBuffer()

  return buf
}
