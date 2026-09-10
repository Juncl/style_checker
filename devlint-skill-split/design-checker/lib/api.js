/**
 * spec-server 接口封装
 *
 * 【职责】
 * 纯调接口：经 fetch 访问规范库服务（spec-server），返回原始 JSON，无本地副作用。
 * 同步落盘 / 三级兜底等编排逻辑在 bin/design-checker.mjs。
 *
 * 【接口清单】（只读，无鉴权）
 *   GET /specs                          领域清单
 *   GET /specs/:domain                  单领域 meta + 文件清单
 *   GET /specs/:domain/file?path=xxx    单文件原文
 *   GET /specs/:domain/archive          整包下载（全量同步用）
 */

import { config } from './config.js'

/** 拉取 JSON（fetch + 超时控制；Node 18+ 内置 fetch，零外部依赖） */
export async function fetchJson(url, timeoutMs = 5000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** 领域清单（替代原 specFiles/index.md 的手工维护） */
export async function listSpecs(serverUrl = config.SPEC_URL) {
  return fetchJson(`${serverUrl}/specs`)
}

/** 单领域 meta + 文件清单（供分批精读规划） */
export async function getSpecDomain(domain, serverUrl = config.SPEC_URL) {
  return fetchJson(`${serverUrl}/specs/${encodeURIComponent(domain)}`)
}

/** 单文件原文（精读 / 修复回读） */
export async function getSpecFile(domain, path, serverUrl = config.SPEC_URL) {
  return fetchJson(`${serverUrl}/specs/${encodeURIComponent(domain)}/file?path=${encodeURIComponent(path)}`)
}

/** 整包下载（模式 A 全量同步：files 平铺 + meta） */
export async function getSpecArchive(domain, serverUrl = config.SPEC_URL) {
  return fetchJson(`${serverUrl}/specs/${encodeURIComponent(domain)}/archive`)
}
