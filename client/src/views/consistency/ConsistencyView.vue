<template>
  <AppLayout>
    <UploadPage
      v-if="!result"
      ref="uploadPageRef"
      :upload-files="uploadFiles"
      :cases="cases"
      :selected-case="selectedCase"
      :loading="loading"
      :case-names="CASE_NAMES"
      :is-drag-over="isDragOver && !loading"
      :debug-mode="debugMode"
      :current-platform="currentPlatform"
      :dev-preview="devPreview"
      :design-preview="designPreview"
      :dev-preview-loading="devPreviewLoading"
      :design-preview-loading="designPreviewLoading"
      :blob-dev-src="blobUrls.arkui"
      :blob-design-src="blobUrls.design"
      @step-picked="onStepPicked"
      @drag-over="isDragOver = $event"
      @drop="onDrop"
      @run-upload="runUpload"
      @select-case="selectCase"
      @platform-switch="onPlatformSwitch"
      @clear-dev-preview="clearDevPreview"
      @clear-design-preview="clearDesignPreview"
    />

    <div v-if="loading" class="center-placeholder-wrapper">
      <div class="center-placeholder">
        <el-icon class="spin" size="48"><Loading /></el-icon>
        <p>正在分析…</p>
      </div>
    </div>

    <ReportPage
      v-else-if="result"
      :result="result"
      :arkui-img-src="arkuiImgSrc"
      :design-img-src="designImgSrc"
      :design-nodes="designNodes"
      :all-arkui-nodes="allArkuiNodes"
      :arkui-nodes="arkuiNodes"
      :selected-pair="selectedPair"
      :active-diff="activeDiff"
      :debug-mode="debugMode"
      :debug-pipeline-on="debugPipelineOn"
      :debug-overlay-on="debugOverlayOn"
      :debug-pair-items="debugPairItems"
      :debug-pair-map="debugPairMap"
      :locked-node-ids="lockedNodeIds"
      :selected-design-diffs="selectedDesignDiffs"
      :selected-arkui-diffs="selectedArkuiDiffs"
      :cases="cases"
      :selected-case="selectedCase"
      :case-names="CASE_NAMES"
      :current-platform="currentPlatform"
      :rerun-loading="rerunLoading"
      :dev-reuploading="devReuploading"
      :design-reuploading="designReuploading"
      :dev-preview="devPreview"
      :dev-preview-loading="devPreviewLoading"
      :design-preview="designPreview"
      :design-preview-loading="designPreviewLoading"
      :blob-dev-src="blobUrls.arkui"
      :blob-design-src="blobUrls.design"
      :upload-files="uploadFiles"
      @select-case="selectCase"
      @arkui-node-click="onArkuiNodeClick"
      @design-node-click="onDesignNodeClick"
      @clear-diff="activeDiff = null"
      @clear-pair="selectedPair = null"
      @share="handleShare"
      @recheck="resetResult"
      @recheck-dev="recheckDev"
      @recheck-design="recheckDesign"
      @rerun="rerunCheck"
      @diff-select="onDiffSelect"
      @toggle-lock="onToggleLock"
      @update:debug-pipeline-on="debugPipelineOn = $event"
      @update:debug-overlay-on="debugOverlayOn = $event"
      @step-picked="onStepPicked"
      @clear-dev-preview="clearDevPreview"
      @clear-design-preview="clearDesignPreview"
    />
    <div
      id="pixso_render"
      style="
        position:fixed;
        left:0;
        bottom:0;
        width: 100px;
        height: 100px;
        z-index:10000;
        background-color: red;
        opacity: 0;
        pointer-events: none;
      "
      v-show="true">
    </div>
  </AppLayout>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import { fetchCases, checkCase, checkUpload, imageUrl, parseDevUpload, parseDesignUpload } from '../../api/index.ts'
import { initApp } from './init/index'
import { savePlatform } from './init/restorePlatform'
import AppLayout from './components/AppLayout.vue'
import UploadPage from './components/UploadPage.vue'
import ReportPage from './components/ReportPage.vue'
import '../../styles/app.css'
import { CASE_NAMES_BY_PLATFORM, DEBUG_COLORS, FILE_SLOTS } from '../utils/constants'

