/**
 * 设计规范检查方法（内外网共用，由 config.SPEC_URL 切换地址）
 *
 * 【职责】
 * 接收 DOM 树 JSON + 规则文件路径列表，
 * POST 到合规检查接口，产出报告 JSON。
 *
 * 【内外网隔离】
 * - 外网环境（当前）：config.SPEC_URL → localhost:3001/mock/spec，走 mock 占位接口
 * - 内网环境：config.SPEC_URL → 7.192.170.117:3100，走真实合规检查服务
 * - 接口地址切换由 config.js 的 SPEC_URL 控制，本文件无需修改
 *
 * @param {Object} domData - DOM 树 JSON（含节点结构 + 计算样式）
 * @param {string[]} specFilePaths - 规则文件路径数组（来自 list_design_specs 的 filePaths）
 * @returns {Promise<Object>} 报告 JSON（结构由接口实现定义）
 */
import { config } from '../../config.js'

export async function specCheck(domData, specFilePaths) {
  const res = await checkDesignTool({ domData, filePathList: specFilePaths });
  return res;
}

async function checkDesignTool({ domData, filePathList = [], options = {} }) {
  try {
    const BASE_HOST = `${config.SPEC_URL}/api/check-compliance`;
    const res = await fetch(BASE_HOST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domData, filePathList, options })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`合规检查接口调用失败: HTTP ${res.status} - ${text}`);
    }
    return await res.json();
  } catch (error) {
    console.error('error:', error);
  }
}
