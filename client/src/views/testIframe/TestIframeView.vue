<template>
  <div class="test-iframe-container">
    <!-- 上边栏 48px -->
    <div class="top-bar">
      <div class="status-info">
        <span class="status-label">iframe 状态：</span>
        <span class="status-indicator" :class="{ loaded: iframeLoaded }"></span>
        <span class="status-text">{{ iframeLoaded ? '已加载' : '加载中...' }}</span>
      </div>
    </div>

    <!-- 左边栏 48px + 中间区域 -->
    <div class="content-wrapper">
      <!-- 左边栏 48px -->
      <div class="left-bar">
        <!-- 预留操作按钮区域 -->
      </div>

      <!-- 右下 iframe 区域 -->
      <div class="iframe-wrapper">
        <iframe
          ref="iframeEl"
          src="/#/consistency"
          title="consistency"
          @load="onIframeLoad"
        ></iframe>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Messenger } from '../utils/message'

const iframeEl = ref<HTMLIFrameElement | null>(null)
const iframeLoaded = ref(false)

const onIframeLoad = () => {
  iframeLoaded.value = true

  // iframe 加载完成后，发送 uxlint 消息给子页面
  if (iframeEl.value) {
    const message = {
      type: 'uxlint',
      source: 'from-parent',
      content: {
        list: [
          {
            arkFileUrl: 'https://fake-internal.com/mock/uxlint-test/case1/arkui.json',
            id: 152,
            imageUrl: 'https://fake-internal.com/mock/uxlint-test/case1/arkui.png',
            name: '20260615_12.00.09'
          },
          {
            arkFileUrl: 'https://fake-internal.com/mock/uxlint-test/case2/arkui.json',
            id: 98,
            imageUrl: 'https://fake-internal.com/mock/uxlint-test/case2/arkui.png',
            name: '20260615_12.00.10'
          }
        ],
        type: 'checkList'
      }
    }
    Messenger.sendToChild(iframeEl.value, message.type, message.content)
    console.log('[TestIframe] 发送 uxlint 消息给子页面：', message)
  }
}
</script>

<style scoped>
.test-iframe-container {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f5f5f5;
}

/* 上边栏 48px */
.top-bar {
  height: 48px;
  border-bottom: 1px solid #ddd;
  background-color: #fff;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 12px;
}

.status-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.status-label {
  color: #666;
  font-weight: 500;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #ccc;
  transition: background-color 0.3s ease;

  &.loaded {
    background-color: #52c41a;
  }
}

.status-text {
  color: #999;
}

/* 内容区域 */
.content-wrapper {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 左边栏 48px */
.left-bar {
  width: 48px;
  border-right: 1px solid #ddd;
  background-color: #fff;
  /* 预留操作按钮区域 */
}

/* iframe 容器（右下） */
.iframe-wrapper {
  flex: 1;
  overflow: hidden;
  position: relative;
}

iframe {
  width: 100%;
  height: 100%;
  border: none;
}
</style>
