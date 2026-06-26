/**
 * 基于 grid 文本对齐矩阵的离群锚点过滤（Pass 1 之后）
 *
 * 用 detectTextAlignment 产出的两侧 grid，对落在「同一对 grid」里的 Pass 1 锚点做
 * 结构共识投票，剔除与多数锚点结构矛盾的离群锚点（避免带偏后续拓扑）。
 *
 * 投票判据（两两锚点 i,j）：只看行（x 方向横排）一致性
 *   hm行号差 === de行号差
 * 列（y 方向同列上下）不一致一律忽略 —— 专抓「行错位」锚点。
 * 与过半锚点（冲突率 > 0.5）行结构矛盾即剔除，迭代至收敛。
 *
 * 典型场景：Pass 1 在「内容归一后等价」的同列动态文本（如各行价格「X元/月」）上产生
 * 错位锚点 —— 这些错位锚点在 grid 行列结构里与多数（内容唯一的会员名锚点）间隔不一致，
 * 被本过滤剔除，降级为普通候选交由后续 Pass 重新匹配。
 *
 * 不补配任何新对，只负责「清洗锚点」。
 *
 * @param {{ grids: (object|null)[][][] }} hmGroups detectTextAlignment 的 hm 侧结果
 * @param {{ grids: (object|null)[][][] }} deGroups detectTextAlignment 的 de 侧结果
 * @param {Array<{ design:object, arkui:object }>} anchorPairs Pass 1 锚点对
 * @returns {object[]} 被投票剔除的离群锚点 pair（调用方需从锚点集移除）
 */
export function dropGridOutlierAnchors(hmGroups, deGroups, anchorPairs) {
  const hmGrids = hmGroups?.grids ?? []
  const deGrids = deGroups?.grids ?? []
  if (!hmGrids.length || !deGrids.length) return []

  const hmIdx = indexGrids(hmGrids)
  const deIdx = indexGrids(deGrids)

  // 锚点在两侧 grid 中的位置：{ pair, hm:{g,r,c}, de:{g,r,c} }
  const anchorsInGrid = []
  for (const pair of anchorPairs) {
    const hp = hmIdx.get(pair.arkui?.id)
    const dp = deIdx.get(pair.design?.id)
    if (hp && dp) anchorsInGrid.push({ pair, hm: hp, de: dp })
  }
  if (!anchorsInGrid.length) return []

  // ── grid 配对：按共享锚点数贪心配对 hmGrid ↔ deGrid（每侧 grid 只用一次）──
  const shareCount = new Map() // "hg:dg" → 共享锚点数
  for (const a of anchorsInGrid) {
    const key = `${a.hm.g}:${a.de.g}`
    shareCount.set(key, (shareCount.get(key) || 0) + 1)
  }
  const usedHg = new Set()
  const usedDg = new Set()
  const gridPairs = []
  for (const [key] of [...shareCount.entries()].sort((x, y) => y[1] - x[1])) {
    const [hg, dg] = key.split(':').map(Number)
    if (usedHg.has(hg) || usedDg.has(dg)) continue
    usedHg.add(hg)
    usedDg.add(dg)
    gridPairs.push({ hg, dg })
  }

  // ── 逐对 grid 投票，收集被剔除的离群锚点 ──
  const droppedAnchors = []
  for (const { hg, dg } of gridPairs) {
    const anchors = anchorsInGrid.filter(a => a.hm.g === hg && a.de.g === dg)
    const { dropped } = voteFilterAnchors(anchors)
    for (const a of dropped) droppedAnchors.push(a.pair)
  }

  return droppedAnchors
}

/** 建立 nodeId → { g, r, c } 位置索引（g=grid 序号，r=行，c=列）*/
function indexGrids(grids) {
  const idx = new Map()
  grids.forEach((matrix, g) => {
    matrix.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell) idx.set(cell.id, { g, r, c })
      })
    })
  })
  return idx
}

/**
 * 行结构一致性投票：剔除与过半锚点行结构矛盾的「行错位」离群锚点。
 * 一致判据（两两）：hm行号差 === de行号差（列方向不一致一律忽略）。
 * 与过半锚点冲突（冲突率 > 0.5）即剔除；迭代至收敛（最多 2 轮）。
 */
function voteFilterAnchors(anchors) {
  const dropped = []
  let kept = anchors.slice()

  for (let iter = 0; iter < 2; iter++) {
    if (kept.length < 3) break // 锚点太少无群体共识可言，不过滤
    const survivors = []
    let removed = false
    for (let i = 0; i < kept.length; i++) {
      let conflict = 0
      for (let j = 0; j < kept.length; j++) {
        if (i === j) continue
        const a = kept[i]
        const b = kept[j]
        // 只看行（x 方向横排）一致性：hm 行号差 === de 行号差，专抓「行错位」锚点。
        // 列（y 方向同列上下）不一致一律忽略 —— 放宽规则。
        const rowConsistent = (a.hm.r - b.hm.r) === (a.de.r - b.de.r)
        if (!rowConsistent) conflict++
      }
      if (conflict / (kept.length - 1) > 0.5) {
        dropped.push(kept[i])
        removed = true
      } else {
        survivors.push(kept[i])
      }
    }
    kept = survivors
    if (!removed) break // 本轮无淘汰，已收敛
  }

  return { kept, dropped }
}
