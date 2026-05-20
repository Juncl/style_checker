<template>
  <!-- ── 中间主区 ── -->
  <main class="center-panel">
    <!-- 空状态：分步上传引导 -->
    <div v-if="!loading" class="upload-guide">
      <input
        ref="pickerInput"
        type="file"
        :accept="fileAccept"
        style="display:none"
        @change="$emit('files-picked', $event)"
      />

      <div class="upload-guide-body">
        <!-- 开发侧包裹 -->
        <div class="upload-section upload-section--dev">
          <div class="upload-col-title">
            <img :src="iconDev" alt="" class="upload-col-title-icon" />
            <span>开发环境</span>
          </div>
          <div class="upload-col">
          <div
            class="upload-left-pane"
            @dragover.prevent="$emit('drag-over', true)"
            @dragleave.prevent="$emit('drag-over', false)"
            @drop.prevent="$emit('drop', $event)"
          >
          <!-- Step1 -->
          <div class="upload-step-card">
            <div class="step-header">
              <span class="step-label">Step1：上传 ArkUI 的 JSON</span>
              <span class="step-info-mark">①</span>
            </div>
            <div
              :class="['step-drop', { 'has-file': uploadFiles.arkuiJson, 'drag-over': isDragOver }]"
              @click="triggerPicker('arkuiJson')"
            >
              <img v-if="!uploadFiles.arkuiJson" :src="iconJson" class="step-drop-img" alt="" />
              <el-icon v-else class="step-drop-icon ok"><CircleCheck /></el-icon>
              <template v-if="!uploadFiles.arkuiJson">
                <span class="step-drop-hint">
                  <span class="step-link" @click.stop>下载并导出ArkUI工具</span>
                  <br />再将文件拖到此处
                  <br />(.json, .dump)
                </span>
              </template>
              <span v-else class="step-drop-done">{{ uploadFiles.arkuiJson.name }}</span>
            </div>
          </div>

          <!-- Step2 -->
          <div class="upload-step-card">
            <div class="step-header">
              <span class="step-label">Step2：上传开发图片</span>
            </div>
            <div
              :class="['step-drop', { 'has-file': uploadFiles.arkuiImage, 'drag-over': isDragOver }]"
              @click="$emit('trigger-picker', 'arkuiImage')"
            >
              <img v-if="!uploadFiles.arkuiImage" :src="iconImage" class="step-drop-img" alt="" />
              <el-icon v-else class="step-drop-icon ok"><CircleCheck /></el-icon>
              <template v-if="!uploadFiles.arkuiImage">
                <span class="step-drop-hint">
                  将图片拖到此处或
                  <span class="step-link" @click.stop="$emit('trigger-picker', 'arkuiImage')">单击上传</span>
                  <br />(.png, .jpg, .jpeg, .gif, .webp, .bmp, .svg)
                </span>
              </template>
              <span v-else class="step-drop-done">{{ uploadFiles.arkuiImage.name }}</span>
            </div>
          </div>
          </div>
          </div>
        </div>

        <!-- 设计侧包裹 -->
        <div class="upload-section upload-section--design">
          <div class="upload-col-title">
            <img :src="iconDesign" alt="" class="upload-col-title-icon" />
            <span>设计页面</span>
          </div>
          <div class="upload-col">
          <div class="upload-right-pane">
          <div class="step-header">
            <span class="step-label">Step3：输入标注视图URL/传送码</span>
          </div>
          <el-input
            v-model="annotationUrl"
            type="textarea"
            :rows="6"
            placeholder="请输入标注视图URL或传送码"
            class="step-url-input"
          />
          <el-button
            type="primary"
            class="step-confirm-btn"
            :disabled="!annotationUrl.trim()"
          >确认</el-button>
          </div>
          </div>
        </div>
      </div>
    </div>
  </main>

  <!-- ── 右侧面板 ── -->
  <aside class="right-panel">
    <!-- 标题栏 -->
    <div class="right-panel-header">
      <span class="right-panel-title">差异报告</span>
    </div>

    <!-- 空状态 + 案例列表 -->
    <div class="right-empty-state">
      <div class="right-empty-icon-wrap">
        <img :src="iconEmpty" class="right-empty-img" alt="" />
      </div>
      <p class="right-empty-hint">请完成操作指引，导入待检查页面后开始检查</p>
      <div class="right-device-row">
        <select class="device-select" v-model="deviceType">
          <option>鸿蒙-手机</option>
          <option>鸿蒙-手表</option>
          <option>web网页</option>
        </select>
        <span class="device-arrow">▾</span>
      </div>
      <el-button
        type="primary"
        :loading="loading"
        :disabled="!uploadFiles.designJson || !uploadFiles.arkuiJson || !uploadFiles.arkuiImage"
        class="right-start-btn"
        @click="$emit('run-upload', deviceType)"
      >开始分析</el-button>
    </div>

    <div class="right-cases-section">
      <div class="right-cases-header">
        <span class="cases-title">试用案例</span>
        <span class="cases-hint">
          <img :src="iconClap" alt="" class="cases-hint-icon" />
          点击下方案例即刻体验～
        </span>
      </div>
      <div v-if="!cases.length" class="cases-loading">加载中…</div>
      <div class="right-case-list">
        <div
          v-for="c in cases"
          :key="c.id"
          :class="['right-case-item', { active: selectedCase === c.id }]"
          @click="$emit('select-case', c.id)"
        >
          <div class="right-case-thumb-wrap">
            <img :src="caseImageUrl(c.id)" class="right-case-thumb" :alt="c.id" />
            <div v-if="loading && selectedCase === c.id" class="right-case-loading">
              <el-icon class="spin"><Loading /></el-icon>
            </div>
          </div>
          <div class="right-case-meta">
            <span class="right-case-label">{{ c.id.replace('case', '案例 ') }}</span>
            <span class="right-case-name">{{ caseNames[c.id] || c.id }}</span>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { CircleCheck, Loading } from '@element-plus/icons-vue'
import { imageUrl } from '../api/index.js'
const iconJson = '/src/assets/a1.png'
const iconImage = '/src/assets/a2.png'
const iconEmpty = '/src/assets/a3.png'
const iconDev = '/src/assets/a4.png'
const iconDesign = '/src/assets/a5.png'
const iconClap = '/src/assets/a6.png'

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
  currentUploadType: {
    type: String,
    default: null
  }
})

defineEmits([
  'files-picked',
  'trigger-picker',
  'drag-over',
  'drop',
  'run-upload',
  'select-case'
])

const pickerInput = ref(null)
const annotationUrl = ref('')
const deviceType = ref('鸿蒙-手机')

const fileAccept = computed(() => {
  if (props.currentUploadType === 'arkuiJson') return '.json,.dump'
  if (props.currentUploadType === 'arkuiImage') return '.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg'
  return '.json,.dump,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg'
})

watch(
  () => props.currentUploadType,
  (newType) => {
    if (newType) {
      pickerInput.value?.click()
    }
  }
)

function triggerPicker() {
  pickerInput.value?.click()
}

function caseImageUrl(caseId) {
  return imageUrl(caseId, 'arkui')
}

defineExpose({
  triggerFilePicker: triggerPicker
})
</script>
