/**
 * 匹配工具类
 *
 * 集中存放匹配流程中跨模块复用的纯工具函数
 * （数学计算、几何工具、字符串相似度等），
 * 避免各文件重复定义，降低耦合。
 *
 * 所有方法均为 static，无需实例化。
 */

export class MatchTools {

  // ── 抛物线-高斯分段曲线 ─────────────────────────────────────────────────────
  /**
   * 抛物线-高斯分段曲线
   * - num1 === num2          → 1
   * - diff > diffmax         → 0
   * - diff ≤ point.x         → 抛物线段 1 - a·diff²
   * - diff > point.x         → 高斯段 exp(-diff²/2σ²)
   * 抛物线与高斯在 diff = point.x 处衔接，值均为 point.y。
   *
   * @param {number} num1     第一个值
   * @param {number} num2     第二个值
   * @param {{ x: number, y: number }} point  衔接点 (x=diff, y=取值)
   * @param {number} diffmax  最大差值，超过则返回 0
   * @returns {number} 0–1 分数
   */
  static gaussianCurveParabola(num1, num2, point, diffmax) {
    const diff = Math.abs(num1 - num2)
    if (num1 === num2) return 1
    if (diff > diffmax) return 0

    const { x, y } = point
    const a = (1 - y) / (x * x)
    const sigma = x / Math.sqrt(-2 * Math.log(y))

    let score
    if (diff <= x) {
      score = 1 - a * diff * diff
    } else {
      score = Math.exp(-(diff * diff) / (2 * sigma * sigma))
    }
    return parseFloat(score.toFixed(4))
  }

  // ── 数字精度 ─────────────────────────────────────────────────────────────────
  /** 保留 4 位小数 */
  static round4(n) {
    return parseFloat(n.toFixed(4))
  }

  // ── 简单高斯衰减 ─────────────────────────────────────────────────────────────
  /** dist=0→1，dist=σ→0.607 */
  static gauss(dist, sigma) {
    return Math.exp(-(dist * dist) / (2 * sigma * sigma))
  }

  // ── 二维几何 ─────────────────────────────────────────────────────────────────
  /** 欧氏距离 */
  static euclid(p, q) {
    return Math.hypot(p.x - q.x, p.y - q.y)
  }

  /** rect 面积 */
  static areaOf(r) {
    return r.w * r.h
  }

  /** rect 宽高比 */
  static aspectOf(r) {
    return r.h > 0 ? r.w / r.h : 0
  }

  /** rect 中心点 */
  static center(r) {
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
  }

  // ── 8 象限方位 ───────────────────────────────────────────────────────────────
  /**
   * 计算 P 相对 Q 的 8 象限方位编号（环形）
   *   2(正上)
   * 3(左上)  1(右上)
   * 4(正左)      0(正右)
   * 5(左下)  7(右下)
   *   6(正下)
   */
  static octant(px, py, qx, qy) {
    const angle = Math.atan2(-(py - qy), px - qx)
    let idx = Math.round(angle / (Math.PI / 4))
    idx = ((idx % 8) + 8) % 8
    return idx
  }

  /** 两个象限的环形距离 0..4 */
  static octantDist(a, b) {
    const d = Math.abs(a - b)
    return Math.min(d, 8 - d)
  }

  // ── Levenshtein 编辑距离 ────────────────────────────────────────────────────
  /** 计算编辑距离相似度 (0-1) */
  static levenshteinSimilarity(s1, s2) {
    if (!s1 || !s2) return 0
    if (s1 === s2) return 1

    const len1 = s1.length
    const len2 = s2.length
    const maxLen = Math.max(len1, len2)
    if (maxLen === 0) return 1

    const dp = Array(len2 + 1).fill(0).map(() => Array(len1 + 1).fill(0))

    for (let i = 0; i <= len1; i++) dp[0][i] = i
    for (let j = 0; j <= len2; j++) dp[j][0] = j

    for (let j = 1; j <= len2; j++) {
      for (let i = 1; i <= len1; i++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
        dp[j][i] = Math.min(
          dp[j][i - 1] + 1,
          dp[j - 1][i] + 1,
          dp[j - 1][i - 1] + cost,
        )
      }
    }

    const distance = dp[len2][len1]
    return 1 - distance / maxLen
  }

  // ── 向量余弦相似度 ───────────────────────────────────────────────────────────
  /** 直方图余弦相似度（用于 region 的 text/container 计数比对） */
  static histogramSimilarity(a, b) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    let dot = 0, aa = 0, bb = 0
    for (const key of keys) {
      const av = a[key] || 0
      const bv = b[key] || 0
      dot += av * bv
      aa += av * av
      bb += bv * bv
    }
    return aa && bb ? dot / Math.sqrt(aa * bb) : 0
  }

  // ── 数组统计 ─────────────────────────────────────────────────────────────────
  static average(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length
  }
}
