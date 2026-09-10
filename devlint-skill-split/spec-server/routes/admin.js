import { Router } from 'express'
import {
  MAX_FILE_BYTES, MAX_BATCH_BYTES,
  validateDomainKey, validateRelPath, validateVersion, domainExists, readMeta,
  writeMeta, bumpVersion, writeSpecFile, deleteSpecFile, deleteDomain, listSpecFiles,
} from '../utils/specStore.js'

const router = Router()

// ── 管理鉴权：设置了 SPEC_ADMIN_TOKEN 环境变量时必须携带 Header x-admin-token ──
// 未设置时放行（本地开发）；只读 /specs 接口无鉴权
router.use((req, res, next) => {
  const token = process.env.SPEC_ADMIN_TOKEN
  if (!token) return next()
  if (req.get('x-admin-token') === token) return next()
  res.status(401).json({ error: '无效的管理令牌（需要 Header x-admin-token）' })
})

// POST /admin/specs —— 新建领域 { key, name, description?, version? }（version 缺省 "1.0.0"）
router.post('/specs', (req, res) => {
  const { key, name, description, version } = req.body || {}
  const err = validateDomainKey(key)
  if (err) return res.status(400).json({ error: err })
  if (!String(name || '').trim()) return res.status(400).json({ error: '规范名称（name）不能为空' })
  if (version !== undefined) {
    const vErr = validateVersion(version)
    if (vErr) return res.status(400).json({ error: vErr })
  }
  if (domainExists(key)) return res.status(409).json({ error: `领域已存在: ${key}` })

  const meta = writeMeta(key, { name: String(name).trim(), description: String(description || '').trim(), version: version || '1.0.0' })
  res.json({ ok: true, key, version: meta.version, updatedAt: meta.updatedAt })
})

// PUT /admin/specs/:domain/meta —— 更新领域 meta { name?, description? }
router.put('/specs/:domain/meta', (req, res) => {
  const { domain } = req.params
  if (!domainExists(domain)) return res.status(404).json({ error: `领域不存在: ${domain}` })
  const { name, description } = req.body || {}
  const current = readMeta(domain) || {}
  const next = {
    ...current,
    ...(name !== undefined ? { name: String(name).trim() } : {}),
    ...(description !== undefined ? { description: String(description).trim() } : {}),
  }
  if (!String(next.name || '').trim()) return res.status(400).json({ error: '规范名称（name）不能为空' })
  writeMeta(domain, next)
  const meta = bumpVersion(domain)
  res.json({ ok: true, key: domain, version: meta.version, updatedAt: meta.updatedAt })
})

// POST /admin/specs/:domain/files —— 上传/覆盖规范文件（批量 JSON：{ files: [{path, content}], version? }）
// version 缺省自动 patch +1；显式指定须为合法 semver（"主.次.补丁"）
router.post('/specs/:domain/files', (req, res) => {
  const { domain } = req.params
  if (!domainExists(domain)) return res.status(404).json({ error: `领域不存在: ${domain}` })
  const { files, version } = req.body || {}
  if (!Array.isArray(files) || !files.length) {
    return res.status(400).json({ error: '请求体需要 { files: [{ path, content }] }，files 为非空数组' })
  }
  if (version !== undefined) {
    const vErr = validateVersion(version)
    if (vErr) return res.status(400).json({ error: vErr })
  }

  // 先整体校验（任一不合法则全部拒绝，不产生半写入）
  const seen = new Set()
  let batchBytes = 0
  for (const f of files) {
    if (!f || typeof f !== 'object') return res.status(400).json({ error: 'files 数组元素必须是 { path, content } 对象' })
    const err = validateRelPath(f.path)
    if (err) return res.status(400).json({ error: `路径不合法（${f.path ?? ''}）: ${err}` })
    if (typeof f.content !== 'string') return res.status(400).json({ error: `content 必须是字符串（${f.path}）` })
    if (seen.has(f.path)) return res.status(400).json({ error: `路径重复: ${f.path}` })
    seen.add(f.path)
    const bytes = Buffer.byteLength(f.content, 'utf-8')
    if (bytes > MAX_FILE_BYTES) return res.status(413).json({ error: `文件超出 2MB 限制: ${f.path}` })
    batchBytes += bytes
  }
  if (batchBytes > MAX_BATCH_BYTES) return res.status(413).json({ error: '单次批量上传超出 20MB 限制' })

  for (const f of files) writeSpecFile(domain, f.path, f.content)
  const meta = bumpVersion(domain, version)
  res.json({ ok: true, key: domain, count: files.length, version: meta.version, updatedAt: meta.updatedAt })
})

// DELETE /admin/specs/:domain/files —— 删除规范文件 { paths: ["a.md", ...] }
router.delete('/specs/:domain/files', (req, res) => {
  const { domain } = req.params
  if (!domainExists(domain)) return res.status(404).json({ error: `领域不存在: ${domain}` })
  const { paths } = req.body || {}
  if (!Array.isArray(paths) || !paths.length) {
    return res.status(400).json({ error: '请求体需要 { paths: [...] }，paths 为非空数组' })
  }
  for (const p of paths) {
    const err = validateRelPath(p)
    if (err) return res.status(400).json({ error: `路径不合法（${p}）: ${err}` })
  }
  const deleted = paths.filter(p => deleteSpecFile(domain, p))
  if (!deleted.length) return res.status(404).json({ error: `待删文件均不存在: ${paths.join(', ')}` })
  const meta = bumpVersion(domain)
  res.json({ ok: true, key: domain, deleted, version: meta.version, updatedAt: meta.updatedAt })
})

// DELETE /admin/specs/:domain —— 删除整个领域
router.delete('/specs/:domain', (req, res) => {
  const { domain } = req.params
  if (!domainExists(domain)) return res.status(404).json({ error: `领域不存在: ${domain}` })
  deleteDomain(domain)
  res.json({ ok: true, key: domain, deleted: true })
})

export default router
