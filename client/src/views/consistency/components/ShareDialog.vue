<template>
  <div class="share-dialog">
    <div class="share-dialog-header">
      <span class="share-dialog-title">分享对比页面</span>
      <button class="share-dialog-close" @click="$emit('close')">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="share-dialog-body">
      <input class="share-url-input" :value="href" readonly />
      <button class="share-copy-btn" @click="copyUrl">复制</button>
    </div>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'

defineEmits(['close'])

const href = window.location.href

async function copyUrl() {
  try {
    await navigator.clipboard.writeText(href)
    ElMessage.success('链接已复制到剪贴板')
  } catch {
    ElMessage.error('复制失败，请手动复制')
  }
}
</script>

<style scoped>
.share-dialog {
  position: fixed;
  top: calc(var(--octo-top-nav-height, 56px) + var(--octo-tabbar-height, 56px));
  right: 144px;
  width: 424px;
  background: #FFFFFF;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  z-index: 500;
}

.share-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 0 24px;
}

.share-dialog-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--octo-text-primary);
  line-height: 22px;
}

.share-dialog-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  background: none;
  border: none;
  color: var(--octo-text-secondary, #777777);
  cursor: pointer;
  transition: color 150ms ease;
  flex-shrink: 0;
}

.share-dialog-close:hover {
  color: var(--octo-text-primary);
}

.share-dialog-body {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 24px 20px 24px;
}

.share-url-input {
  flex: 1;
  height: 32px;
  min-width: 0;
  padding: 0 8px;
  font-size: 12px;
  color: var(--octo-text-primary);
  background: #FFFFFF;
  border: 1px solid var(--octo-border-default, #D1D5DC);
  border-radius: 4px;
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
  cursor: text;
}

.share-url-input:focus {
  border-color: var(--octo-primary, #0067D1);
  box-shadow: 0 0 0 2px rgba(0, 103, 209, 0.2);
}

.share-copy-btn {
  flex-shrink: 0;
  width: 72px;
  height: 32px;
  padding: 0;
  font-size: 12px;
  color: #FFFFFF;
  background: var(--octo-primary, #0067D1);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 150ms ease;
}

.share-copy-btn:hover {
  background: var(--octo-primary-hover, #0057B3);
}

.share-copy-btn:active {
  background: var(--octo-primary-active, #004A99);
}
</style>
