#!/usr/bin/env node
/**
 * ui-param-diff CLI 入口
 *
 * 4 个子命令，直接调用 src/lib/ 下的底层函数。
 * 不启动常驻进程，agent 通过 bash 工具调用。
 *
 * 用法：
 *   ui-param-diff collect-arkui [--timeout 60000]
 *   ui-param-diff collect-web --url <url> [--width 1920] [--height 1080] [--headless]
 *   ui-param-diff collect-design --code <传送码> | --url <设计稿URL>
 *   ui-param-diff ui-style-check --design-json <path> --dev-json <path> [--platform hmPhone] [--design-image <path>] [--dev-image <path>]
 *
 * 输出统一为 JSON 到 stdout，错误信息到 stderr 并以非零退出码退出。
 */

import { existsSync, writeFileSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── 引擎函数（src/lib，mcp 共享）─────────────────────────

import { collectArkui } from '../src/lib/collectData/getArkui/getArkui.js'
import { collectWebDom } from '../src/lib/collectData/getWebDom/getWebDom.js'
import { collectDesign } from '../src/lib/collectData/getPixData/getPixData.js'
import { extractSummary, generateReport } from '../src/lib/utils/report.js'
import { fileToBlob } from '../src/lib/utils/tools.js'
import { resetSession, getUserInfo, getSessionDir, getSessionTimestamp } from '../src/lib/utils/session.js'
import { trackCheckComplete } from '../src/lib/utils/track.js'
import { config } from '../src/lib/config.js'

// ── skill 专属模块（图图对比 + Excel + 文案走查）─────────

import { callPixelDiffServer } from '../src/lib/pixelDiff/client.js'
import { mergeDiffs } from '../src/lib/report/mergeDiffs.js'
import { generateExcelReport, addTextTabToExcel } from '../src/lib/report/excelReport.js'

// ── 辅助 ────────────────────────────────────────────────

function output(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n')
}

function fail(msg) {
  process.stderr.write(`✗ ${msg}\n`)
  process.exit(1)
}

/** 解析 --flag value 参数对 */
function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key.startsWith('--')) {
      const val = argv[i + 1]
      if (val && !val.startsWith('--')) {
        args[key.slice(2)] = val
        i++
      } else {
        args[key.slice(2)] = true
      }
    }
  }
  return args
}

// ── 子命令实现 ──────────────────────────────────────────

/**
 * collect-arkui: 鸿蒙 ArkUI 开发侧数据采集
 */
async function cmdCollectArkui(args) {
  const timeout = args.timeout ? parseInt(args.timeout, 10) : 60000
  const result = await collectArkui({ timeout })
  output(result)
}

/**
 * collect-web: Web 页面 DOM 采集
 */
async function cmdCollectWeb(args) {
  if (!args.url) fail('缺少必填参数: --url')
  const options = {
    viewport: {
      width: args.width ? parseInt(args.width, 10) : 1920,
      height: args.height ? parseInt(args.height, 10) : 1080,
      deviceScaleFactor: args['scale-factor'] ? parseInt(args['scale-factor'], 10) : 2,
    },
    headless: args.headless === 'false' ? false : true,
  }
  const result = await collectWebDom(args.url, options)
  output(result)
}

/**
 * collect-design: 设计稿数据采集
 */
async function cmdCollectDesign(args) {
  const { code, url } = args
  if (!code && !url) fail('缺少参数: --code <传送码> 或 --url <设计稿URL> 至少传一个')
  const result = await collectDesign(code, url)
  // 解包 mcp 格式 {content:[{type:"text", text:"<JSON>"}]} → 直接输出 flat JSON
  const text = result?.content?.[0]?.text
  if (text) {
    try { output(JSON.parse(text)) } catch { output({ raw: text }) }
  } else {
    output(result)
  }
}

