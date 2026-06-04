<template>
  <div class="up-columns">
    <!-- 隐藏的文件选择器（设计侧） -->
    <input ref="pickerStep3" type="file" accept=".json" style="display:none" @change="onStep3Picked" />
    <input ref="pickerStep4" type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.svg" style="display:none" @change="onStep4Picked" />

    <!-- ════ 开发侧 ════ -->
    <section class="up-col up-col--dev">
      <div
        :class="['up-stage', devPreview && !devPreviewLoading ? 'up-stage--report' : '']"
        @dragover.prevent="$emit('drag-over', true)"
        @dragleave.prevent="$emit('drag-over', false)"
        @drop.prevent="$emit('drop', $event)"
      >
        <!-- 解析中 -->
        <div v-if="devPreviewLoading" class="phone-card">
          <div class="phone-bg"></div>
          <div class="phone-content phone-content--center">
            <div class="preview-loading">
              <el-icon class="spin" size="32"><Loading /></el-icon>
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
          :is-drag-over="isDragOver"
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
              <el-icon class="spin" size="32"><Loading /></el-icon>
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
        <div v-else class="phone-card">
          <div class="phone-bg"></div>
          <div class="phone-content">
            <!-- debugger 模式 -->
            <template v-if="debugMode">
              <!-- 传送码模式 -->
              <div v-if="debugStep3Mode" class="up-url-group">
                <div v-if="urlLoading" class="url-loading-overlay">
                  <el-icon class="spin"><Loading /></el-icon>
                </div>
                <div class="up-step-title up-step-title--center up-step-title--row">
                  <span>Step3:输入传送码</span>
                  <button class="debug-inline-toggle" @click="debugStep3Mode = false" title="切换到文件上传">⇄ 切换</button>
                </div>
                <div class="up-url-card">
                  <img :src="iconStep3" class="up-url-icon" alt="" />
                  <el-input
                    v-model="annotationUrl"
                    placeholder="请输入标注视图URL/传送码"
                    class="up-url-input"
                    @keyup.enter="validateAnnotationUrl"
                  />
                </div>
                <el-button
                  type="primary"
                  class="up-url-btn"
                  :disabled="!annotationUrl.trim()"
                  @click="validateAnnotationUrl"
                >确认</el-button>
              </div>
              <!-- 文件上传模式 -->
              <div v-else class="up-upload-card">
                <div class="up-step-title up-step-title--center up-step-title--row">
                  <span>调试对比</span>
                  <button class="debug-inline-toggle" @click="debugStep3Mode = true" title="返回传送码模式">⇄ 返回</button>
                </div>
                <div class="up-step">
                  <div class="up-step-title up-step-title--center"><span>Step3：上传 JSON</span></div>
                  <div
                    :class="['up-drop', { 'has-file': uploadFiles.designJson, 'is-disabled': !uploadFiles.arkuiImage }]"
                    @click="triggerStep3"
                  >
                    <img v-if="!uploadFiles.designJson" :src="iconJson" class="up-drop-icon" alt="" />
                    <el-icon v-else class="up-drop-check"><CircleCheck /></el-icon>
                    <div v-if="!uploadFiles.designJson" class="up-drop-text">
                      <span class="up-link" @click.stop="triggerStep3">单击上传</span>
                      <span class="up-drop-sub">(.json)</span>
                    </div>
                    <span v-else class="up-drop-done">{{ uploadFiles.designJson.name }}</span>
                  </div>
                </div>
                <div class="up-step">
                  <div class="up-step-title up-step-title--center"><span>Step4：上传图片</span></div>
                  <div
                    :class="['up-drop', { 'has-file': uploadFiles.designImage, 'is-disabled': !uploadFiles.designJson }]"
                    @click="triggerStep4"
                  >
                    <img v-if="!uploadFiles.designImage" :src="iconImage" class="up-drop-icon" alt="" />
                    <el-icon v-else class="up-drop-check"><CircleCheck /></el-icon>
                    <div v-if="!uploadFiles.designImage" class="up-drop-text">
                      <span class="up-link" @click.stop="triggerStep4">单击上传</span>
                      <span class="up-drop-sub">(.png, .jpg ...)</span>
                    </div>
                    <span v-else class="up-drop-done">{{ uploadFiles.designImage.name }}</span>
                  </div>
                </div>
              </div>
            </template>

            <!-- 非 debugger 模式：URL / 传送码输入 -->
            <div v-else class="up-url-group">
              <div v-if="urlLoading" class="url-loading-overlay">
                <el-icon class="spin"><Loading /></el-icon>
              </div>
              <div class="up-step-title up-step-title--center">
                <span>Step3:输入标注视图URL/传送码</span>
              </div>
              <div class="up-url-card">
                <img :src="iconStep3" class="up-url-icon" alt="" />
                <el-input
                  v-model="annotationUrl"
                  placeholder="请输入标注视图URL/传送码"
                  class="up-url-input"
                  @keyup.enter="validateAnnotationUrl"
                />
              </div>
              <el-button
                type="primary"
                class="up-url-btn"
                :disabled="!annotationUrl.trim()"
                @click="validateAnnotationUrl"
              >确认</el-button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { getJsonImage } from '../../utils-inner/getJsonImage'
