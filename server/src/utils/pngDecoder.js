import { inflateSync } from 'zlib'

const PNG_SIGNATURE = '89504e470d0a1a0a'

// Minimal PNG decoder for screenshot-based matching; supports non-interlaced RGB/RGBA PNGs.
export function decodePng(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) {
    throw new Error('not a PNG file')
  }

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset); offset += 4
    const type = buffer.subarray(offset, offset + 4).toString('ascii'); offset += 4
    const data = buffer.subarray(offset, offset + length); offset += length
    offset += 4 // CRC

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      const interlace = data[12]
      if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`)
      if (![2, 6].includes(colorType)) throw new Error(`unsupported PNG color type ${colorType}`)
      if (interlace !== 0) throw new Error('interlaced PNG is not supported')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
  }

  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const inflated = inflateSync(Buffer.concat(idat))
  const rgba = new Uint8ClampedArray(width * height * 4)
  let src = 0
  let prev = new Uint8Array(stride)
  let cur = new Uint8Array(stride)

  for (let y = 0; y < height; y++) {
    const filter = inflated[src++]
    cur = Uint8Array.from(inflated.subarray(src, src + stride))
    src += stride
    unfilterScanline(cur, prev, channels, filter)

    for (let x = 0; x < width; x++) {
      const si = x * channels
      const di = (y * width + x) * 4
      rgba[di] = cur[si]
      rgba[di + 1] = cur[si + 1]
      rgba[di + 2] = cur[si + 2]
      rgba[di + 3] = channels === 4 ? cur[si + 3] : 255
    }

    prev = cur
  }

  return { width, height, rgba }
}

function unfilterScanline(cur, prev, bpp, filter) {
  for (let i = 0; i < cur.length; i++) {
    const left = i >= bpp ? cur[i - bpp] : 0
    const up = prev[i] || 0
    const upLeft = i >= bpp ? prev[i - bpp] || 0 : 0
    if (filter === 1) cur[i] = (cur[i] + left) & 255
    else if (filter === 2) cur[i] = (cur[i] + up) & 255
    else if (filter === 3) cur[i] = (cur[i] + Math.floor((left + up) / 2)) & 255
    else if (filter === 4) cur[i] = (cur[i] + paeth(left, up, upLeft)) & 255
    else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`)
  }
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}
