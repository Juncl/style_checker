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

import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, relative, resolve, basename } from 'path'

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
import { callPairScore } from '../src/lib/batch/pairScoreClient.js'
import { imageSimilarity } from '../src/lib/batch/imagePair.js'

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
  args._raw = argv
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
  const saveResultFlag = args['save-result'] !== undefined && args['save-result'] !== null
  const saveResultPath = saveResultFlag
    ? (args['save-result'] === true ? null : resolve(args['save-result']))
    : null
  const batchDir = args['batch-dir'] ? resolve(args['batch-dir']) : null
  const groupIndex = args['group-index'] ? parseInt(args['group-index'], 10) : null
  const pairScore = args['pair-score'] ? parseFloat(args['pair-score']) : null
  const groupName = args['group-name'] || null

  // 批量场景: --batch-dir + --group-index 自动拼路径,格式 <batch-dir>/<batch时间戳>_group<N>/
  let groupDir = null
  if (batchDir && groupIndex != null) {
    const batchTs = basename(batchDir).replace('batch_', '')
    groupDir = join(batchDir, `${batchTs}_group${groupIndex}`)
    mkdirSync(groupDir, { recursive: true })
  }

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

    let excelPath = ''
    try {
      excelPath = await generateExcelReport(unified, {
        designImagePath, devImagePath,
        designCanvas: null,
        devCanvas: null,
      }, groupDir)
    } catch (e) {
      process.stderr.write(`✗ Excel 报告生成失败: ${e.message}\n`)
    }

    // 纯局部图场景无节点树,不打点(无 stats/diffCount 语义)
    resetSession()

    const preview = {
      platform,
      nodes: unified.slice(0, 10),
      totalNodes: unified.length,
      reportPath: null,
      htmlReportPath: null,
      excelReportPath: excelPath || null,
      textPairs: [],
    }

    if (saveResultFlag) {
      const finalSavePath = saveResultPath || (groupDir ? join(groupDir, 'result.json') : null)
      if (finalSavePath) {
        const fullResult = {
          ...preview,
          nodes: unified,
          nodeIssueCount: 0,
          pixelIssueCount: unified.length,
          textIssueCount: 0,
          pairScore,
          groupName,
          matchedPairs: null,
          highConfidencePairs: null,
        }
        mkdirSync(dirname(finalSavePath), { recursive: true })
        writeFileSync(finalSavePath, JSON.stringify(fullResult, null, 2), 'utf-8')
      }
    }

    output(preview)
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
  const reportPath = generateReport(nodeResult, groupDir)

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
      const htmlOutDir = groupDir || getSessionDir()
      htmlReportPath = join(htmlOutDir, `octo_uxlint_result_${getSessionTimestamp()}.html`)
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
    }, groupDir)
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

  // 批量场景:保存完整结果 JSON
  if (saveResultFlag) {
    const finalSavePath = saveResultPath || (groupDir ? join(groupDir, 'result.json') : null)
    if (finalSavePath) {
      const fullResult = {
        ...preview,
        nodes: unified,
        totalNodes: unified.length,
        nodeIssueCount: unified.filter(u => u.issueType !== '局部图').length,
        pixelIssueCount: unified.filter(u => u.issueType === '局部图').length,
        textIssueCount: 0,
        pairScore,
        groupName,
        matchedPairs: null,
        highConfidencePairs: null,
      }
      mkdirSync(dirname(finalSavePath), { recursive: true })
      writeFileSync(finalSavePath, JSON.stringify(fullResult, null, 2), 'utf-8')
    }
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

  // 图片路径 + 画布尺寸由参数传入
  const ctx = {
    designImagePath: args['design-image'] || null,
    devImagePath: args['dev-image'] || null,
    designCanvas: args['design-canvas-w'] ? { w: parseFloat(args['design-canvas-w']), h: parseFloat(args['design-canvas-h']) } : null,
    devCanvas: args['dev-canvas-w'] ? { w: parseFloat(args['dev-canvas-w']), h: parseFloat(args['dev-canvas-h']) } : null,
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

  await addTextTabToExcel(excelPath, textIssues, ctx)
  output({ added: true, count: textIssues.length, excelPath })
}

async function cmdBatchPair(args) {
  const devGroupsRaw = args['dev-groups'] || ''
  const designGroupsRaw = args['design-groups'] || ''
  const platform = args.platform || 'hmPhone'

  if (!devGroupsRaw) fail('缺少必填参数: --dev-groups')
  if (!designGroupsRaw) fail('缺少必填参数: --design-groups')

  const devGroups = parseGroupArgs(args._raw, '--dev-groups')
  const designGroups = parseGroupArgs(args._raw, '--design-groups')

  if (devGroups.length === 0) fail('--dev-groups 未解析到有效组')
  if (designGroups.length === 0) fail('--design-groups 未解析到有效组')

  // 自动创建批量目录: .octo-uxlint/batch_<时间戳>/
  const batchTs = getSessionTimestamp()
  const batchDir = join(process.cwd(), config.DIR_NAME, `batch_${batchTs}`)
  mkdirSync(batchDir, { recursive: true })

  const allDevImageOnly = devGroups.every(g => !g.json)
  const allDesignImageOnly = designGroups.every(g => !g.json)
  const isImageOnly = allDevImageOnly && allDesignImageOnly

  process.stderr.write(`批量目录: ${batchDir}\n`)
  process.stderr.write(`配对计算: 开发 ${devGroups.length} 组 × 设计 ${designGroups.length} 组 = ${devGroups.length * designGroups.length} 次调用${isImageOnly ? ' (纯图模式,用图片相似度)' : ' (JSON模式,用节点匹配)'}\n`)

  const scoreMatrix = []
  let completed = 0
  const total = devGroups.length * designGroups.length

  for (let i = 0; i < devGroups.length; i++) {
    for (let j = 0; j < designGroups.length; j++) {
      const dev = devGroups[i]
      const design = designGroups[j]
      completed++
      try {
        if (isImageOnly) {
          const sim = await imageSimilarity(dev.image, design.image)
          scoreMatrix.push({ devIndex: i, designIndex: j, pairScore: Number(sim.toFixed(4)), dev, design })
          process.stderr.write(`  [${completed}/${total}] dev[${i}] × design[${j}] → 相似度=${sim.toFixed(4)}\n`)
        } else {
          const score = await callPairScore({
            designJsonPath: design.json, devJsonPath: dev.json,
            designImagePath: design.image, devImagePath: dev.image,
            platform,
          })
          scoreMatrix.push({ devIndex: i, designIndex: j, ...score, dev, design })
          process.stderr.write(`  [${completed}/${total}] dev[${i}] × design[${j}] → pairScore=${score.pairScore} (匹配${score.matchedPairs}对,高可信${score.highConfidencePairs}对)\n`)
        }
      } catch (e) {
        scoreMatrix.push({ devIndex: i, designIndex: j, pairScore: -1, error: e.message, dev, design })
        process.stderr.write(`  [${completed}/${total}] dev[${i}] × design[${j}] → 失败: ${e.message}\n`)
      }
    }
  }

  // 贪心配对
  const sorted = scoreMatrix.filter(s => s.pairScore >= 0).sort((a, b) => b.pairScore - a.pairScore)
  const usedDev = new Set()
  const usedDesign = new Set()
  const pairs = []
  let groupIndex = 0
  for (const s of sorted) {
    if (usedDev.has(s.devIndex) || usedDesign.has(s.designIndex)) continue
    usedDev.add(s.devIndex)
    usedDesign.add(s.designIndex)
    groupIndex++
    pairs.push({
      groupIndex,
      devIndex: s.devIndex,
      devJson: s.dev.json,
      devImage: s.dev.image,
      designIndex: s.designIndex,
      designJson: s.design.json,
      designImage: s.design.image,
      pairScore: s.pairScore,
      matchedPairs: s.matchedPairs || null,
      highConfidencePairs: s.highConfidencePairs || null,
      groupName: `dev${s.devIndex}_design${s.designIndex}`,
    })
  }

  const unmatchedDev = devGroups.map((g, i) => ({ index: i, ...g })).filter(g => !usedDev.has(g.index))
  const unmatchedDesign = designGroups.map((g, j) => ({ index: j, ...g })).filter(g => !usedDesign.has(g.index))

  const result = { batchDir, pairs, unmatchedDev, unmatchedDesign, totalDev: devGroups.length, totalDesign: designGroups.length }
  const pairsPath = join(batchDir, 'pairs.json')
  writeFileSync(pairsPath, JSON.stringify(result, null, 2), 'utf-8')

  process.stderr.write(`\n配对完成: ${pairs.length} 组配对成功`)
  if (unmatchedDev.length) process.stderr.write(`, 开发侧未配对 ${unmatchedDev.length} 组`)
  if (unmatchedDesign.length) process.stderr.write(`, 设计侧未配对 ${unmatchedDesign.length} 组`)
  process.stderr.write('\n')

  output({ ...result, pairsPath })
}

async function cmdBatchSummary(args) {
  const batchDir = args['batch-dir'] ? resolve(args['batch-dir']) : null
  if (!batchDir) fail('缺少必填参数: --batch-dir')
  if (!existsSync(batchDir)) fail(`批量目录不存在: ${batchDir}`)

  // 自动扫描 batchDir 下所有子目录的 result.json
  const { readdirSync, statSync } = await import('fs')
  const resultFiles = []
  for (const name of readdirSync(batchDir)) {
    const subDir = join(batchDir, name)
    if (!statSync(subDir).isDirectory()) continue
    const resultPath = join(subDir, 'result.json')
    if (existsSync(resultPath)) resultFiles.push(resultPath)
  }

  if (resultFiles.length === 0) fail('批量目录下未找到任何 result.json')

  const groups = []
  for (const rPath of resultFiles.sort()) {
    try {
      const data = JSON.parse(readFileSync(rPath, 'utf-8'))
      groups.push({ path: rPath, dir: dirname(rPath), ...data })
    } catch (e) {
      process.stderr.write(`✗ 结果文件解析失败: ${rPath}: ${e.message}\n`)
    }
  }

  if (groups.length === 0) fail('无有效结果文件')

  const lines = []
  lines.push('# 批量 UI 一致性检查汇总')
  lines.push('')
  lines.push(`- 批量组数: ${groups.length} 组`)
  lines.push(`- 生成时间: ${new Date().toLocaleString('zh-CN')}`)
  lines.push('')
  lines.push('## 总览')
  lines.push('')
  lines.push('| 组名 | 平台 | 节点对比问题数 | 局部图问题数 | 文案问题数 | 总问题数 | 配对度 | 报告目录 |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    const groupName = g.groupName || `组${i + 1}`
    const total = (g.nodeIssueCount || 0) + (g.pixelIssueCount || 0) + (g.textIssueCount || 0)
    const score = g.pairScore != null ? g.pairScore : '-'
    lines.push(`| ${groupName} | ${g.platform || '-'} | ${g.nodeIssueCount || 0} | ${g.pixelIssueCount || 0} | ${g.textIssueCount || 0} | ${total} | ${score} | ${g.dir} |`)
  }
  lines.push('')
  lines.push('## 各组详情')
  lines.push('')
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    const groupName = g.groupName || `组${i + 1}`
    lines.push(`### ${groupName}`)
    lines.push('')
    if (g.pairScore != null) {
      lines.push(`- 配对度: ${g.pairScore}${g.matchedPairs ? `(匹配 ${g.matchedPairs} 对,高可信 ${g.highConfidencePairs || 0} 对)` : ''}`)
    }
    lines.push(`- 节点对比: ${g.nodeIssueCount || 0} 个属性差异`)
    lines.push(`- 局部图对比: ${g.pixelIssueCount || 0} 个(差异率 ≥35%)`)
    lines.push(`- 文案对比: ${g.textIssueCount || 0} 个文案不一致`)
    if (g.reportPath) lines.push(`- 报告: [md](${relPath(g.dir, g.reportPath)}) | [html](${relPath(g.dir, g.htmlReportPath)}) | [excel](${relPath(g.dir, g.excelReportPath)})`)
    lines.push('')
  }

  const allMdPath = join(batchDir, 'all.md')
  writeFileSync(allMdPath, lines.join('\n'), 'utf-8')

  output({ groups: groups.length, allMdPath, batchDir })
}

