/**
 * 调试接口路由（仅供本地调试脚本使用，生产环境可整体移除此文件及 index.js 中的引用）
 *
 * GET /api/debug/parse/:caseId
 *   解析指定内置 case，返回两侧 UnifiedNode[] 及画布尺寸。
 *   供 scripts/analyzePass1.js、scripts/debugPass4.js 调用，
 *   复用 server 热启动的 Tesseract worker，避免脚本冷启动慢的问题。
 */

import { Router } from 'express'
import { readFileSync, existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

import { parseDesign } from '../parsers/design/index.js'
import { parseArkui }  from '../parsers/arkui/index.js'

const router = Router()

const __dirname = dirname(fileURLToPath(import.meta.url))
const CASES_DIR = resolve(__dirname, '../../../case')

router.get('/parse/:caseId', async (req, res) => {
  const { caseId } = req.params
  const caseDir = join(CASES_DIR, caseId)
  if (!existsSync(caseDir)) return res.status(404).json({ error: `case not found: ${caseId}` })

  try {
    const designJson = JSON.parse(readFileSync(join(caseDir, 'design.json'), 'utf8'))
    const arkuiJson  = JSON.parse(readFileSync(join(caseDir, 'arkui.json'), 'utf8'))
    const designImg  = readFileSync(join(caseDir, 'design.png'))
    const arkuiImg   = readFileSync(join(caseDir, 'arkui.png'))

    const [designResult, arkuiResult] = await Promise.all([
      parseDesign(designJson, { imageBuffer: designImg }),
      parseArkui(arkuiJson,   { imageBuffer: arkuiImg }),
    ])

    res.json({
      designNodes:    designResult.nodes,
      arkuiNodes:     arkuiResult.nodes,
      canvasWidth:    designResult.canvasWidth,
      canvasHeight:   designResult.canvasHeight,
      canvasWidthVp:  arkuiResult.canvasWidthVp,
      canvasHeightVp: arkuiResult.canvasHeightVp,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
