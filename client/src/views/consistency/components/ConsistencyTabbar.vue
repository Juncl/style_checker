<template>
  <div class="c-tabbar">
    <!-- 开发侧 -->
    <div class="c-tabbar-col c-tabbar-col--dev">
      <img :src="iconDev" alt="" class="up-tab-icon" />
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
import DeliverableDropdown from './DeliverableDropdown.vue'
import iconDev from '@/assets/icon-dev.png'
import iconDesign from '@/assets/icon-design.png'

defineProps({
  viewMode:             { type: String,  default: 'upload' },
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

defineEmits([
  'select-deliverable',
  'select-page',
  'add-page',
  'clear-dev-preview',
  'clear-design-preview',
  'recheck-dev',
  'recheck-design',
])
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
</style>
