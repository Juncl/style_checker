#!/usr/bin/env node
/**
 * build.js —— 打包脚本
 *
 * 将 devlint-mcp/lib 整体拷贝到 src/lib（排除 server.js），
 * 将 devlint-mcp/script 整体拷贝到 src/script（与 lib 同级，保持 getArkui.js 的 ../../../script 路径正确），
 * 组装 skill 自己的 bin/ + SKILL.md + install.js + README.md + package.json，
 * 打成可分发的 zip 包。
 *
 * 对 devlint-mcp 只读拷贝，不修改任何源码。
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } = fs
const { join } = path

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIR = join(ROOT, '..', 'devlint-mcp')
const DIST = join(ROOT, 'dist')

// ── 1. 校验源码完整性 ──────────────────────────────────

function checkSrc() {
  if (!existsSync(SRC_DIR)) {
    console.error(`✗ 未找到源码目录: ${SRC_DIR}`)
    process.exit(1)
  }
  if (!existsSync(join(SRC_DIR, 'lib'))) {
    console.error(`✗ 源码 lib/ 目录不存在`)
    process.exit(1)
  }
}

// ── 2. 拷贝源码目录（整体拷贝，只排除 node_modules）──────

function copyDirs(prodDir) {
  // ── mcp 共享引擎：devlint-mcp/lib → prodDir/src/lib（排除 server.js）──
  const srcLib = join(SRC_DIR, 'lib')
  const dstLib = join(prodDir, 'src', 'lib')
  rmSync(join(prodDir, 'src'), { recursive: true, force: true })
  mkdirSync(dstLib, { recursive: true })
  cpSync(srcLib, dstLib, {
    recursive: true,
    filter: (src) => !src.includes('node_modules') && !src.endsWith('server.js'),
  })

  // ── mcp 共享脚本：devlint-mcp/script → prodDir/src/script ──
  const srcScript = join(SRC_DIR, 'script')
  const dstScript = join(prodDir, 'src', 'script')
  if (existsSync(srcScript)) {
    rmSync(dstScript, { recursive: true, force: true })
    mkdirSync(dstScript, { recursive: true })
    cpSync(srcScript, dstScript, {
      recursive: true,
      filter: (src) => !src.includes('node_modules'),
    })
  }

  // ── skill 独有模块：devlint-skill/lib → prodDir/lib（不依赖 mcp）──
  const skillLibSrc = join(ROOT, 'lib')
  const skillLibDst = join(prodDir, 'lib')
  if (!existsSync(skillLibSrc)) {
    console.error(`✗ 缺少 skill 独有模块目录: ${skillLibSrc}`)
    process.exit(1)
  }
  rmSync(skillLibDst, { recursive: true, force: true })
  mkdirSync(skillLibDst, { recursive: true })
  cpSync(skillLibSrc, skillLibDst, {
    recursive: true,
    filter: (src) => !src.includes('node_modules'),
  })

  // 统计拷贝的文件数（src + lib）
  const copied = []
  function walk(dir, base) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const rel = base ? `${base}/${name}` : name
      if (statSync(full).isDirectory()) {
        walk(full, rel)
      } else {
        copied.push(rel)
      }
    }
  }
  walk(join(prodDir, 'src'))
  walk(join(prodDir, 'lib'))
  return copied
}

// ── 3. 生成产物 package.json ────────────────────────────

function writeProdPkg(prodDir, version) {
  const srcPkg = JSON.parse(readFileSync(join(SRC_DIR, 'package.json'), 'utf-8'))
  const pkg = {
    name: 'devlint-skill',
    version,
    type: 'module',
    description: 'DevLint Skill — UI 一致性检查与设计规范检查的命令行工具',
    bin: {
      'devlint-skill': 'bin/devlint-skill.js',
    },
    scripts: {
      setup: 'node install.js',
    },
    dependencies: srcPkg.dependencies || {},
  }
  writeFileSync(join(prodDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
}

// ── 4. 打 zip（跨平台）──────────────────────────────────

function makeZip(prodName) {
  if (os.platform() === 'win32') {
    // Windows 使用 PowerShell 的 Compress-Archive
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${prodName}' -DestinationPath '${prodName}.zip' -Force"`, {
      cwd: DIST,
      stdio: 'inherit',
    })
  } else {
    execSync(`zip -r -q "${prodName}.zip" "${prodName}"`, {
      cwd: DIST,
      stdio: 'inherit',
    })
  }
}

// ── 主流程 ──────────────────────────────────────────────

function main() {
  console.log('════════════════════════════════════════')
  console.log('  DevLint Skill 打包工具')
  console.log('════════════════════════════════════════\n')

  checkSrc()
  const srcPkg = JSON.parse(readFileSync(join(SRC_DIR, 'package.json'), 'utf-8'))
  const version = srcPkg.version
  const prodName = `devlint-skill-${version}`
  const prodDir = join(DIST, prodName)

  console.log(`[1/5] 版本: ${version}`)
  console.log(`      产物目录: ${prodDir}`)

  // 清空 & 创建
  rmSync(DIST, { recursive: true, force: true })
  mkdirSync(prodDir, { recursive: true })

  // 拷贝源码目录
  console.log('\n[2/5] 拷贝引擎源码目录...')
  const files = copyDirs(prodDir)
  console.log(`      → ${files.length} 个文件`)

  // 拷贝 skill 专属文件
  console.log('\n[3/5] 拷贝 skill 专属文件...')
  for (const f of ['bin/devlint-skill.js', 'SKILL.md', 'install.js']) {
    if (!existsSync(join(ROOT, f))) {
      console.error(`✗ 缺少 skill 文件: ${f}`)
      process.exit(1)
    }
    const dst = join(prodDir, f)
    mkdirSync(path.dirname(dst), { recursive: true })
    copyFileSync(join(ROOT, f), dst)
    console.log(`      → ${f}`)
  }

  // 产物 package.json
  console.log('\n[4/5] 生成产物 package.json...')
  writeProdPkg(prodDir, version)
  console.log('      → package.json')

  // 打 zip
  console.log('\n[5/5] 打包 zip...')
  makeZip(prodName)
  const zipPath = join(DIST, `${prodName}.zip`)
  console.log(`      → ${zipPath}`)

  // 统计
  const zipSize = (statSync(zipPath).size / 1024 / 1024).toFixed(2)
  console.log('\n────────────────────────────────────────')
  console.log('  打包完成!')
  console.log(`  产物:   ${zipPath}`)
  console.log(`  大小:   ${zipSize} MB`)
  console.log(`  版本:   ${version}`)
  console.log(`  文件数: ${files.length + 4} (源码 ${files.length}：mcp 共享 src/lib + skill 独有 lib；skill 专属 4)`)
  console.log('────────────────────────────────────────')
  console.log('\n  用户安装方式:')
  console.log('    1. 解压 devlint-skill-<ver>.zip')
  console.log('    2. node install.js')
  console.log('    3. 重启 opencode\n')
}

main()
