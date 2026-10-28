import sharp from 'sharp'

const HASH_SIZE = 16

async function computePHash(imagePath) {
  const img = sharp(imagePath)
  const { data } = await img
    .greyscale()
    .resize(HASH_SIZE, HASH_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pixels = Array.from(data)
  const avg = pixels.reduce((s, p) => s + p, 0) / pixels.length
  const bits = pixels.map(p => (p > avg ? 1 : 0))

  let hash = BigInt(0)
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) hash |= BigInt(1) << BigInt(i)
  }
  return hash
}

function hammingDistance(a, b) {
  let x = a ^ b
  let count = 0
  while (x) {
    count++
    x &= x - BigInt(1)
  }
  return count
}

export async function imageSimilarity(pathA, pathB) {
  const [hashA, hashB] = await Promise.all([computePHash(pathA), computePHash(pathB)])
  const distance = hammingDistance(hashA, hashB)
  const maxBits = HASH_SIZE * HASH_SIZE
  return 1 - distance / maxBits
}
