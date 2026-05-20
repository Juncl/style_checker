<template>
  <!-- ── 中间主区 ── -->
  <main class="center-panel">
    <!-- 空状态：分步上传引导 -->
    <div v-if="!loading" class="upload-guide">
      <!-- Step1: ArkUI JSON -->
      <input
        ref="pickerStep1"
        type="file"
        accept=".json,.dump"
        style="display:none"
        @change="onStep1Picked"
      />
      <!-- Step2: ArkUI Image -->
      <input
        ref="pickerStep2"
        type="file"
        accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.svg"
        style="display:none"
        @change="onStep2Picked"
      />
      <!-- Step3 (debugger): JSON -->
      <input
        ref="pickerStep3"
        type="file"
        accept=".json"
        style="display:none"
        @change="onStep3Picked"
      />
      <!-- Step4 (debugger): Image -->
      <input
        ref="pickerStep4"
        type="file"
        accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.svg"
        style="display:none"
        @change="onStep4Picked"
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
              @click="triggerStep1"
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
              :class="['step-drop', { 'has-file': uploadFiles.arkuiImage, 'drag-over': isDragOver, 'is-disabled': !uploadFiles.arkuiJson }]"
              @click="triggerStep2"
            >
              <img v-if="!uploadFiles.arkuiImage" :src="iconImage" class="step-drop-img" alt="" />
              <el-icon v-else class="step-drop-icon ok"><CircleCheck /></el-icon>
              <template v-if="!uploadFiles.arkuiImage">
                <span class="step-drop-hint">
                  将图片拖到此处或
                  <span class="step-link" @click.stop="triggerStep2">单击上传</span>
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
              <!-- debugger模式：内部两种状态切换 -->
              <template v-if="debugMode">
                <!-- 传送码模式 -->
                <template v-if="debugStep3Mode">
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                    <div class="step-header">
                      <span class="step-label">Step3：输入传送码</span>
                    </div>
                    <button class="debug-inline-toggle" @click="debugStep3Mode = false" title="切换到文件上传">
                      ⇄ 切换
                    </button>
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
                    @click="validateAnnotationUrl"
                  >确认</el-button>
                </template>

                <!-- 文件上传模式 -->
                <template v-else>
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                    <div class="step-header">
                      <span class="step-label">调试对比</span>
                    </div>
                    <button class="debug-inline-toggle" @click="debugStep3Mode = true" title="返回传送码模式">
                      ⇄ 返回
                    </button>
                  </div>
                  <div>
                    <!-- Step3：JSON文件 -->
                    <div class="upload-step-card">
                      <div class="step-header">
                        <span class="step-label">Step3：上传 JSON</span>
                      </div>
                      <div
                        :class="['step-drop', { 'has-file': uploadFiles.designJson, 'is-disabled': !uploadFiles.arkuiImage }]"
                        @click="triggerStep3"
                      >
                        <img v-if="!uploadFiles.designJson" :src="iconJson" class="step-drop-img" alt="" />
                        <el-icon v-else class="step-drop-icon ok"><CircleCheck /></el-icon>
                        <template v-if="!uploadFiles.designJson">
                          <span class="step-drop-hint">
                            <span class="step-link" @click.stop="triggerStep3">单击上传</span>
                            <br />(.json)
                          </span>
                        </template>
                        <span v-else class="step-drop-done">{{ uploadFiles.designJson.name }}</span>
                      </div>
                    </div>

                    <!-- Step4：图片文件 -->
                    <div class="upload-step-card">
                      <div class="step-header">
                        <span class="step-label">Step4：上传图片</span>
                      </div>
                      <div
                        :class="['step-drop', { 'has-file': uploadFiles.designImage, 'is-disabled': !uploadFiles.designJson }]"
                        @click="triggerStep4"
                      >
                        <img v-if="!uploadFiles.designImage" :src="iconImage" class="step-drop-img" alt="" />
                        <el-icon v-else class="step-drop-icon ok"><CircleCheck /></el-icon>
                        <template v-if="!uploadFiles.designImage">
                          <span class="step-drop-hint">
                            <span class="step-link" @click.stop="triggerStep4">单击上传</span>
                            <br />(.png, .jpg, .jpeg, .gif, .webp, .bmp, .svg)
                          </span>
                        </template>
                        <span v-else class="step-drop-done">{{ uploadFiles.designImage.name }}</span>
                      </div>
                    </div>
                  </div>
                </template>
              </template>

              <!-- 非debugger模式：原有的URL/传送码输入 -->
              <template v-else>
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
                  @click="validateAnnotationUrl"
                >确认</el-button>
              </template>

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
        :disabled="!uploadFiles.designJson || !uploadFiles.arkuiJson || !uploadFiles.arkuiImage || !uploadFiles.designImage"
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
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
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
  debugMode: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits([
  'step-picked',
  'drag-over',
  'drop',
  'run-upload',
  'select-case'
])

const annotationUrl = ref('')
const deviceType = ref('鸿蒙-手机')

// 4个独立的picker input
const pickerStep1 = ref(null)
const pickerStep2 = ref(null)
const pickerStep3 = ref(null)
const pickerStep4 = ref(null)

// debugger模式下的状态
const debugStep3Mode = ref(true) // true: 传送码模式，false: 文件上传模式

function caseImageUrl(caseId) {
  return imageUrl(caseId, 'arkui')
}

// ── 传送码校验（共用于debugger和非debugger模式）──
function validateAnnotationUrl() {
  const code = annotationUrl.value.trim()
  if (!code) return

  // 调用校验函数（当前所有输入都返回不合规）
  const result = checkTransmissionCode(code)

  if (!result.valid) {
    ElMessage.error('传送码不合规，请检查输入')
    return
  }

  // 后续：当合规时处理返回的json和image base64
  // console.log('合规:', result.json, result.image)
}

// ── 空函数：传送码字符串校验（目前所有输入都返回不合规）──
function checkTransmissionCode(code) {
  // 预留函数，后续在这里添加真实的校验逻辑
  // 入参：code (字符串)
  // 出参：{ valid: boolean, json?: base64, image?: base64 }
  return { valid: false }
}

// ── 4个独立的 trigger 函数，带顺序控制 ──
function triggerStep1() {
  pickerStep1.value?.click()
}

function triggerStep2() {
  if (!props.uploadFiles.arkuiJson) {
    ElMessage.warning('请先完成 Step 1：上传 ArkUI 的 JSON')
    return
  }
  pickerStep2.value?.click()
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

// ── 4个独立的文件选中处理函数 ──
function onStep1Picked(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (!file.name.endsWith('.json') && !file.name.endsWith('.dump')) {
    ElMessage.error('请上传 .json 或 .dump 文件')
    event.target.value = ''
    return
  }
  emit('step-picked', { type: 'arkuiJson', file })
  event.target.value = ''
}

function onStep2Picked(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const validExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']
  if (!file.type.startsWith('image/') && !validExts.some(ext => file.name.toLowerCase().endsWith(ext))) {
    ElMessage.error('请上传图片文件')
    event.target.value = ''
    return
  }
  emit('step-picked', { type: 'arkuiImage', file })
  event.target.value = ''
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
