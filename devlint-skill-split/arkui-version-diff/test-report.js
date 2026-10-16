#!/usr/bin/env node
/**
 * 测试脚本：生成版本对比 HTML 报告样例（本地直接调用 server 函数，不依赖 server 进程）
 *
 * 用法：
 *   node devlint-skill-split/arkui-version-diff/test-report.js           # 造差异演示（默认）
 *   node devlint-skill-split/arkui-version-diff/test-report.js --real    # 真实对比 26.8 vs 26.9
 *
 * 造差异演示：以 26.8 版本为 base，深拷贝后自造多种样式差异作为 target，
 * 覆盖 字号/颜色/透明度 error+warning、未匹配节点 等报告元素；
 * 产物输出到 <项目根>/.devlint/arkui-version-diff/ 下，含完整结果 JSON 与 HTML 报告。
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import { runVersionCheck } from '../../server/src/routes/versionCompare.js'
import { parseArkui } from '../../server/src/parsers/arkui/index.js'
import { fetchHtmlReport } from './lib/api.js'
import {
  saveResult,
  saveHtmlReport,
  timestamp,
  resolveOutDir,
} from './lib/report.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../..')
const DATA_DIR = join(PROJECT_ROOT, 'test', '实例数据')

const BASE_DIR = join(DATA_DIR, '26.8版本')
const TARGET_DIR = join(DATA_DIR, '26.9版本')
const DATA_FILE = 'com.huawei.hmos.vmall.json'
const IMG_FILE = 'com.huawei.hmos.vmall.png'

const realMode = process.argv.includes('--real')

// ── 造差异：深拷贝 base 后按规则篡改 target ──────────────────────────────────

function walk(node, fn) {
  fn(node)
  for (const c of node['$children'] || []) walk(c, fn)
}

/** 收集所有 content 非空且 ≥2 字的 Text 内容（按树序，过滤角标/单字符） */
function collectTextContents(root) {
  const out = []
  walk(root, n => {
    const c = n['$attrs']?.content
    if (n['$type'] === 'Text' && typeof c === 'string' && c.trim().length >= 2) out.push(c)
  })
  return out
}

