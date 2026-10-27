/**
 * 像素对比 server 调用封装
 *
 * 封装 POST /api/check/pixel-diff 调用:
 *   - 只传图场景(分支A): 仅带 designImage + devImage + platform
 *   - JSON + 图场景(分支B): 额外带 nodes JSON(pairs + designCanvas + arkuiCanvas),
 *     server 按节点匹配结果逐区域对比,像素差异天然绑定节点
 *
 * 依赖 config.CHECK_SERVER_URL(由 build.js 从 devlint-mcp/lib 拷贝)
 */
import { config } from '../config.js'
import { fileToBlob } from '../utils/tools.js'

/**
 * @param {Object} opts
 * @param {string} opts.designImagePath  - 设计稿截图路径
 * @param {string} opts.devImagePath     - 开发侧截图路径
 * @param {string} opts.platform         - hmPhone / hmWatch / web
 * @param {Array}  [opts.pairs]          - 节点匹配对(仅 JSON 场景,含 design.rect + arkui.rect)
 * @param {{w:number,h:number}} [opts.designCanvas] - 设计侧画布尺寸(与 design.rect 同单位)
 * @param {{w:number,h:number}} [opts.arkuiCanvas]  - 开发侧画布尺寸(与 arkui.rect 同单位)
 * @returns {Promise<Object>} server 响应 { platform, diffBlocks, totalBlocks, canvas }
 */
export async function callPixelDiffServer({
  designImagePath,
  devImagePath,
  platform,
  pairs,
  designCanvas,
  arkuiCanvas,
}) {
  const form = new FormData()
  form.append('platform', platform)
  form.append('designImage', fileToBlob(designImagePath, 'image/png'), 'design.png')
  form.append('devImage', fileToBlob(devImagePath, 'image/png'), 'arkui.png')

  // JSON 场景附带节点匹配结果 + 两侧画布尺寸
  if (Array.isArray(pairs) && pairs.length > 0) {
    const nodesJson = JSON.stringify({ pairs, designCanvas, arkuiCanvas })
    form.append('nodes', new Blob([nodesJson], { type: 'application/json' }), 'nodes.json')
  }

  const res = await fetch(`${config.CHECK_SERVER_URL}/check/pixel-diff`, {
    method: 'POST',
    body: form,
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`像素对比请求失败 (${res.status}): ${errText}`)
  }

  return res.json()
}
