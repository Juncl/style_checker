/**
 * 像素对比 - 差异提取
 *
 * 输入: 对齐后的两侧 sharp 实例 + 画布尺寸
 * 流程:
 *   1. 两侧转灰度 raw buffer
 *   2. 逐像素做 |a-b| > threshold 的判定,生成差异位图
 *   3. 差异位图做 8-连通域聚类(BFS),过滤面积过小的连通域
 *   4. 每个连通域输出 bbox + area + diffRatio + severity
 *
 * 输出差异块坐标系: 绝对像素(基于 devImage 尺寸),
 * 后续 mapToNode 会把像素坐标换算到节点的 rect 坐标系。
 */
import sharp from 'sharp'

// 像素差异阈值:灰度差 > 此值视为差异像素
const DIFF_THRESHOLD = 30

// 最小连通域面积(像素数),小于此值忽略(抗噪声)
const MIN_AREA = 200

// 最小差异率,低于 35% 的连通域不报(认为视觉一致)
const MIN_DIFF_RATIO = 0.35

// 严重等级阈值(diffRatio = area / bboxArea)
const SEVERITY_HIGH = 0.85
const SEVERITY_MID = 0.6

/**
 * 取灰度 raw buffer
 * @param {sharp.Sharp} img
 * @param {number} w
 * @param {number} h
 * @returns {Promise<Buffer>} 长度 w*h 的 Uint8 buffer
 */
async function toGrayRaw(img, w, h) {
  const { data } = await img
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return data
}

/**
 * 生成差异位图
 * @returns {{ diffMask: Uint8Array, width: number, height: number, diffPixelCount: number }}
 */
async function buildDiffMask(designImg, devImg, w, h) {
  const a = await toGrayRaw(designImg, w, h)
  const b = await toGrayRaw(devImg, w, h)

  const diffMask = new Uint8Array(w * h)
  let count = 0
  for (let i = 0; i < w * h; i++) {
    if (Math.abs(a[i] - b[i]) > DIFF_THRESHOLD) {
      diffMask[i] = 1
      count++
    }
  }
  return { diffMask, width: w, height: h, diffPixelCount: count }
}

/**
 * 8-连通域聚类(BFS),返回连通域列表
 * @returns {Array<{ minX, minY, maxX, maxY, area }>}
 */
function findConnectedComponents(diffMask, w, h) {
  const visited = new Uint8Array(w * h)
  const components = []

  const stack = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (!diffMask[idx] || visited[idx]) continue

      // BFS 起点
      stack.length = 0
      stack.push(idx)
      visited[idx] = 1

      let minX = x, minY = y, maxX = x, maxY = y, area = 0
      while (stack.length) {
        const cur = stack.pop()
        const cx = cur % w
        const cy = (cur - cx) / w
        area++

        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy

        // 8 邻接
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = cx + dx
            const ny = cy + dy
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
            const nidx = ny * w + nx
            if (diffMask[nidx] && !visited[nidx]) {
              visited[nidx] = 1
              stack.push(nidx)
            }
          }
        }
      }

      if (area >= MIN_AREA) {
        components.push({ minX, minY, maxX, maxY, area })
      }
    }
  }
  return components
}

/**
 * 计算严重等级
 * @param {number} diffRatio - area / bboxArea
 * @returns {'high'|'mid'|'low'}
 */
function classifySeverity(diffRatio) {
  if (diffRatio > SEVERITY_HIGH) return 'high'
  if (diffRatio > SEVERITY_MID) return 'mid'
  return 'low'
}

/**
 * 从对齐后的两侧图提取差异块
 * @param {sharp.Sharp} designImg
 * @param {sharp.Sharp} devImg
 * @param {number} w
 * @param {number} h
 * @returns {Promise<Array>} diffBlocks
 */
export async function extractDiffBlocks(designImg, devImg, w, h) {
  const { diffMask } = await buildDiffMask(designImg, devImg, w, h)
  const components = findConnectedComponents(diffMask, w, h)

  // 合并距离很近的连通域(避免一个真实差异被切成多块)
  // 用简单的 bbox 膨胀合并:相邻 bbox 间距 < GAP 的合并
  const GAP = 20
  const merged = mergeNearbyBoxes(components, GAP)

  return merged.map((c, i) => {
    const bboxW = c.maxX - c.minX + 1
    const bboxH = c.maxY - c.minY + 1
    const bboxArea = bboxW * bboxH
    const diffRatio = bboxArea > 0 ? c.area / bboxArea : 0
    return {
      id: `PX-${String(i + 1).padStart(3, '0')}`,
      bbox: { x: c.minX, y: c.minY, w: bboxW, h: bboxH },
      area: c.area,
      diffRatio: Number(diffRatio.toFixed(4)),
      severity: classifySeverity(diffRatio),
      matchedNodeId: null,
      matchedNodeName: null,
    }
  }).filter(b => b.diffRatio >= MIN_DIFF_RATIO)  // 过滤掉差异率 < 35% 的块
}

/**
 * 合并相邻 bbox(简单贪心,直到无变化为止)
 */
function mergeNearbyBoxes(boxes, gap) {
  if (boxes.length === 0) return []
  let arr = boxes.map(b => ({ ...b }))
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (boxesNear(arr[i], arr[j], gap)) {
          arr[i] = mergeBox(arr[i], arr[j])
          arr.splice(j, 1)
          changed = true
          break
        }
      }
      if (changed) break
    }
  }
  return arr
}

function boxesNear(a, b, gap) {
  // 两个 bbox 间距 < gap 视为相邻(任意方向)
  const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX))
  const dy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY))
  return dx <= gap && dy <= gap
}

function mergeBox(a, b) {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    area: a.area + b.area,
  }
}
