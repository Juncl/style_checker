/**
 * /api/version 路由 — ArkUI 版本对比
 *
 * 对比同一页面两个版本的 ArkUI Inspector 数据（旧版 base vs 新版 target），
 * 输出节点匹配对、样式差异、一致度评分。
 *
 * - POST /api/version/compare   分析上传的两个版本文件
 *   multipart 字段：
 *     baseJson    (必填) 旧版本 arkui JSON（或 dump 文本）
 *     targetJson  (必填) 新版本 arkui JSON（或 dump 文本）
 *     baseImage   (可选) 旧版本截图 png，用于像素可见性标注
 *     targetImage (可选) 新版本截图 png
 *
 * 实现说明：
 *   - 复用 parseArkui / matchNodes / compareAll，不修改任何现有模块
 *   - base 侧进入 matchNodes 的 design 槽位，target 侧进入 arkui 槽位
 *   - 输出结构与 runCheck 对齐（design=base 旧版本、arkui=target 新版本），
 *     可直接作为 POST /api/report/html 的 result 入参，复用现有可视化报告
 *   - 两侧均为 ArkUI 数据，画布不一致时无法对齐坐标，直接报 500
 */

import { Router } from 'express'
import multer from 'multer'

import { parseArkui } from '../parsers/arkui/index.js'
import { buildDumpTree } from '../parsers/arkui/1-buildDumpTree.js'
import { matchNodes } from '../matchers/index.js'
import { compareAll } from '../comparators/styleComparator.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

// 画布尺寸允许误差（vp）：两侧分辨率导出精度抖动
const CANVAS_TOLERANCE_VP = 1

/**
 * 输入归一化：JSON 文本 → 对象；其余视为 ArkUI Inspector dump 文本
 * （与 /api/check/upload 的开发侧识别规则保持一致）
 */
function normalizeArkuiInput(rawText) {
  const trimmed = rawText.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(rawText)
  }
  const { canvasWidthVp, canvasHeightVp, resolution, root } = buildDumpTree(rawText)
  return { _sourceFormat: 'dump', canvasWidthVp, canvasHeightVp, resolution, root }
}

/**
 * 版本对比核心流程
 *
 * @param {object} baseJson    旧版本 arkui 输入（JSON 对象或 dump 包装对象）
 * @param {object} targetJson  新版本 arkui 输入
 * @param {{ baseImageBuffer?: Buffer, targetImageBuffer?: Buffer }} assets
 * @returns {object} runCheck 同构的结果（design 槽位 = base，arkui 槽位 = target）
 */
