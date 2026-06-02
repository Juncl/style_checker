<template>
  <!-- ── 中间主区：开发侧 + 设计侧 ── -->
  <main class="center-panel up-board">
    <div v-if="!loading" class="up-columns">
      <!-- 隐藏的文件选择器（设计侧） -->
      <input ref="pickerStep3" type="file" accept=".json" style="display:none" @change="onStep3Picked" />
      <input ref="pickerStep4" type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.svg" style="display:none" @change="onStep4Picked" />

      <!-- ════ 开发侧 ════ -->
      <section class="up-col up-col--dev">
        <!-- 标签栏 -->
        <div class="up-tabbar up-tabbar--soft">
          <img :src="iconDev" alt="" class="up-tab-icon" />
          <span class="up-tab-text">开发环境</span>
          <span class="up-tab-sep">/</span>
          <span class="up-tab-text">20260306 10:50:15</span>
          <el-icon class="up-tab-arrow"><ArrowRight /></el-icon>
          <button
            v-if="devPreview || devPreviewLoading"
            class="up-tab-action"
            @click="$emit('clear-dev-preview')"
          >重新上传</button>
        </div>
        <!-- 舞台 -->
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
            :platform="selectedPlatform"
            @pick-json="onDevJsonPicked"
            @pick-image="file => $emit('step-picked', { type: 'arkuiImage', file })"
          />
        </div>
      </section>

      <!-- ════ 设计侧 ════ -->
      <section class="up-col up-col--design">
        <!-- 标签栏 -->
        <div class="up-tabbar">
          <img :src="iconDesign" alt="" class="up-tab-icon" />
          <span class="up-tab-text">设计页面</span>
          <span class="up-tab-sep">/</span>
          <span class="up-tab-text">主题购买页面示例</span>
          <el-icon class="up-tab-arrow"><ArrowRight /></el-icon>
          <button
            v-if="designPreview || designPreviewLoading"
            class="up-tab-action"
            @click="$emit('clear-design-preview')"
          >重新上传</button>
        </div>
        <!-- 舞台 -->
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
  </main>

  <!-- ── 右侧差异报告面板 ── -->
  <aside class="right-panel up-right-panel">
    <!-- 标签栏 -->
    <div class="up-tabbar up-tabbar--report">
      <span class="report-tab-title">差异报告</span>
    </div>

    <div class="report-body">
      <!-- 空状态卡片 -->
      <div class="report-empty">
        <img :src="iconEmpty" class="report-empty-img" alt="" />
        <p class="report-empty-hint">请完成操作指引<br />导入待检查页面后开始检查</p>
        <div class="report-device-row" ref="platformDropdownRef">
          <div class="report-device-trigger" @click="togglePlatformDropdown">
            <span class="report-device-text">{{ platformLabel }}</span>
            <el-icon class="report-device-arrow" :class="{ 'is-open': platformDropdownOpen }"><ArrowDown /></el-icon>
          </div>
          <div v-show="platformDropdownOpen" class="platform-dropdown-panel">
            <div
              v-for="opt in platformOptions"
              :key="opt.value"
              class="platform-dropdown-item"
              :class="{ 'is-selected': selectedPlatform === opt.value }"
              @click="selectPlatformOption(opt.value)"
            >{{ opt.label }}</div>
          </div>
        </div>
        <el-button
          type="primary"
          :loading="loading"
          :disabled="!canStartCheck"
          class="report-start-btn"
          @click="$emit('run-upload', selectedPlatform)"
        >开始对比</el-button>
      </div>

      <!-- 试用案例 -->
      <div class="cases-block">
        <div class="cases-head">
          <span class="cases-head-title">试用案例</span>
          <span class="cases-head-hint">点击下方案例即刻体验~</span>
          <div v-if="debugMode" class="cases-platform-dropdown" ref="casesPlatformRef">
            <div class="cases-platform-trigger" @click="toggleCasesPlatform">
              <span class="cases-platform-text">{{ platformLabel }}</span>
              <el-icon class="cases-platform-arrow" :class="{ 'is-open': casesPlatformOpen }"><ArrowDown /></el-icon>
            </div>
            <div v-show="casesPlatformOpen" class="cases-platform-panel">
              <div
                v-for="opt in platformOptions"
                :key="opt.value"
                class="cases-platform-item"
                :class="{ 'is-selected': currentPlatform === opt.value }"
                @click="selectCasesPlatformOption(opt.value)"
              >{{ opt.label }}</div>
            </div>
          </div>
        </div>
        <div v-if="!cases.length" class="cases-loading">加载中…</div>
        <div class="cases-list">
          <div
            v-for="c in cases"
            :key="c.id"
            :class="['case-row', { active: selectedCase === c.id }]"
            @click="$emit('select-case', c.id)"
          >
            <div class="case-thumb">
              <img :src="caseImageUrl(c.id)" class="case-thumb-img" :alt="c.id" />
              <div v-if="loading && selectedCase === c.id" class="case-thumb-loading">
                <el-icon class="spin"><Loading /></el-icon>
              </div>
            </div>
            <div class="case-meta">
              <span class="case-name">{{ c.id.replace('case', '案例 ') }}</span>
              <span class="case-desc">{{ caseNames[c.id] || c.id }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { getJsonImage } from '../../utils/getJsonImage'
import { ElMessage } from 'element-plus'
import { CircleCheck, Loading, ArrowRight, ArrowDown } from '@element-plus/icons-vue'
import { imageUrl } from '../../../api/index.ts'
import ImagePanel from './ImagePanel.vue'
import DevUploadCard from './DevUploadCard.vue'
import iconJson from '@/assets/upload-json.png'
import iconImage from '@/assets/upload-image.png'
import iconEmpty from '@/assets/svg/empty-report.svg'
import iconStep3 from '@/assets/svg/Step3-up.svg'
import iconDev from '@/assets/icon-dev.png'
import iconDesign from '@/assets/icon-design.png'

const props = defineProps({
  uploadFiles: {
    type: Object,
    required: true
  },
  cases: {
    type: Array,
    default: () => []
  },
  selectedCase: {
    type: String,
    default: ''
  },
  loading: {
    type: Boolean,
    default: false
  },
  caseNames: {
    type: Object,
    default: () => ({})
  },
  isDragOver: {
    type: Boolean,
    default: false
  },
  debugMode: {
    type: Boolean,
    default: false
  },
  currentPlatform: {
    type: String,
    default: 'hmPhone'
  },
  // 预览相关 props
  devPreview: {
    type: Object,
    default: null   // { nodes, canvas: { w, h } } | null
  },
  designPreview: {
    type: Object,
    default: null
  },
  devPreviewLoading: {
    type: Boolean,
    default: false
  },
  designPreviewLoading: {
    type: Boolean,
    default: false
  },
  blobDevSrc: {
    type: String,
    default: ''
  },
  blobDesignSrc: {
    type: String,
    default: ''
  },
})

const emit = defineEmits([
  'step-picked',
  'drag-over',
  'drop',
  'run-upload',
  'select-case',
  'platform-switch',
  'clear-dev-preview',
  'clear-design-preview',
])

const annotationUrl = ref('')
const urlLoading    = ref(false)
const selectedPlatform = ref(props.currentPlatform || 'hmPhone')
watch(() => props.currentPlatform, v => { if (v && v !== selectedPlatform.value) selectedPlatform.value = v })

// 当父组件清除设计侧数据时，重置本地 URL 输入状态
watch(() => props.uploadFiles.designJson, newVal => {
  if (!newVal) {
    annotationUrl.value = ''
    urlLoading.value    = false
  }
})

// debugger 模式下设计侧的子模式
const debugStep3Mode = ref(true)  // true: 传送码模式，false: 文件上传模式

const pickerStep3 = ref(null)
const pickerStep4 = ref(null)

// "开始对比"按钮可用条件
const canStartCheck = computed(() => {
  const f = props.uploadFiles
  if (!f.designJson || !f.arkuiJson) return false
  if (!f.arkuiImage) return false
  if (!f.designImage) return false
  return true
})

function caseImageUrl(caseId) {
  return imageUrl(caseId, 'arkui', props.currentPlatform)
}

function onPlatformSwitch(platform) {
  selectedPlatform.value = platform
  emit('platform-switch', platform)
}

const platformOptions = [
  { value: 'hmPhone', label: '鸿蒙-手机' },
  { value: 'hmWatch', label: '鸿蒙-手表' },
  { value: 'web',     label: 'web网页'  },
]

const platformLabel = computed(() =>
  platformOptions.find(o => o.value === selectedPlatform.value)?.label ?? '鸿蒙-手机'
)

const platformDropdownOpen  = ref(false)
const platformDropdownRef   = ref(null)
const casesPlatformOpen     = ref(false)
const casesPlatformRef      = ref(null)

function togglePlatformDropdown() {
  platformDropdownOpen.value = !platformDropdownOpen.value
  casesPlatformOpen.value = false
}

function toggleCasesPlatform() {
  casesPlatformOpen.value = !casesPlatformOpen.value
  platformDropdownOpen.value = false
}

function selectPlatformOption(val) {
  platformDropdownOpen.value = false
  onPlatformSwitch(val)
}

function selectCasesPlatformOption(val) {
  casesPlatformOpen.value = false
  onPlatformSwitch(val)
}

function handleDocumentClick(e) {
  if (platformDropdownRef.value && !platformDropdownRef.value.contains(e.target)) {
    platformDropdownOpen.value = false
  }
  if (casesPlatformRef.value && !casesPlatformRef.value.contains(e.target)) {
    casesPlatformOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', handleDocumentClick))
onUnmounted(() => document.removeEventListener('click', handleDocumentClick))


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
