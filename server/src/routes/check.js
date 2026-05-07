/**
 * /api/check 路由
 * - GET  /api/cases                  列出可用的内置 case
 * - POST /api/check/case/:caseId     分析指定 case（从磁盘加载）
 * - POST /api/check/upload           分析上传的文件
 */

import { Router } from 'express'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import multer from 'multer'

import { parseDesign } from '../parsers/designParser.js'
import { parseArkui }  from '../parsers/arkuiParser.js'
import { matchNodes }  from '../matchers/nodeMatcher.js'
import { compareAll }  from '../comparators/styleComparator.js'
import { compareSpatialRelations } from '../comparators/spatialComparator.js'
import {
  annotatePixelVisibility,
  componentVisualDiff,
  extractNodeVisualFeatures,
} from '../utils/imageFeatures.js'
import { annotateTextOcrVisibility } from '../utils/textOcrVisibility.js'
import { isPipelineVisibleNode } from '../matchers/nodeVisibility.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

// case 数据根目录（相对于项目位置动态解析）
const __dirname = dirname(fileURLToPath(import.meta.url))
const CASES_DIR = resolve(__dirname, '../../../case')
const VISUAL_MATCHING_ENABLED = process.env.STYLE_CHECKER_VISUAL_MATCHING === 'true'
const DEFAULT_MATCH_DIRECTION = process.env.STYLE_CHECKER_MATCH_DIRECTION || 'arkui'

