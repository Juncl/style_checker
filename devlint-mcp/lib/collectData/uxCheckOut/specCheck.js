/**
 * 设计规范检查方法（内网实现，外网空逻辑占位）
 *
 * 【职责】
 * 接收 DOM 树 JSON + 规则文件路径列表，
 * 基于内网规则库进行检查，产出报告 JSON。
 *
 * 【内外网隔离】
 * - 外网环境（当前）：空逻辑占位，返回空结果
 * - 内网环境：替换本文件为真实检查实现，入参出参结构保持不变
 *
 * @param {Object} domData - DOM 树 JSON（含节点结构 + 计算样式）
 * @param {string[]} specFilePaths - 规则文件路径数组（来自 list_design_specs 的 filePaths）
 * @returns {Promise<Object>} 报告 JSON（结构由内网实现定义）
 */
export async function specCheck(domData, specFilePaths) {
  // TODO: 内网替换为真实检查实现
  return {
    specFilePaths,
    issues: [],
    stats: {
      total: 0,
      errorCount: 0,
      warningCount: 0,
    },
  }
}
