<template>
  <div class="c-tabbar">
    <!-- 开发侧 -->
    <div class="c-tabbar-col c-tabbar-col--dev">
      <img
        :src="iconDev"
        alt=""
        class="up-tab-icon"
        :class="{ 'up-tab-icon--ai-trigger': debugMode }"
        @click.stop="onDevIconClick"
      />
      <span class="up-tab-text">开发环境</span>
      <DeliverableDropdown
        :items="deliverables"
        :selected="selectedDeliverable"
        placeholder="选择"
        empty-text="暂无交付件"
        @select="$emit('select-deliverable', $event)"
      />
      <DeliverableDropdown
        v-if="pages.length > 0"
        :items="pages"
        :selected="selectedPage"
        placeholder="选择页面"
        empty-text="暂无页面"
        :show-add-button="true"
        add-button-text="新增页面"
        @select="$emit('select-page', $event)"
        @add="$emit('add-page')"
      />
      <!-- upload 模式：有预览时显示重新上传 -->
      <button
        v-if="viewMode === 'upload' && (devPreview || devPreviewLoading)"
        class="up-tab-action"
        @click="$emit('clear-dev-preview')"
      >重新上传</button>
      <!-- report 模式 -->
      <template v-else-if="viewMode === 'report'">
        <button
          v-if="!devReuploading"
          class="up-tab-action"
          @click="$emit('recheck-dev')"
        >重新上传</button>
        <button
          v-else-if="devPreview || devPreviewLoading"
          class="up-tab-action"
          @click="$emit('clear-dev-preview')"
        >重新上传</button>
      </template>
    </div>

    <!-- 设计侧 -->
    <div class="c-tabbar-col c-tabbar-col--design">
      <img :src="iconDesign" alt="" class="up-tab-icon" />

      <!-- 传送码快捷替换图标按钮 -->
      <div
        class="design-link-btn"
        :class="{ active: linkPopoverVisible }"
        @click.stop="toggleLinkPopover"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12.0265 9.49321L13.5199 7.99988C15.0465 6.47321 15.0465 3.99988 13.5199 2.47654C11.9965 0.949876 9.52321 0.949876 7.99988 2.47654L6.50321 3.96988M9.49321 12.0265L7.99988 13.5199C6.47321 15.0465 3.99988 15.0465 2.47654 13.5199C0.949876 11.9965 0.949876 9.52321 2.47654 7.99988L3.96988 6.50321" stroke="currentColor" stroke-linecap="round" stroke-width="1" />
          <path d="M6.5 9.5L9.5 6.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
        </svg>

        <!-- 悬浮卡片 -->
        <transition name="link-popover-fade">
          <div v-if="linkPopoverVisible" class="link-popover" @click.stop>
            <div class="link-popover-inner">
              <el-input
                v-model="linkCode"
                placeholder="请输入标注视图URL/传送码"
                type="textarea"
                :rows="4"
                class="link-popover-input"
                @keydown.enter.ctrl.prevent="confirmLink"
              />
              <div class="link-popover-actions">
                <span class="link-popover-clear" @click="clearLinkCode">清空</span>
                <button
                  class="link-popover-confirm"
                  :disabled="!linkCode.trim() || linkLoading"
                  @click="confirmLink"
                >{{ linkLoading ? '加载中…' : '确定' }}</button>
              </div>
            </div>
          </div>
        </transition>
      </div>

      <span class="up-tab-text">设计页面</span>
      <!-- upload 模式：有预览时显示重新上传 -->
      <button
        v-if="viewMode === 'upload' && (designPreview || designPreviewLoading)"
        class="up-tab-action"
        @click="$emit('clear-design-preview')"
      >重新上传</button>
      <!-- report 模式 -->
      <template v-else-if="viewMode === 'report'">
        <button
          v-if="!designReuploading"
          class="up-tab-action"
          @click="$emit('recheck-design')"
        >重新上传</button>
        <button
          v-else-if="designPreview || designPreviewLoading"
          class="up-tab-action"
          @click="$emit('clear-design-preview')"
        >重新上传</button>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import DeliverableDropdown from './DeliverableDropdown.vue'
import { getJsonImage } from '../../utils-inner/getJsonImage'
import iconDev from '@/assets/icon-dev.png'
import iconDesign from '@/assets/icon-design.png'

