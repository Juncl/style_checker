import { config } from '../config.js'

/**
 * 打点上报
 *
 * 入参格式对齐 test/打点接口入参格式.js：
 *   外层公共字段（account/module/project/platform/device/os/...）
 *   datas[] 数组，每条事件含 name/subType/type/path/extend(JSON 字符串)
 *
 * 打点为 fire-and-forget：失败只 warn，不阻塞主流程、不影响检查结果。
 */

/**
 * 上报事件
 *
 * @param {Object} opts
 * @param {Object} opts.userInfo - 用户信息（取 account）
 * @param {string} opts.eventName - 事件名，如 "devlint_mcp_uiCheck"
 * @param {Object} opts.extend - 扩展数据，序列化为 JSON 字符串放入 datas[0].extend
 * @param {string} [opts.subType] - 子类型，默认 "AI"
 * @param {string} [opts.type] - 事件类型，默认 "interaction"
 */
export function reportInteraction({ userInfo, eventName, extend, subType = 'AI', type = 'interaction' }) {
  const url = config.TRACK_URL
  if (!url) return

  const payload = {
    account: (userInfo && userInfo.account) ? userInfo.account : '',
    browserName: 'unknown',
    browserVersion: 'unknown',
    datas: [
      {
        extend: JSON.stringify(extend || {}),
        name: eventName,
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

  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {})
  } catch (err) {
    console.warn('dc-report error: ', err.message)
  }
}

/**
 * 上报 UI 一致性检查完成事件
 *
 * @param {Object} data
 * @param {Object} data.userInfo - 用户信息（来自 collect_design）
 * @param {string} data.platform - 平台 hmPhone/hmWatch/web
 * @param {Object} data.stats - server 返回的统计信息
 * @param {number} data.diffCount - 差异项总数
 * @param {number} data.devImgSize - 开发侧图片大小（字节）
 * @param {number} data.designImgSize - 设计侧图片大小（字节）
 */
export function trackCheckComplete({ userInfo, platform, stats, diffCount, devImgSize, designImgSize }) {
  reportInteraction({
    userInfo,
    eventName: 'devlint_mcp_uiCheck',
    extend: {
      diffCount: diffCount ?? 0,
      devImgSize: devImgSize ?? null,
      designImgSize: designImgSize ?? null,
      platform: platform || 'hmPhone',
      isFrom: 'octo',
      score: stats?.score ?? null,
      errorCount: stats?.errorCount ?? 0,
      warningCount: stats?.warningCount ?? 0,
    },
  })
}
