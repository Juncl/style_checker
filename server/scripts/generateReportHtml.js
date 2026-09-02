/**
 * generateReportHtml.js — 调用 /api/report/html 生成可视化 HTML 报告（自测调试用）
 *
 * 流程（全部走 HTTP 接口，不直接读 server 内部模块）：
 *   1. POST /api/check/case/:caseId          跑完整检查，拿 result JSON
 *   2. GET  /api/cases/:caseId/image/:type   取设计稿 / 开发侧截图 buffer
 *   3. POST /api/report/html                 result + 图片 → 完整 HTML 字符串
 *   4. 落盘到 test/report-html/<caseId>.html
 *
 * 依赖：server 必须已在 3012 端口运行（cd server && npm run dev）。本脚本不启动 server。
 *
 * 落盘规则（与 devlint-mcp lib/server.js 一致）：
 *   <cwd>/.octo-uxlint/<年月日_时分秒>/octo_uxlint_result_<年月日_时分秒>.html
 *
 * 环境变量：
 *   SERVER   server 地址，默认 http://localhost:3012
 *   PLATFORM 平台，默认 hmPhone
 *
 * 用法：
 *   cd server && node scripts/generateReportHtml.js        # 默认 case4
 *   node scripts/generateReportHtml.js case6 case11        # 指定 case
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = process.env.SERVER || 'http://localhost:3012'
const PLATFORM = process.env.PLATFORM || 'hmPhone'

const cases = process.argv.slice(2).length ? process.argv.slice(2) : ['case4']

// 时间戳格式与 devlint-mcp lib/utils/session.js 一致：年月日_时分秒
const pad = n => String(n).padStart(2, '0')
const now = new Date()
const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
const outDir = join(process.cwd(), '.octo-uxlint', timestamp)

// ── 健康检查（不通则提示用户手动启动，AI/脚本不代启）──────────────────────────
try {
  const h = await fetch(`${SERVER}/api/cases`)
  if (!h.ok) throw new Error('HTTP ' + h.status)
} catch (e) {
  console.error(`❌ 无法连接 server（${SERVER}）：${e.message}`)
  console.error('   请先手动启动：cd server && npm run dev')
  process.exit(1)
}

// 拉取图片，按 Content-Type 推断扩展名（dump case 的开发侧图是 jpeg，
// /api/report/html 内部按文件名后缀决定 data URI 的 mime，必须命名正确）
async function fetchImage(caseId, type) {
  const res = await fetch(`${SERVER}/api/cases/${caseId}/image/${type}?platform=${PLATFORM}`)
  if (!res.ok) throw new Error(`GET image/${type} HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const mime = (res.headers.get('content-type') || 'image/png').split(';')[0]
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpeg' : 'png'
  return { buf, mime, name: `${type}.${ext}` }
}

mkdirSync(outDir, { recursive: true })

let lastPath = null
for (const c of cases) {
  try {
    // ① 跑 case，拿 result
    //   注：devlint-mcp 的 result 来自 /check/upload，不含下列附加字段；
    //   /check/case 会额外返回（check.js），剔除后与 mcp 的输入形态完全一致
    const checkRes = await fetch(`${SERVER}/api/check/case/${c}?platform=${PLATFORM}`, { method: 'POST' })
    const result = await checkRes.json()
    if (result.error) { console.log(`${c.padEnd(8)} ❌ ${result.error}`); continue }
    delete result.matchValidation   // 验证集（仅测试用）
    delete result._rawDesignJson    // 原始设计 JSON 完整副本
    delete result._rawDevContent    // 原始开发 JSON 完整副本
    delete result._devImgExt        // 开发侧图片扩展名标记

    // ② 取两侧截图
    const design = await fetchImage(c, 'design')
    const dev = await fetchImage(c, 'arkui')

    // ③ 组装 multipart，调 /api/report/html
    const form = new FormData()
    form.append('result', new Blob([JSON.stringify(result)], { type: 'application/json' }), 'result.json')
    form.append('designImage', new Blob([design.buf], { type: design.mime }), design.name)
    form.append('devImage', new Blob([dev.buf], { type: dev.mime }), dev.name)

    const htmlRes = await fetch(`${SERVER}/api/report/html`, { method: 'POST', body: form })
    if (!htmlRes.ok) {
      console.log(`${c.padEnd(8)} ❌ /report/html HTTP ${htmlRes.status}: ${await htmlRes.text()}`)
      continue
    }
    const html = await htmlRes.text()

    // ④ 落盘（命名与 devlint-mcp 一致：octo_uxlint_result_<时间戳>.html；多 case 时加 caseId 区分）
    const fileName = cases.length === 1
      ? `octo_uxlint_result_${timestamp}.html`
      : `octo_uxlint_result_${c}_${timestamp}.html`
    const outPath = join(outDir, fileName)
    writeFileSync(outPath, html)
    const kb = (Buffer.byteLength(html) / 1024).toFixed(1)
    console.log(`${c.padEnd(8)} ✓ ${result.diffs?.length ?? 0} 条 diff → ${outPath}（${kb} KB）`)
    lastPath = outPath
  } catch (e) {
    console.log(`${c.padEnd(8)} ❌ ${e.message}`)
  }
}

console.log(`\n浏览器查看：open ${lastPath || join(outDir, 'octo_uxlint_result_' + timestamp + '.html')}`)
