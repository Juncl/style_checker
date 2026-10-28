/**
 * Excel 报告生成(带节点局部切图,双工作表)
 *
 * 表头(严格按需求):
 *   节点对比 tab: id | 页面 | 模块 | 严重等级 | 问题类型 | 问题描述 | 差异 | 修复建议 | 设计稿截图 | 开发截图
 *   像素对比 tab: id | 页面 | 模块 | 严重等级 | 问题类型 | 问题描述 | 设计稿截图 | 开发截图
 *
 * 切图:
 *   - design.png 用 issue.designRect + designCanvas 换算
 *   - arkui.png 用 issue.devRect + devCanvas 换算
 *   - 纯像素块(无画布坐标)rect 为像素坐标,canvasSize 传 null 不换算
 *
 * 依赖 exceljs + sharp(skill 专属,build.js 注入 package.json)
 */
import ExcelJS from 'exceljs'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { getSessionDir, getSessionTimestamp } from '../utils/session.js'
import { cropNodeImage } from './cropImage.js'

// 节点对比 tab:完整 10 列(含修复建议、差异)
const NODE_HEADERS = [
  { header: 'id',         key: 'id',         width: 16 },
  { header: '页面',       key: 'page',       width: 10 },
  { header: '模块',       key: 'module',     width: 40 },
  { header: '严重等级',   key: 'severity',   width: 10 },
  { header: '问题类型',   key: 'issueType',   width: 14 },
  { header: '问题描述',   key: 'description', width: 40 },
  { header: '差异',       key: 'diff',        width: 40 },
  { header: '修复建议',   key: 'suggestion',  width: 40 },
  { header: '设计稿截图', key: 'designImage', width: 30 },
  { header: '开发截图',   key: 'devImage',    width: 30 },
]
// 像素对比 tab:去掉「修复建议」「差异」,8 列
const PIXEL_HEADERS = [
  { header: 'id',         key: 'id',         width: 16 },
  { header: '页面',       key: 'page',       width: 10 },
  { header: '模块',       key: 'module',     width: 40 },
  { header: '严重等级',   key: 'severity',   width: 10 },
  { header: '问题类型',   key: 'issueType',   width: 14 },
  { header: '问题描述',   key: 'description', width: 40 },
  { header: '设计稿截图', key: 'designImage', width: 30 },
  { header: '开发截图',   key: 'devImage',    width: 30 },
]
const TEXT_HEADERS = [
  { header: 'id',         key: 'id',         width: 16 },
  { header: '页面',       key: 'page',       width: 10 },
  { header: '模块',       key: 'module',     width: 40 },
  { header: '严重等级',   key: 'severity',   width: 10 },
  { header: '设计稿文案', key: 'designText', width: 30 },
  { header: '开发文案',   key: 'devText',    width: 30 },
  { header: '问题描述',   key: 'reason',     width: 40 },
  { header: '修复建议',   key: 'suggestion', width: 40 },
  { header: '设计稿截图', key: 'designImage', width: 30 },
  { header: '开发截图',   key: 'devImage',    width: 30 },
]

const IMG_ROW_HEIGHT = 90
const IMG_COL_HEIGHT = 90
const IMG_COL_WIDTH = 120

/**
 * 填充一个工作表:表头 + 数据行 + 切图
 *
 * @param {ExcelJS.Worksheet} ws
 * @param {Array} issues - 该 tab 的问题条目
 * @param {Array} headers - 表头定义
 * @param {Object} ctx - { designImagePath, devImagePath, designCanvas, devCanvas }
 */
async function fillWorksheet(ws, issues, headers, ctx) {
  const { designImagePath, devImagePath, designCanvas, devCanvas } = ctx
  const DESIGN_IMG_COL = headers.length - 2
  const DEV_IMG_COL = headers.length - 1

  ws.columns = headers
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' }
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  if (issues.length === 0) {
    ws.getCell('A2').value = '（无差异）'
    return
  }

  for (let i = 0; i < issues.length; i++) {
    const u = issues[i]
    const row = ws.getRow(i + 2)
    const values = headers.map(h => {
      if (h.key === 'designImage' || h.key === 'devImage') return ''
      return u[h.key] ?? ''
    })
    row.values = values
    row.alignment = { vertical: 'top', wrapText: true }
    row.height = IMG_ROW_HEIGHT

    // 切图:design 用 designRect + designCanvas,dev 用 devRect + devCanvas
    const designRect = u.designRect || u.rect
    const devRect = u.devRect || u.rect
    if (designImagePath && devImagePath) {
      try {
        const [designBuf, devBuf] = await Promise.all([
          designRect ? cropNodeImage(designImagePath, designRect, designCanvas) : null,
          devRect ? cropNodeImage(devImagePath, devRect, devCanvas) : null,
        ])

        const rowIdx = i + 2
        if (designBuf) {
          const imgId = ws.workbook.addImage({ buffer: designBuf, extension: 'png' })
          ws.addImage(imgId, {
            tl: { col: DESIGN_IMG_COL, row: rowIdx - 1 },
            ext: { width: IMG_COL_WIDTH, height: IMG_COL_HEIGHT },
          })
        }
        if (devBuf) {
          const imgId = ws.workbook.addImage({ buffer: devBuf, extension: 'png' })
          ws.addImage(imgId, {
            tl: { col: DEV_IMG_COL, row: rowIdx - 1 },
            ext: { width: IMG_COL_WIDTH, height: IMG_COL_HEIGHT },
          })
        }
        if (!designBuf) row.getCell(DESIGN_IMG_COL + 1).value = '无坐标'
        if (!devBuf) row.getCell(DEV_IMG_COL + 1).value = '无坐标'
      } catch (err) {
        row.getCell(DESIGN_IMG_COL + 1).value = `切图失败: ${err.message}`
      }
    }
  }
}

