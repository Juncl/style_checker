/**
 * URL 参数管理工具
 *
 * 所有 URL 修改均保留 `debugger=1` 参数（若当前 URL 中存在）。
 */

/** 写入指定参数到 URL，同时保留 debugger=1 */
export function setUrlParams(params: Record<string, string>): void {
  const hashPath = window.location.hash.split('?')[0]
  const hashQuery = window.location.hash.split('?')[1] || ''
  const kept = hashQuery.split('&').filter(p => p && p.startsWith('debugger='))
  const newParams = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const query = [newParams, ...kept].filter(Boolean).join('&')
  window.history.replaceState(null, '', `${window.location.pathname}${hashPath}?${query}`)
}

/** 从 URL 中删除指定 key 的参数，保留其余参数（含 debugger） */
export function removeUrlParams(keys: string[]): void {
  const hashPath = window.location.hash.split('?')[0]
  const hashQuery = window.location.hash.split('?')[1] || ''
  const keepParams = hashQuery.split('&').filter(p => {
    if (!p) return false
    const key = p.split('=')[0]
    return !keys.includes(key)
  })
  const newQuery = keepParams.length ? `?${keepParams.join('&')}` : ''
  window.history.replaceState(null, '', `${window.location.pathname}${hashPath}${newQuery}`)
}
