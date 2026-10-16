#!/usr/bin/env node
/**
 * arkui-version-diff CLI 入口
 *
 * 2 个子命令，服务地址取自 src/lib/config.js 的 config.CHECK_SERVER_URL。
 *
 * 用法：
 *   arkui-version-diff collect-arkui --label base|target [--timeout 60000] [--cwd <项目目录>]
 *   arkui-version-diff version-diff --base-json <path> --target-json <path>
 *                                    [--base-image <path>] [--target-image <path>] [--cwd <项目目录>]
 *
 * 输出统一为 JSON 到 stdout，错误信息到 stderr 并以非零退出码退出。
 */

import { existsSync, readFileSync } from 'fs'
import { basename } from 'path'

import { config } from '../src/lib/config.js'
import { collectArkui } from '../src/lib/collectData/getArkui/getArkui.js'
import { runVersionCompare, fetchHtmlReport } from '../lib/api.js'
import {
  timestamp,
  resolveOutDir,
  saveResult,
  saveHtmlReport,
  extractSummary,
} from '../lib/report.js'

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
 * collect-arkui: 采集一版 ArkUI 数据（仅 Windows）
 *
 * 采集引擎与 ui-param-diff 同源（build 时从 devlint-mcp 拷贝到 src/lib/），
 * 输出文件落在 .octo-uxlint/<会话时间戳>/ 下；
 * 本命令仅做 label（base/target）语义包装，供 version-diff 串联。
 */
async function cmdCollectArkui(args) {
  const label = args.label
  if (label !== 'base' && label !== 'target') {
    fail('缺少或非法参数: --label base|target（base=旧版本，target=新版本）')
  }

  const timeout = args.timeout ? parseInt(args.timeout, 10) : 60000
  const { devJsonPath, devImagePath } = await collectArkui({ timeout })

  // 按 label 包装字段名，agent 串联时直接对应 version-diff 的 --base-json / --target-json
  const jsonKey = label === 'base' ? 'baseJsonPath' : 'targetJsonPath'
  const imgKey  = label === 'base' ? 'baseImagePath' : 'targetImagePath'
  output({
    label,
    [jsonKey]: devJsonPath,
    [imgKey]:  devImagePath,
  })
}

/**
 * version-diff: ArkUI 版本对比
 *
 * 校验文件 → 上传 server → 结果 JSON 落盘 → HTML 报告落盘 → stdout 摘要
 */
async function cmdVersionDiff(args) {
  const { 'base-json': basePath, 'target-json': targetPath } = args
  if (!basePath) fail('缺少必填参数: --base-json')
  if (!targetPath) fail('缺少必填参数: --target-json')

  const baseImagePath = args['base-image'] || null
  const targetImagePath = args['target-image'] || null
  const serverUrl = config.CHECK_SERVER_URL

  // 校验文件存在
  for (const [label, path] of [
    ['旧版本 JSON（base）', basePath],
    ['新版本 JSON（target）', targetPath],
    ...(baseImagePath ? [['旧版本截图（base）', baseImagePath]] : []),
    ...(targetImagePath ? [['新版本截图（target）', targetImagePath]] : []),
  ]) {
    if (!existsSync(path)) fail(`${label}文件不存在: ${path}`)
  }

  // 调 server 执行对比
  const result = await runVersionCompare({
    basePath,
    targetPath,
    baseImagePath,
    targetImagePath,
    serverUrl,
  })

  // 落盘：完整结果 JSON + 可视化 HTML 报告
  // （main 中已按 --cwd chdir，这里直接用当前工作目录，避免相对路径二次拼接错位）
  const ts = timestamp()
  const outDir = resolveOutDir()
  const names = { baseName: basename(basePath), targetName: basename(targetPath) }

  const resultPath = saveResult(result, outDir, ts)

  // HTML 报告：复用检查服务的现有报告接口（报告内"设计侧"= base、"开发侧"= target）
  let htmlReportPath = ''
  try {
    const html = await fetchHtmlReport({
      result,
      baseImage: baseImagePath ? { buffer: readFileSync(baseImagePath), name: basename(baseImagePath) } : null,
      targetImage: targetImagePath ? { buffer: readFileSync(targetImagePath), name: basename(targetImagePath) } : null,
      serverUrl,
    })
    htmlReportPath = saveHtmlReport(html, outDir, ts)
  } catch (err) {
    // HTML 生成失败不阻断主流程，stderr 提示即可
    process.stderr.write(`⚠ HTML 报告生成失败: ${err.message}\n`)
  }

  // stdout 摘要（diffPreview 前 10 条，避免占用 AI 上下文）
  const summary = extractSummary(result, names)
  output({
    ...summary,
    resultPath,
    htmlReportPath,
  })
}

// ── 主调度 ──────────────────────────────────────────────

const COMMANDS = {
  'collect-arkui': cmdCollectArkui,
  'version-diff': cmdVersionDiff,
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)

  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(`ArkUI Version Diff Skill CLI

用法: arkui-version-diff <command> [options]

命令:
  collect-arkui        采集一版 ArkUI 数据（仅 Windows，--label base|target 区分新旧版本）
  version-diff         对比两个版本的 ArkUI 数据，输出 JSON 结果 + 可视化 HTML 报告

选项:
  --help, -h           显示帮助

各命令的详细参数见 SKILL.md。
`)
    return
  }

  const handler = COMMANDS[cmd]
  if (!handler) {
    fail(`未知命令: ${cmd}\n运行 arkui-version-diff --help 查看可用命令`)
  }

  const args = parseArgs(rest)

  // 切换工作目录到项目目录（结果 JSON、HTML 报告保存到项目下而非 skill 目录）
  if (args.cwd) {
    process.chdir(args.cwd)
  }

  try {
    await handler(args)
  } catch (err) {
    process.stderr.write(`✗ ${err.message}\n`)
    process.exit(1)
  }
}

main()
