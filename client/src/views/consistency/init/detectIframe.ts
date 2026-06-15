/**
 * iframe 环境检测
 * 内网实现：检测页面是否运行在 iframe 内，结果写入 window.__inIframe
 * 用于：iframe 内嵌时的通信、样式适配、权限限制等特殊处理
 */

import { Messenger } from '../../utils/message'

// 收到父页面合法 checkList 消息后派发的应用内事件名，ConsistencyView 监听它来更新状态
export const UXLINT_CHECKLIST_EVENT = 'uxlint:checkList'

export function detectIframe(): (() => void) | null {
  // 检测是否在 iframe 中
  const inIframe = window.self !== window.top
  let stopListen: (() => void) | null = null

  if (inIframe) {
    // 发送加载完成消息给父页面
    Messenger.sendToParent('LOAD_SUCCESS', { id: 1, status: 'success' })

    // 监听父页面发来的消息
    stopListen = Messenger.listen(async (type, data) => {
      if (type === 'uxlint') {
        const content = data?.content
        if (
          content?.type === 'checkList' &&
          Array.isArray(content?.list) &&
          content.list.length > 0
        ) {
          // 只负责把 iframe 消息翻译成应用内事件，具体处理交给 ConsistencyView
          window.dispatchEvent(new CustomEvent(UXLINT_CHECKLIST_EVENT, { detail: content.list }))
        } else {
          console.warn('[detectIframe] uxlint 消息格式不合法：', data)
        }
      }
    })
  }

  return stopListen
}
