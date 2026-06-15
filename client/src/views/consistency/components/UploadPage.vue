<template>
  <div class="up-columns">
    <!-- ════ 开发侧 ════ -->
    <section class="up-col up-col--dev">
      <div
        :class="['up-stage', devPreview && !devPreviewLoading ? 'up-stage--report' : '']"
      >
        <!-- 解析中 -->
        <div v-if="devPreviewLoading" class="phone-card">
          <div class="phone-bg"></div>
          <div class="phone-content phone-content--center">
            <div class="preview-loading">
              <OctoLoading :size="48" />
              <span class="preview-loading-text">正在解析节点…</span>
            </div>
          </div>
        </div>
        <!-- 节点预览 -->
        <ImagePanel
          v-else-if="devPreview"
          :src="blobDevSrc"
          :canvas-w="devPreview.canvas.w"
          :canvas-h="devPreview.canvas.h"
          :nodes="devPreview.nodes"
        />
        <!-- 上传卡片 -->
        <DevUploadCard
          v-else
          :arkui-json="uploadFiles.arkuiJson"
          :arkui-image="uploadFiles.arkuiImage"
          :platform="currentPlatform"
          @pick-json="onDevJsonPicked"
          @pick-image="file => $emit('step-picked', { type: 'arkuiImage', file })"
        />
      </div>
    </section>

    <!-- ════ 设计侧 ════ -->
    <section class="up-col up-col--design">
      <div :class="['up-stage', designPreview && !designPreviewLoading ? 'up-stage--report' : '']">
        <!-- 解析中 -->
        <div v-if="designPreviewLoading" class="phone-card">
          <div class="phone-bg"></div>
          <div class="phone-content phone-content--center">
            <div class="preview-loading">
              <OctoLoading :size="48" />
              <span class="preview-loading-text">正在解析节点…</span>
            </div>
          </div>
        </div>
        <!-- 节点预览 -->
        <ImagePanel
          v-else-if="designPreview"
          :src="blobDesignSrc"
          :canvas-w="designPreview.canvas.w"
          :canvas-h="designPreview.canvas.h"
          :nodes="designPreview.nodes"
        />
        <!-- 上传卡片 -->
        <DesignUploadCard
          v-else
          :design-json="uploadFiles.designJson"
          :design-image="uploadFiles.designImage"
          :debug-mode="debugMode"
          @step-picked="$emit('step-picked', $event)"
        />
      </div>
    </section>
  </div>
</template>

<script setup>
import ImagePanel from './ImagePanel.vue'
import DevUploadCard from './DevUploadCard.vue'
import DesignUploadCard from './DesignUploadCard.vue'
import OctoLoading from './common/OctoLoading.vue'

const props = defineProps({
  uploadFiles:          { type: Object,  required: true },
  debugMode:            { type: Boolean, default: false },
  currentPlatform:      { type: String,  default: 'hmPhone' },
  devPreview:           { type: Object,  default: null },
  designPreview:        { type: Object,  default: null },
  devPreviewLoading:    { type: Boolean, default: false },
  designPreviewLoading: { type: Boolean, default: false },
  blobDevSrc:           { type: String,  default: '' },
  blobDesignSrc:        { type: String,  default: '' },
})

const emit = defineEmits(['step-picked'])

function onDevJsonPicked(file) {
  emit('step-picked', { type: 'arkuiJson', file })
}

</script>

<style scoped>
.phone-content--center {
  align-items: center;
  justify-content: center;
  padding-top: 0;
}

.preview-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: #555;
}

.preview-loading-text {
  font-size: 12px;
  color: #777;
}
</style>
