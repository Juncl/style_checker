/**
 * 网页模式采集模块（--collect-web）
 *
 * 【职责】
 * puppeteer 打开目标网页，拉取 JS 执行后的 HTML + 全套 CSS + JS 文件，按原文件形态
 * 落盘到报告固定根下的工作目录（web-<时间戳>/），作为网页模式的检查对象与存档。
 * 不做视口/分辨率设置——采集只需页面资源，与渲染尺寸无关。
 *
 * 【产物结构】
 * <REPORT_ROOT>/web-<时间戳>/
 *   page.html      ← JS 执行后的 DOM 快照（class、内联 style、<style>/<script> 块齐全）
 *   css/*.css      ← 外部表按 URL 原文件名下载原始文件（清单取自 document.styleSheets，
 *                     天然覆盖 <link> 引入与 @import 链；重名追加序号）、内联 <style> 块
 *                     inline-style-N.css；每个文件头部注释标明来源
 *   js/*.js        ← 外部脚本按 URL 原文件名下载、内联脚本 inline-script-N.js（存档用）
 *   manifest.json  ← url / finalUrl / title / 采集时间 / 文件清单 / 下载失败清单
 *
 * 【引擎与依赖】
 * puppeteer 通道为 skill 自有源码 lib/puppeteer.js（参考 devlint-mcp 的
 * getWebDom/puppeteer.js 及其 tools 依赖重写的精简版：去掉截图、CDP 设备仿真与
 * 视口设置，保留登录态闭环 + 登录页检测 + 有头降级）。通道顶层 import puppeteer-core——
 * 仅 --collect-web 时动态加载（本地文件检查模式保持零依赖，无需 npm install）。
 */

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { config } from './config.js'
import { timestamp, readableTimestamp } from './report.js'

/**
 * 页面上下文采集函数（🔴 自包含——page.evaluate 序列化后在浏览器执行，不可引用闭包变量）：
 * JS 执行后的完整 HTML + 外部资源 URL 清单（CSS/JS，由 Node 侧统一下载原始文件）+ 内联块原文。
 */
async function pageAssetsCollector() {
  // 移除有头模式注入的"采集中"提示条（若存在），避免污染 page.html 产物
  // （id 与 lib/puppeteer.js 的 injectCollectBanner 约定一致）
  document.getElementById('__devlint_collect_banner__')?.remove()

  // 等文档完全加载（样式/脚本等子资源就位；兜底最多再等 10 秒）
  if (document.readyState !== 'complete') {
    await new Promise(resolve => {
      document.addEventListener('readystatechange', () => {
        if (document.readyState === 'complete') resolve()
      })
      setTimeout(resolve, 10000)
    })
  }

  // 外部 CSS 清单：document.styleSheets 枚举全部有 href 的表——天然覆盖 <link> 引入
  // 与 @import 链（imported 表也在集合中），去重后由 Node 侧统一下载原始文件
  const cssHrefs = []
  const seenCss = new Set()
  for (const sheet of document.styleSheets) {
    if (sheet.href && !seenCss.has(sheet.href)) {
      seenCss.add(sheet.href)
      cssHrefs.push(sheet.href)
    }
  }

  // 内联 <style> 块（含 JS 注入的）：取 textContent 原始文本
  const inlineStyles = []
  document.querySelectorAll('style').forEach(el => {
    if (el.textContent && el.textContent.trim()) {
      inlineStyles.push(el.textContent)
    }
  })

  // 脚本清单：外部（src）记 URL 待下载（去重）；内联取 textContent
  const externalScripts = []
  const inlineScripts = []
  const seenJs = new Set()
  for (const el of document.scripts) {
    if (el.src) {
      if (!seenJs.has(el.src)) {
        seenJs.add(el.src)
        externalScripts.push(el.src)
      }
    } else if (el.textContent && el.textContent.trim()) {
      inlineScripts.push(el.textContent)
    }
  }

  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    cssHrefs,
    inlineStyles,
    externalScripts,
    inlineScripts,
    finalUrl: location.href,
    title: document.title,
  }
}

/** 动态加载 puppeteer 通道（惰性：仅 --collect-web 触发；puppeteer-core 未安装时给出安装指引） */
async function loadChannel() {
  try {
    return await import('./puppeteer.js')
  } catch (err) {
    if (/puppeteer-core/.test(err.message)) {
      throw new Error('未安装 puppeteer-core（网页采集依赖）。安装方式：cd <skill目录> && npm install puppeteer-core（本机需有 Chrome 浏览器），装好后重试')
    }
    throw err
  }
}

/** 从资源 URL 提取落盘文件名（URL 末段有扩展名则用原文件名；否则用兜底名；重名追加序号）。
 *  🔴 须在下载前的同步阶段调用分配（usedNames 去重），避免并行下载竞态 */
