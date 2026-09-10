#!/usr/bin/env node
/**
 * design-checker CLI 入口（调度文件：调接口 + 生成文档）
 *
 * 职责：解析 argv → 分发到 lib/ 各模块。不启动常驻进程，agent 通过 bash 工具调用。
 *   - 调接口：lib/api.js（spec-server 只读接口）
 *   - 生成文档：lib/report.js（检查/修复报告渲染 + 存档 + 清理）
 *   - 接口配置：lib/config.js（多环境 SPEC_URL + 本地目录常量）
 *   - 本文件内聚：--sync-spec 检查&更新编排、--scan-spec 规范粗筛（本地扫描）
 *
 * 【规范库工作目录】
 * skill 内 specFiles/ 本地自带一份规范，是唯一规范读取来源。检查流程第 1 步先跑
 * --sync-spec 对照服务端 version 检查&更新（一致零写入，变化原子覆盖）；服务不可达
 * 时静默用本地自带规范（stdout 来源标 local，不向用户提示）。
 *
 * 用法：
 *   design-checker --list-specs [--spec-server <url>]
 *   design-checker --sync-spec <领域key> [--spec-server <url>]
 *   design-checker --scan-spec <领域key>
 *   design-checker [--out-dir <绝对目录>] <<'JSON'                    （检查递交，stdin）
 *   design-checker --fix --work-dir <检查工作目录> [--out-dir <绝对目录>] <<'JSON'  （修复递交，stdin）
 *   design-checker <issues.json> [--out-dir <绝对目录>]               （兼容旧文件输入）
 *   design-checker --fix <fix-result.json> [--out-dir <绝对目录>]     （兼容旧文件输入）
 *
 * 输出：进度与结果到 stdout（路径均为绝对路径），错误信息到 stderr 并以非零退出码退出。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, renameSync } from 'fs'
import { join, dirname, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { config } from '../lib/config.js'
import { listSpecs, getSpecDomain, getSpecArchive } from '../lib/api.js'
import {
  runCheck, runFix, readStdin, parseJson, decodeTextBuffer, safeDomain, pruneOldRuns,
} from '../lib/report.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILL_ROOT = join(__dirname, '..')

// ── 模式：规范清单（--list-specs） ──────────────────────

/** 读本地领域总表（specFiles/index.json 数组；不存在/格式异常兜底空数组） */
function readLocalIndex() {
  try {
    const p = join(config.SPEC_ROOT, 'index.json')
    if (!existsSync(p)) return []
    const data = JSON.parse(readFileSync(p, 'utf-8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/** 读本地领域条目（从总表按 key 查找，不存在返回 null） */
function readLocalMeta(domainKey) {
  return readLocalIndex().find(e => e.key === domainKey) || null
}

/** 扫描 skill 内 specFiles/ 生成本地领域清单（服务不可达时的本地兜底，以根总表为准；过滤目录已不存在的死条目） */
function localSpecList() {
  return readLocalIndex()
    .filter(e => existsSync(join(config.SPEC_ROOT, e.key)))
    .map(e => ({
      key: e.key,
      name: e.name || e.key,
      description: e.description || '',
      version: e.version ?? '—',
      updatedAt: e.updatedAt || '',
      fileCount: listSpecFiles(join(config.SPEC_ROOT, e.key)).length,
    }))
}

/** 打印领域清单表 */
function printSpecTable(specs, sourceLabel) {
  if (!specs.length) {
    console.log(`规范清单为空（来源：${sourceLabel}）`)
    return
  }
  console.log(`== 规范清单（来源：${sourceLabel}）==`)
  console.log('| 领域 key | 规范名称 | 说明 | 文件数 | 更新时间 |')
  console.log('|---|---|---|---|---|')
  for (const s of specs) {
    console.log(`| ${s.key} | ${s.name || s.key} | ${s.description || '—'} | ${s.fileCount ?? '—'} | ${s.updatedAt || '—'} |`)
  }
}

/** 规范清单：服务端优先（/specs），不可达自动退回 skill 本地 specFiles/ 扫描生成 */
async function runListSpecs(server) {
  try {
    const data = await listSpecs(server)
    printSpecTable(Array.isArray(data.specs) ? data.specs : [], `服务端 ${server}`)
  } catch {
    printSpecTable(localSpecList(), 'skill 本地 specFiles/')
  }
}

// ── 模式：规范检查&更新（--sync-spec） ──────────────────

/** 输出「来源」一行固定格式（AI 从 stdout 读取感知规范来源，格式勿动） */
function printSpecSource(source) {
  console.log(`来源: ${source}`)
}

/**
 * 规范检查&更新（skill 内 specFiles/ 是唯一规范工作目录，本地自带一份）：
 * - 服务端可达 + 本地 version 一致（字符串比较，semver 如 "1.0.0"）→ 零写入
 * - 服务端可达 + version 不一致/本地总表无该领域 → 拉整包原子覆盖 specFiles/<领域key>/（先写 .tmp/ 再 rename）并更新本地总表
 * - 📄 文档校验（version 有变化时必过）：拉取的 files 为空数组 / 条目缺 path 或 content
 *   → 视为拉取失败，🔴 不动本地规范与总表，静默沿用旧版（来源标 local）
 * - 服务端不可达/服务端无此领域 + 本地有 → 静默用本地自带规范（来源标 local，🔴 不向用户提示）
 * - 本地无该领域且服务端无/不可达 → 报错退出（唯一提示场景：无此规范）
 */
async function runSyncSpec(domain, server) {
  const key = String(domain || '').trim()
  const safeKey = safeDomain(key)
  const localDomainDir = join(config.SPEC_ROOT, safeKey)

  try {
    const info = await getSpecDomain(key, server)
    const remoteVersion = String(info.version ?? '')
    const localMeta = readLocalMeta(safeKey)

    // version 一致（字符串比较）→ 本地已是最新，零写入（服务端已校验，来源标 server）
    if (localMeta && String(localMeta.version ?? '') === remoteVersion) {
      console.log(`✓ 规范已是最新（version ${remoteVersion}，${info.updatedAt || ''}），无需更新`)
      printSpecSource('server')
      return
    }

    const archive = await getSpecArchive(key, server)
    const files = Array.isArray(archive.files) ? archive.files : []

    // 📄 文档校验：version 有变化但拉不到有效文件（空数组 / 条目缺 path 或 content）
    // → 视为拉取失败，不动本地规范与总表，静默沿用旧版（本地有该领域时）
    const valid = files.length > 0 && files.every(f => f && typeof f.path === 'string' && typeof f.content === 'string')
    if (!valid) {
      if (existsSync(localDomainDir)) {
        console.log(`拉取的规范文件无效（version ${remoteVersion}，${files.length} 个文件），沿用本地自带规范`)
        printSpecSource('local')
        return
      }
      console.error(`✗ 服务端领域 ${key}（version ${remoteVersion}）无有效规范文件，本地也无该领域`)
      process.exit(1)
    }

    // 原子覆盖：先写 <领域>.tmp/ 再整体替换，避免中断产生半新半旧状态
    const tmpDir = `${localDomainDir}.tmp`
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })
    for (const f of files) {
      const p = join(tmpDir, f.path)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, f.content, 'utf-8')
    }
    rmSync(localDomainDir, { recursive: true, force: true })
    renameSync(tmpDir, localDomainDir)

    // 更新本地总表条目（不存在则追加）
    const list = readLocalIndex()
    const entry = { key, ...(archive.meta || {}), version: archive.version ?? remoteVersion }
    const idx = list.findIndex(e => e.key === key)
    if (idx >= 0) list[idx] = { ...list[idx], ...entry }
    else list.push(entry)
    writeFileSync(join(config.SPEC_ROOT, 'index.json'), JSON.stringify(list, null, 2) + '\n', 'utf-8')

    console.log(`✓ 规范库已更新: ${key}（${files.length} 个文件，version ${archive.version ?? remoteVersion}）`)
    printSpecSource('server')
  } catch (err) {
    if (existsSync(localDomainDir)) {
      if (err.status === 404) {
        console.log(`服务端无领域 ${key}，使用本地自带规范`)
      } else {
        console.log(`规范库服务不可达（${server}），使用本地自带规范`)
      }
      printSpecSource('local')
    } else {
      console.error(`✗ 本地无领域 ${key}，且${err.status === 404 ? `服务端也无该领域` : `规范库服务不可达（${server}，${err.message}）`}（可跑 --list-specs 查看可用领域）`)
      process.exit(1)
    }
  }
}

// ── 模式：规范粗筛（--scan-spec，纯只读，不落盘） ────────

/** 疑似规则行召回——数值/颜色模式（精确信号，直接命中） */
const RULE_VALUE_PATTERNS = [
  /#[0-9a-fA-F]{3,8}\b/,                      // hex 颜色（#0067D1 / #FFF）
  /\brgba?\s*\(/i,                             // rgb() / rgba()
  /\bhsla?\s*\(/i,                             // hsl() / hsla()
  /\b\d+(?:\.\d+)?\s*(?:px|dp|vp|pt|rpx)\b/i,  // 绝对尺寸（32px / 4dp / 12vp）
  /\b\d+(?:\.\d+)?\s*(?:rem|em)\b/i,           // 相对尺寸（0.5rem / 2em）
  /\b\d+(?:\.\d+)?\s*%/,                       // 百分比（50%）
]

/** 疑似规则行召回——规范关键词（定性规则兜底；宁多勿漏，AI 精审剔除） */
const RULE_KEYWORD_RE = /(字号|字体|字重|行高|颜色|色彩|主色|背景|边框|描边|圆角|间距|边距|留白|内边距|外边距|高度|宽度|尺寸|大小|阴影|透明度|渐变|光晕|悬停|按下|禁用|选中|置灰|font|color|radius|spacing|border|shadow|opacity|height|width|padding|margin|size|weight|hover|active|focus|disabled)/i

/** 判定某行是否为疑似规则行 */
function isRuleCandidateLine(line) {
  const s = line.trim()
  if (!s || s.length < 3) return false
  if (RULE_VALUE_PATTERNS.some(re => re.test(s))) return true
  return RULE_KEYWORD_RE.test(s)
}

/** 递归列出领域下全部规范文件（任意层级嵌套；README.md / index.json / 隐藏文件任意层级跳过；排序保证输出稳定） */
function listSpecFiles(domainDir) {
  const out = []
  const walk = dir => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'README.md' || name === 'index.json' || name.startsWith('.')) continue
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(domainDir)
  return out
}

/** 规则粗筛：扫描 specFiles/<领域>/ 全部可读文本文件，输出疑似规则行清单（文件+行号+原文行）。纯只读：不落盘、不触发 7 天清理 */
function runScanSpec(domain) {
  const domainDir = join(config.SPEC_ROOT, safeDomain(domain))
  if (!existsSync(domainDir)) {
    console.error(`✗ 领域目录不存在: ${domainDir}（可用领域先跑 --list-specs 查看）`)
    process.exit(1)
  }
  const files = listSpecFiles(domainDir)
  if (!files.length) {
    console.log(`领域 ${domain} 下无规范文件（README.md / index.json 不计），请先放入规范文件`)
    return
  }
  const chunks = []
  let total = 0
  for (const f of files) {
    const rel = relative(config.SPEC_ROOT, f)
    let buf
    try {
      buf = readFileSync(f)
    } catch {
      chunks.push(`== ${rel} ==（不可读，跳过）`)
      continue
    }
    if (buf.includes(0)) {
      chunks.push(`== ${rel} ==（疑似二进制，跳过）`)
      continue
    }
    const content = decodeTextBuffer(buf, rel)
    const hits = []
    content.split(/\r?\n/).forEach((line, i) => {
      if (!isRuleCandidateLine(line)) return
      const text = line.trim().replace(/\s+/g, ' ')
      hits.push(`  L${String(i + 1).padStart(4)}  ${text.length > 160 ? text.slice(0, 160) + '…' : text}`)
    })
    total += hits.length
    chunks.push(`== ${rel}（${hits.length} 条候选）==\n${hits.join('\n') || '  （无候选行）'}`)
  }
  console.log(chunks.join('\n\n'))
  console.log(`\n统计：${files.length} 个文件、共 ${total} 条候选行`)
  console.log('（粗筛宁多勿漏；按此清单分批精读原文核对——每批 3-5 个文件，每批读完立即产出 issues 草稿，不逐字通读全文）')
}

// ── usage ───────────────────────────────────────────────

function usage() {
  console.log(`design-checker —— UI 规范检查与修复（调度入口：调接口 + 生成文档；AI 只经 stdin 递交数据，不写产物文件）

规范库工作目录：skill 内 specFiles/ 本地自带一份，是唯一规范读取来源；检查流程第 1 步先跑
--sync-spec 对照服务端 version 检查&更新（一致零写入，变化原子覆盖；服务不可达直接用本地）。

用法:
  # 规范清单（服务端优先，服务不可达自动退回本地 specFiles/ 扫描生成）
  node ${join(__dirname, 'design-checker.mjs')} --list-specs [--spec-server <url>]

  # 规范检查&更新（version 一致零写入；本地无该领域且服务不可达才报错）
  node ${join(__dirname, 'design-checker.mjs')} --sync-spec <领域key> [--spec-server <url>]
  → stdout 固定输出：「来源: server|local」
    来源=local = 服务不可达/服务端无此领域，静默使用本地自带规范（🔴 不向用户提示）

  # 规范粗筛（纯只读；规范文件 > 3 个时，检查第 1 遍先跑此命令替代逐字通读）
  node ${join(__dirname, 'design-checker.mjs')} --scan-spec <领域key>

  # 检查递交（stdin，主线）
  node ${join(__dirname, 'design-checker.mjs')} [--out-dir <绝对目录>] <<'JSON'
  { "summary": "...", "sourceFile": "...", "specDomain": "<领域key>", "issues": [...] }
  JSON
  → stdout：报告路径 + JSON 存档路径 + 工作目录 + 问题统计

  # 修复递交（stdin，主线；--work-dir 从检查 stdout 原样透传）
  node ${join(__dirname, 'design-checker.mjs')} --fix --work-dir <检查工作目录> [--out-dir <绝对目录>] <<'JSON'
  { "sourceFile": "...", "copyMode": "...", "fixedFiles": [...], "fixes": [...] }
  JSON
  → stdout：修复报告路径 + 修复数据存档路径 + 修复结果摘要

兼容旧文件输入（兜底）:
  node ${join(__dirname, 'design-checker.mjs')} <issues.json> [--out-dir <绝对目录>]
  node ${join(__dirname, 'design-checker.mjs')} --fix <fix-result.json> [--out-dir <绝对目录>]

参数:
  --out-dir <目录>    报告保存目录（🔴 仅用户指定过时由 AI 传入；必须是绝对目录；
                      ~/ 、~\\\\ 前缀由脚本兜底展开；目录不存在自动创建）
  --work-dir <目录>   修复模式：检查工作目录（检查 stdout 已返回，原样透传）
  --scan-spec <key>   规范规则粗筛：扫描 specFiles/<key>/ 输出疑似规则行清单（纯只读，用后即退）
  --list-specs        列出全部可用规范领域（服务端优先，本地兜底；纯只读）
  --sync-spec <key>   规范检查&更新（对照服务端 version，一致零写入；服务不可达用本地自带）
  --spec-server <url> 规范库服务地址（默认环境变量 SPEC_SERVER_URL 或 lib/config.js 的 SPEC_URL）

说明:
  报告目录规则：--out-dir 指定时 md 报告落该目录（不过期，由用户自行管理）；
  未指定时默认落固定根 ${config.REPORT_ROOT} 下（与 JSON 存档同一工作子文件夹，${config.REPORT_MAX_AGE_DAYS} 天自动过期）
  输入兼容纯 JSON 或 Markdown 内嵌 json 代码块；md 报告必出（0 问题 / 0 修复条目同样生成）
  详细流程见 ${join(SKILL_ROOT, 'SKILL.md')}`)
}

// ── 主入口 ──────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2)

  // 解析 --out-dir / --work-dir / --scan-spec / --sync-spec / --list-specs / --spec-server（参数位置不限）
  let outDir = null
  let workDir = null
  let scanDomain = null
  let syncDomain = null
  let specServer = null
  let listSpecsMode = false
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out-dir') {
      outDir = argv[++i]
      if (!outDir || outDir.startsWith('-')) {
        console.error('✗ --out-dir 需要跟一个目录参数')
        process.exit(1)
      }
    } else if (argv[i] === '--work-dir') {
      workDir = argv[++i]
      if (!workDir || workDir.startsWith('-')) {
        console.error('✗ --work-dir 需要跟一个目录参数')
        process.exit(1)
      }
    } else if (argv[i] === '--scan-spec') {
      scanDomain = argv[++i]
      if (!scanDomain || scanDomain.startsWith('-')) {
        console.error('✗ --scan-spec 需要跟一个领域 key 参数')
        process.exit(1)
      }
    } else if (argv[i] === '--sync-spec') {
      syncDomain = argv[++i]
      if (!syncDomain || syncDomain.startsWith('-')) {
        console.error('✗ --sync-spec 需要跟一个领域 key 参数')
        process.exit(1)
      }
    } else if (argv[i] === '--spec-server') {
      specServer = argv[++i]
      if (!specServer || specServer.startsWith('-')) {
        console.error('✗ --spec-server 需要跟一个服务地址参数')
        process.exit(1)
      }
    } else if (argv[i] === '--list-specs') {
      listSpecsMode = true
    } else {
      rest.push(argv[i])
    }
  }

  const isFix = rest[0] === '--fix'
  const jsonFile = isFix ? rest[1] : rest[0]
  const hasFile = Boolean(jsonFile)

  if (argv.includes('-h') || argv.includes('--help')) {
    usage()
    process.exit(hasFile ? 0 : 1)
  }

  // 规范清单 / 规范检查&更新 / 规范粗筛：只读或仅更新 specFiles/（不读 stdin、不触发 7 天清理、不动检查产物）
  const server = specServer || config.SPEC_URL
  if (listSpecsMode) {
    await runListSpecs(server)
    process.exit(0)
  }
  if (syncDomain) {
    await runSyncSpec(syncDomain, server)
    process.exit(0)
  }
  if (scanDomain) {
    runScanSpec(scanDomain)
    process.exit(0)
  }

  // 输入来源：位置参数文件（旧模式兜底）> stdin（主线：AI 只递交数据，不落盘）；编码统一走 decodeTextBuffer 兜底
  let raw = ''
  if (hasFile) {
    if (!existsSync(jsonFile)) {
      console.error(`✗ JSON 文件不存在: ${jsonFile}`)
      process.exit(1)
    }
    raw = decodeTextBuffer(readFileSync(jsonFile), jsonFile)
  } else {
    if (process.stdin.isTTY) {
      usage()
      process.exit(1)
    }
    raw = decodeTextBuffer(await readStdin(), 'stdin')
  }

  let data
  try {
    data = parseJson(raw)
  } catch (err) {
    console.error(`✗ ${err.message}`)
    process.exit(1)
  }

  // 清理固定根下超过指定天数的历史产物（尽力而为，不影响主流程）
  pruneOldRuns()

  try {
    if (isFix) {
      // 修复模式：workDir 优先级 --work-dir 参数 > 数据内 workDir 字段 > （文件模式）JSON 所在目录
      const wd = workDir || data.workDir || (hasFile ? dirname(resolve(jsonFile)) : null)
      if (!wd) {
        console.error('✗ 修复模式（stdin）需要 --work-dir <检查工作目录>（检查 stdout 已返回，原样透传即可）')
        process.exit(1)
      }
      const r = await runFix(data, { workDir: resolve(wd), outDir, hasFile, jsonFile })
      console.log(`✓ 修复报告已生成: ${r.reportPath}`)
      if (r.jsonPath) console.log(`✓ 修复数据已存档: ${r.jsonPath}`)
      console.log(`修复 ${r.fixed} / 失败 ${r.failed} / 跳过 ${r.skipped}，共 ${r.totalFixes} 条`)
    } else {
      const r = await runCheck(data, { outDir, hasFile, jsonFile })
      console.log(`✓ 报告已生成: ${r.reportPath}`)
      if (r.jsonPath) console.log(`✓ 检查数据已存档: ${r.jsonPath}`)
      if (r.workDir) console.log(`工作目录: ${r.workDir}`)
      const c = r.sevCounts
      console.log(`共 ${r.totalIssues} 处问题（error ${c.error} / warning ${c.warning} / missing ${c.missing} / extra ${c.extra} / info ${c.info}）`)
    }
  } catch (err) {
    console.error(`✗ ${err.message}`)
    process.exit(1)
  }
}

main()
