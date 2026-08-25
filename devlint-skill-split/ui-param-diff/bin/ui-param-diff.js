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

import { existsSync, writeFileSync } from 'fs'
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
 * 校验文件 → FormData → fetch server → extractSummary → generateReport → trackCheckComplete → resetSession
 */
async function cmdUiStyleCheck(args) {
  const { 'design-json': designJsonPath, 'dev-json': devJsonPath } = args
  if (!designJsonPath) fail('缺少必填参数: --design-json')
  if (!devJsonPath) fail('缺少必填参数: --dev-json')

  const platform = args.platform || 'hmPhone'
  const designImagePath = args['design-image'] || null
  const devImagePath = args['dev-image'] || null

  const account = args.account || ''

  // 校验文件存在
  for (const [label, path] of [
    ['设计稿 JSON', designJsonPath],
    ['开发侧 JSON', devJsonPath],
    ...(designImagePath ? [['设计稿截图', designImagePath]] : []),
    ...(devImagePath ? [['开发侧截图', devImagePath]] : []),
  ]) {
    if (!existsSync(path)) fail(`${label}文件不存在: ${path}`)
  }

  // 构造 FormData 上传
  const form = new FormData()
  form.append('platform', platform)
  form.append('designJson', fileToBlob(designJsonPath), 'design.json')
  form.append('arkuiJson', fileToBlob(devJsonPath), 'arkui.json')
  if (designImagePath) {
    form.append('designImage', fileToBlob(designImagePath), 'design.png')
  }
  if (devImagePath) {
    form.append('arkuiImage', fileToBlob(devImagePath), 'arkui.png')
  }

  const res = await fetch(`${config.CHECK_SERVER_URL}/check/upload`, {
    method: 'POST',
    body: form,
  })

  if (!res.ok) {
    const errText = await res.text()
    fail(`检查请求失败 (${res.status}): ${errText}`)
  }

  const result = await res.json()
  const summary = extractSummary(result)
  const reportPath = generateReport(result)

  // 生成可视化 HTML 报告（调 server 接口，返回 HTML 字符串后写入本地）
  let htmlReportPath = ''
  try {
    const htmlForm = new FormData()
    htmlForm.append('result', new Blob([JSON.stringify(result)], { type: 'application/json' }), 'result.json')
    if (designImagePath) {
      htmlForm.append('designImage', fileToBlob(designImagePath, 'image/png'), 'design.png')
    }
    if (devImagePath) {
      htmlForm.append('devImage', fileToBlob(devImagePath, 'image/png'), 'arkui.png')
    }
    const htmlRes = await fetch(`${config.CHECK_SERVER_URL}/report/html`, {
      method: 'POST',
      body: htmlForm,
    })
    if (htmlRes.ok) {
      const html = await htmlRes.text()
      const outDir = getSessionDir()
      htmlReportPath = join(outDir, `devlint_result_${getSessionTimestamp()}.html`)
      writeFileSync(htmlReportPath, html, 'utf-8')
    }
  } catch {}

  try {
    trackCheckComplete({
      account: account || getUserInfo()?.account || '',
      platform: result.platform,
      stats: result.stats,
      diffCount: (result.diffs || []).length,
    })
  } catch {}

  resetSession()

  // 返回前 10 个节点（避免上下文过长）
  const MAX_PREVIEW = 10
  const preview = {
    platform: summary.platform,
    nodes: summary.nodes.slice(0, MAX_PREVIEW),
    totalNodes: summary.nodes.length,
    reportPath,
    htmlReportPath,
  }

  output(preview)
}

// ── 主调度 ──────────────────────────────────────────────

const COMMANDS = {
  'collect-arkui': cmdCollectArkui,
  'collect-web': cmdCollectWeb,
  'collect-design': cmdCollectDesign,
  'ui-style-check': cmdUiStyleCheck,
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)

  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(`UI Param Diff Skill CLI

用法: ui-param-diff <command> [options]

命令:
  collect-arkui        采集鸿蒙 ArkUI 开发侧数据（仅 Windows）
  collect-web          采集 Web 页面 DOM 树 + 截图
  collect-design       采集 Pixso 设计稿数据 + 截图
  ui-style-check       对比设计稿与开发实现，输出差异清单（基于节点树 JSON）

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
