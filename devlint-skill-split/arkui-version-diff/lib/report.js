/**
 * 报告与结果落盘
 *
 * HTML 报告复用检查服务的现有能力（lib/api.js 的 fetchHtmlReport），
 * 本模块只负责：输出目录、结果 JSON 落盘、HTML 落盘、stdout 摘要提取。
 */

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/** 时间戳：YYYYMMDD_HHmmss */
export function timestamp() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 输出目录：<cwd>/.devlint/arkui-version-diff/ */
export function resolveOutDir(cwd) {
  const dir = join(cwd || process.cwd(), '.devlint', 'arkui-version-diff')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 完整结果 JSON 落盘 */
export function saveResult(result, outDir, ts) {
  const path = join(outDir, `arkui_version_diff_result_${ts}.json`)
  writeFileSync(path, JSON.stringify(result, null, 2), 'utf-8')
  return path
}

/** HTML 报告落盘 */
export function saveHtmlReport(html, outDir, ts) {
  const path = join(outDir, `arkui_version_diff_report_${ts}.html`)
  writeFileSync(path, html, 'utf-8')
  return path
}

// ── 摘要提取 ────────────────────────────────────────────────────────────────

/**
 * 提取 stdout 摘要（给 agent 消费，控制在最小体积）
 *
 * 结果结构中 design 槽位 = base（旧版本）、arkui 槽位 = target（新版本）。
 *
 * @param {object} result 对比结果（/api/version/compare 返回）
 * @param {{ baseName: string, targetName: string }} names
 * @returns {object} { base, target, stats, diffPreview, totalDiffs }
 */
export function extractSummary(result, names) {
  const MAX_PREVIEW = 10
  const diffs = result.diffs || []
  return {
    base: names.baseName,
    target: names.targetName,
    stats: {
      baseNodes: result.stats?.designNodes,
      targetNodes: result.stats?.arkuiNodes,
      matchedPairs: result.stats?.matchedPairs,
      unmatchedBase: result.stats?.unmatchedDesign,
      unmatchedTarget: result.stats?.unmatchedArkui,
      errorCount: result.stats?.errorCount,
      warningCount: result.stats?.warningCount,
      score: result.stats?.score,
      duration: result.stats?.duration ?? result.duration,
    },
    diffPreview: diffs.slice(0, MAX_PREVIEW).map(d => ({
      severity: d.severity,
      property: d.property,
      baseValue: d.designValue,
      targetValue: d.arkuiValue,
      nodeName: d.arkuiName || d.designName || null,
      textContent: d.textContent || null,
    })),
    totalDiffs: diffs.length,
  }
}
