/**
 * 调试接口路由（仅供本地调试脚本使用，生产环境可整体移除此文件及 index.js 中的引用）
 *
 * GET /api/debug/parse/:caseId?platform=hmPhone|hmWatch|web
 *   解析指定平台的内置 case，返回两侧 UnifiedNode[] 及画布尺寸。
 *   供 scripts/analyzePass1.js、scripts/debugPass4.js 调用，
 *   复用 server 热启动的 Tesseract worker，避免脚本冷启动慢的问题。
 */

import { Router } from 'express'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

import { parseDesign } from '../parsers/design/index.js'
import { parseArkui }  from '../parsers/arkui/index.js'
import { parseWeb }    from '../parsers/web/index.js'
import { buildArkuiTree } from '../parsers/arkui/1-buildTree.js'
import { buildDumpTree }  from '../parsers/arkui/1-buildDumpTree.js'
import { pruneArkuiTree } from '../parsers/arkui/2-pruneTree.js'
import { annotateArkuiTree } from '../parsers/arkui/3-annotateTree.js'
import { flattenArkuiTree }  from '../parsers/arkui/4-flattenTree.js'
import { normalizeTree }     from '../utils/normalizeTree.js'
import { getPlatform, resolvePlatform } from '../config/platforms.js'

const router = Router()