export async function runVersionCheck(baseJson, targetJson, assets = {}) {
  const t0 = Date.now()

  // 1. 双侧解析（两侧均为 ArkUI 数据，走同一条解析流水线）
  const baseResult = await parseArkui(baseJson, { imageBuffer: assets.baseImageBuffer })
  const targetResult = await parseArkui(targetJson, { imageBuffer: assets.targetImageBuffer })

  // 2. 画布一致性校验：不一致时绝对坐标不可比，直接失败
  const wDelta = Math.abs(baseResult.canvasWidthVp - targetResult.canvasWidthVp)
  const hDelta = Math.abs(baseResult.canvasHeightVp - targetResult.canvasHeightVp)
  if (wDelta > CANVAS_TOLERANCE_VP || hDelta > CANVAS_TOLERANCE_VP) {
    throw new Error(
      `两侧画布尺寸不一致（base ${baseResult.canvasWidthVp.toFixed(1)}x${baseResult.canvasHeightVp.toFixed(1)} vp，` +
      `target ${targetResult.canvasWidthVp.toFixed(1)}x${targetResult.canvasHeightVp.toFixed(1)} vp），` +
      `无法进行版本对比，请使用相同设备与分辨率重新导出`
    )
  }

  // 3. 节点匹配：base 进入 design 槽位、target 进入 arkui 槽位（两侧画布一致，rect 直接可比）
  const {
    pairs,
    unmatchedDesign,
    unmatchedArkui,
    comparableDesignCount,
    comparableArkuiCount,
  } = matchNodes(baseResult.nodes, targetResult.nodes, {
    canvasWidthVp: targetResult.canvasWidthVp,
    canvasHeightVp: targetResult.canvasHeightVp,
    canvasWidth: baseResult.canvasWidthVp,
    canvasHeight: baseResult.canvasHeightVp,
    platform: 'hmPhone',
  })

  // 4. 样式比对 + diff 后处理
  //    与 runCheck 一致：diff 附带两侧 rect；
  //    额外增加误报过滤：两侧展示值完全相同的 diff 直接丢弃
  //    （规避多色字符串 "#FFCE0E2D, #FFFFFFFF" 在 colorDelta 中解析失败产生的假 error）
  const rawDiffs = compareAll(pairs, { platform: 'hmPhone' })
  const rectByPairKey = new Map(
    pairs.map(p => [`${p.design.id}::${p.arkui.id}`, { designRect: p.design.rect, arkuiRect: p.arkui.rect }])
  )
  const diffs = []
  for (const d of rawDiffs) {
    if (String(d.designValue) === String(d.arkuiValue)) continue
    diffs.push({ ...d, ...(rectByPairKey.get(`${d.designNodeId}::${d.arkuiNodeId}`) || {}) })
  }

  // 5. 统计与评分（沿用现有评分公式的量纲，语义为"版本间一致度"）
  const errorCount = diffs.filter(d => d.severity === 'error').length
  const warningCount = diffs.filter(d => d.severity === 'warning').length
  // matchCoverage 需 clamp 到 1：text-con-列表 等 Pass 允许不可比容器进入 pairs，
  // 分母（comparable 数）小于分子（pairs 数）时会出现 >100% 的覆盖率，进而拉高评分
  const matchCoverage = comparableDesignCount
    ? Math.min(1, pairs.length / comparableDesignCount)
    : 0
  const lowConfidencePairs = pairs.filter(p => p.confidence === 'low').length
  const totalNodes = pairs.length || 1
  const penalty = (errorCount * 3 + warningCount * 1) / totalNodes
  const coveragePenalty = (1 - matchCoverage) * 25
  const lowConfidencePenalty = (lowConfidencePairs / totalNodes) * 10
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty * 10 - coveragePenalty - lowConfidencePenalty)))

  const matchedDesignIds = new Set(pairs.map(p => p.design.id))
  const matchedArkuiIds = new Set(pairs.map(p => p.arkui.id))

  return {
    // 版本对比标识：design 槽位 = base（旧版本），arkui 槽位 = target（新版本）
    compareType: 'arkui-version',
    caseId: 'version-compare',
    platform: 'hmPhone',
    duration: Date.now() - t0,
    stats: {
      designNodes: baseResult.nodes.length,
      arkuiNodes: targetResult.nodes.length,
      comparableDesignNodes: comparableDesignCount,
      comparableArkuiNodes: comparableArkuiCount,
      matchedPairs: pairs.length,
      unmatchedDesign: unmatchedDesign.length,
      unmatchedArkui: unmatchedArkui.length,
      matchCoverage: Number((matchCoverage * 100).toFixed(1)),
      lowConfidencePairs,
      errorCount,
      warningCount,
      score,
      basePixelVisibilityChecked: baseResult.annotateStats?.pixelChecked || 0,
      basePixelInvisibleNodes: baseResult.annotateStats?.pixelHidden || 0,
      targetPixelVisibilityChecked: targetResult.annotateStats?.pixelChecked || 0,
      targetPixelInvisibleNodes: targetResult.annotateStats?.pixelHidden || 0,
    },
    canvas: {
      design: { w: baseResult.canvasWidthVp, h: baseResult.canvasHeightVp },
      arkui: { w: targetResult.canvasWidthVp, h: targetResult.canvasHeightVp, resolution: targetResult.resolution },
    },
    diffs,
    allDesignNodes: baseResult.nodes.map(n => ({
      id: n.id,
      name: n.name,
      type: n.type,
      rawType: n.rawType || null,
      textContent: n.textContent || null,
      path: n.path,
      rect: n.rect,
      style: n.style,
      matched: matchedDesignIds.has(n.id),
    })),
    allArkuiNodes: targetResult.nodes.map(n => ({
      id: n.id,
      name: n.name,
      type: n.type,
      rawType: n.rawType || null,
      textContent: n.textContent || null,
      path: n.path,
      rect: n.rect,
      style: n.style,
      matched: matchedArkuiIds.has(n.id),
    })),
    pairs: pairs.map(p => ({
      matchDetail: p.matchDetail,
      iou: p.iou,
      confidence: p.confidence,
      topologyScore: p.topologyScore,
      isAnchor: p.isAnchor,
      design: { id: p.design.id, name: p.design.name, type: p.design.type, rawType: p.design.rawType || null, textContent: p.design.textContent || null, rect: p.design.rect, style: p.design.style },
      arkui: { id: p.arkui.id, name: p.arkui.name, type: p.arkui.type, rawType: p.arkui.rawType || null, textContent: p.arkui.textContent || null, rect: p.arkui.rect, style: p.arkui.style },
    })),
    unmatchedDesignNodes: unmatchedDesign.map(n => ({ id: n.id, name: n.name, type: n.type, textContent: n.textContent, rect: n.rect })),
    unmatchedArkuiNodes: unmatchedArkui.map(n => ({ id: n.id, name: n.name, type: n.type, textContent: n.textContent, rect: n.rect })),
  }
}

// ── 分析上传的两个版本文件 ────────────────────────────────────────────────────
router.post(
  '/compare',
  upload.fields([
    { name: 'baseJson', maxCount: 1 },
    { name: 'targetJson', maxCount: 1 },
    { name: 'baseImage', maxCount: 1 },
    { name: 'targetImage', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const files = req.files
      if (!files?.baseJson || !files?.targetJson) {
        return res.status(400).json({ error: '缺少 baseJson 或 targetJson 文件' })
      }

      const baseJson = normalizeArkuiInput(files.baseJson[0].buffer.toString('utf-8'))
      const targetJson = normalizeArkuiInput(files.targetJson[0].buffer.toString('utf-8'))

      const result = await runVersionCheck(baseJson, targetJson, {
        baseImageBuffer: files.baseImage?.[0]?.buffer,
        targetImageBuffer: files.targetImage?.[0]?.buffer,
      })
      res.json(result)
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: err.message })
    }
  }
)

export default router