async function makeMutatedTarget(baseJson, baseImg) {
  const target = JSON.parse(JSON.stringify(baseJson))
  const texts = collectTextContents(target.content)
  const [tFont, tOpacity, tRemove] = texts

  // 先探测解析结果，定位"解析后真实存在"的容器节点（id 不带 ':' 的原生节点）
  const probe = await parseArkui(baseJson, { imageBuffer: baseImg })
  const fillTarget = probe.nodes.find(n =>
    n.type === 'container' && n.style?.backgroundColor && !String(n.id).includes(':'))
  const radiusTarget = probe.nodes.find(n =>
    n.type === 'container' && n.style?.borderRadius && !String(n.id).includes(':'))

  const log = []

  // 1&2. 字号 +4 与颜色改红：第 1 个文本（同节点双差异）
  walk(target.content, n => {
    const a = n['$attrs'] || {}
    if (n['$type'] === 'Text' && a.content === tFont) {
      a.fontSize = `${parseFloat(a.fontSize) + 4}fp`
      if (a.actualFontSize) a.actualFontSize = String(parseFloat(a.actualFontSize) + 4)
      if (a.fontColor) a.fontColor = '#E5FF0000'
      log.push(`字号 +4、颜色 → #E5FF0000： "${tFont}"`)
    }
  })

  // 3. 透明度：第 2 个文本 1 → 0.5
  walk(target.content, n => {
    const a = n['$attrs'] || {}
    if (n['$type'] === 'Text' && a.content === tOpacity && a.opacity != null) {
      a.opacity = 0.5
      log.push(`透明度 → 0.5： "${tOpacity}"`)
    }
  })

  // 4. 删除第 3 个文本节点 → base 侧 unmatched
  if (tRemove) {
    const removed = { count: 0 }
    walk(target.content, n => {
      if (!Array.isArray(n['$children'])) return
      const before = n['$children'].length
      n['$children'] = n['$children'].filter(
        c => !(c['$type'] === 'Text' && c['$attrs']?.content === tRemove)
      )
      removed.count += before - n['$children'].length
    })
    if (removed.count) log.push(`删除节点 ×${removed.count}： "${tRemove}"`)
  }

  // 5. 容器填充：探测到的容器 backgroundColor 改色
  if (fillTarget) {
    walk(target.content, n => {
      if (String(n['$ID']) === String(fillTarget.id)) {
        n['$attrs'].backgroundColor = '#FF0067D1'
        log.push(`容器填充 → #FF0067D1（节点 ${fillTarget.id}）`)
      }
    })
  }

  // 6. 容器圆角：探测到的容器 borderRadius +8（仅字符串格式）
  if (radiusTarget) {
    walk(target.content, n => {
      if (String(n['$ID']) === String(radiusTarget.id)) {
        const cur = n['$attrs']?.borderRadius
        if (typeof cur === 'string' && (parseFloat(cur) || parseFloat(cur) === 0)) {
          n['$attrs'].borderRadius = `${(parseFloat(cur) + 8).toFixed(2)}vp`
          log.push(`圆角 +8vp（节点 ${radiusTarget.id}）`)
        }
      }
    })
  }

  console.log('已造差异：')
  for (const l of log) console.log('  · ' + l)
  return target
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  const baseJson = JSON.parse(readFileSync(join(BASE_DIR, DATA_FILE), 'utf-8'))
  const baseImg = readFileSync(join(BASE_DIR, IMG_FILE))

  let targetJson, targetImg, baseName, targetName
  if (realMode) {
    targetJson = JSON.parse(readFileSync(join(TARGET_DIR, DATA_FILE), 'utf-8'))
    targetImg = readFileSync(join(TARGET_DIR, IMG_FILE))
    baseName = '26.8版本.json'
    targetName = '26.9版本.json'
    console.log('模式：真实对比 26.8 vs 26.9')
  } else {
    targetJson = await makeMutatedTarget(baseJson, baseImg)
    targetImg = baseImg
    baseName = '26.8版本.json'
    targetName = '26.8版本(自造差异).json'
    console.log('模式：自造差异演示（base 深拷贝后篡改）')
  }

  console.log('\n执行版本对比...')
  const result = await runVersionCheck(baseJson, targetJson, {
    baseImageBuffer: baseImg,
    targetImageBuffer: targetImg,
  })

  const s = result.stats
  console.log(`\n对比结果：匹配 ${s.matchedPairs} 对 | error ${s.errorCount} | warning ${s.warningCount} | 未匹配 base ${s.unmatchedDesign} / target ${s.unmatchedArkui} | 一致度 ${s.score} | 耗时 ${result.duration}ms`)
  for (const d of result.diffs) {
    console.log(`  [${d.severity}] ${d.property}: ${JSON.stringify(d.designValue)} → ${JSON.stringify(d.arkuiValue)} | ${d.textContent || d.arkuiName || ''}`)
  }

  // 落盘：结果 JSON
  const names = { baseName, targetName }
  const outDir = resolveOutDir(PROJECT_ROOT)
  const ts = timestamp()
  const resultPath = saveResult(result, outDir, ts)

  // HTML 报告：调检查服务现有 /api/report/html 接口（复用 devlint 报告，无需 server 重启加载新路由）
  let htmlReportPath = ''
  try {
    const html = await fetchHtmlReport({
      result,
      baseImage: { buffer: baseImg, name: IMG_FILE },
      targetImage: { buffer: targetImg, name: IMG_FILE },
      serverUrl: 'http://localhost:3012/api',
    })
    htmlReportPath = saveHtmlReport(html, outDir, ts)
  } catch (err) {
    console.error(`⚠ HTML 报告生成失败: ${err.message}`)
  }

  console.log(`\n产物：`)
  console.log(`  结果 JSON：${resultPath}`)
  console.log(`  HTML 报告：${htmlReportPath}`)
  console.log(`\n浏览器打开查看：`)
  console.log(`  open "${htmlReportPath}"`)
}

main().catch(err => {
  console.error(`✗ ${err.message}`)
  process.exit(1)
})