router.get('/parse/:caseId', async (req, res) => {
  const { caseId } = req.params
  const platform = getPlatform(resolvePlatform(req.query?.platform))
  const caseDir = join(platform.casesDir, caseId)
  if (!existsSync(caseDir)) return res.status(404).json({ error: `case not found: ${caseId} (platform ${platform.key})` })

  try {
    const designJson = JSON.parse(readFileSync(join(caseDir, 'design.json'), 'utf8'))
    // dump 文件按字符串读，JSON 文件解析为对象
    const devFileRaw = readFileSync(join(caseDir, platform.devFile), 'utf8')
    const devInput   = platform.devFile.endsWith('.dump') ? devFileRaw : JSON.parse(devFileRaw)
    const designImg  = readFileSync(join(caseDir, 'design.png'))
    const devImg     = readFileSync(join(caseDir, platform.devImg))

    const devResult = platform.devType === 'web'
      ? await parseWeb(devInput, { imageBuffer: devImg })
      : await parseArkui(devInput, { imageBuffer: devImg })

    const designResult = await parseDesign(designJson, {
      imageBuffer: designImg,
      arkuiCanvasWidthVp: devResult.canvasWidthVp,
      designScale: platform.designScale,
    })

    res.json({
      platform: platform.key,
      designNodes:    designResult.nodes,
      arkuiNodes:     devResult.nodes,
      canvasWidth:    designResult.canvasWidth,
      canvasHeight:   designResult.canvasHeight,
      canvasWidthVp:  devResult.canvasWidthVp,
      canvasHeightVp: devResult.canvasHeightVp,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── /api/debug/arkui-steps/:caseId ───────────────────────────────────────────
// 返回 arkui 流水线每个 step 之后的节点数（含子树扁平化），用于诊断 dump vs JSON 差异
router.get('/arkui-steps/:caseId', async (req, res) => {
  const { caseId } = req.params
  const platform = getPlatform(resolvePlatform(req.query?.platform))
  const caseDir = join(platform.casesDir, caseId)
  if (!existsSync(caseDir)) return res.status(404).json({ error: `case not found: ${caseId} (platform ${platform.key})` })
  if (platform.devType !== 'arkui') return res.status(400).json({ error: `platform ${platform.key} is not arkui` })

  try {
    const devFileRaw = readFileSync(join(caseDir, platform.devFile), 'utf8')
    const isDump = platform.devFile.endsWith('.dump')
    const devInput = isDump ? devFileRaw : JSON.parse(devFileRaw)
    const devImg = readFileSync(join(caseDir, platform.devImg))

    // step1
    const { canvasWidthVp, canvasHeightVp, resolution, root } =
      isDump ? buildDumpTree(devInput) : buildArkuiTree(devInput)
    const step1 = countTree(root)

    // step2 前：dry-run 统计每个节点的硬剪枝原因
    const hardReasonStats = dryRunHardPrune(root, canvasWidthVp, canvasHeightVp)
    // 同时记录一些样本节点（每种原因取前 5 个）
    const sampleLimit = Number(req.query?.sampleLimit) || 5
    const hardReasonSamples = sampleByReason(root, canvasWidthVp, canvasHeightVp, sampleLimit)
    // 额外统计被剪节点的 name 分布（按 reason 分组）
    const reasonByName = nameByReason(root, canvasWidthVp, canvasHeightVp)

    // 若 query 给了 nodeIds=1,124,165 则返回这些节点 step1 后的详细状态
    const nodeIds = String(req.query?.nodeIds || '').split(',').map(s => s.trim()).filter(Boolean)
    const nodeDetails = nodeIds.length ? lookupNodes(root, nodeIds, canvasWidthVp, canvasHeightVp) : null

    pruneArkuiTree(root, canvasWidthVp, canvasHeightVp)
    const step2 = countTree(root)

    // step2.5
    normalizeTree(root)
    const step25 = countTree(root)

    // step3
    const { stats: annotateStats } = await annotateArkuiTree(root, {
      imageBuffer: devImg, canvasWidthVp, canvasHeightVp,
    })
    const step3 = countTree(root)

    // step4
    const nodes = flattenArkuiTree(root)

    res.json({
      platform: platform.key,
      format: isDump ? 'dump' : 'json',
      canvasWidthVp, canvasHeightVp, resolution,
      counts: {
        step1_buildTree:    step1,
        step2_pruneTree:    step2,
        step2_5_normalize:  step25,
        step3_annotateTree: step3,
        step4_flatten:      nodes.length,
      },
      hardPrune: { reasonStats: hardReasonStats, samples: hardReasonSamples, reasonByName },
      nodeDetails,
      annotateStats,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message, stack: err.stack })
  }
})

function countTree(node) {
  if (!node) return 0
  let n = 1
  for (const c of node.children || []) n += countTree(c)
  return n
}

// 复制 2-pruneTree.js 的硬剪枝判定逻辑（dry-run 用，不修改树）
const TEXT_TYPES_PRUNE = new Set(['Text'])
function hardPruneReasonDry(node, canvasW, canvasH) {
  const attrs = node._attrs || {}
  const type = node.name
  const rawType = String(type || '').toLowerCase()
  if (attrs.visibility === 'Visibility.Hidden') return 'visibility-hidden'
  const op = Number(attrs.opacity)
  if (Number.isFinite(op) && op <= 0 && attrs.opacity !== '' && attrs.opacity !== undefined && attrs.opacity !== null) return 'opacity-zero'
  if (rawType === 'leftarrow' || rawType === 'rightarrow') return 'special-component'
  if (!node._rectRaw && !node._frameworkType && !node._spanType) return 'no-rect'
  const r = node.rect
  if (r && r.w > 0 && r.h > 0 && (r.x > canvasW || r.y > canvasH || r.x + r.w <= 0 || r.y + r.h <= 0)) return 'out-of-bounds'
  if (r && r.w > canvasW * 3) return 'too-wide'
  if (TEXT_TYPES_PRUNE.has(type) && String(node.textContent || '').trim().length === 0) return 'empty-text'
  return null
}

function dryRunHardPrune(root, canvasW, canvasH) {
  const stats = { kept: 0 }
  function walk(node) {
    if (!node) return
    const reason = hardPruneReasonDry(node, canvasW, canvasH)
    if (reason) stats[reason] = (stats[reason] || 0) + 1
    else stats.kept += 1
    for (const c of node.children || []) walk(c)
  }
  walk(root)
  return stats
}

function nameByReason(root, canvasW, canvasH) {
  // { reason: { name: count } }
  const out = {}
  function walk(node) {
    if (!node) return
    const reason = hardPruneReasonDry(node, canvasW, canvasH)
    if (reason) {
      const bucket = out[reason] = out[reason] || {}
      const k = node.name || '(unknown)'
      bucket[k] = (bucket[k] || 0) + 1
    }
    for (const c of node.children || []) walk(c)
  }
  walk(root)
  return out
}

function lookupNodes(root, ids, canvasW, canvasH) {
  const wanted = new Set(ids)
  const out = []
  function walk(node, ancestors) {
    if (!node) return
    if (wanted.has(String(node.id))) {
      const reason = hardPruneReasonDry(node, canvasW, canvasH)
      out.push({
        id: node.id, name: node.name, rawType: node.rawType,
        rect: node.rect, normRect: node.normRect, hasRectRaw: !!node._rectRaw,
        framework: !!node._frameworkType, attrs: node._attrs,
        hardPruneReason: reason,
        ancestorReasons: ancestors.map(a => ({
          id: a.id, name: a.name, reason: hardPruneReasonDry(a, canvasW, canvasH),
          rect: a.rect,
        })),
      })
    }
    const next = ancestors.concat(node === root ? [] : [node])
    for (const c of node.children || []) walk(c, next)
  }
  walk(root, [])
  return out
}

function sampleByReason(root, canvasW, canvasH, limit) {
  const samples = {}
  function walk(node) {
    if (!node) return
    const reason = hardPruneReasonDry(node, canvasW, canvasH)
    if (reason) {
      const arr = samples[reason] = samples[reason] || []
      if (arr.length < limit) {
        arr.push({
          id: node.id, name: node.name, rawType: node.rawType,
          rect: node.rect, hasRectRaw: !!node._rectRaw,
          framework: !!node._frameworkType, attrs: node._attrs,
          textContent: node.textContent,
        })
      }
    }
    for (const c of node.children || []) walk(c)
  }
  walk(root)
  return samples
}

export default router
