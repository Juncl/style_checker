/**
 * 设计规范检查方法（内网实现，外网空逻辑占位）
 *
 * 【注意】此函数在浏览器上下文中执行（通过 page.evaluate 注入），
 * 函数体内可直接访问 document / window，
 * 但不能引用外部作用域的变量（不能 import、不能闭包）。
 * 返回值必须可序列化（基本类型、普通对象、数组）。
 *
 * 【内外网隔离】
 * - 外网环境（当前）：空逻辑占位，返回空结果
 * - 内网环境：替换本文件为真实检查实现，函数签名保持不变
 *
 * @param {string} specName - 规范名称（用户输入，如 "Octo"）
 * @returns {Object} 报告 JSON（可序列化）
 */
export function specCheck(specName) {
  // 此处可直接访问 document
  // 例：const elements = document.querySelectorAll('body *')
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
