<template>
  <!-- ── 中间主区：开发侧 + 设计侧 ── -->
  <main class="center-panel up-board">
    <div v-if="!loading" class="up-columns">
      <!-- 隐藏的文件选择器 -->
      <input ref="pickerStep1" type="file" accept=".json,.dump" style="display:none" @change="onStep1Picked" />
      <input ref="pickerStep2" type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.svg" style="display:none" @change="onStep2Picked" />
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
        </div>
        <!-- 舞台：手机模型 -->
        <div
          class="up-stage"
          @dragover.prevent="$emit('drag-over', true)"
          @dragleave.prevent="$emit('drag-over', false)"
          @drop.prevent="$emit('drop', $event)"
        >
          <div class="phone-card">
            <div class="phone-bg"></div>
            <div class="phone-content">
              <div class="up-upload-card">
                <!-- Step1 -->
                <div class="up-step">
                  <div class="up-step-title">
                    <span>Step1：{{ selectedPlatform === 'web' ? '上传 JSON 文件' : '上传 ArkUI 树 JSON/DUMP' }}</span>
                    <span class="up-help" :title="selectedPlatform === 'web' ? '上传 Web DOM 树 JSON 文件' : '下载工具导出 ArkUI 节点树 JSON 或 DUMP 后上传'">?</span>
                  </div>
                  <div
                    :class="['up-drop', { 'has-file': uploadFiles.arkuiJson, 'drag-over': isDragOver }]"
                    @click="triggerStep1"
                  >
                    <img v-if="!uploadFiles.arkuiJson" :src="iconJson" class="up-drop-icon" alt="" />
                    <el-icon v-else class="up-drop-check"><CircleCheck /></el-icon>
                    <div v-if="!uploadFiles.arkuiJson" class="up-drop-text">
                      <span class="up-link" @click.stop>下载导出 ArkUI 树工具</span>
                      <span class="up-drop-sub">再将 JSON 文件拖到此处</span>
                    </div>
                    <span v-else class="up-drop-done">{{ uploadFiles.arkuiJson.name }}</span>
                  </div>
                </div>

                <!-- Step2 -->
                <div class="up-step">
                  <div class="up-step-title up-step-title--center">
                    <span>Step2：上传开发图片</span>
                  </div>
                  <div
                    :class="['up-drop', { 'has-file': uploadFiles.arkuiImage, 'drag-over': isDragOver, 'is-disabled': !uploadFiles.arkuiJson }]"
                    @click="triggerStep2"
                  >
                    <img v-if="!uploadFiles.arkuiImage" :src="iconImage" class="up-drop-icon" alt="" />
                    <el-icon v-else class="up-drop-check"><CircleCheck /></el-icon>
                    <div v-if="!uploadFiles.arkuiImage" class="up-drop-text">
                      <span class="up-drop-sub">将图片拖到此处或</span>
                      <span class="up-link" @click.stop="triggerStep2">单击上传</span>
                    </div>
                    <span v-else class="up-drop-done">{{ uploadFiles.arkuiImage.name }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
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
        </div>
        <!-- 舞台：手机模型 -->
        <div class="up-stage">
          <div class="phone-card">
            <div class="phone-bg"></div>
            <div class="phone-content">
              <!-- debugger 模式 -->
              <template v-if="debugMode">
                <!-- 传送码模式 -->
                <div v-if="debugStep3Mode" class="up-url-group">
                  <div class="up-step-title up-step-title--center up-step-title--row">
                    <span>Step3：输入传送码</span>
                    <button class="debug-inline-toggle" @click="debugStep3Mode = false" title="切换到文件上传">⇄ 切换</button>
                  </div>
                  <div class="up-url-card">
                    <el-input
                      v-model="annotationUrl"
                      type="textarea"
                      :rows="7"
                      placeholder="请输入标注视图URL/传送码"
                      class="up-url-textarea"
                    />
                    <el-button
                      type="primary"
                      class="up-url-btn"
                      :disabled="!annotationUrl.trim()"
                      @click="validateAnnotationUrl"
                    >确认</el-button>
                  </div>
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
                <div class="up-step-title up-step-title--center">
                  <span>Step3：输入标注视图 URL / 传送码</span>
                </div>
                <div class="up-url-card">
                  <el-input
                    v-model="annotationUrl"
                    type="textarea"
                    :rows="7"
                    placeholder="请输入标注视图URL/传送码"
                    class="up-url-textarea"
                  />
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
        <p class="report-empty-hint">请完成操作指引，<br />导入待检查页面后开始检查</p>
        <div class="report-device-row">
          <select class="report-device-select" :value="selectedPlatform" @change="onPlatformSwitch($event.target.value)">
            <option value="hmPhone">鸿蒙-手机</option>
            <option value="hmWatch">鸿蒙-手表</option>
            <option value="web">web网页</option>
          </select>
          <el-icon class="report-device-arrow"><ArrowDown /></el-icon>
        </div>
        <el-button
          type="primary"
          :loading="loading"
          :disabled="!uploadFiles.designJson || !uploadFiles.arkuiJson || (selectedPlatform !== 'web' && !uploadFiles.arkuiImage) || !uploadFiles.designImage"
          class="report-start-btn"
          @click="$emit('run-upload', selectedPlatform)"
        >开始对比</el-button>
      </div>

      <!-- 试用案例 -->
      <div class="cases-block">
        <div class="cases-head">
          <span class="cases-head-title">试用案例</span>
          <span class="cases-head-hint">👏 点击下方案例即刻体验~</span>
          <!-- debugger 模式：平台下拉框，切换会刷新 case 组 -->
          <select
            v-if="debugMode"
            class="cases-platform-select"
            :value="currentPlatform"
            @change="onPlatformSwitch($event.target.value)"
          >
            <option value="hmPhone">鸿蒙-手机</option>
            <option value="hmWatch">鸿蒙-手表</option>
            <option value="web">web网页</option>
          </select>
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
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { CircleCheck, Loading, ArrowRight, ArrowDown } from '@element-plus/icons-vue'
import { imageUrl } from '../../../api/index.ts'
const iconJson = '/src/assets/upload-json.png'
const iconImage = '/src/assets/upload-image.png'
const iconEmpty = '/src/assets/empty-report.png'
const iconDev = '/src/assets/icon-dev.png'
const iconDesign = '/src/assets/icon-design.png'

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
  }
})

