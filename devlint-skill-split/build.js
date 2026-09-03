#!/usr/bin/env node
/**
 * build.js —— 顶层调度器
 *
 * 依次调用 4 个子 build，打出 4 个 zip。
 * 也可单独运行子 build：node ui-param-diff/build.js
 */

import { execSync } from 'child_process'
import { readdirSync, statSync, rmSync, mkdirSync, cpSync, readFileSync } from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const { join } = path
const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST = join(ROOT, 'dist')
const SKILLS = ['ui-param-diff', 'design-system-checker', 'ui-pixel-diff', 'design-checker']

// design-checker 为纯 md + 单脚本结构（无 bin/lib、无子 build.js），
// 版本号由 design-checker/package.json 提供（打包时排除该文件），
// skill 目录本身就是发布结构，直接整目录拷贝 + zip。

function makeZip(prodName) {
  if (os.platform() === 'win32') {
    execSync(`powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $src = Join-Path $PWD '${prodName}'; $dst = Join-Path $PWD '${prodName}.zip'; if (Test-Path $dst) { Remove-Item $dst -Force }; [System.IO.Compression.ZipFile]::CreateFromDirectory($src, $dst, [System.IO.Compression.CompressionLevel]::Optimal, $true)"`, {
      cwd: DIST, stdio: 'inherit',
    })
  } else {
    execSync(`zip -r -q "${prodName}.zip" "${prodName}"`, { cwd: DIST, stdio: 'inherit' })
  }
}

function buildDesignChecker() {
  const skillDir = join(ROOT, 'design-checker')
  const pkgFile = join(skillDir, 'package.json')
  const version = JSON.parse(readFileSync(pkgFile, 'utf-8')).version
  const prodName = `design-checker-${version}`
  const prodDir = join(DIST, prodName)

  console.log(`  打包 ${prodName}`)
  rmSync(prodDir, { recursive: true, force: true })
  mkdirSync(prodDir, { recursive: true })
  cpSync(skillDir, prodDir, {
    recursive: true,
    filter: (s) => !s.includes('.DS_Store') && s !== pkgFile,
  })
  makeZip(prodName)
}

console.log('════════════════════════════════════════')
console.log('  DevLint Skill Split 统一打包')
console.log('  一次打出 4 个 skill 包')
console.log('════════════════════════════════════════\n')

for (const name of SKILLS) {
  if (name === 'design-checker') {
    buildDesignChecker()
  } else {
    execSync(`node ${name}/build.js`, { stdio: 'inherit' })
  }
}

console.log('\n────────────────────────────────────────')
console.log('  全部打包完成!')
console.log('────────────────────────────────────────')
for (const f of readdirSync(DIST).filter(f => f.endsWith('.zip'))) {
  const size = (statSync(join(DIST, f)).size / 1024 / 1024).toFixed(2)
  console.log(`  ${f}  (${size} MB)`)
}
console.log(`\n  产物目录: ${DIST}`)
console.log('\n  用户安装方式:')
console.log('    1. 解压 <skill>-<ver>.zip')
console.log('    2. cd <解压目录> && npm install --omit=dev && npm link')
console.log('    3. 拷贝 SKILL.md 到 ~/.config/opencode/skills/<skill-name>/')
console.log('    4. 重启 opencode\n')
