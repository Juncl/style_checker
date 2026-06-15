//跨窗口通信工具类

export const Messenger = {

    // 发送消息给子页面(iframe)
    sendToChild(iframeEl, type, content) {
        if (!iframeEl || !iframeEl.contentWindow) {
            console.error('[Messenger] 未找到 iframe 元素或 contentWindow');
            return;

        }
        const message = { source: 'from-parent', type, content };
        // 向iframe 内部窗口发送消息
        iframeEl.contentWindow.postMessage(message, "*");
    },

    // 发送消息给父窗口
    sendToParent(type, data, targetOrigin = '*') {
        if (window.parent !== window) {
            window.parent.postMessage({ type, data }, targetOrigin);

        } else {
            console.warn("当前页面不在iframe中，无法发送给父窗口");
        }
    },

    // 监听来自特定窗口的消息
    listen(callback, expectedOrigin = null) {
        const handler = (event: MessageEvent) => {
            // 安全校验： 如果指定了来源，则进行比对
            if (expectedOrigin && event.origin !== expectedOrigin) return;

            // 触发回调，传递数据和原始事件
            if (event.data && event.data.type) {
                callback(event.data.type, event.data, event);
            }
        };
        window.addEventListener('message', handler);

        // 返回销毁函数，方便在 onUnmounted中调用
        return () => window.removeEventListener('message', handler);
    }


}