/**
 * ui-style-check: UI 一致性检查
 *
 * 支持两种模式:
 *   A. 只传图(无 JSON)→ 局部图对比单轨,输出差异块 + Excel
 *   B. JSON + 图 → 节点树比对 + 局部图对比双轨,mergeDiffs 合并去重 + md/html/Excel
 *
 * 可选 --text-rules <path>:文案走查规则文本文件(自然语言),仅 B 模式 + 用户传了才触发
 */
async function cmdUiStyleCheck(args) {
  const { 'design-json': designJsonPath, 'dev-json': devJsonPath } = args
  const designImagePath = args['design-image'] || null
  const devImagePath = args['dev-image'] || null
  const platform = args.platform || 'hmPhone'
  const account = args.account || ''
  const textRulesPath = args['text-rules'] || null

  const hasJson = !!(designJsonPath && devJsonPath)
  const hasImg = !!(designImagePath && devImagePath)

  // 至少要有图(图图对比最小输入)
  if (!hasImg) {
    fail('至少需要 --design-image 和 --dev-image(图图对比最小输入);JSON 可选,传了则双轨比对')
  }

  // 文案走查仅在 B 模式生效
  if (textRulesPath && !hasJson) {
    process.stderr.write('⚠ 纯图场景无文本节点,文案走查已忽略\n')
  }

  // ── 分支 A: 只传图(局部图对比单轨)─────────────────────
  if (!hasJson) {
    const pixelRes = await callPixelDiffServer({
      designImagePath, devImagePath, platform,
    })

    // 局部图差异块直接转 unified(无节点信息,模块=位置描述)
    const unified = mergeDiffs([], pixelRes.diffBlocks, [])

    // Excel 报告(纯局部图场景,局部图块 bbox 已是像素坐标,不换算)
    let excelPath = ''
    try {
      excelPath = await generateExcelReport(unified, {
        designImagePath, devImagePath,
        designCanvas: null,
        devCanvas: null,
      })
    } catch (e) {
      process.stderr.write(`✗ Excel 报告生成失败: ${e.message}\n`)
    }

    // 纯局部图场景无节点树,不打点(无 stats/diffCount 语义)
    resetSession()

    output({
      platform,
      nodes: unified.slice(0, 10),
      totalNodes: unified.length,
      reportPath: null,        // 纯局部图场景无 md 报告
      htmlReportPath: null,   // 纯局部图场景无 html 报告
      excelReportPath: excelPath || null,
    })
    return
  }

  // ── 分支 B: JSON + 图(双轨比对 + 合并)─────────────────────
  // 校验文件存在
  for (const [label, path] of [
    ['设计稿 JSON', designJsonPath],
    ['开发侧 JSON', devJsonPath],
    ['设计稿截图', designImagePath],
    ['开发侧截图', devImagePath],
  ]) {
    if (!existsSync(path)) fail(`${label}文件不存在: ${path}`)
  }

  // ① 节点树比对(现有 /check/upload)
  const form = new FormData()
  form.append('platform', platform)
  form.append('designJson', fileToBlob(designJsonPath), 'design.json')
  form.append('arkuiJson', fileToBlob(devJsonPath), 'arkui.json')
  form.append('designImage', fileToBlob(designImagePath), 'design.png')
  form.append('arkuiImage', fileToBlob(devImagePath), 'arkui.png')

  const res = await fetch(`${config.CHECK_SERVER_URL}/check/upload`, {
    method: 'POST',
    body: form,
  })

  if (!res.ok) {
    const errText = await res.text()
    fail(`检查请求失败 (${res.status}): ${errText}`)
  }

  const nodeResult = await res.json()

  // ② 局部图对比(按节点匹配结果逐区域对比,局部图差异天然绑定节点)
  const designCanvas = nodeResult.canvas?.design || {}
  const arkuiCanvas = nodeResult.canvas?.arkui || {}
  const pixelRes = await callPixelDiffServer({
    designImagePath, devImagePath, platform,
    pairs: nodeResult.pairs,
    designCanvas: { w: designCanvas.w || 0, h: designCanvas.h || 0 },
    arkuiCanvas: { w: arkuiCanvas.w || 0, h: arkuiCanvas.h || 0 },
  })

  // ③ 提取文案对比用文本对(用户传 --text-rules 时才供 AI agent 语义比对)
  const textPairs = textRulesPath
    ? (nodeResult.pairs || [])
        .filter(p => p.design?.textContent && p.arkui?.textContent)
        .map(p => ({
          designId: p.design.id,
          arkuiId: p.arkui.id,
          nodeName: p.arkui.name || p.design.name || null,
          designText: p.design.textContent,
          arkuiText: p.arkui.textContent,
          designRect: p.design.rect || null,
          devRect: p.arkui.rect || null,
        }))
    : []

  // ④ 合并去重
  const ctx = buildMergeContext(nodeResult)
  const unified = mergeDiffs(nodeResult.diffs || [], pixelRes.diffBlocks, [], ctx)

  // ⑤ md 报告(现有 generateReport,基于节点树结果)
  const reportPath = generateReport(nodeResult)

  // ⑥ 可视化 HTML 报告(现有 /report/html)
  let htmlReportPath = ''
  try {
    const htmlForm = new FormData()
    htmlForm.append('result', new Blob([JSON.stringify(nodeResult)], { type: 'application/json' }), 'result.json')
    htmlForm.append('designImage', fileToBlob(designImagePath, 'image/png'), 'design.png')
    htmlForm.append('devImage', fileToBlob(devImagePath, 'image/png'), 'arkui.png')
    const htmlRes = await fetch(`${config.CHECK_SERVER_URL}/report/html`, {
      method: 'POST',
      body: htmlForm,
    })
    if (htmlRes.ok) {
      const html = await htmlRes.text()
      const outDir = getSessionDir()
      htmlReportPath = join(outDir, `octo_uxlint_result_${getSessionTimestamp()}.html`)
      writeFileSync(htmlReportPath, html, 'utf-8')
    }
  } catch {}

  // ⑦ Excel 报告(节点对比 + 局部图对比,文案 tab 由 agent 后续调 add-text-tab 追加)
  let excelPath = ''
  try {
    excelPath = await generateExcelReport(unified, {
      designImagePath, devImagePath,
      designCanvas: { w: designCanvas.w || 0, h: designCanvas.h || 0 },
      devCanvas: { w: arkuiCanvas.w || 0, h: arkuiCanvas.h || 0 },
    }, [])
    // 写 context 文件供 add-text-tab 命令读取(图片路径 + 画布尺寸)
    const ctxPath = join(getSessionDir(), 'excel_context.json')
    writeFileSync(ctxPath, JSON.stringify({
      excelPath, designImagePath, devImagePath,
      designCanvas: { w: designCanvas.w || 0, h: designCanvas.h || 0 },
      devCanvas: { w: arkuiCanvas.w || 0, h: arkuiCanvas.h || 0 },
    }), 'utf-8')
  } catch (e) {
    process.stderr.write(`✗ Excel 报告生成失败: ${e.message}\n`)
  }

  // ⑧ 打点
  try {
    trackCheckComplete({
      account: account || getUserInfo()?.account || '',
      platform: nodeResult.platform,
      stats: nodeResult.stats,
      diffCount: unified.length,
    })
  } catch {}

  resetSession()

  // 返回前 10 个节点(避免上下文过长)
  const MAX_PREVIEW = 10
  const preview = {
    platform: nodeResult.platform,
    nodes: unified.slice(0, MAX_PREVIEW),
    totalNodes: unified.length,
    reportPath,
    htmlReportPath,
    excelReportPath: excelPath || null,
    textPairs,
  }

  output(preview)
}

