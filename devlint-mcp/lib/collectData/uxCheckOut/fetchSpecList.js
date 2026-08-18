/**
 * 规则库全量数据获取（内外网隔离）
 *
 * 【职责】
 * 通过 fetch 调用规则库接口，返回原始 JSON（结构同 test/spec_data.json）。
 * resolveSpec.js 基于此数据做模糊匹配。
 *
 * 【内外网隔离】
 * - 外网环境（当前）：config.SPEC_URL → localhost:3001/mock/spec
 * - 内网环境：config.SPEC_URL → 7.192.170.117:3100
 * - 接口地址切换由 config.js 的 SPEC_URL 控制，本文件拼 /index.json 后缀
 *
 * @returns {Promise<Object>} 规则库全量数据，结构：
 *   {
 *     categories: [{
 *       categoryName, categoryPath, groupId,
 *       standards: [{
 *         standardId, standardName, path,
 *         scenes: [{
 *           sceneId, sceneName, sceneCategory,
 *           libraries: [{ fileKey, fileName, filePath }]
 *         }]
 *       }]
 *     }]
 *   }
 */
import { config } from '../../config.js'

export async function fetchSpecList() {
  const res = await fetch(`${config.SPEC_URL}/index.json`)

  if (!res.ok) {
    throw new Error(`获取规范库数据失败 (${res.status}): ${await res.text()}`)
  }

  return res.json()
}