// 从 raw argv 解析组参数,每组是 "json,png" 形式
// --dev-groups "a.json,a.png" "b.json,b.png" --design-groups "c.json,c.png" "d.json,d.png"
function parseGroupArgs(rawArgv, flag) {
  const groups = []
  let capturing = false
  let currentFlag = ''
  for (const arg of rawArgv || []) {
    if (arg.startsWith('--')) {
      capturing = arg === flag
      currentFlag = arg
      continue
    }
    if (capturing && currentFlag === flag) {
      const parts = arg.split(',').map(s => s.trim()).filter(s => s)
      if (parts.length >= 2) {
        groups.push({ json: parts[0], image: parts[1] })
      } else if (parts.length === 1) {
        groups.push({ json: null, image: parts[0] })
      }
    }
  }
  return groups
}

function relPath(from, to) {
  if (!to) return ''
  try {
    return relPathSimple(from, to)
  } catch {
    return to
  }
}

function relPathSimple(from, to) {
  return relative(dirname(from), to)
}

const COMMANDS = {
  'collect-arkui': cmdCollectArkui,
  'collect-web': cmdCollectWeb,
  'collect-design': cmdCollectDesign,
  'ui-style-check': cmdUiStyleCheck,
  'add-text-tab': cmdAddTextTab,
  'batch-pair': cmdBatchPair,
  'batch-summary': cmdBatchSummary,
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
  batch-pair           批量配对（N×M 算配对度,输出最优配对 pairs.json）
  batch-summary        批量汇总（读多组 result.json → 输出 batch_summary.md）

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