/**
 * 构造 mergeDiffs 上下文(从 nodeResult 提取 componentChain + 两侧 rect 数据)
 */
function buildMergeContext(nodeResult) {
  const arkuiByPath = new Map()
  for (const n of nodeResult.allArkuiNodes || []) {
    const key = Array.isArray(n.path) ? n.path.join('.') : ''
    if (key) arkuiByPath.set(key, n)
  }
  const designRectMap = new Map()
  const arkuiRectMap = new Map()
  const designToArkuiId = new Map()  // design.id → arkui.id
  for (const p of nodeResult.pairs || []) {
    if (p.design?.id) designRectMap.set(p.design.id, p.design.rect)
    if (p.arkui?.id) arkuiRectMap.set(p.design.id, p.arkui.rect)  // 以 design.id 为键,便于按节点取两侧 rect
    if (p.design?.id && p.arkui?.id) designToArkuiId.set(p.design.id, p.arkui.id)
  }
  return {
    arkuiByPath,
    designRectMap,
    arkuiRectMap,
    designToArkuiId,
    allArkuiNodes: nodeResult.allArkuiNodes || [],
    allDesignNodes: nodeResult.allDesignNodes || [],
  }
}

// ── 主调度 ──────────────────────────────────────────────

async function cmdAddTextTab(args) {
  const excelPath = args.excel
  const textIssuesPath = args['text-issues']
  if (!excelPath) fail('缺少必填参数: --excel')
  if (!textIssuesPath) fail('缺少必填参数: --text-issues')
  if (!existsSync(excelPath)) fail(`Excel 文件不存在: ${excelPath}`)
  if (!existsSync(textIssuesPath)) fail(`文案差异文件不存在: ${textIssuesPath}`)

  // 从同目录读 context(excel_context.json)
  const ctxPath = join(excelPath, '..', 'excel_context.json')
  let ctx = null
  if (existsSync(ctxPath)) {
    try { ctx = JSON.parse(readFileSync(ctxPath, 'utf-8')) } catch {}
  }

  let textIssues = []
  try {
    textIssues = JSON.parse(readFileSync(textIssuesPath, 'utf-8'))
  } catch (e) {
    fail(`文案差异 JSON 解析失败: ${e.message}`)
  }

  if (!Array.isArray(textIssues) || textIssues.length === 0) {
    output({ added: false, reason: '无文案差异' })
    return
  }

  await addTextTabToExcel(excelPath, textIssues, ctx || {})
  output({ added: true, count: textIssues.length, excelPath })
}

