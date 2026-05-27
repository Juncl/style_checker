/**
 * /api/check 路由
 * - GET  /api/cases?platform=                列出指定平台的可用 case
 * - GET  /api/cases/:caseId/image/:type?platform=
 * - POST /api/check/case/:caseId?platform=   分析指定 case（从磁盘加载）
 * - POST /api/check/upload                   分析上传的文件（platform 从 form 字段读）
 */

import { Router } from 'express'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import multer from 'multer'

import { parseDesign } from '../parsers/design/index.js'
import { parseArkui }  from '../parsers/arkui/index.js'
import { parseWeb }    from '../parsers/web/index.js'
import { matchNodes }  from '../matchers/nodeMatcher.js'
import { compareAll }  from '../comparators/styleComparator.js'
import { compareSpatialRelations } from '../comparators/spatialComparator.js'
import { getPlatform, resolvePlatform } from '../config/platforms.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

const DEFAULT_MATCH_DIRECTION = process.env.STYLE_CHECKER_MATCH_DIRECTION || 'arkui'

// 从请求里解析 platform key（query 优先，body 兜底）
function platformFromRequest(req) {
  return resolvePlatform(req.query?.platform || req.body?.platform || req.body?.deviceType)
}

// ── 列出所有可用 case ─────────────────────────────────────────────────────────
router.get('/cases', (req, res) => {
  try {
    const platform = getPlatform(platformFromRequest(req))
    const casesDir = platform.casesDir
    if (!existsSync(casesDir)) {
      return res.json({ cases: [] })
    }
    const requiredFiles = ['design.json', platform.devFile, 'design.png', platform.devImg]
    const cases = readdirSync(casesDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('case'))
      .map(d => {
        const dir = join(casesDir, d.name)
        const hasAll = requiredFiles.every(f => existsSync(join(dir, f)))
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
// type=design → design.png；type=arkui → 平台对应的开发侧图片（arkui.png 或 web.png）
router.get('/cases/:caseId/image/:type', (req, res) => {
  const { caseId, type } = req.params
  if (!['design', 'arkui'].includes(type)) return res.status(400).end()

  const platform = getPlatform(platformFromRequest(req))
  const fileName = type === 'design' ? 'design.png' : platform.devImg
  const imgPath = join(platform.casesDir, caseId, fileName)
  if (!existsSync(imgPath)) return res.status(404).end()

  res.setHeader('Content-Type', 'image/png')
  res.sendFile(imgPath)
})

// ── 分析内置 case ─────────────────────────────────────────────────────────────
router.post('/check/case/:caseId', async (req, res) => {
  const { caseId } = req.params
  const platform = getPlatform(platformFromRequest(req))
  const caseDir = join(platform.casesDir, caseId)

  if (!existsSync(caseDir)) {
    return res.status(404).json({ error: `Case ${caseId} not found for platform ${platform.key}` })
  }

  try {
    const designJson = JSON.parse(readFileSync(join(caseDir, 'design.json'), 'utf-8'))
    const devJson    = JSON.parse(readFileSync(join(caseDir, platform.devFile), 'utf-8'))
    const result = await runCheck(designJson, devJson, caseId, {
      designImageBuffer: readFileSync(join(caseDir, 'design.png')),
      devImageBuffer:    readFileSync(join(caseDir, platform.devImg)),
      matchDirection:    matchDirectionFromRequest(req),
      platform,
    })
    // 验证集：先尝试 platform 子目录，再回退到旧根目录（hmPhone 旧布局兼容）
    const validationPath = findValidationPath(platform, caseId)
    if (validationPath) {
      result.matchValidation = JSON.parse(readFileSync(validationPath, 'utf-8'))
    }
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
      const platform = getPlatform(platformFromRequest(req))
      // web 平台不需要图片，ArkUI 系仍要求开发侧图片用于 OCR
      if (platform.devType === 'arkui' && !files?.arkuiImage) {
        return res.status(400).json({ error: 'ArkUI 主流程需要 arkuiImage 文件' })
      }
      const designJson = JSON.parse(files.designJson[0].buffer.toString('utf-8'))
      const devJson    = JSON.parse(files.arkuiJson[0].buffer.toString('utf-8'))
      const result = await runCheck(designJson, devJson, 'upload', {
        designImageBuffer: files.designImage?.[0]?.buffer,
        devImageBuffer:    files.arkuiImage?.[0]?.buffer,
        matchDirection:    matchDirectionFromRequest(req),
        platform,
      })
      res.json(result)
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: err.message })
    }
  }
)

// 查找验证集文件路径，hmPhone 兼容旧的扁平结构
function findValidationPath(platform, caseId) {
  const primary = join(platform.validationDir, caseId, 'matchValidation.json')
  if (existsSync(primary)) return primary
  if (platform.validationFallbackDir) {
    const fallback = join(platform.validationFallbackDir, caseId, 'matchValidation.json')
    if (existsSync(fallback)) return fallback
  }
  return null
}

// ──────────────────────────────────────────────────────────────────────────────
// 核心分析流程
// ──────────────────────────────────────────────────────────────────────────────
async function runCheck(designJson, devJson, caseId, assets = {}) {
  const t0 = Date.now()
  const platform = assets.platform || getPlatform()

  // 1. 解析：先解开发侧拿到画布宽度，再据此缩放 design 坐标系
  const devResult = platform.devType === 'web'
    ? await parseWeb(devJson, { imageBuffer: assets.devImageBuffer })
    : await parseArkui(devJson, { imageBuffer: assets.devImageBuffer })

  const designResult = await parseDesign(designJson, {
    imageBuffer: assets.designImageBuffer,
    arkuiCanvasWidthVp: devResult.canvasWidthVp,
    designScale: platform.designScale,
  })

  const designVisibleNodes = designResult.nodes
  const devVisibleNodes    = devResult.nodes

  const devAnnotate    = devResult.annotateStats    || {}
  const designAnnotate = designResult.annotateStats || {}

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
    devVisibleNodes,
    {
      primarySource: assets.matchDirection || DEFAULT_MATCH_DIRECTION,
      canvasWidthVp: devResult.canvasWidthVp,
      canvasHeightVp: devResult.canvasHeightVp,
      canvasWidth: designResult.canvasWidth,
      canvasHeight: designResult.canvasHeight,
      platform: platform.key,
    }
  )

  // 3. 样式比对
  const rectByPairKey = new Map(
    pairs.map(p => [`${p.design.id}::${p.arkui.id}`, { designRect: p.design.rect, arkuiRect: p.arkui.rect }])
  )
  const spatialDiffs = compareSpatialRelations(pairs)
  const diffs = [...compareAll(pairs, { platform: platform.key }), ...spatialDiffs].map(d => ({
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

  const totalNodes = pairs.length || 1
  const penalty = (errorCount * 3 + warningCount * 1) / totalNodes
  const coveragePenalty = (1 - matchCoverage) * 25
  const lowConfidencePenalty = lowConfidencePairs / totalNodes * 10
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty * 10 - coveragePenalty - lowConfidencePenalty)))

  return {
    caseId,
    platform: platform.key,
    duration: Date.now() - t0,
    stats: {
      designNodes:    designVisibleNodes.length,
      arkuiNodes:     devVisibleNodes.length,
      comparableDesignNodes: comparableDesignCount,
      comparableArkuiNodes: comparableArkuiCount,
      matchedPairs:   pairs.length,
      unmatchedDesign: unmatchedDesign.length,
      unmatchedArkui:  unmatchedArkui.length,
      matchCoverage:   Number((matchCoverage * 100).toFixed(1)),
      matchDirection: assets.matchDirection || DEFAULT_MATCH_DIRECTION,
      lowConfidencePairs,
      pixelVisibilityChecked: devAnnotate.pixelChecked || 0,
      pixelInvisibleNodes: devAnnotate.pixelHidden || 0,
      arkuiOcrVisibilityChecked: devAnnotate.ocrChecked || 0,
      arkuiOcrInvisibleTextNodes: devAnnotate.ocrHidden || 0,
      arkuiOcrMatchedTextNodes: devAnnotate.ocrMatched || 0,
      arkuiOcrItems: devAnnotate.ocrItems || 0,
      designPixelVisibilityChecked: designAnnotate.pixelChecked || 0,
      designPixelInvisibleNodes: designAnnotate.pixelHidden || 0,
      errorCount,
      warningCount,
      infoCount,
      score,
    },
    canvas: {
      design: { w: designResult.canvasWidth, h: designResult.canvasHeight },
      arkui:  { w: devResult.canvasWidthVp, h: devResult.canvasHeightVp, resolution: devResult.resolution },
    },
    regions,
    diffs,
    allDesignNodes: (() => {
      const matchedIds = new Set(pairs.map(p => p.design.id))
      return designVisibleNodes.map(n => ({
        id: n.id,
        name: n.name,
        type: n.type,
        rawType: n.rawType || null,
        textContent: n.textContent || null,
        path: n.path,
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
      return devVisibleNodes.map(n => ({
        id: n.id,
        name: n.name,
        type: n.type,
        rawType: n.rawType || null,
        textContent: n.textContent || null,
        path: n.path,
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
      regionScore: p.regionScore,
      designRegionId: p.designRegionId,
      arkuiRegionId: p.arkuiRegionId,
      isAnchor: p.isAnchor,
      design: { id: p.design.id, name: p.design.name, type: p.design.type, rawType: p.design.rawType || null, textContent: p.design.textContent || null, rect: p.design.rect, style: p.design.style, visible: p.design.visible !== false, visualOccluded: !!p.design.visualOccluded, visualOcclusionReason: p.design.visualOcclusionReason || null, pixelVisibility: p.design.pixelVisibility || null },
      arkui:  { id: p.arkui.id,  name: p.arkui.name,  type: p.arkui.type,  rawType: p.arkui.rawType || null, textContent: p.arkui.textContent  || null, rect: p.arkui.rect,  style: p.arkui.style,  visible: p.arkui.visible !== false,  hiddenFrameworkAncestor: !!p.arkui.hiddenFrameworkAncestor, visualOccluded: !!p.arkui.visualOccluded,  visualOcclusionReason: p.arkui.visualOcclusionReason || null, pixelVisibility: p.arkui.pixelVisibility || null, ocrVisibility: p.arkui.ocrVisibility || null  },
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

function matchDirectionFromRequest(req) {
  const value = req.query.matchDirection || req.body?.matchDirection
  return value === 'design' || value === 'design-first' ? 'design' : DEFAULT_MATCH_DIRECTION
}

export default router
