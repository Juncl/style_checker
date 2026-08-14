#!/usr/bin/env node
/**
 * install.js —— 用户安装脚本
 *
 * 三步：
 *   1. npm install --omit=dev   安装引擎依赖
 *   2. npm link                 注册 devlint-skill 命令到全局 PATH
 *   3. 拷贝 SKILL.md             放到 opencode skills 目录
 *
 * 不碰 opencode.json，不启动进程，不注册任何 server。
 *
 * 用法：解压 zip 后在产物根目录运行 node install.js
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const PKG_ROOT = path.dirname(fileURLToPath(import.meta.url))
const HOME = os.homedir()
const OPENCODE_DIR = path.join(HOME, '.config', 'opencode')
const SKILL_DIR = path.join(OPENCODE_DIR, 'skills', 'devlint-skill')

function step(n, total, msg) {
  console.log(`\n[${n}/${total}] ${msg}`)
}

async function main() {
  console.log('════════════════════════════════════════')
  console.log('  DevLint Skill 安装程序')
  console.log('════════════════════════════════════════')

  // 校验产物完整性
  if (!fs.existsSync(path.join(PKG_ROOT, 'bin', 'devlint-skill.js'))) {
    console.error('\n✗ 未找到 bin/devlint-skill.js，请确认在解压后的 devlint-skill-<ver>/ 根目录下运行此脚本')
    process.exit(1)
  }
  if (!fs.existsSync(path.join(PKG_ROOT, 'src', 'lib'))) {
    console.error('\n✗ 未找到 src/lib/ 目录，产物可能已损坏')
    process.exit(1)
  }

  // 1. 安装依赖
  step(1, 3, '安装依赖（可能需要数秒）...')
  try {
    execSync('npm install --omit=dev', {
      cwd: PKG_ROOT,
      stdio: 'inherit',
    })
    console.log('  → 依赖安装完成')
  } catch {
    console.error('  ✗ 依赖安装失败')
    console.error(`  请手动在 ${PKG_ROOT} 运行 npm install`)
    process.exit(1)
  }

  // 2. 注册命令到 PATH
  step(2, 3, '注册 devlint-skill 命令到 PATH...')
  try {
    execSync('npm link', {
      cwd: PKG_ROOT,
      stdio: 'inherit',
    })
    // 验证命令可用
    try {
      execSync('devlint-skill --help', { stdio: 'pipe' })
      console.log('  → devlint-skill 命令已注册')
    } catch {
      console.log('  → npm link 完成（如命令不可用，请确认 npm 全局 bin 目录在 PATH 中）')
    }
  } catch {
    console.error('  ✗ npm link 失败')
    console.error('  请手动运行 npm link，或确认 Node.js/npm 已正确安装')
    process.exit(1)
  }

  // 3. 安装 SKILL.md
  step(3, 3, '安装 skill 指令文档...')
  const skillSrc = path.join(PKG_ROOT, 'SKILL.md')
  if (!fs.existsSync(skillSrc)) {
    console.error('  ✗ SKILL.md 不存在，产物可能已损坏')
    process.exit(1)
  }
  fs.mkdirSync(SKILL_DIR, { recursive: true })
  fs.copyFileSync(skillSrc, path.join(SKILL_DIR, 'SKILL.md'))
  console.log(`  → ${path.join(SKILL_DIR, 'SKILL.md')}`)

  // 完成
  console.log('\n────────────────────────────────────────')
  console.log('  安装摘要:')
  console.log(`    安装目录:  ${PKG_ROOT}`)
  console.log(`    命令:      devlint-skill`)
  console.log(`    Skill:     ${SKILL_DIR}`)
  console.log('────────────────────────────────────────')
  console.log('\n  ⚠  请重启 opencode 使 skill 生效。')
  console.log('  验证安装: devlint-skill --help\n')
}

main().catch(err => {
  console.error('\n✗ 安装失败:', err.message)
  process.exit(1)
})
