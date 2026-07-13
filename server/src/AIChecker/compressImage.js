import sharp from 'sharp'

const SUPPORTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp'])

/**
 * 将图片 base64 统一转为 WebP 格式，降低 VLM 传输 token 消耗。
 * 不支持的格式（GIF、SVG 等）直接透传。
 * @param {string} dataUrl - data:image/xxx;base64,...
 * @returns {Promise<string>} 转换后的 WebP dataUrl（或原值）
 */
export async function compressImage(dataUrl) {
  if (!dataUrl) return dataUrl

  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/)
  if (!match) return dataUrl

  const [, mime, b64] = match
  if (!SUPPORTED.has(mime)) return dataUrl

  const buf = Buffer.from(b64, 'base64')
  const out = await sharp(buf).webp().toBuffer()
  const outB64 = out.toString('base64')

  // console.log(`[图片压缩] ${mime}  |  压缩前: ${b64.length.toLocaleString()} 字符  →  压缩后: ${outB64.length.toLocaleString()} 字符  |  缩减 ${((1 - outB64.length / b64.length) * 100).toFixed(1)}%`)

  return `data:image/webp;base64,${outB64}`
}
