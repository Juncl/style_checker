/**
 * iframe 环境检测
 * 检测当前页面是否运行在 iframe 内，结果挂载到 window.__inIframe 供全局读取
 * TODO: 补充 iframe 内的特殊处理逻辑（如通信、样式适配、权限限制等）
 */
export function detectIframe(): void {
  const inIframe = window.self !== window.top
  ;(window as any).__inIframe = inIframe

  if (inIframe) {
    // TODO: iframe 内的处理逻辑，例如：
    // - 向父页面发送 postMessage 握手
    // - 隐藏不适合内嵌的导航元素
    // - 应用内嵌专用的样式类
  }
}
