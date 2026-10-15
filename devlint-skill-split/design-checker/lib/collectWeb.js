/**
 * 网页模式采集模块（--collect-web）
 *
 * 【职责】
 * puppeteer 打开目标网页，拉取 JS 执行后的 HTML + 全套 CSS 样式表，落盘到报告固定根下的
 * 工作目录（web-<时间戳>/），作为网页模式的检查对象。采集产物与本地前端工程同构
 * （HTML 文件 + CSS 文件），检查方法论（check-method.md 两遍法）零改动复用。
 *
 * 【产物结构】
 * <REPORT_ROOT>/web-<时间戳>/
 *   page.html      ← JS 执行后的 DOM 快照（class、内联 style、<style> 块齐全）
 *   css/*.css      ← document.styleSheets 全量序列化：link 表按原文件名（重名追加序号）、
 *                     内联 / JS 注入块 inline-style-N.css；跨域表（cssRules 受 CORS 限制）
 *                     由 Node 侧 fetch 原始文件兜底；每个文件头部注释标明来源
 *   manifest.json  ← url / finalUrl / title / 采集时间 / 文件清单 / 兜底失败清单
 *
 * 【引擎与依赖】
 * puppeteer 通道为 skill 自有源码 lib/puppeteer.js（参考 devlint-mcp 的
 * getWebDom/puppeteer.js 及其 tools 依赖重写的精简版：去掉截图与 CDP 设备仿真，
 * 保留登录态闭环 + 登录页检测 + 有头降级）。通道顶层 import puppeteer-core——
 * 仅 --collect-web 时动态加载（本地文件检查模式保持零依赖，无需 npm install）。
 */

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { config } from './config.js'
import { timestamp, readableTimestamp } from './report.js'

/**
 * 页面上下文采集函数（🔴 自包含——page.evaluate 序列化后在浏览器执行，不可引用闭包变量）：
 * JS 执行后的完整 HTML + document.styleSheets 全量序列化。
 * 跨域样式表访问 cssRules 抛 SecurityError → 标记 crossOrigin，由 Node 侧 fetch 兜底。
 */
function pageAssetsCollector() {
  const sheets = []
  let seq = 0
  for (const sheet of document.styleSheets) {
    seq += 1
    const entry = { index: seq, href: sheet.href || '', inline: !sheet.href }
    try {
      entry.css = Array.from(sheet.cssRules).map(r => r.cssText).join('\n\n')
    } catch {
      entry.crossOrigin = true
    }
    sheets.push(entry)
  }
  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    sheets,
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

/** 从样式表 href 提取落盘文件名（URL 末段 .css；非法/缺失兜底 sheet-N.css；重名追加序号） */
function cssFileNameFromHref(href, usedNames, seq) {
  let base = `sheet-${seq}.css`
  try {
    const last = new URL(href).pathname.split('/').filter(Boolean).pop()
    if (last && /\.css$/i.test(last)) base = last
  } catch {}
  let name = base
  let n = 2
  while (usedNames.has(name)) {
    name = base.replace(/\.css$/i, '') + `-${n}.css`
    n += 1
  }
  usedNames.add(name)
  return name
}

/** 落盘单个 CSS 文件（头部注释标明来源，便于检查时追溯定位） */
function writeCssFile(path, sourceLabel, css) {
  writeFileSync(path, `/* ===== 来源: ${sourceLabel} ===== */\n\n${css || ''}\n`, 'utf-8')
}

/** Node 侧 fetch 跨域样式表原文（绕开浏览器 cssRules 的 CORS 限制；Node fetch 不受 CORS 约束） */
async function fetchCssText(href, pageUrl) {
  const res = await fetch(href, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Referer: pageUrl,
    },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/**
 * 网页模式采集入口（--collect-web）
 *
 * @param {string} url - 目标网页地址（http/https 完整 URL）
 * @returns {Promise<{workDir: string, htmlPath: string, cssDir: string, manifestPath: string,
 *                    cssFiles: Array<{file: string, source: string}>, failed: Array<{source: string, reason: string}>}>}
 *   采集落盘到 <REPORT_ROOT>/web-<时间戳>/（与报告同一固定根，7 天自动过期）；
 *   跨域样式表 fetch 失败不中断整体采集，记入 failed 由调用方提示
 */
export async function collectWeb(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) {
    throw new Error(`非法网址: ${url}（--collect-web 需要 http:// 或 https:// 开头的完整 URL）`)
  }
  const { run } = await loadChannel()
  const viewport = { width: 1920, height: 1080, deviceScaleFactor: 1 }
  const { domData } = await run(url, {
    collectFn: pageAssetsCollector,
    viewport,
    waitUntil: 'networkidle0',
  })

  const workDir = join(config.REPORT_ROOT, `web-${timestamp()}`)
  const cssDir = join(workDir, 'css')
  mkdirSync(cssDir, { recursive: true })

  const htmlPath = join(workDir, 'page.html')
  writeFileSync(htmlPath, domData.html, 'utf-8')

  const cssFiles = []
  const failed = []
  const usedNames = new Set()
  let inlineSeq = 0
  for (const s of domData.sheets) {
    let name
    let sourceLabel
    if (s.inline) {
      inlineSeq += 1
      name = `inline-style-${inlineSeq}.css`
      sourceLabel = `内联 <style> 块（页面第 ${s.index} 个样式表）`
    } else {
      name = cssFileNameFromHref(s.href, usedNames, s.index)
      sourceLabel = s.href
    }
    if (s.crossOrigin) {
      try {
        const css = await fetchCssText(s.href, domData.finalUrl)
        writeCssFile(join(cssDir, name), sourceLabel, css)
        cssFiles.push({ file: `css/${name}`, source: s.href, via: 'http-fallback' })
      } catch (err) {
        failed.push({ source: s.href, reason: err.message })
      }
    } else {
      writeCssFile(join(cssDir, name), sourceLabel, s.css)
      cssFiles.push({ file: `css/${name}`, source: sourceLabel })
    }
  }

  const manifest = {
    url,
    finalUrl: domData.finalUrl,
    title: domData.title,
    collectedAt: readableTimestamp(),
    viewport,
    files: { html: 'page.html', css: cssFiles },
    failed,
  }
  const manifestPath = join(workDir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')

  return { workDir, htmlPath, cssDir, manifestPath, cssFiles, failed }
}