const route           = useRoute()
const cases           = ref([])
const currentPlatform = ref('hmPhone')
const CASE_NAMES      = computed(() => CASE_NAMES_BY_PLATFORM[currentPlatform.value] || {})
const selectedCase = ref('')
const loading      = ref(false)
const result       = ref(null)
const activeDiff   = ref(null)
const selectedPair   = ref(null)
const lockedNodeIds  = ref(new Set())
const isDragOver     = ref(false)
const uploadPageRef = ref(null)
const debugMode      = ref(false)
const debugPipelineOn = ref(false)
const debugOverlayOn = ref(false)
const rerunLoading      = ref(false)
const devReuploading    = ref(false)
const designReuploading = ref(false)

// 上传页预览状态：文件上传后自动解析并展示
const devPreview          = ref(null)   // { nodes, canvas } | null
const designPreview       = ref(null)   // { nodes, canvas } | null
const devPreviewLoading   = ref(false)
const designPreviewLoading = ref(false)


const designNodes = computed(() => result.value?.allDesignNodes ?? [])
const allArkuiNodes = computed(() => result.value?.allArkuiNodes ?? [])
const arkuiNodes  = computed(() =>
  (allArkuiNodes.value.length ? allArkuiNodes.value : result.value?.pairs?.map(p => p.arkui) ?? [])
    .filter(node => !isBlankLikeNode(node) && isInteractiveImageNode(node))
)

const selectedDesignDiffs = computed(() =>
  selectedPair.value?.design?.id
    ? nodeDiffsFor('designNodeId', selectedPair.value.design.id)
    : []
)

const selectedArkuiDiffs = computed(() =>
  selectedPair.value?.arkui?.id
    ? nodeDiffsFor('arkuiNodeId', selectedPair.value.arkui.id)
    : []
)

const debugPairItems = computed(() => {
  const validation = result.value?.matchValidation ?? null
  const pairs = result.value?.pairs ?? []
  const items = []

  if (!validation) {
    pairs.forEach((pair, index) => {
      const arkuiId = pair.arkui?.id ?? null
      items.push({
        key: `${pair.design?.id || 'd'}::${arkuiId || 'a'}::${index}`,
        index,
        color: DEBUG_COLORS[index % DEBUG_COLORS.length],
        designId: pair.design?.id || null,
        arkuiId,
        arkuiRawType: pair.arkui?.rawType?.toLowerCase() || '-',
        confidence: pair.confidence || '-',
        validationStatus: null,
      })
    })
    return items
  }

  const processedArkuiIds = new Set()

  pairs.forEach((pair, index) => {
    const arkuiId = pair.arkui?.id ?? null
    const designId = pair.design?.id ?? null
    if (arkuiId) processedArkuiIds.add(arkuiId)

    let validationStatus = null
    if (validation && arkuiId) {
      if (arkuiId in validation) {
        validationStatus = validation[arkuiId] === designId ? 'ok' : 'wrong'
      } else {
        validationStatus = 'extra'
      }
    }

    items.push({
      key: `${designId || 'd'}::${arkuiId || 'a'}::${index}`,
      index,
      color: DEBUG_COLORS[index % DEBUG_COLORS.length],
      designId,
      arkuiId,
      arkuiRawType: pair.arkui?.rawType?.toLowerCase() || '-',
      confidence: pair.confidence || '-',
      validationStatus,
    })
  })

  if (validation) {
    for (const [arkuiId, designId] of Object.entries(validation)) {
      if (!processedArkuiIds.has(arkuiId)) {
        items.push({
          key: `missing::${arkuiId}`,
          index: null,
          color: '#999999',
          designId,
          arkuiId,
          arkuiRawType: '-',
          confidence: '-',
          validationStatus: 'missing',
        })
      }
    }
  }

  items.sort((a, b) => (parseInt(a.arkuiId) || 0) - (parseInt(b.arkuiId) || 0))
  items.forEach((item, i) => { item.index = i })
  return items
})

const debugPairMap = computed(() => {
  const map = {}
  for (const item of debugPairItems.value) {
    if (item.designId) map[item.designId] = { color: item.color, index: item.index }
    if (item.arkuiId) map[item.arkuiId] = { color: item.color, index: item.index }
  }
  return map
})


const uploadFiles = ref({ designJson: null, arkuiJson: null, designImage: null, arkuiImage: null })

const blobUrls = ref({ design: '', arkui: '' })

function revokeBlobUrls() {
  if (blobUrls.value.design) URL.revokeObjectURL(blobUrls.value.design)
  if (blobUrls.value.arkui)  URL.revokeObjectURL(blobUrls.value.arkui)
  blobUrls.value = { design: '', arkui: '' }
}
onUnmounted(revokeBlobUrls)

