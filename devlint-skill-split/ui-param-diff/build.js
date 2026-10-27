#!/usr/bin/env node
/**
 * ui-param-diff 独立打包脚本
 *
 * 运行：node ui-param-diff/build.js
 * 产物：dist/ui-param-diff-<ver>.zip（版本跟随 devlint-mcp）
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } = fs
const { join } = path

const SELF = path.dirname(fileURLToPath(import.meta.url))     // devlint-skill-split/ui-param-diff/
const SPLIT_ROOT = join(SELF, '..')                             // devlint-skill-split/
const MCP_DIR = join(SPLIT_ROOT, '..', 'devlint-mcp')
const DIST = join(SPLIT_ROOT, 'dist')

const MCP_PKG = JSON.parse(readFileSync(join(MCP_DIR, 'package.json'), 'utf-8'))
const SELF_PKG = JSON.parse(readFileSync(join(SELF, 'package.json'), 'utf-8'))

// ── skill 配置 ──────────────────────────────────────────

const SKILL = {
  name: 'ui-param-diff',
  version: SELF_PKG.version,
  binName: 'ui-param-diff',
  binFile: 'bin/ui-param-diff.js',
  description: 'UI Param Diff Skill — UI 一致性检查的命令行工具',
  trackPrefix: 'devlint_skill_',
}

// skill 专属依赖(mcp 没有,由 skill 自带;打包时注入 package.json)
const SKILL_DEPS = {
  exceljs: '^4.4.0',
  sharp:   '^0.35.3',  // 与 server 同版本
}

// ── 从 mcp/lib 拷贝的文件夹/文件清单 ────────────────────
// config.js 单文件 + 4 个功能文件夹（内网同文件夹内容可能不同，整体拷贝）
const MCP_DIRS = [
  'utils',
  'collectData/getArkui',
  'collectData/getWebDom',
  'collectData/getPixData',
]
const MCP_FILES = [
  'config.js',
]

function copyFile(srcDir, dstDir, relPath) {
  const src = join(srcDir, relPath)
  const dst = join(dstDir, relPath)
  if (!existsSync(src)) {
    console.error(`✗ mcp 源文件不存在: ${relPath}`)
    process.exit(1)
  }
  mkdirSync(path.dirname(dst), { recursive: true })
  copyFileSync(src, dst)
}

function copyDir(srcDir, dstDir, relPath) {
  const src = join(srcDir, relPath)
  const dst = join(dstDir, relPath)
  if (!existsSync(src)) {
    console.error(`✗ mcp 源目录不存在: ${relPath}`)
    process.exit(1)
  }
  rmSync(dst, { recursive: true, force: true })
  mkdirSync(dst, { recursive: true })
  cpSync(src, dst, {
    recursive: true,
    filter: (s) => !s.includes('node_modules') && !s.includes('.DS_Store'),
  })
}

// ── 拷贝引擎 ────────────────────────────────────────────

function copySrcLib(prodDir) {
  const srcLib = join(MCP_DIR, 'lib')
  const dstLib = join(prodDir, 'src', 'lib')
  rmSync(join(prodDir, 'src'), { recursive: true, force: true })
  mkdirSync(dstLib, { recursive: true })

  for (const f of MCP_FILES) {
    copyFile(srcLib, dstLib, f)
  }
  for (const d of MCP_DIRS) {
    copyDir(srcLib, dstLib, d)
  }

  // patch 打点前缀
  const trackFile = join(dstLib, 'utils', 'track.js')
  const trackSrc = readFileSync(trackFile, 'utf-8')
  const patched = trackSrc.replace(/devlint_mcp_/g, SKILL.trackPrefix)
  if (patched !== trackSrc) {
    writeFileSync(trackFile, patched)
    console.log(`      ✓ 打点前缀已替换: devlint_mcp_* → ${SKILL.trackPrefix}*`)
  }
}

/**
 * 拷贝 skill 自有 src/lib 覆盖到产物(图图对比/Excel/文案走查等 skill 专属模块)
 *
 * 与 mcp 共享目录(report/ 等)是叠加关系:skill 自有文件覆盖到同名路径,
 * mcp 拷过来的同名文件会被覆盖(mergeDiffs.js 等是 skill 独有的,不冲突)。
 * mcp 拷过来的 report.js 等保留不动(skill 不重写)。
 */
function copySkillOwnSrc(prodDir) {
  const skillSrcLib = join(SELF, 'src', 'lib')
  if (!existsSync(skillSrcLib)) return 0

  const dstLib = join(prodDir, 'src', 'lib')
  let count = 0

  function walk(srcDir, relPath) {
    for (const name of readdirSync(srcDir)) {
      const srcFull = join(srcDir, name)
      const rel = relPath ? `${relPath}/${name}` : name
      if (statSync(srcFull).isDirectory()) {
        walk(srcFull, rel)
      } else {
        const dstFull = join(dstLib, rel)
        mkdirSync(path.dirname(dstFull), { recursive: true })
        copyFileSync(srcFull, dstFull)
        count++
      }
    }
  }
  walk(skillSrcLib, '')
  return count
}

function copySrcScript(prodDir) {
  const srcScript = join(MCP_DIR, 'script')
  const dstScript = join(prodDir, 'src', 'script')
  if (existsSync(srcScript)) {
    rmSync(dstScript, { recursive: true, force: true })
    mkdirSync(dstScript, { recursive: true })
    cpSync(srcScript, dstScript, {
      recursive: true,
      filter: (src) => !src.includes('node_modules') && !src.includes('.DS_Store'),
    })
  }
}

