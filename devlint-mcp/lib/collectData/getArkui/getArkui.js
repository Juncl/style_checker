/**
 * ArkUI 开发侧数据采集（鸿蒙）
 *
 * 模拟用户双击 .exe 采集程序的过程：
 *   启动 exe → 轮询等待 .exe 目录出现新的 json + 图片文件 → 移动到 .devlint 目录
 *
 * 限制：arkui 采集只能在 Windows 电脑上执行（依赖 ArkUI Inspector 导出工具）。
 * 真实 .exe 文件部署时替换 devlint-mcp/.exe/aaa.exe 即可，本模块按扩展名扫描，
 * 不写死文件名。
 */

import { spawn } from 'child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  cpSync,
  rmSync,
} from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, extname } from 'path'
import { platform } from 'os'
import { config } from '../../config.js'
import { timestamp } from '../../utils/tools.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// .exe 目录：devlint-mcp/.exe（相对当前文件向上 3 级到包根）
const EXE_DIR = join(__dirname, '../../../.exe')

// 默认采集超时时间（ms）
const DEFAULT_TIMEOUT = 60000
// 轮询间隔（ms）
const POLL_INTERVAL = 1000
// 文件大小连续稳定的次数阈值（判定写入完成，避免读到半成品）
const STABLE_THRESHOLD = 2

const JSON_EXT = '.json'
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg']

// 采集程序固定文件名
const EXE_NAME = 'export_arkui.exe'
const EXE_PATH = join(EXE_DIR, EXE_NAME)

/**
 * 校验采集程序是否存在
 * @returns {string} exe 文件绝对路径
 */
function findExe() {
  if (!existsSync(EXE_PATH)) {
    throw new Error(
      `未找到采集程序 ${EXE_PATH}，请确认 devlint-mcp/.exe/ 目录下存在 ${EXE_NAME}`
    )
  }
  return EXE_PATH
}

/**
 * 快照 .exe 目录中现有的 json/图片文件名（用于后续判断哪些是新增）
 * @returns {Set<string>}
 */
function snapshotExisting() {
  if (!existsSync(EXE_DIR)) return new Set()
  return new Set(
    readdirSync(EXE_DIR).filter(f => {
      const ext = extname(f).toLowerCase()
      return ext === JSON_EXT || IMAGE_EXTS.includes(ext)
    })
  )
}

/**
 * 判断单个文件是否已稳定写入完成
 * 连续 STABLE_THRESHOLD 次轮询大小不变且 > 0，视为写完。
 */
function isFileStable(file, lastSize, stableCount) {
  try {
    const size = statSync(join(EXE_DIR, file)).size
    if (size > 0 && lastSize.get(file) === size) {
      stableCount.set(file, (stableCount.get(file) || 0) + 1)
    } else {
      lastSize.set(file, size)
      stableCount.set(file, 0)
    }
    return stableCount.get(file) >= STABLE_THRESHOLD
  } catch {
    return false
  }
}

/**
 * 轮询等待 .exe 目录中出现新的 json + 图片文件并写入完成
 *
 * @param {Set<string>} existing - 启动前已存在的文件名集合
 * @param {number} timeout - 超时 ms
 * @returns {Promise<{ jsonFile: string, imageFile: string|null }>}
 */
function waitForOutput(existing, timeout) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout
    const lastSize = new Map()
    const stableCount = new Map()

    const tick = () => {
      if (Date.now() > deadline) {
        clearInterval(timer)
        reject(
          new Error(
            `等待采集文件超时（${timeout / 1000}秒），请确认采集程序是否正常运行并已导出数据`
          )
        )
        return
      }

      const current = readdirSync(EXE_DIR)
      const newJson = current.filter(
        f => extname(f).toLowerCase() === JSON_EXT && !existing.has(f)
      )
      const newImg = current.filter(
        f => IMAGE_EXTS.includes(extname(f).toLowerCase()) && !existing.has(f)
      )

      // json 是必须项；图片可选（部分场景可能不产出截图）
      const jsonReady = newJson.find(f =>
        isFileStable(f, lastSize, stableCount)
      )
      if (jsonReady) {
        const imgReady = newImg.find(f =>
          isFileStable(f, lastSize, stableCount)
        )
        clearInterval(timer)
        resolve({ jsonFile: jsonReady, imageFile: imgReady || null })
      }
    }

    const timer = setInterval(tick, POLL_INTERVAL)
    // 立即先跑一次，减少首次等待
    tick()
  })
}

/**
 * 跨设备安全的文件移动（rename 失败时降级为 copy + delete，应对跨盘符场景）
 */
function moveFile(src, dst) {
  try {
    renameSync(src, dst)
  } catch {
    cpSync(src, dst)
    rmSync(src, { force: true })
  }
}

/**
 * 采集 ArkUI 开发侧数据
 *
 * 模拟用户双击 exe 的完整过程：
 *   1. 校验 Windows 平台（arkui 采集仅限 Windows）
 *   2. 定位 .exe 目录下的采集程序
 *   3. 快照目录现有文件（区分新旧，避免误移历史文件）
 *   4. spawn 启动 exe（detached 独立进程，不阻塞 Node，模拟双击）
 *   5. 轮询等待新的 json + 图片文件出现且写入完成
 *   6. 将随机名文件重命名为规范名（arkui_<timestamp>.<ext>）后移动到配置目录（config.DIR_NAME）
 *
 * @param {Object} [options]
 * @param {number} [options.timeout=60000] 采集超时时间 ms
 * @returns {Promise<{ devJsonPath: string, devImagePath: string|null }>}
 *   文件路径，供 ui_style_check 的 devJsonPath / devImagePath 衔接
 */
export async function collectArkui(options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT

  // 1. 平台校验
  if (platform() !== 'win32') {
    throw new Error(
      'ArkUI 采集只能在 Windows 电脑上执行（依赖 ArkUI Inspector 导出工具）。' +
        '请在 Windows 环境运行，或手动提供 arkui.json / arkui.png 文件路径直接调用 ui_style_check。'
    )
  }

  // 2. 定位 exe
  const exePath = findExe()

  // 3. 快照现有文件
  const existing = snapshotExisting()

  // 4. 启动 exe（detached，模拟双击，Node 进程不等待 exe 退出）
  const child = spawn(exePath, [], {
    cwd: EXE_DIR,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref()

  // exe 启动失败（文件损坏/无权限等）时通过 error 事件抛出，与文件轮询竞争
  const exeError = new Promise((_, reject) => {
    child.on('error', err =>
      reject(new Error(`采集程序启动失败: ${err.message}`))
    )
  })

  // 5. 等待输出（exe 启动失败会抢先 reject）
  const output = await Promise.race([
    waitForOutput(existing, timeout),
    exeError,
  ])

  // 6. 移动到 .devlint
  const dir = join(process.cwd(), config.DIR_NAME)
  mkdirSync(dir, { recursive: true })

  const ts = timestamp()
  const devJsonPath = join(dir, `arkui_${ts}.json`)
  const devImagePath = output.imageFile
    ? join(dir, `arkui_${ts}${extname(output.imageFile)}`)
    : null

  moveFile(join(EXE_DIR, output.jsonFile), devJsonPath)
  if (devImagePath) {
    moveFile(join(EXE_DIR, output.imageFile), devImagePath)
  }

  return { devJsonPath, devImagePath }
}
