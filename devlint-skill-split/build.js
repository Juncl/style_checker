#!/usr/bin/env node
/**
 * build.js —— 顶层调度器
 *
 * 依次调用 3 个子 build，打出 3 个 zip。
 * 也可单独运行子 build：node ui-param-diff/build.js
 */

import { execSync } from 'child_process'
import { readdirSync, statSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const { join } = path
const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST = join(ROOT, 'dist')
const SKILLS = ['ui-param-diff', 'design-system-checker', 'ui-pixel-diff']

console.log('════════════════════════════════════════')
console.log('  DevLint Skill Split 统一打包')
console.log('  一次打出 3 个 skill 包')
console.log('════════════════════════════════════════\n')

for (const name of SKILLS) {
  execSync(`node ${name}/build.js`, { stdio: 'inherit' })
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
