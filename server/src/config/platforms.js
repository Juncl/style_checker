/**
 * 平台配置中心
 *
 * 三种设备类型 (platform key)：
 *   - hmPhone：鸿蒙手机，ArkUI Inspector 格式
 *   - hmWatch：鸿蒙手表，与 hmPhone 同格式，但 design.json 数值需 ÷2 才能与 ArkUI vp 对齐
 *   - web    ：Web 前端 DOM 树格式，独立解析器
 *
 * 集中管理：case 目录、开发侧文件名、design 缩放、开发侧解析器类型。
 */

import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../../..')

export const PLATFORMS = {
  hmPhone: {
    key: 'hmPhone',
    label: '鸿蒙-手机',
    casesDir:     resolve(PROJECT_ROOT, 'case/hmPhone'),
    validationDir: resolve(PROJECT_ROOT, 'matchTest/matchCase/hmPhone'),
    validationFallbackDir: null,
    devFile:  'arkui.json',
    devImg:   'arkui.png',
    devType:  'arkui',
    designScale: 1,
  },
  hmWatch: {
    key: 'hmWatch',
    label: '鸿蒙-手表',
    casesDir:     resolve(PROJECT_ROOT, 'case/hmWatch'),
    validationDir: resolve(PROJECT_ROOT, 'matchTest/matchCase/hmWatch'),
    validationFallbackDir: null,
    devFile:  'arkui.json',
    devImg:   'arkui.png',
    devType:  'arkui',
    designScale: 0.5,
  },
  web: {
    key: 'web',
    label: 'web网页',
    casesDir:     resolve(PROJECT_ROOT, 'case/web'),
    validationDir: resolve(PROJECT_ROOT, 'matchTest/matchCase/web'),
    validationFallbackDir: null,
    devFile:  'web.json',
    devImg:   'web.png',
    devType:  'web',
    designScale: 1,
  },
}

export const DEFAULT_PLATFORM = 'hmPhone'

// 中文 deviceType ↔ platform key
const ZH_TO_KEY = {
  '鸿蒙-手机': 'hmPhone',
  '鸿蒙-手表': 'hmWatch',
  'web网页':   'web',
}

/**
 * 解析平台 key：接受 platform key、中文 deviceType、undefined 三种输入。
 * 解析失败时回退到 DEFAULT_PLATFORM，并通过 console.warn 提示。
 */
export function resolvePlatform(input) {
  if (!input) return DEFAULT_PLATFORM
  if (PLATFORMS[input]) return input
  if (ZH_TO_KEY[input]) return ZH_TO_KEY[input]
  console.warn(`[platforms] 未识别的 platform/deviceType: ${input}, 回退到 ${DEFAULT_PLATFORM}`)
  return DEFAULT_PLATFORM
}

/** 取平台配置对象，未知 key 抛错 */
export function getPlatform(platform) {
  const key = resolvePlatform(platform)
  return PLATFORMS[key]
}
