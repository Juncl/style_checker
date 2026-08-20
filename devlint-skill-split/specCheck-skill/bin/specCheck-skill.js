#!/usr/bin/env node
/**
 * specCheck-skill CLI 入口
 *
 * 2 个子命令，直接调用 src/lib/ 下的底层函数。
 * 不启动常驻进程，agent 通过 bash 工具调用。
 *
 * 用法：
 *   specCheck-skill list-design-specs [--standard-name <规范名>] [--scene-name <场景名>]
 *   specCheck-skill design-spec-check --source <html路径或URL> --spec-file-paths <path1,path2,...>
 *
 * 输出统一为 JSON 到 stdout，错误信息到 stderr 并以非零退出码退出。
 */

// ── 引擎函数（src/lib，mcp 共享）─────────────────────────

import { uxCheck } from '../src/lib/collectData/uxCheckOut/index.js'
import { fetchSpecList } from '../src/lib/collectData/uxCheckOut/fetchSpecList.js'
import { resolveSpec } from '../src/lib/collectData/uxCheckOut/resolveSpec.js'
import { getUserInfo } from '../src/lib/utils/session.js'
import { trackSpecCheckComplete } from '../src/lib/utils/track.js'

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
 * list-design-specs: 规范名称模糊匹配
 *
 * 拉取规则库全量数据，按 standardName + sceneName 两阶段模糊匹配，
 * 返回 filePaths（matched=true）或候选列表（matched=false）。
 */
async function cmdListDesignSpecs(args) {
  const standardName = args['standard-name'] || undefined
  const sceneName = args['scene-name'] || undefined
  const specData = await fetchSpecList()
  const result = resolveSpec(specData, standardName, sceneName)
  output(result)
}

/**
 * design-spec-check: 设计规范检查
 *
 * source 为本地 HTML 或 URL，specFilePaths 为规则文件路径数组（来自 list-design-specs）。
 * --spec-file-paths 支持逗号分隔字符串或 JSON 数组字符串。
 */
async function cmdDesignSpecCheck(args) {
  const { source } = args
  if (!source) fail('缺少必填参数: --source')
  if (!args['spec-file-paths']) fail('缺少必填参数: --spec-file-paths（来自 list-design-specs 的 filePaths）')

  const raw = args['spec-file-paths']
  let specFilePaths
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    specFilePaths = JSON.parse(raw)
  } else {
    specFilePaths = String(raw).split(',').map(s => s.trim()).filter(Boolean)
  }
  if (!Array.isArray(specFilePaths) || specFilePaths.length === 0) {
    fail('--spec-file-paths 解析后为空数组，请确认传入的规则文件路径')
  }

  const report = await uxCheck(source, specFilePaths)

  try {
    trackSpecCheckComplete({
      account: getUserInfo()?.account || '',
      specFilePaths,
      stats: report?.stats,
      issueCount: (report?.issues || []).length,
    })
  } catch {}

  output(report)
}

// ── 主调度 ──────────────────────────────────────────────

const COMMANDS = {
  'list-design-specs': cmdListDesignSpecs,
  'design-spec-check': cmdDesignSpecCheck,
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)

  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(`SpecCheck Skill CLI

用法: specCheck-skill <command> [options]

命令:
  list-design-specs    模糊匹配规范名/场景名，返回规则文件路径列表
  design-spec-check    检查 HTML/URL 是否符合设计规范（需先调 list-design-specs）

选项:
  --help, -h           显示帮助

各命令的详细参数见 SKILL.md。
`)
    return
  }

  const handler = COMMANDS[cmd]
  if (!handler) {
    fail(`未知命令: ${cmd}\n运行 specCheck-skill --help 查看可用命令`)
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