import { ElMessage } from 'element-plus'
import { CircleCheck, Loading } from '@element-plus/icons-vue'
import ImagePanel from './ImagePanel.vue'
import DevUploadCard from './DevUploadCard.vue'
import iconJson from '@/assets/upload-json.png'
import iconImage from '@/assets/upload-image.png'
import iconStep3 from '@/assets/svg/Step3-up.svg'

const props = defineProps({
  uploadFiles:          { type: Object,  required: true },
  isDragOver:           { type: Boolean, default: false },
  debugMode:            { type: Boolean, default: false },
  currentPlatform:      { type: String,  default: 'hmPhone' },
  devPreview:           { type: Object,  default: null },
  designPreview:        { type: Object,  default: null },
  devPreviewLoading:    { type: Boolean, default: false },
  designPreviewLoading: { type: Boolean, default: false },
  blobDevSrc:           { type: String,  default: '' },
  blobDesignSrc:        { type: String,  default: '' },
})

const emit = defineEmits(['step-picked', 'drag-over', 'drop'])

const annotationUrl  = ref('')
const urlLoading     = ref(false)
const debugStep3Mode = ref(true)
const pickerStep3    = ref(null)
const pickerStep4    = ref(null)

watch(() => props.uploadFiles.designJson, newVal => {
  if (!newVal) {
    annotationUrl.value = ''
    urlLoading.value    = false
  }
})

async function validateAnnotationUrl() {
  const code = annotationUrl.value.trim()
  if (!code) return

  urlLoading.value = true
  try {
    const result = await getJsonImage({ url: code })
    if (!result.valid) {
      ElMessage.error(result.errorMsg || '传送码不合规，请检查输入')
      return
    }
    if (result.designJson) {
      const jsonBlob = new Blob([JSON.stringify(result.designJson)], { type: 'application/json' })
      emit('step-picked', { type: 'designJson', file: new File([jsonBlob], 'design.json', { type: 'application/json' }) })
    }
    if (result.designImageUrl) {
      const [meta, b64] = result.designImageUrl.split(',')
      const mimeType = meta.match(/:(.*?);/)?.[1] || 'image/png'
      const ext = mimeType.split('/')[1] || 'png'
      const imageBlob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: mimeType })
      emit('step-picked', { type: 'designImage', file: new File([imageBlob], `design.${ext}`, { type: mimeType }) })
    }
    ElMessage.success('设计稿获取成功')
  } finally {
    urlLoading.value = false
  }
}

function onDevJsonPicked(file) {
  emit('step-picked', { type: 'arkuiJson', file })
}

function triggerStep3() {
  if (!props.uploadFiles.arkuiImage) {
    ElMessage.warning('请先完成 Step 2：上传开发图片')
    return
  }
  pickerStep3.value?.click()
}

function triggerStep4() {
  if (!props.uploadFiles.designJson) {
    ElMessage.warning('请先完成 Step 3：上传 JSON')
    return
  }
  pickerStep4.value?.click()
}

function onStep3Picked(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (!file.name.endsWith('.json')) {
    ElMessage.error('请上传 .json 文件')
    event.target.value = ''
    return
  }
  emit('step-picked', { type: 'designJson', file })
  event.target.value = ''
}

function onStep4Picked(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const validExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']
  if (!file.type.startsWith('image/') && !validExts.some(ext => file.name.toLowerCase().endsWith(ext))) {
    ElMessage.error('请上传图片文件')
    event.target.value = ''
    return
  }
  emit('step-picked', { type: 'designImage', file })
  event.target.value = ''
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
