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
const MCP_VERSION = MCP_PKG.version

// ── skill 配置 ──────────────────────────────────────────

const SKILL = {
  name: 'ui-param-diff',
  version: MCP_VERSION,
  binName: 'ui-param-diff',
  binFile: 'bin/ui-param-diff.js',
  description: 'UI Param Diff Skill — UI 一致性检查的命令行工具',
  trackPrefix: 'devlint_skill_',
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
    filter: (s) => !s.includes('node_modules'),
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

function copySrcScript(prodDir) {
  const srcScript = join(MCP_DIR, 'script')
  const dstScript = join(prodDir, 'src', 'script')
  if (existsSync(srcScript)) {
    rmSync(dstScript, { recursive: true, force: true })
    mkdirSync(dstScript, { recursive: true })
    cpSync(srcScript, dstScript, {
      recursive: true,
      filter: (src) => !src.includes('node_modules'),
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
    dependencies: MCP_PKG.dependencies || {},
  }
  writeFileSync(join(prodDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
}

// ── 打 zip ──────────────────────────────────────────────

function makeZip(prodName) {
  if (os.platform() === 'win32') {
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${prodName}' -DestinationPath '${prodName}.zip' -Force"`, {
      cwd: DIST, stdio: 'inherit',
    })
  } else {
    execSync(`zip -r -q "${prodName}.zip" "${prodName}"`, {
      cwd: DIST, stdio: 'inherit',
    })
  }
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

// 生成 package.json
writeProdPkg(prodDir)

// 打 zip
makeZip(prodName)
const zipPath = join(DIST, `${prodName}.zip`)
const zipSize = (statSync(zipPath).size / 1024 / 1024).toFixed(2)
const srcCount = countFiles(join(prodDir, 'src'))

console.log(`  ✓ ${prodName}.zip (${zipSize} MB, 引擎 ${srcCount} 文件)`)
console.log(`\n  产物: ${zipPath}`)
