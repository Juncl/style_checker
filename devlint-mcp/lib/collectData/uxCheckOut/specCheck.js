/**
 * 设计规范检查方法（内网实现，外网空逻辑占位）
 *
 * 【职责】
 * 接收 document.body.outerHTML + 规范名称，
 * 基于内网规则库进行检查，产出报告 JSON。
 *
 * 【内外网隔离】
 * - 外网环境（当前）：空逻辑占位，返回空结果
 * - 内网环境：替换本文件为真实检查实现，入参出参结构保持不变
 *
 * @param {string} bodyHtml - document.body.outerHTML
 * @param {string} specName - 规范名称（用户输入，如 "Octo"）
 * @returns {Promise<Object>} 报告 JSON（结构由内网实现定义）
 */
export async function specCheck(bodyHtml, specName) {
  // TODO: 内网替换为真实检查实现
  return {
    specName,
    issues: [],
    stats: {
      total: 0,
      errorCount: 0,
      warningCount: 0,
    },
  }
}
