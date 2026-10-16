#!/usr/bin/env node
/**
 * arkui-version-diff 独立打包脚本
 *
 * 运行：node arkui-version-diff/build.js
 * 产物：dist/arkui-version-diff-<ver>.zip（版本跟随本目录 package.json）
 *
 * 打包依赖说明：
 *   - bin/ + lib/          skill 自有代码（全新写，零 npm 依赖）
 *   - src/lib/             采集引擎 + 服务配置（devlint-mcp 同源快照，已静态提交在
 *                          本目录，与 ui-param-diff 行为一致；mcp 侧更新时需手动同步）
 *   - src/script/          采集程序 export_arkui.exe —— 唯一从 devlint-mcp 拉取的部分
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const { existsSync, readFileSync, rmSync, mkdirSync, cpSync, statSync } = fs
const { join } = path

const SELF = path.dirname(fileURLToPath(import.meta.url))     // devlint-skill-split/arkui-version-diff/
const SPLIT_ROOT = join(SELF, '..')                             // devlint-skill-split/
const MCP_DIR = join(SPLIT_ROOT, '..', 'devlint-mcp')           // exe 单一源头
const DIST = join(SPLIT_ROOT, 'dist')

const SELF_PKG = JSON.parse(readFileSync(join(SELF, 'package.json'), 'utf-8'))

// ── skill 配置 ──────────────────────────────────────────

const SKILL = {
  name: 'arkui-version-diff',
  version: SELF_PKG.version,
}

// skill 自有文件/目录（含静态提交的同源引擎快照 src/lib，整目录拷贝）
const OWN_ENTRIES = ['bin', 'lib', 'src', 'SKILL.md', 'README.md', 'package.json']

// 采集程序目录（唯一从 devlint-mcp 拉取的部分）
const MCP_SCRIPT_DIR = 'script'

// ── 打 zip ──────────────────────────────────────────────

function makeZip(prodName) {
  if (os.platform() === 'win32') {
    execSync(`powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $src = Join-Path $PWD '${prodName}'; $dst = Join-Path $PWD '${prodName}.zip'; if (Test-Path $dst) { Remove-Item $dst -Force }; [System.IO.Compression.ZipFile]::CreateFromDirectory($src, $dst, [System.IO.Compression.CompressionLevel]::Optimal, $true)"`, {
      cwd: DIST, stdio: 'inherit',
    })
  } else {
    execSync(`zip -r -q "${prodName}.zip" "${prodName}"`, { cwd: DIST, stdio: 'inherit' })
  }
}

// ── 主流程 ──────────────────────────────────────────────

const prodName = `${SKILL.name}-${SKILL.version}`
const prodDir = join(DIST, prodName)

console.log('════════════════════════════════════════')
console.log(`  打包 ${SKILL.name} (v${SKILL.version})`)
console.log('════════════════════════════════════════')
console.log(`  产物目录: ${prodDir}`)

// 清空 & 创建产物目录
rmSync(prodDir, { recursive: true, force: true })
mkdirSync(prodDir, { recursive: true })

// 拷贝 skill 自有文件（bin / lib / src/lib 引擎快照等）
console.log('  拷贝 skill 文件...')
for (const entry of OWN_ENTRIES) {
  const src = join(SELF, entry)
  if (!existsSync(src)) {
    console.error(`✗ 缺少文件: ${SKILL.name}/${entry}`)
    process.exit(1)
  }
  cpSync(src, join(prodDir, entry), {
    recursive: true,
    filter: (s) => !s.includes('.DS_Store') && !s.includes('node_modules') && !s.includes('.devlint'),
  })
  console.log(`      ✓ ${entry}`)
}

// 拷贝采集程序（唯一从 devlint-mcp 拉取的部分）
// 目标必须是 src/script/：getArkui.js 的 EXE_DIR 按 __dirname/../../../script 定位
console.log('  拷贝采集程序（devlint-mcp → src/script）...')
{
  const src = join(MCP_DIR, MCP_SCRIPT_DIR)
  if (!existsSync(src)) {
    console.error(`✗ devlint-mcp 采集程序目录不存在: ${src}`)
    process.exit(1)
  }
  cpSync(src, join(prodDir, 'src', MCP_SCRIPT_DIR), {
    recursive: true,
    filter: (s) => !s.includes('.DS_Store'),
  })
  console.log(`      ✓ src/${MCP_SCRIPT_DIR}/（export_arkui.exe）`)
}

// 打 zip
makeZip(prodName)
const zipPath = join(DIST, `${prodName}.zip`)
const zipSize = (statSync(zipPath).size / 1024).toFixed(1)

console.log(`  ✓ ${prodName}.zip (${zipSize} KB)`)
console.log(`\n  产物: ${zipPath}`)
console.log('\n  用户安装方式:')
console.log('    1. 解压 arkui-version-diff-<ver>.zip')
console.log('    2. cd <解压目录> && npm link   （零依赖，无需 npm install）')
console.log('    3. 拷贝 SKILL.md 到 ~/.config/opencode/skills/arkui-version-diff/')
console.log('    4. 重启 opencode\n')