const emit = defineEmits([
  'step-picked',
  'drag-over',
  'drop',
  'run-upload',
  'select-case',
  'platform-switch'
])

const annotationUrl = ref('')
// 当前对比的平台 key（与父组件双向同步）
const selectedPlatform = ref(props.currentPlatform || 'hmPhone')
watch(() => props.currentPlatform, v => { if (v && v !== selectedPlatform.value) selectedPlatform.value = v })

// 4个独立的picker input
const pickerStep1 = ref(null)
const pickerStep2 = ref(null)
const pickerStep3 = ref(null)
const pickerStep4 = ref(null)

// debugger模式下的状态
const debugStep3Mode = ref(true) // true: 传送码模式，false: 文件上传模式

function caseImageUrl(caseId) {
  return imageUrl(caseId, 'arkui', props.currentPlatform)
}

// debugger 模式：用户切换平台下拉框时通知父组件刷新 case 列表
function onPlatformSwitch(platform) {
  selectedPlatform.value = platform
  emit('platform-switch', platform)
}

// 从开发侧 JSON 自动识别平台（上传 ArkUI/Web JSON 后调用）
async function detectPlatformFromJson(file) {
  try {
    const text = await file.text()
    const json = JSON.parse(text)
    // web 标识：deviceType === 'web' 或 name === 'viewport'
    if (json.deviceType === 'web') return 'web'
    if (json.name === 'viewport') return 'web'
    // ArkUI：content.$resolution 存在
    if (json.content && json.content.width != null) {
      const w = parseFloat(json.content.width)
      if (Number.isFinite(w) && w < 600) return 'hmWatch'
      return 'hmPhone'
    }
  } catch (e) {
    // 解析失败不切换平台
  }
  return null
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
async function onStep1Picked(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (!file.name.endsWith('.json') && !file.name.endsWith('.dump')) {
    ElMessage.error('请上传 .json 或 .dump 文件')
    event.target.value = ''
    return
  }
  emit('step-picked', { type: 'arkuiJson', file })
  // 自动识别平台：读 JSON 内容做特征匹配
  const detected = await detectPlatformFromJson(file)
  if (detected && detected !== selectedPlatform.value) {
    selectedPlatform.value = detected
    emit('platform-switch', detected)
  }
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
