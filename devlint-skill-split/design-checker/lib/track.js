import os from 'os'
import { config } from './config.js'

/**
 * 打点上报（独立于 devlint-mcp 引擎，本 skill 自带一份）
 *
 * 入参格式对齐 test/打点接口入参格式：
 *   外层公共字段（account/module/project/platform/device/os/...）
 *   datas[] 数组，每条事件含 name/subType/type/path/extend(JSON 字符串)
 *
 * 打点为 fire-and-forget：失败只 warn，不阻塞主流程、不影响检查结果。
 */

/**
 * 采集本机 IPv4 地址（跨平台兼容 macOS / Windows / Linux）
 *
 * @returns {string} 本机 IP，取不到时返回 'unknown'
 */
function getLocalIp() {
  try {
    const interfaces = os.networkInterfaces()

    const VIRTUAL_RE = /virtual|vmware|virtualbox|host-only|hyper-?v|vethernet|docker|wsl|veth|br-|virbr|bridge|tun|tap|utun|awdl|llw|ppp/i

    const PHYSICAL_RE = /^(en\d|eth\d|enp|ens|wlan|wlp|以太网|ethernet|wi-?fi|wlan|local area connection)/i

    let firstNonInternal = null
    let physicalMatch = null

    for (const name of Object.keys(interfaces)) {
      if (VIRTUAL_RE.test(name)) continue
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          if (!firstNonInternal) firstNonInternal = iface.address
          if (!physicalMatch && PHYSICAL_RE.test(name)) {
            physicalMatch = iface.address
          }
        }
      }
    }

    return physicalMatch || firstNonInternal || 'unknown'
  } catch {}
  return 'unknown'
}

/**
 * 解析 account：优先用传入值，为空（''/null/undefined）时兜底本机 IP
 * @param {string} account
 * @returns {string}
 */
function resolveAccount(account) {
  const val = typeof account === 'string' ? account.trim() : ''
  return val || getLocalIp()
}

/**
 * 上报事件
 *
 * account 优先级：传入值 → 本机 IP → 'unknown'
 * 整体 try-catch 包裹，任何异常都不阻塞主流程、不影响检查结果。
 *
 * @param {Object} opts
 * @param {string} opts.account - 用户账号（为空时自动用本机 IP 兜底）
 * @param {string} opts.name - 事件名，如 "devlint_skill_specCheck"
 * @param {Object} opts.extend - 扩展数据，序列化为 JSON 字符串放入 datas[0].extend
 * @param {string} [opts.subType] - 子类型，默认 "click"
 * @param {string} [opts.type] - 事件类型，默认 "interaction"
 */
export function reportInteraction({ account, name, extend, subType = 'click', type = 'interaction' }) {
  try {
    const url = config.TRACK_URL
    if (!url) return

    const payload = {
      account: resolveAccount(account),
      browserName: 'unknown',
      browserVersion: 'unknown',
      datas: [
        {
          extend: JSON.stringify(extend || {}),
          name,
          path: 'unknown',
          subType,
          type,
        },
      ],
      device: 'unknown',
      module: 'octo',
      os: 'unknown',
      platform: 1,
      project: 'designCloud',
      uid: 'unknown',
      userAgent: 'unknown',
    }

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {})
  } catch (err) {
    console.warn('dc-report error: ', err.message)
  }
}
