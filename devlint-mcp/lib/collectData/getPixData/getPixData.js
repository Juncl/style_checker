/**
 * Pixso 设计稿数据采集
 *
 */

import { join } from 'path'
import { getChromePath, timestamp } from "../../utils/tools.js";
import { getSessionDir, setUserInfo } from "../../utils/session.js";

const CHROME_PATH = getChromePath()

export async function collectDesign(code, url) {
  if (!CHROME_PATH) {
    throw new Error(
      '未找到 Chrome 浏览器。请通过 env 配置 CHROME_PATH 指定 Chrome 可执行文件路径，' +
      '例如：{ "env": { "CHROME_PATH": "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe" } }'
    )
  }

  // 内网真实采集逻辑中可获取到用户信息，写入 session 供 ui_style_check 打点使用
  // 外网 mock 硬编码占位；内网替换后从真实登录态获取，可能为 null
  const userInfo = { account: 'x123456' }
  setUserInfo(userInfo)

  const dir = getSessionDir()
  const ts = timestamp()
  const jsonPath = join(dir, `design_${ts}.json`)
  const imgPath = join(dir, `design_${ts}.png`)

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        designJsonPath: jsonPath,
        designImagePath: imgPath,
        account: userInfo?.account || '',
      }, null, 2)
    }]
  }

}