async function onStepPicked({ type, file }) {
  if (!file) return
  const next = { ...uploadFiles.value }
  if (type === 'arkuiJson')        next.arkuiJson    = file
  else if (type === 'arkuiImage')  next.arkuiImage   = file
  else if (type === 'designJson')  next.designJson   = file
  else if (type === 'designImage') next.designImage  = file
  selectedCase.value = ''
  uploadFiles.value = next

  // 按侧更新 blob URL，避免影响另一侧的图片显示
  if (type === 'arkuiJson' || type === 'arkuiImage') {
    if (blobUrls.value.arkui) URL.revokeObjectURL(blobUrls.value.arkui)
    blobUrls.value = { ...blobUrls.value, arkui: next.arkuiImage ? URL.createObjectURL(next.arkuiImage) : '' }
  } else {
    if (blobUrls.value.design) URL.revokeObjectURL(blobUrls.value.design)
    blobUrls.value = { ...blobUrls.value, design: next.designImage ? URL.createObjectURL(next.designImage) : '' }
  }

  // arkuiJson 上传时，由 json 内容决定平台，更新全局状态和缓存
  if (type === 'arkuiJson') {
    const detected = await detectPlatformFromJson(file)
    if (detected && detected !== currentPlatform.value) {
      currentPlatform.value = detected
      savePlatform(detected)
      cases.value = []
      try { cases.value = await fetchCases(detected) }
      catch { ElMessage.warning(`无法加载 ${detected} 的 Case 列表`) }
    }
  }

  // 开发侧 json + 图片都齐才触发节点预览
  if (type === 'arkuiJson' || type === 'arkuiImage') {
    if (next.arkuiJson && next.arkuiImage) triggerDevPreview(next)
  }
  // 设计侧 json + 图片都齐才触发预览
  if (type === 'designJson' || type === 'designImage') {
    if (next.designJson && next.designImage) triggerDesignPreview(next)
  }
}

function onDrop(e) {
  isDragOver.value = false
  assignFiles([...e.dataTransfer.files])
}

function assignFiles(files) {
  const next = { ...uploadFiles.value }
  const unmatched = []

  for (const f of files) {
    const slot = FILE_SLOTS.find(s => s.match(f))
    if (slot) next[slot.key] = f
    else unmatched.push(f.name)
  }

  const jsonFallback  = files.filter(f => f.name.endsWith('.json'))
  const imageFallback = files.filter(f => f.type.startsWith('image/'))
  if (!next.designJson  && jsonFallback[0])  next.designJson  = jsonFallback[0]
  if (!next.arkuiJson   && jsonFallback[1])  next.arkuiJson   = jsonFallback[1]
  if (!next.designImage && imageFallback[0]) next.designImage = imageFallback[0]
  if (!next.arkuiImage  && imageFallback[1]) next.arkuiImage  = imageFallback[1]

  if (unmatched.length) ElMessage.info(`以下文件未能识别：${unmatched.join(', ')}`)

  selectedCase.value = ''
  uploadFiles.value  = next
  revokeBlobUrls()
  if (next.designImage) blobUrls.value.design = URL.createObjectURL(next.designImage)
  if (next.arkuiImage)  blobUrls.value.arkui  = URL.createObjectURL(next.arkuiImage)

  const devReady    = next.arkuiJson && next.arkuiImage
  const designReady = next.designJson && next.designImage

  if (devReady && designReady) {
    // 全部就绪 → 直接运行全量对比，不需要单独预览
    nextTick(runUpload)
  } else {
    // 部分就绪 → 触发可用侧的节点预览
    if (devReady) triggerDevPreview(next)
    if (designReady) triggerDesignPreview(next)
  }
}

const designImgSrc = computed(() => blobUrls.value.design)
const arkuiImgSrc  = computed(() => blobUrls.value.arkui)

onMounted(async () => {
  const { platform, deliverable } = await initApp()
  currentPlatform.value = platform

  debugMode.value = route.query['debugger'] === '1'
  debugPipelineOn.value = false
  debugOverlayOn.value = false

  // Step 6：deliverableId 模式，直接渲染报告页，跳过上传和 fetchCases
  if (deliverable) {
    result.value = deliverable.result
    blobUrls.value = { design: deliverable.designImgSrc, arkui: deliverable.arkuiImgSrc }
    return
  }

  try { cases.value = await fetchCases(currentPlatform.value) }
  catch { ElMessage.warning('无法加载内置 Case') }
})