// ── 列出所有可用 case ─────────────────────────────────────────────────────────
router.get('/cases', (_req, res) => {
  try {
    if (!existsSync(CASES_DIR)) {
      return res.json({ cases: [] })
    }
    const cases = readdirSync(CASES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('case'))
      .map(d => {
        const dir = join(CASES_DIR, d.name)
        const hasAll = ['design.json', 'arkui.json', 'design.png', 'arkui.png']
          .every(f => existsSync(join(dir, f)))
        return { id: d.name, dir, hasAll }
      })
      .filter(c => c.hasAll)
      .sort((a, b) => {
        const na = parseInt(a.id.replace('case', ''))
        const nb = parseInt(b.id.replace('case', ''))
        return na - nb
      })
    res.json({ cases: cases.map(c => ({ id: c.id })) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── 获取 case 图片 ─────────────────────────────────────────────────────────────
router.get('/cases/:caseId/image/:type', (req, res) => {
  const { caseId, type } = req.params
  if (!['design', 'arkui'].includes(type)) return res.status(400).end()

  const imgPath = join(CASES_DIR, caseId, `${type}.png`)
  if (!existsSync(imgPath)) return res.status(404).end()

  res.setHeader('Content-Type', 'image/png')
  res.sendFile(imgPath)
})

// ── 分析内置 case ─────────────────────────────────────────────────────────────
router.post('/check/case/:caseId', async (req, res) => {
  const { caseId } = req.params
  const caseDir = join(CASES_DIR, caseId)

  if (!existsSync(caseDir)) {
    return res.status(404).json({ error: `Case ${caseId} not found` })
  }

  try {
    const designJson = JSON.parse(readFileSync(join(caseDir, 'design.json'), 'utf-8'))
    const arkuiJson  = JSON.parse(readFileSync(join(caseDir, 'arkui.json'),  'utf-8'))
    const result = await runCheck(designJson, arkuiJson, caseId, {
      designImageBuffer: readFileSync(join(caseDir, 'design.png')),
      arkuiImageBuffer: readFileSync(join(caseDir, 'arkui.png')),
      enableVisualMatching: shouldUseVisualMatching(req),
      matchDirection: matchDirectionFromRequest(req),
    })
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

// ── 分析上传文件 ───────────────────────────────────────────────────────────────
router.post(
  '/check/upload',
  upload.fields([
    { name: 'designJson', maxCount: 1 },
    { name: 'arkuiJson',  maxCount: 1 },
    { name: 'designImage', maxCount: 1 },
    { name: 'arkuiImage',  maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const files = req.files
      if (!files?.designJson || !files?.arkuiJson) {
        return res.status(400).json({ error: '缺少 designJson 或 arkuiJson 文件' })
      }
      if (!files?.arkuiImage) {
        return res.status(400).json({ error: 'OCR 主流程需要 arkuiImage 文件' })
      }
      const designJson = JSON.parse(files.designJson[0].buffer.toString('utf-8'))
      const arkuiJson  = JSON.parse(files.arkuiJson[0].buffer.toString('utf-8'))
      const result = await runCheck(designJson, arkuiJson, 'upload', {
        designImageBuffer: files.designImage?.[0]?.buffer,
        arkuiImageBuffer: files.arkuiImage?.[0]?.buffer,
        enableVisualMatching: shouldUseVisualMatching(req),
        matchDirection: matchDirectionFromRequest(req),
      })
      res.json(result)
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: err.message })
    }
  }
)

// ──────────────────────────────────────────────────────────────────────────────
// 核心分析流程
// ──────────────────────────────────────────────────────────────────────────────
async function runCheck(designJson, arkuiJson, caseId, assets = {}) {
  const t0 = Date.now()

  // 1. 解析
  const designResult = parseDesign(designJson)
  const arkuiResult  = parseArkui(arkuiJson)

  const pixelVisibility = assets.arkuiImageBuffer
    ? annotatePixelVisibility(arkuiResult.nodes, assets.arkuiImageBuffer, {
      w: arkuiResult.canvasWidthVp,
      h: arkuiResult.canvasHeightVp,
    }, { source: 'arkui' })
    : { checked: 0, hidden: 0 }
  const arkuiOcrVisibility = assets.arkuiImageBuffer
    ? await annotateTextOcrVisibility(arkuiResult.nodes, assets.arkuiImageBuffer, {
      w: arkuiResult.canvasWidthVp,
      h: arkuiResult.canvasHeightVp,
    }, {
      source: 'arkui',
      mode: 'all',
    })
    : { checked: 0, hidden: 0, matched: 0, ocrItems: 0 }
  const designPixelVisibility = assets.designImageBuffer
    ? annotatePixelVisibility(designResult.nodes, assets.designImageBuffer, {
      w: designResult.canvasWidth,
      h: designResult.canvasHeight,
    }, { source: 'design' })
    : { checked: 0, hidden: 0 }

  const designVisibleNodes = designResult.nodes.filter(isPipelineVisibleNode)
  const arkuiVisibleNodes = arkuiResult.nodes.filter(isPipelineVisibleNode)

  // 2. 匹配
  const {
    pairs,
    unmatchedDesign,
    unmatchedArkui,
    comparableDesignCount,
    comparableArkuiCount,
    regions,
  } = matchNodes(
    designVisibleNodes,
    arkuiVisibleNodes,
    {
      visualImages: assets.designImageBuffer && assets.arkuiImageBuffer ? {
        designBuffer: assets.designImageBuffer,
        arkuiBuffer: assets.arkuiImageBuffer,
        designCanvas: { w: designResult.canvasWidth, h: designResult.canvasHeight },
        arkuiCanvas: { w: arkuiResult.canvasWidthVp, h: arkuiResult.canvasHeightVp },
      } : null,
      primarySource: assets.matchDirection || DEFAULT_MATCH_DIRECTION,
    }
  )

  // 3. 样式比对，并将节点坐标挂到每条 diff 上（前端高亮用）
  const rectByPairKey = new Map(
    pairs.map(p => [`${p.design.id}::${p.arkui.id}`, { designRect: p.design.rect, arkuiRect: p.arkui.rect }])
  )
  const visualDiffs = buildComponentVisualDiffs(pairs, designResult, arkuiResult, assets)
  const spatialDiffs = compareSpatialRelations(pairs)
  const diffs = [...compareAll(pairs), ...spatialDiffs, ...visualDiffs].map(d => ({
    ...d,
    ...( rectByPairKey.get(`${d.designNodeId}::${d.arkuiNodeId}`) || {} ),
  }))

  // 4. 统计
  const errorCount   = diffs.filter(d => d.severity === 'error').length
  const warningCount = diffs.filter(d => d.severity === 'warning').length
  const infoCount    = diffs.filter(d => d.severity === 'info').length
  const matchCoverage = comparableDesignCount
    ? pairs.length / comparableDesignCount
    : 0
  const lowConfidencePairs = pairs.filter(p => p.confidence === 'low').length

  // 还原度评分：差异扣分 + 覆盖率扣分。匹配覆盖不足时分数不能虚高。
  const totalNodes = pairs.length || 1
  const penalty = (errorCount * 3 + warningCount * 1) / totalNodes
  const coveragePenalty = (1 - matchCoverage) * 25
  const lowConfidencePenalty = lowConfidencePairs / totalNodes * 10
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty * 10 - coveragePenalty - lowConfidencePenalty)))

  return {
    caseId,
    duration: Date.now() - t0,
    stats: {
      designNodes:    designVisibleNodes.length,
      arkuiNodes:     arkuiVisibleNodes.length,
      designNodesRaw: designResult.nodes.length,
      arkuiNodesRaw: arkuiResult.nodes.length,
      designNodesFilteredOut: designResult.nodes.length - designVisibleNodes.length,
      arkuiNodesFilteredOut: arkuiResult.nodes.length - arkuiVisibleNodes.length,
      comparableDesignNodes: comparableDesignCount,
      comparableArkuiNodes: comparableArkuiCount,
      matchedPairs:   pairs.length,
      unmatchedDesign: unmatchedDesign.length,
      unmatchedArkui:  unmatchedArkui.length,
      matchCoverage:   Number((matchCoverage * 100).toFixed(1)),
      matchDirection: assets.matchDirection || DEFAULT_MATCH_DIRECTION,
      lowConfidencePairs,
      pixelVisibilityChecked: pixelVisibility.checked,
      pixelInvisibleNodes: pixelVisibility.hidden,
      arkuiOcrVisibilityChecked: arkuiOcrVisibility.checked,
      arkuiOcrInvisibleTextNodes: arkuiOcrVisibility.hidden,
      arkuiOcrMatchedTextNodes: arkuiOcrVisibility.matched,
      arkuiOcrItems: arkuiOcrVisibility.ocrItems,
      designPixelVisibilityChecked: designPixelVisibility.checked,
      designPixelInvisibleNodes: designPixelVisibility.hidden,
      errorCount,
      warningCount,
      infoCount,
      score,
    },
    canvas: {
      design: { w: designResult.canvasWidth, h: designResult.canvasHeight },
      arkui:  { w: arkuiResult.canvasWidthVp, h: arkuiResult.canvasHeightVp, resolution: arkuiResult.resolution },
    },
    regions,
    diffs,
    allDesignNodes: (() => {
      const matchedIds = new Set(pairs.map(p => p.design.id))
      return designVisibleNodes.map(n => ({
        id: n.id,
        name: n.name,
        type: n.type,
        textContent: n.textContent || null,
        path: n.path,
        paintIndex: n.paintIndex ?? null,
        rect: n.rect,
        style: n.style,
        visible: n.visible !== false,
        visualOccluded: !!n.visualOccluded,
        visualOcclusionReason: n.visualOcclusionReason || null,
        pixelVisibility: n.pixelVisibility || null,
        ocrVisibility: n.ocrVisibility || null,
        matched: matchedIds.has(n.id),
      }))
    })(),
    allArkuiNodes: (() => {
      const matchedIds = new Set(pairs.map(p => p.arkui.id))
      return arkuiVisibleNodes.map(n => ({
        id: n.id,
        name: n.name,
        type: n.type,
        textContent: n.textContent || null,
        path: n.path,
        paintIndex: n.paintIndex ?? null,
        rect: n.rect,
        style: n.style,
        visible: n.visible !== false,
        hiddenFrameworkAncestor: !!n.hiddenFrameworkAncestor,
        visualOccluded: !!n.visualOccluded,
        visualOcclusionReason: n.visualOcclusionReason || null,
        pixelVisibility: n.pixelVisibility || null,
        matched: matchedIds.has(n.id),
      }))
    })(),
    pairs: pairs.map(p => ({
      matchType: p.matchType,
      iou: p.iou,
      confidence: p.confidence,
      topologyScore: p.topologyScore,
      visualScore: p.visualScore,
      regionScore: p.regionScore,
      designRegionId: p.designRegionId,
      arkuiRegionId: p.arkuiRegionId,
      isAnchor: p.isAnchor,
      design: { id: p.design.id, name: p.design.name, type: p.design.type, textContent: p.design.textContent || null, rect: p.design.rect, style: p.design.style, visible: p.design.visible !== false, visualOccluded: !!p.design.visualOccluded, visualOcclusionReason: p.design.visualOcclusionReason || null, pixelVisibility: p.design.pixelVisibility || null },
      arkui:  { id: p.arkui.id,  name: p.arkui.name,  type: p.arkui.type,  textContent: p.arkui.textContent  || null, rect: p.arkui.rect,  style: p.arkui.style,  visible: p.arkui.visible !== false,  hiddenFrameworkAncestor: !!p.arkui.hiddenFrameworkAncestor, visualOccluded: !!p.arkui.visualOccluded,  visualOcclusionReason: p.arkui.visualOcclusionReason || null, pixelVisibility: p.arkui.pixelVisibility || null, ocrVisibility: p.arkui.ocrVisibility || null  },
    })),
    unmatchedDesignNodes: unmatchedDesign.map(n => ({
      id:   n.id,
      name: n.name,
      type: n.type,
      textContent: n.textContent,
      rect: n.rect,
    })),
    unmatchedArkuiNodes: unmatchedArkui.map(n => ({
      id:   n.id,
      name: n.name,
      type: n.type,
      textContent: n.textContent,
      rect: n.rect,
    })),
  }
}

function buildComponentVisualDiffs(pairs, designResult, arkuiResult, assets) {
  if (!assets.designImageBuffer || !assets.arkuiImageBuffer) return []
  const visualPairs = pairs.filter(p =>
    p.confidence !== 'low' &&
    p.design.type !== 'text' &&
    p.arkui.type !== 'text' &&
    (p.design.type === 'image' || p.arkui.type === 'image' || hasVisualStyle(p.design) || hasVisualStyle(p.arkui))
  )
  if (!visualPairs.length) return []

  const designFeatures = extractNodeVisualFeatures(assets.designImageBuffer, {
    w: designResult.canvasWidth,
    h: designResult.canvasHeight,
  }, visualPairs.map(p => p.design))
  const arkuiFeatures = extractNodeVisualFeatures(assets.arkuiImageBuffer, {
    w: arkuiResult.canvasWidthVp,
    h: arkuiResult.canvasHeightVp,
  }, visualPairs.map(p => p.arkui))
  if (!designFeatures || !arkuiFeatures) return []

  const diffs = []
  for (const pair of visualPairs) {
    const metrics = componentVisualDiff(
      designFeatures.get(pair.design.id),
      arkuiFeatures.get(pair.arkui.id)
    )
    if (!metrics || metrics.similarity >= 0.68) continue
    diffs.push({
      property: 'visual.component',
      designValue: `similarity ${(metrics.similarity * 100).toFixed(0)}%`,
      arkuiValue: `diff ${(metrics.diff * 100).toFixed(0)}%`,
      severity: metrics.similarity < 0.50 ? 'warning' : 'info',
      description: `组件截图差异：前景 ${(metrics.foregroundDelta * 100).toFixed(0)}%，边缘 ${(metrics.edgeDelta * 100).toFixed(0)}%`,
      nodeType: pair.design.type,
      textContent: pair.design.textContent || null,
      designName: pair.design.name,
      arkuiName: pair.arkui.name,
      matchType: pair.matchType,
      confidence: pair.confidence,
      iou: pair.iou ?? null,
      topologyScore: pair.topologyScore ?? null,
      regionScore: pair.regionScore ?? null,
      designNodeId: pair.design.id,
      arkuiNodeId: pair.arkui.id,
    })
  }
  return diffs
}

function hasVisualStyle(node) {
  const s = node?.style || {}
  return !!(s.backgroundColor || s.border || s.gradient || s.shadow || s.backdropBlur || s.blur)
}

function shouldUseVisualMatching(req) {
  return VISUAL_MATCHING_ENABLED ||
    req.query.visual === '1' ||
    req.query.visualMatching === 'true' ||
    req.body?.visualMatching === true
}

function matchDirectionFromRequest(req) {
  const value = req.query.matchDirection || req.body?.matchDirection
  return value === 'design' || value === 'design-first' ? 'design' : DEFAULT_MATCH_DIRECTION
}

export default router