const props = defineProps({
  viewMode:             { type: String,  default: 'upload' },
  debugMode:            { type: Boolean, default: false },
  deliverables:         { type: Array,   default: () => [] },
  selectedDeliverable:  { type: Object,  default: null },
  pages:                { type: Array,   default: () => [] },
  selectedPage:         { type: Object,  default: null },
  devPreview:           { type: Object,  default: null },
  devPreviewLoading:    { type: Boolean, default: false },
  designPreview:        { type: Object,  default: null },
  designPreviewLoading: { type: Boolean, default: false },
  devReuploading:       { type: Boolean, default: false },
  designReuploading:    { type: Boolean, default: false },
})

const emit = defineEmits([
  'select-deliverable',
  'select-page',
  'add-page',
  'clear-dev-preview',
  'clear-design-preview',
  'recheck-dev',
  'recheck-design',
  'replace-design',
  'toggle-ai-chat',
])

const linkPopoverVisible = ref(false)
const linkCode           = ref('')
const linkLoading        = ref(false)

function toggleLinkPopover() {
  linkPopoverVisible.value = !linkPopoverVisible.value
}

function clearLinkCode() {
  linkCode.value = ''
}

async function confirmLink() {
  const code = linkCode.value.trim()
  if (!code || linkLoading.value) return
  linkLoading.value = true
  try {
    const result = await getJsonImage({ url: code })
    if (!result.valid) {
      ElMessage.error(result.errorMsg || '传送码不合规，请检查输入')
      return
    }
    const designJson = result.designJson
      ? new File([JSON.stringify(result.designJson)], 'design.json', { type: 'application/json' })
      : null
    let designImage = null
    if (result.designImageUrl) {
      const [meta, b64] = result.designImageUrl.split(',')
      const mimeType = meta.match(/:(.*?);/)?.[1] || 'image/png'
      const ext = mimeType.split('/')[1] || 'png'
      designImage = new File(
        [Uint8Array.from(atob(b64), c => c.charCodeAt(0))],
        `design.${ext}`, { type: mimeType }
      )
    }
    emit('replace-design', { designJson, designImage })
    linkPopoverVisible.value = false
    ElMessage.success('设计稿更新成功')
  } catch {
    ElMessage.error('设计稿获取失败，请检查标注视图URL或传送码后重试')
  } finally {
    linkLoading.value = false
  }
}

function onDevIconClick() {
  if (props.debugMode) emit('toggle-ai-chat')
}

function onDocClick() {
  if (linkPopoverVisible.value) linkPopoverVisible.value = false
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<style scoped>
.c-tabbar {
  display: flex;
  height: var(--octo-tabbar-height);
  border-bottom: 1px solid var(--octo-border-separator);
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

.c-tabbar-col {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 24px;
  background: var(--octo-surface-page);
}

.c-tabbar-col--dev {
  border-right: 1px solid var(--octo-border-separator);
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(8px);
}

/* ── 传送码快捷替换图标按钮 ── */
.design-link-btn {
  position: relative;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #777777;
  flex-shrink: 0;
  transition: color 150ms ease, background-color 150ms ease;
}
.design-link-btn:hover,
.design-link-btn.active {
  color: var(--octo-primary);
  background: #E6F2FD;
}

/* ── 悬浮卡片 ── */
.link-popover {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  width: 240px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
  padding: 4px;
  z-index: 1000;
}

.link-popover-inner {
  background: rgba(230, 242, 253, 0.7);
  border-radius: 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.link-popover-input :deep(textarea) {
  font-size: 12px;
  line-height: 1.6;
  color: var(--octo-primary);
  resize: none;
  background: transparent;
  border: none;
  box-shadow: none;
}
.link-popover-input :deep(.el-textarea__inner) {
  background: transparent;
  border: none;
  box-shadow: none !important;
  padding: 0;
  font-size: 12px;
  color: var(--octo-primary);
}
.link-popover-input :deep(.el-textarea__inner::placeholder) {
  color: #aaaaaa;
}

.link-popover-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.link-popover-clear {
  font-size: 12px;
  color: #777777;
  cursor: pointer;
  line-height: 22px;
  transition: color 150ms ease;
}
.link-popover-clear:hover {
  color: #191919;
}

.link-popover-confirm {
  height: 28px;
  padding: 0 16px;
  border: none;
  border-radius: 8px;
  background: var(--octo-primary);
  color: #ffffff;
  font-size: 12px;
  cursor: pointer;
  transition: opacity 150ms ease;
}
.link-popover-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 入场动画 */
.link-popover-fade-enter-active,
.link-popover-fade-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}
.link-popover-fade-enter-from,
.link-popover-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