async function onPlatformSwitch(platform) {
  if (!platform || platform === currentPlatform.value) return
  currentPlatform.value = platform
  savePlatform(platform)
  selectedCase.value = ''
  cases.value = []
  try { cases.value = await fetchCases(platform) }
  catch { ElMessage.warning(`无法加载 ${platform} 的 Case 列表`) }
}

async function detectPlatformFromJson(file) {
  try {
    const text = await file.text()
    const json = JSON.parse(text)
    if (json.deviceType === 'web') return 'web'
    if (json.name === 'viewport') return 'web'
    if (json.content && json.content.width != null) {
      const w = parseFloat(json.content.width)
      if (Number.isFinite(w) && w < 600) return 'hmWatch'
      return 'hmPhone'
    }
  } catch { /* 解析失败不切换平台 */ }
  return null
}

watch(debugMode, value => {
  if (!value) debugOverlayOn.value = false
})

// 报告页重新上传后，预览解析完成时提示用户点击重新对比
watch(devPreview, val => {
  if (val && result.value && devReuploading.value) {
    ElMessage.success('上传成功，点击右侧重新对比分析')
  }
})
watch(designPreview, val => {
  if (val && result.value && designReuploading.value) {
    ElMessage.success('上传成功，点击右侧重新对比分析')
  }
})

// ── 预览解析 ─────────────────────────────────────────────────────────────────

async function triggerDevPreview(files) {
  devPreview.value   = null
  devPreviewLoading.value = true
  try {
    devPreview.value = await parseDevUpload(
      files.arkuiJson,
      files.arkuiImage ?? null,
      currentPlatform.value,
    )
  } catch { /* 静默失败，不阻断主流程 */ }
  finally { devPreviewLoading.value = false }
}

async function triggerDesignPreview(files) {
  designPreview.value   = null
  designPreviewLoading.value = true
  try {
    designPreview.value = await parseDesignUpload(
      files.designJson,
      files.designImage ?? null,
      currentPlatform.value,
    )
  } catch { /* 静默失败 */ }
  finally { designPreviewLoading.value = false }
}

// ── 重置 ───────────────────────────────────────────────────────────────────

function resetResult() {
  result.value        = null
  selectedCase.value  = ''
  activeDiff.value    = null
  selectedPair.value  = null
  lockedNodeIds.value = new Set()
  devPreview.value    = null
  designPreview.value = null
  revokeBlobUrls()
  uploadFiles.value   = { designJson: null, arkuiJson: null, designImage: null, arkuiImage: null }
}

// 报告页"开发侧重新上传"：保留设计侧数据和报告页，仅清空 arkui，进入上传卡片模式
function recheckDev() {
  uploadFiles.value = { ...uploadFiles.value, arkuiJson: null, arkuiImage: null }
  devPreview.value  = null
  devPreviewLoading.value = false
  if (blobUrls.value.arkui) {
    URL.revokeObjectURL(blobUrls.value.arkui)
    blobUrls.value = { ...blobUrls.value, arkui: '' }
  }
  activeDiff.value    = null
  selectedPair.value  = null
  lockedNodeIds.value = new Set()
  devReuploading.value = true
}

// 报告页"设计侧重新上传"：保留 arkui 侧数据和 result，仅清空 design 文件并进入上传卡片模式
function recheckDesign() {
  uploadFiles.value = { ...uploadFiles.value, designJson: null, designImage: null }
  designPreview.value = null
  designPreviewLoading.value = false
  if (blobUrls.value.design) {
    URL.revokeObjectURL(blobUrls.value.design)
    blobUrls.value = { ...blobUrls.value, design: '' }
  }
  activeDiff.value        = null
  selectedPair.value      = null
  lockedNodeIds.value     = new Set()
  designReuploading.value = true
}

// 上传页内"重新上传"按钮：仅清空对应侧
function clearDevPreview() {
  uploadFiles.value = { ...uploadFiles.value, arkuiJson: null, arkuiImage: null }
  devPreview.value  = null
  devPreviewLoading.value = false
  if (blobUrls.value.arkui) {
    URL.revokeObjectURL(blobUrls.value.arkui)
    blobUrls.value = { ...blobUrls.value, arkui: '' }
  }
}

function clearDesignPreview() {
  uploadFiles.value = { ...uploadFiles.value, designJson: null, designImage: null }
  designPreview.value = null
  designPreviewLoading.value = false
  if (blobUrls.value.design) {
    URL.revokeObjectURL(blobUrls.value.design)
    blobUrls.value = { ...blobUrls.value, design: '' }
  }
}

