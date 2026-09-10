import { Router } from 'express'
import { join } from 'path'
import {
  SPECS_ROOT, MAX_FILE_BYTES,
  validateRelPath, domainExists, readMeta, listSpecFiles, fileStat, readSpecFile, listDomains,
} from '../utils/specStore.js'

const router = Router()

// ── 只读分发接口（skill 经 build-report.mjs --list-specs / --sync-spec 消费） ──

// GET /specs —— 领域清单（替代原 specFiles/index.md 的手工维护）
router.get('/', (req, res) => {
  res.json({ specs: listDomains() })
})

// GET /specs/:domain —— 单领域 meta + 文件清单（供分批精读规划）
router.get('/:domain', (req, res) => {
  const { domain } = req.params
  if (!domainExists(domain)) {
    return res.status(404).json({ error: `领域不存在: ${domain}` })
  }
  const meta = readMeta(domain) || {}
  const files = listSpecFiles(domain).map(p => {
    const path = p.slice(join(SPECS_ROOT, domain).length + 1)
    const content = readSpecFile(domain, path)
    return { path, ...fileStat(content) }
  })
  res.json({
    key: domain,
    name: meta.name || domain,
    description: meta.description || '',
    version: meta.version ?? 0,
    updatedAt: meta.updatedAt || '',
    files,
  })
})

// GET /specs/:domain/file?path=xxx —— 单文件原文（精读 / 修复回读）
router.get('/:domain/file', (req, res) => {
  const { domain } = req.params
  const path = String(req.query.path || '')
  if (!domainExists(domain)) {
    return res.status(404).json({ error: `领域不存在: ${domain}` })
  }
  const err = validateRelPath(path)
  if (err) return res.status(400).json({ error: `路径不合法: ${err}` })
  const content = readSpecFile(domain, path)
  if (content === null) {
    return res.status(404).json({ error: `规范文件不存在: ${domain}/${path}` })
  }
  if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_BYTES) {
    return res.status(413).json({ error: '文件超出大小限制' })
  }
  const meta = readMeta(domain) || {}
  res.json({ domain, path, version: meta.version ?? 0, content })
})

// GET /specs/:domain/archive —— 整包下载（模式 A 全量同步：files 平铺 + meta）
router.get('/:domain/archive', (req, res) => {
  const { domain } = req.params
  if (!domainExists(domain)) {
    return res.status(404).json({ error: `领域不存在: ${domain}` })
  }
  const meta = readMeta(domain) || {}
  const files = listSpecFiles(domain).map(p => {
    const path = p.slice(join(SPECS_ROOT, domain).length + 1)
    return { path, content: readSpecFile(domain, path) }
  })
  res.json({
    domain,
    version: meta.version ?? 0,
    meta: { name: meta.name || domain, description: meta.description || '', updatedAt: meta.updatedAt || '' },
    files,
  })
})

export default router