// ── 统计文件数 ──────────────────────────────────────────

function countFiles(dir) {
  const files = []
  function walk(d, base) {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      const rel = base ? `${base}/${name}` : name
      if (statSync(full).isDirectory()) {
        walk(full, rel)
      } else {
        files.push(rel)
      }
    }
  }
  if (existsSync(dir)) walk(dir)
  return files.length
}

// ── 生成 package.json ───────────────────────────────────

function writeProdPkg(prodDir) {
  const pkg = {
    name: SKILL.name,
    version: SKILL.version,
    type: 'module',
    description: SKILL.description,
    bin: { [SKILL.binName]: SKILL.binFile },
    // 合并 mcp 依赖 + skill 专属依赖(exceljs/sharp)
    dependencies: { ...(MCP_PKG.dependencies || {}), ...SKILL_DEPS },
  }
  writeFileSync(join(prodDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
}

// ── 打 zip ──────────────────────────────────────────────

function makeZip(prodName) {
  if (os.platform() === 'win32') {
    execSync(`powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $src = Join-Path $PWD '${prodName}'; $dst = Join-Path $PWD '${prodName}.zip'; if (Test-Path $dst) { Remove-Item $dst -Force }; [System.IO.Compression.ZipFile]::CreateFromDirectory($src, $dst, [System.IO.Compression.CompressionLevel]::Optimal, $true)"`, {
      cwd: DIST, stdio: 'inherit',
    })
  } else {
    execSync(`zip -r -q "${prodName}.zip" "${prodName}"`, {
      cwd: DIST, stdio: 'inherit',
    })
  }
}

// 打 zip 前清理产物目录中的临时/系统文件(npm install 生成的 lock、macOS .DS_Store、运行时产物)
function cleanupBeforeZip(prodDir) {
  const junkNames = ['package-lock.json', '.DS_Store']
  const junkDirs = ['.octo-uxlint', '.devlint']
  for (const name of junkNames) {
    const p = join(prodDir, name)
    if (existsSync(p)) rmSync(p, { force: true })
  }
  // 递归删除 .DS_Store 和 .octo-uxlint/.devlint
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (name === '.DS_Store') { rmSync(full, { force: true }); continue }
      if (junkDirs.includes(name)) { rmSync(full, { recursive: true, force: true }); continue }
      if (statSync(full).isDirectory() && name !== 'node_modules') walk(full)
    }
  }
  walk(prodDir)
}

// ── 主流程 ──────────────────────────────────────────────

const prodName = `${SKILL.name}-${SKILL.version}`
const prodDir = join(DIST, prodName)

console.log('════════════════════════════════════════')
console.log(`  打包 ${SKILL.name} (v${SKILL.version})`)
console.log('════════════════════════════════════════')
console.log(`  产物目录: ${prodDir}`)

// 校验
if (!existsSync(join(MCP_DIR, 'lib'))) {
  console.error('✗ devlint-mcp/lib 目录不存在')
  process.exit(1)
}

// 清空 & 创建产物目录
rmSync(prodDir, { recursive: true, force: true })
mkdirSync(prodDir, { recursive: true })

// 拷贝引擎
console.log('  拷贝引擎...')
copySrcLib(prodDir)
copySrcScript(prodDir)

// 拷贝 skill 自有 src(图图对比/Excel/文案走查等专属模块,覆盖叠加到 mcp 引擎之上)
console.log('  拷贝 skill 专属模块...')
const ownCount = copySkillOwnSrc(prodDir)
if (ownCount > 0) console.log(`      ✓ skill 专属模块 ${ownCount} 文件已叠加`)

// 拷贝 skill 专属文件
console.log('  拷贝 skill 专属文件...')
for (const f of [SKILL.binFile, 'SKILL.md', 'README.md']) {
  const src = join(SELF, f)
  if (!existsSync(src)) {
    console.error(`✗ 缺少文件: ${SKILL.name}/${f}`)
    process.exit(1)
  }
  const dst = join(prodDir, f)
  mkdirSync(path.dirname(dst), { recursive: true })
  copyFileSync(src, dst)
}

// patch SKILL.md 占位变量（从 mcp/lib/config.js 提取 SKILL_GUIDE_URL）
{
  const guideUrl = (readFileSync(join(MCP_DIR, 'lib', 'config.js'), 'utf-8')
    .match(/SKILL_GUIDE_URL:\s*'([^']*)'/) || [])[1] || ''
  if (guideUrl) {
    const skillMdPath = join(prodDir, 'SKILL.md')
    const skillMdSrc = readFileSync(skillMdPath, 'utf-8')
    const patched = skillMdSrc.replace(/\{\{SKILL_GUIDE_URL\}\}/g, guideUrl)
    if (patched !== skillMdSrc) {
      writeFileSync(skillMdPath, patched)
      console.log(`      ✓ SKILL.md 指南链接已替换: {{SKILL_GUIDE_URL}} → ${guideUrl}`)
    }
  }
}

// 生成 package.json
writeProdPkg(prodDir)

// 清理临时/系统文件后打 zip
cleanupBeforeZip(prodDir)

// 打 zip
makeZip(prodName)
const zipPath = join(DIST, `${prodName}.zip`)
const zipSize = (statSync(zipPath).size / 1024 / 1024).toFixed(2)
const srcCount = countFiles(join(prodDir, 'src'))

console.log(`  ✓ ${prodName}.zip (${zipSize} MB, 引擎 ${srcCount} 文件)`)
console.log(`\n  产物: ${zipPath}`)