async function rerunCheck() {
  activeDiff.value    = null
  selectedPair.value  = null
  lockedNodeIds.value = new Set()
  rerunLoading.value  = true
  try {
    if (uploadFiles.value.designJson && uploadFiles.value.arkuiJson) {
      result.value = await checkUpload(
        uploadFiles.value.designJson,
        uploadFiles.value.arkuiJson,
        uploadFiles.value.designImage,
        uploadFiles.value.arkuiImage,
        currentPlatform.value,
      )
    } else {
      ElMessage.warning('没有可用的数据，请重新上传')
      return
    }
    devReuploading.value    = false
    designReuploading.value = false
    ElMessage.success('重新对比完成')
  } catch (e) {
    ElMessage.error(`分析失败：${e.response?.data?.error || e.message}`)
  } finally {
    rerunLoading.value = false
  }
}

function handleShare() {
  ElMessage.info('分享功能开发中')
}

function onDesignNodeClick(nodeId) {
  const node = resolveSelectableNode(designNodes.value, nodeId)
  if (!isSelectableNode(node)) return
  const pair = result.value?.pairs?.find(p => p.design.id === (node?.id || nodeId))
  if (pair) {
    selectedPair.value = pair
  } else {
    const designNode = node || result.value?.allDesignNodes?.find(n => n.id === nodeId)
    if (designNode) selectedPair.value = { matchType: 'unmatched', design: designNode, arkui: null }
  }
  activeDiff.value = null
}

function onArkuiNodeClick(nodeId) {
  const node = resolveSelectableNode(allArkuiNodes.value, nodeId)
  if (!isSelectableNode(node)) return
  const pair = result.value?.pairs?.find(p => p.arkui.id === (node?.id || nodeId))
  if (pair) {
    selectedPair.value = pair
  } else {
    const arkuiNode = node || result.value?.allArkuiNodes?.find(n => n.id === nodeId)
    if (arkuiNode) selectedPair.value = { matchType: 'unmatched-dev', design: null, arkui: arkuiNode }
  }
  activeDiff.value = null
}

function isInteractiveImageNode(node) {
  return node &&
    !isBlankLikeNode(node) &&
    node.visible !== false &&
    !isHiddenFrameworkTextNode(node) &&
    !isOcrHiddenTextNode(node) &&
    !node.visualOccluded &&
    node.rect &&
    node.rect.w > 4 &&
    node.rect.h > 4
}

function isSelectableNode(node) {
  return !!(node &&
    node.visible !== false &&
    !isHiddenFrameworkTextNode(node) &&
    !isOcrHiddenTextNode(node) &&
    !node.visualOccluded &&
    node.rect?.w > 4 &&
    node.rect?.h > 4)
}

function isBlankLikeNode(node) {
  return String(node?.type || node?.name || '').trim().toLowerCase() === 'blank'
}

function isHiddenFrameworkTextNode(node) {
  return !!(node && node.type === 'text' && node.hiddenFrameworkAncestor)
}

function isOcrHiddenTextNode(node) {
  return !!(node &&
    node.type === 'text' &&
    (node.visualOccluded || node.ocrVisibility?.visible === false))
}

function nodeDiffsFor(key, nodeId) {
  return (result.value?.diffs ?? []).filter(d => d[key] === nodeId)
}

function resolveSelectableNode(nodes, nodeId) {
  const node = nodes.find(n => n.id === nodeId)
  if (!node) return null
  if (isHiddenFrameworkTextNode(node) || isOcrHiddenTextNode(node)) return null
  if (node.type === 'text' || !node.textContent) return node

  const targetText = normalizeLooseText(node.textContent)
  if (!targetText) return node

  const descendants = nodes.filter(n =>
    n.type === 'text' &&
    normalizeLooseText(n.textContent) === targetText &&
    isPathPrefix(node.path, n.path) &&
    n.visible !== false &&
    !n.visualOccluded &&
    !isHiddenFrameworkTextNode(n) &&
    !isOcrHiddenTextNode(n)
  )

  if (!descendants.length) return node
  return descendants.sort((a, b) => {
    const da = (a.path?.length ?? 0) - (node.path?.length ?? 0)
    const db = (b.path?.length ?? 0) - (node.path?.length ?? 0)
    if (da !== db) return db - da
    return (a.rect.w * a.rect.h) - (b.rect.w * b.rect.h)
  })[0]
}

function normalizeLooseText(text) {
  return String(text || '').replace(/\s+/g, '').trim()
}