const COMMANDS = {
  'collect-arkui': cmdCollectArkui,
  'collect-web': cmdCollectWeb,
  'collect-design': cmdCollectDesign,
  'ui-style-check': cmdUiStyleCheck,
  'add-text-tab': cmdAddTextTab,
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)

  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(`UI Param Diff Skill CLI

用法: ui-param-diff <command> [options]

命令:
  collect-arkui        采集鸿蒙 ArkUI 开发侧数据（仅 Windows）
  collect-web          采集 Web 页面 DOM 树 + 截图
  collect-design       采集设计稿数据 + 截图
  ui-style-check       UI 一致性检查（支持图图对比 + JSON+图双轨比对 + Excel 报告）
  add-text-tab         向已有 Excel 追加文案对比工作表

选项:
  --help, -h           显示帮助

各命令的详细参数见 SKILL.md。
`)
    return
  }

  const handler = COMMANDS[cmd]
  if (!handler) {
    fail(`未知命令: ${cmd}\n运行 ui-param-diff --help 查看可用命令`)
  }

  const args = parseArgs(rest)

  // 切换工作目录到项目目录（采集结果、报告等保存到项目下而非 skill 目录）
  if (args.cwd) {
    process.chdir(args.cwd)
  }

  try {
    await handler(args)
  } catch (err) {
    if (err.code === 'LOGIN_TIMEOUT') {
      process.stderr.write(`✗ 登录超时: ${err.message}\n`)
    } else {
      process.stderr.write(`✗ ${err.message}\n`)
    }
    process.exit(1)
  }
}

main()
