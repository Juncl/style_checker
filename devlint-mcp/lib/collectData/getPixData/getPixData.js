/**
 * Pixso 设计稿数据采集
 *
 */

import { join } from 'path'
import { getChromePath, timestamp } from "../../utils/tools.js";
import { getSessionDir } from "../../utils/session.js";

const CHROME_PATH = getChromePath()

export async function collectDesign(code, url, filePath) {
  if (!CHROME_PATH) {
    throw new Error(
      '未找到 Chrome 浏览器。请通过 env 配置 CHROME_PATH 指定 Chrome 可执行文件路径，' +
      '例如：{ "env": { "CHROME_PATH": "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe" } }'
    )
  }

  const dir = getSessionDir()
  const ts = timestamp()
  const jsonPath = join(dir, `design_${ts}.json`);
  const imgPath = join(dir, `design_${ts}.png`);

  return {
    content: [{
      type: "text",
      text: JSON.stringify({ designJsonPath: jsonPath, designImagePath: imgPath }, null, 2)
    }]
  }

}