function isPathPrefix(prefix, path) {
  if (!Array.isArray(prefix) || !Array.isArray(path)) return false
  if (prefix.length >= path.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== path[i]) return false
  }
  return true
}

function onToggleLock(nodeId) {
  const next = new Set(lockedNodeIds.value)
  next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId)
  lockedNodeIds.value = next
  if (next.has(nodeId) && selectedPair.value?.design?.id === nodeId) selectedPair.value = null
}

async function selectCase(id) {
  selectedCase.value  = id
  activeDiff.value    = null
  selectedPair.value  = null
  lockedNodeIds.value = new Set()
  loading.value       = true
  result.value        = null
  revokeBlobUrls()
  try {
    const data = await checkCase(id, currentPlatform.value)

    // 从响应中取出原始文件内容，构造 File 对象（等价于用户手动上传 4 个文件）
    const rawDesignJson = data._rawDesignJson
    const rawDevContent = data._rawDevContent
    const devImgExt     = data._devImgExt || 'png'
    delete data._rawDesignJson
    delete data._rawDevContent
    delete data._devImgExt
    result.value = data

    // 构造 JSON File 对象
    const designJsonBlob = new Blob([JSON.stringify(rawDesignJson)], { type: 'application/json' })
    const designJsonFile = new File([designJsonBlob], 'design.json', { type: 'application/json' })
    let devJsonFile
    if (typeof rawDevContent === 'string') {
      const blob = new Blob([rawDevContent], { type: 'text/plain' })
      devJsonFile = new File([blob], 'arkui.dump', { type: 'text/plain' })
    } else {
      const blob = new Blob([JSON.stringify(rawDevContent)], { type: 'application/json' })
      devJsonFile = new File([blob], 'arkui.json', { type: 'application/json' })
    }

    // 并行 fetch 图片，转 File 对象
    const arkuiImgUrl  = imageUrl(id, 'arkui',  currentPlatform.value)
    const designImgUrl = imageUrl(id, 'design', currentPlatform.value)
    const [arkuiImgBlob, designImgBlob] = await Promise.all([
      fetch(arkuiImgUrl).then(r => r.blob()),
      fetch(designImgUrl).then(r => r.blob()),
    ])
    const arkuiImgFile  = new File([arkuiImgBlob],  `arkui.${devImgExt}`,  { type: arkuiImgBlob.type  || `image/${devImgExt}` })
    const designImgFile = new File([designImgBlob], 'design.png', { type: designImgBlob.type || 'image/png' })

    // 存入 uploadFiles，此后与手动上传路径完全一致
    uploadFiles.value = {
      designJson:  designJsonFile,
      arkuiJson:   devJsonFile,
      designImage: designImgFile,
      arkuiImage:  arkuiImgFile,
    }

    // 创建 blob URL 用于图片显示
    blobUrls.value = {
      arkui:  URL.createObjectURL(arkuiImgBlob),
      design: URL.createObjectURL(designImgBlob),
    }
  }
  catch (e) { ElMessage.error(`分析失败：${e.response?.data?.error || e.message}`) }
  finally    { loading.value = false }
}

async function runUpload(platform) {
  selectedCase.value  = ''
  activeDiff.value    = null
  selectedPair.value  = null
  lockedNodeIds.value = new Set()
  loading.value       = true
  result.value        = null
  if (platform && platform !== currentPlatform.value) currentPlatform.value = platform
  try {
    result.value = await checkUpload(
      uploadFiles.value.designJson,
      uploadFiles.value.arkuiJson,
      uploadFiles.value.designImage,
      uploadFiles.value.arkuiImage,
      platform || currentPlatform.value,
    )
    ElMessage.success('分析完成')
  } catch (e) { ElMessage.error(`分析失败：${e.response?.data?.error || e.message}`) }
  finally     { loading.value = false }
}

function onDiffSelect(diff) {
  activeDiff.value = diff
  if (diff) {
    const pair = result.value?.pairs?.find(p =>
      p.design.id === diff.designNodeId && p.arkui.id === diff.arkuiNodeId
    )
    selectedPair.value = pair || null
  } else {
    selectedPair.value = null
  }
}

function validationBg(status) {
  if (status === 'wrong')   return 'rgba(239, 68, 68, 0.18)'
  if (status === 'extra')   return 'rgba(234, 179, 8, 0.18)'
  if (status === 'missing') return 'rgba(150, 150, 150, 0.18)'
  return 'transparent'
}
</script>
