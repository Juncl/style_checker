/**
 * design-checker 配置文件
 *
 * 【职责】
 * 集中管理规范库服务地址与本地目录常量，bin/lib 各模块统一从此处读取。
 *
 * 【内外网切换】（参考 devlint-mcp/lib/config.js 的多环境模式）
 * - 外网环境（当前）：SPEC_URL → http://localhost:3021（spec-server 本地部署）
 * - 内网环境：SPEC_URL → 内网 spec-server 地址（部署后填写）
 * - 优先级：环境变量 SPEC_SERVER_URL > 命令行 --spec-server > 此处 SPEC_ENV 默认值
 *
 * 【规范库工作目录】
 * skill 内 specFiles/ 是唯一规范工作目录（本地自带一份，检查启动时经 --sync-spec
 * 对照服务端 version 检查&更新；服务不可达时直接用本地自带规范）。
 */

import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SPEC_ENV = 'outer'
// const SPEC_ENV = 'inner_beta'
// const SPEC_ENV = 'inner_pro'

/** 规范库服务（spec-server）地址 */
const SPEC_URL = {
  outer: 'http://localhost:3021',
  inner_beta: '', // TODO: 内网 spec-server 部署后填写
  inner_pro: '',  // TODO: 内网 spec-server 部署后填写
}

export const config = {
  /** 规范库服务地址（环境变量 SPEC_SERVER_URL 可覆盖） */
  SPEC_URL: process.env.SPEC_SERVER_URL || SPEC_URL[SPEC_ENV],
  /** 规范库工作目录（skill 自带，唯一规范读取来源；--sync-spec 检查&更新的落盘处） */
  SPEC_ROOT: join(__dirname, '..', 'specFiles'),
  /** 检查/修复报告与 JSON 存档的固定根目录 */
  REPORT_ROOT: join(homedir(), '.octo-uxlint', 'design-check'),
  /** 固定根下报告自动清理天数（用户 --out-dir 指定目录中的报告不过期） */
  REPORT_MAX_AGE_DAYS: 7,
}