function fileNameFromHref(href, usedNames, fallbackName) {
  let base = fallbackName
  try {
    const last = new URL(href).pathname.split('/').filter(Boolean).pop()
    if (last && /\.\w+$/.test(last)) base = last
  } catch {}
  let name = base
  let n = 2
  while (usedNames.has(name)) {
    name = base.replace(/(\.\w+)$/, '') + `-${n}$1`
    n += 1
  }
  usedNames.add(name)
  return name
}

/** 落盘单个资源文件（头部注释标明来源，便于检查时追溯定位） */
function writeAssetFile(path, sourceLabel, content) {
  writeFileSync(path, `/* ===== 来源: ${sourceLabel} ===== */\n\n${content || ''}\n`, 'utf-8')
}

/** Node 侧下载外部资源原文（CSS/JS 共用；Node fetch 不受浏览器 CORS 约束；单文件 30s 超时） */
async function fetchText(href, pageUrl) {
  const res = await fetch(href, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Referer: pageUrl,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/**
 * 网页模式采集入口（--collect-web）
 *
 * @param {string} url - 目标网页地址（http/https 完整 URL）
 * @returns {Promise<{workDir, htmlPath, cssDir, jsDir, manifestPath, cssFiles, jsFiles, failed}>}
 *   采集落盘到 <REPORT_ROOT>/web-<时间戳>/（与报告同一固定根，7 天自动过期）；
 *   外部资源下载失败不中断整体采集，记入 failed 由调用方提示
 */
export async function collectWeb(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) {
    throw new Error(`非法网址: ${url}（--collect-web 需要 http:// 或 https:// 开头的完整 URL）`)
  }
  const { run } = await loadChannel()
  // waitUntil 对齐 mcp 通道实际默认（domcontentloaded）：networkidle0 在含长轮询/埋点/
  // 长连接的真实站点永远达不到空闲，60s 超时会误判失败并触发不必要的有头降级；
  // 子资源就绪改由 collectFn 内的 readyState===complete 等待保障
  const { domData } = await run(url, {
    collectFn: pageAssetsCollector,
    waitUntil: 'domcontentloaded',
  })

  const workDir = join(config.REPORT_ROOT, `web-${timestamp()}`)
  const cssDir = join(workDir, 'css')
  const jsDir = join(workDir, 'js')
  mkdirSync(cssDir, { recursive: true })
  mkdirSync(jsDir, { recursive: true })

  const htmlPath = join(workDir, 'page.html')
  writeFileSync(htmlPath, domData.html, 'utf-8')

  const cssFiles = []
  const jsFiles = []
  const failed = []
  const usedCss = new Set()
  const usedJs = new Set()

  // 先同步分配文件名（去重），再并行下载——避免并行竞态导致重名覆盖
  const cssJobs = domData.cssHrefs.map((href, i) => ({ href, name: fileNameFromHref(href, usedCss, `sheet-${i + 1}.css`) }))
  const jsJobs = domData.externalScripts.map((src, i) => ({ src, name: fileNameFromHref(src, usedJs, `script-${i + 1}.js`) }))

  // 内联块落盘（原文保存）
  domData.inlineStyles.forEach((css, i) => {
    const name = `inline-style-${i + 1}.css`
    const sourceLabel = `内联 <style> 块（第 ${i + 1} 个）`
    writeAssetFile(join(cssDir, name), sourceLabel, css)
    cssFiles.push({ file: `css/${name}`, source: sourceLabel })
  })
  domData.inlineScripts.forEach((js, i) => {
    const name = `inline-script-${i + 1}.js`
    const sourceLabel = `内联 <script> 块（第 ${i + 1} 个）`
    writeAssetFile(join(jsDir, name), sourceLabel, js)
    jsFiles.push({ file: `js/${name}`, source: sourceLabel })
  })

  // 外部 CSS + JS 并行下载原始文件；单个失败记入 failed 继续
  await Promise.all([
    ...cssJobs.map(async ({ href, name }) => {
      try {
        const text = await fetchText(href, domData.finalUrl)
        writeAssetFile(join(cssDir, name), href, text)
        cssFiles.push({ file: `css/${name}`, source: href })
      } catch (err) {
        failed.push({ source: href, reason: err.message })
      }
    }),
    ...jsJobs.map(async ({ src, name }) => {
      try {
        const text = await fetchText(src, domData.finalUrl)
        writeAssetFile(join(jsDir, name), src, text)
        jsFiles.push({ file: `js/${name}`, source: src })
      } catch (err) {
        failed.push({ source: src, reason: err.message })
      }
    }),
  ])

  const manifest = {
    url,
    finalUrl: domData.finalUrl,
    title: domData.title,
    collectedAt: readableTimestamp(),
    files: { html: 'page.html', css: cssFiles, js: jsFiles },
    failed,
  }
  const manifestPath = join(workDir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')

  return { workDir, htmlPath, cssDir, jsDir, manifestPath, cssFiles, jsFiles, failed }
}
