#!/usr/bin/env node
/**
 * aiCheck-skill CLI 入口
 *
 * 1 个子命令，调用 src/lib/ 和 lib/ 下的函数。
 * 不启动常驻进程，agent 通过 bash 工具调用。
 *
 * 用法：
 *   aiCheck-skill ai-img-check --mode prompt | --mode build --diff-file <json>
 *
 * 输出统一为 JSON 到 stdout，错误信息到 stderr 并以非零退出码退出。
 */

// ── 引擎函数（src/lib，mcp 共享）─────────────────────────

import { getUserInfo } from '../src/lib/utils/session.js'
import { reportInteraction } from '../src/lib/utils/track.js'

// ── skill 独有模块（lib/）───────────────────────────────

import { getImgCheckPrompt } from '../lib/vlmCheck.js'
import { buildHtmlReport } from '../lib/htmlBuilder.js'

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
 * ai-img-check: 视觉检查
 *
 * 两步操作：
 *   --mode prompt   取 system prompt，agent 看对话中的图输出差异 JSON（lib/vlmCheck.js）
 *   --mode build    用 agent 输出的 diff JSON 生成 HTML 模板（图片位置为占位符，agent 填入图片后得到最终 HTML）（lib/htmlBuilder.js）
 */
async function cmdAiImgCheck(args) {
  const mode = args.mode

  // 第 1 步：返回 prompt
  if (mode === 'prompt') {
    const result = getImgCheckPrompt()
    output(result)
    return
  }

  // 第 2 步：生成 HTML 模板（agent 填入图片后得到最终 HTML）
  if (mode === 'build') {
    const result = await buildHtmlReport({
      diffFile: args['diff-file'],
    })

    try {
      reportInteraction({
        account: getUserInfo()?.account || '',
        name: 'aiCheck-skill-aiCheck',
        extend: {
          overallLevel: result.overallLevel,
          score: result.score,
          totalDiffs: result.totalDiffs,
        },
      })
    } catch {}

    output(result)
    return
  }

  fail('不支持的 --mode: ' + (mode || '（未指定）') + '，当前支持 prompt / build')
}

// ── 主调度 ──────────────────────────────────────────────

const COMMANDS = {
  'ai-img-check': cmdAiImgCheck,
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)

  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(`AiCheck Skill CLI

用法: aiCheck-skill <command> [options]

命令:
  ai-img-check         视觉检查，取 prompt → 看对话图 → 输出差异 JSON → 生成 HTML 标注图

选项:
  --help, -h           显示帮助

各命令的详细参数见 SKILL.md。
`)
    return
  }

  const handler = COMMANDS[cmd]
  if (!handler) {
    fail(`未知命令: ${cmd}\n运行 aiCheck-skill --help 查看可用命令`)
  }

  const args = parseArgs(rest)

  // 切换工作目录到项目目录（报告等保存到项目下而非 skill 目录）
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
