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
import { getPlatform, resolvePlatform } from '../config/platforms.js'

const router = Router()

router.get('/parse/:caseId', async (req, res) => {
  const { caseId } = req.params
  const platform = getPlatform(resolvePlatform(req.query?.platform))
  const caseDir = join(platform.casesDir, caseId)
  if (!existsSync(caseDir)) return res.status(404).json({ error: `case not found: ${caseId} (platform ${platform.key})` })

  try {
    const designJson = JSON.parse(readFileSync(join(caseDir, 'design.json'), 'utf8'))
    const devJson    = JSON.parse(readFileSync(join(caseDir, platform.devFile), 'utf8'))
    const designImg  = readFileSync(join(caseDir, 'design.png'))
    const devImg     = readFileSync(join(caseDir, platform.devImg))

    const devResult = platform.devType === 'web'
      ? await parseWeb(devJson, { imageBuffer: devImg })
      : await parseArkui(devJson, { imageBuffer: devImg })

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

export default router
