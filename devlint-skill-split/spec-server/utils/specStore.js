import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** 规范主库根目录：spec-server/specFiles/（按领域分子文件夹，入 git） */
export const SPECS_ROOT = join(__dirname, '..', 'specFiles')

/** 保留文件名：任何层级均不作为规范文件分发（README.md = 领域说明；index.json = 领域元数据） */
const RESERVED_FILES = new Set(['README.md', 'index.json'])

/** 单文件 / 单次批量上传大小上限 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_BATCH_BYTES = 20 * 1024 * 1024

// ── 校验 ────────────────────────────────────────────────

/** 领域 key 校验：字母/数字开头，仅允许 字母 数字 . _ -，长度 ≤ 60；拒路径穿越 */
export function validateDomainKey(key) {
  if (typeof key !== 'string' || !key.trim()) return '领域 key 不能为空'
  if (key.length > 60) return '领域 key 过长（≤60）'
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key)) return '领域 key 仅允许字母、数字、点、下划线、连字符，且以字母/数字开头'
  return null
}

/** 规范文件相对路径校验：字母/数字开头，可含 . _ - /；拒绝对路径、反斜杠、.. 段、保留文件名 */
export function validateRelPath(p) {
  if (typeof p !== 'string' || !p.trim()) return '路径不能为空'
  if (p.length > 200) return '路径过长（≤200）'
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(p)) return '路径仅允许字母、数字、点、下划线、连字符、正斜杠，且以字母/数字开头'
  if (p.startsWith('/') || p.endsWith('/') || p.includes('//')) return '路径格式不合法（不允许首尾或连续斜杠）'
  const segs = p.split('/')
  if (segs.some(s => s === '.' || s === '..')) return '路径不允许 . 或 .. 段'
  if (segs.some(s => RESERVED_FILES.has(s))) return `保留文件名不可作为规范文件：${[...RESERVED_FILES].join(' / ')}`
  return null
}

// ── 元数据（index.json） ────────────────────────────────

function metaPath(key) { return join(SPECS_ROOT, key, 'index.json') }

export function domainExists(key) {
  return existsSync(join(SPECS_ROOT, key))
}

/** 读领域 index.json（不存在返回 null） */
export function readMeta(key) {
  const p = metaPath(key)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

/** 人类可读时间戳 */
function readableTimestamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 校验 semver 字符串（"1.0.0" 格式），合法返回 null，非法返回错误信息 */
export function validateVersion(v) {
  if (typeof v !== 'string' || !/^\d+\.\d+\.\d+$/.test(v)) return 'version 必须是 "主.次.补丁" 格式的字符串（如 "1.0.0"）'
  return null
}

/** semver 自动递增：patch +1（非法/缺失版本号归位 "1.0.0"） */
function bumpSemver(v) {
  const m = String(v ?? '').match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return '1.0.0'
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`
}

/** 写入领域 index.json（缺 updatedAt 时补当前时间） */
export function writeMeta(key, meta) {
  const dir = join(SPECS_ROOT, key)
  mkdirSync(dir, { recursive: true })
  const full = { key, name: meta.name || key, description: meta.description || '', ...meta }
  if (!full.updatedAt) full.updatedAt = readableTimestamp()
  writeFileSync(metaPath(key), JSON.stringify(full, null, 2) + '\n', 'utf-8')
  return full
}

/**
 * 版本号提升：任一写操作成功后调用（skill 侧 --sync-spec 靠 version 字符串对比判断新鲜度）。
 * explicitVersion 显式指定（须为合法 semver）；缺省自动 patch +1。
 */
export function bumpVersion(key, explicitVersion) {
  const meta = readMeta(key) || { key }
  meta.version = explicitVersion || bumpSemver(meta.version)
  meta.updatedAt = readableTimestamp()
  writeMeta(key, meta)
  return meta
}

// ── 文件枚举与读取 ──────────────────────────────────────

/** 递归列出领域下全部规范文件（跳过 README.md / index.json / 隐藏文件；排序保证输出稳定） */
export function listSpecFiles(domainKey) {
  const domainDir = join(SPECS_ROOT, domainKey)
  const out = []
  const walk = dir => {
    for (const name of readdirSync(dir).sort()) {
      if (RESERVED_FILES.has(name) || name.startsWith('.')) continue
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(domainDir)
  return out
}

/** 规范文件统计信息 */
export function fileStat(content) {
  return {
    lines: content.split(/\r?\n/).length,
    bytes: Buffer.byteLength(content, 'utf-8'),
  }
}

/** 读单个规范文件内容（不存在返回 null） */
export function readSpecFile(domainKey, relPath) {
  const p = join(SPECS_ROOT, domainKey, relPath)
  if (!existsSync(p)) return null
  return readFileSync(p, 'utf-8')
}

/** 写规范文件（多级路径自动建目录） */
export function writeSpecFile(domainKey, relPath, content) {
  const p = join(SPECS_ROOT, domainKey, relPath)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, content, 'utf-8')
}

/** 删除规范文件（不存在返回 false） */
export function deleteSpecFile(domainKey, relPath) {
  const p = join(SPECS_ROOT, domainKey, relPath)
  if (!existsSync(p)) return false
  rmSync(p, { force: true })
  return true
}

/** 删除整个领域 */
export function deleteDomain(domainKey) {
  rmSync(join(SPECS_ROOT, domainKey), { recursive: true, force: true })
}

/** 全部领域清单（子目录即领域，meta 缺失时兜底） */
export function listDomains() {
  if (!existsSync(SPECS_ROOT)) return []
  const out = []
  for (const name of readdirSync(SPECS_ROOT).sort()) {
    const p = join(SPECS_ROOT, name)
    if (!statSync(p).isDirectory() || name.startsWith('.')) continue
    const meta = readMeta(name) || {}
    out.push({
      key: name,
      name: meta.name || name,
      description: meta.description || '',
      version: meta.version ?? 0,
      updatedAt: meta.updatedAt || '',
      fileCount: listSpecFiles(name).length,
    })
  }
  return out
}