/**
 * 生成 Excel 报告(双工作表)
 *
 * @param {Array} unifiedIssues - mergeDiffs 输出的 UnifiedIssue[]
 * @param {Object} ctx
 * @param {string} ctx.designImagePath
 * @param {string} ctx.devImagePath
 * @param {{w:number,h:number}} [ctx.designCanvas] - 设计侧画布尺寸(切 design.png 用)
 * @param {{w:number,h:number}} [ctx.devCanvas]    - 开发侧画布尺寸(切 arkui.png 用)
 * @returns {Promise<string>} xlsx 文件路径
 */
export async function generateExcelReport(unifiedIssues, ctx, outDir) {
  const { designImagePath, devImagePath, designCanvas, devCanvas } = ctx

  const nodeIssues = unifiedIssues.filter(u => u.issueType !== '局部图')
  const pixelIssues = unifiedIssues
    .filter(u => u.issueType === '局部图')
    .sort((a, b) => (b.diffRatio || 0) - (a.diffRatio || 0))

  const wb = new ExcelJS.Workbook()

  if (nodeIssues.length > 0) {
    const wsNode = wb.addWorksheet('节点对比')
    const nodeCtx = { designImagePath, devImagePath, designCanvas, devCanvas }
    await fillWorksheet(wsNode, nodeIssues, NODE_HEADERS, nodeCtx)
  }

  if (pixelIssues.length > 0) {
    const wsPixel = wb.addWorksheet('局部图对比')
    const pixelCtx = { designImagePath, devImagePath, designCanvas: null, devCanvas: null }
    await fillWorksheet(wsPixel, pixelIssues, PIXEL_HEADERS, pixelCtx)
  }

  if (wb.worksheets.length === 0) {
    const ws = wb.addWorksheet('节点对比')
    ws.getCell('A1').value = '开发侧与设计稿一致,无需修改'
  }

  const finalOutDir = outDir || getSessionDir()
  const xlsxPath = join(finalOutDir, `octo_uxlint_result_${getSessionTimestamp()}.xlsx`)
  const buf = await wb.xlsx.writeBuffer()
  writeFileSync(xlsxPath, Buffer.from(buf))
  return xlsxPath
}

async function fillTextWorksheet(ws, textIssues, ctx) {
  const { designImagePath, devImagePath, designCanvas, devCanvas } = ctx
  ws.columns = TEXT_HEADERS
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' }
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  if (textIssues.length === 0) {
    ws.getCell('A2').value = '（无差异）'
    return
  }

  for (let i = 0; i < textIssues.length; i++) {
    const t = textIssues[i]
    const row = ws.getRow(i + 2)
    row.values = [
      t.id || '',
      '-',
      t.nodeName || '',
      t.severity || '',
      t.designText || '',
      t.devText || '',
      t.reason || '',
      t.suggestion || '',
      '', '',
    ]
    row.alignment = { vertical: 'top', wrapText: true }
    row.height = IMG_ROW_HEIGHT

    const designRect = t.designRect
    const devRect = t.devRect
    if (designImagePath && devImagePath) {
      try {
        const [designBuf, devBuf] = await Promise.all([
          designRect ? cropNodeImage(designImagePath, designRect, designCanvas) : null,
          devRect ? cropNodeImage(devImagePath, devRect, devCanvas) : null,
        ])
        if (designBuf) {
          const imgId = ws.workbook.addImage({ buffer: designBuf, extension: 'png' })
          ws.addImage(imgId, { tl: { col: 8, row: i + 1 }, ext: { width: IMG_COL_WIDTH, height: IMG_COL_HEIGHT } })
        }
        if (devBuf) {
          const imgId = ws.workbook.addImage({ buffer: devBuf, extension: 'png' })
          ws.addImage(imgId, { tl: { col: 9, row: i + 1 }, ext: { width: IMG_COL_WIDTH, height: IMG_COL_HEIGHT } })
        }
      } catch {}
    }
  }
}

export async function addTextTabToExcel(excelPath, textIssues, ctx) {
  const { designImagePath, devImagePath, designCanvas, devCanvas } = ctx
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(excelPath)

  if (wb.getWorksheet('文案对比')) {
    wb.removeWorksheet('文案对比')
  }
  const ws = wb.addWorksheet('文案对比')
  await fillTextWorksheet(ws, textIssues, {
    designImagePath, devImagePath, designCanvas, devCanvas,
  })

  const buf = await wb.xlsx.writeBuffer()
  writeFileSync(excelPath, Buffer.from(buf))
}
