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
      @step-picked="onStepPicked"
      @drag-over="isDragOver = $event"
      @drop="onDrop"
      @run-upload="runUpload"
      @select-case="selectCase"
      @platform-switch="onPlatformSwitch"
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
      @select-case="selectCase"
      @arkui-node-click="onArkuiNodeClick"
      @design-node-click="onDesignNodeClick"
      @clear-diff="activeDiff = null"
      @clear-pair="selectedPair = null"
      @share="handleShare"
      @recheck="resetResult"
      @diff-select="onDiffSelect"
      @toggle-lock="onToggleLock"
      @update:debug-pipeline-on="debugPipelineOn = $event"
      @update:debug-overlay-on="debugOverlayOn = $event"
    />
  </AppLayout>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchCases, checkCase, checkUpload, imageUrl } from './api/index.ts'
import AppLayout from './components/AppLayout.vue'
import UploadPage from './components/UploadPage.vue'
import ReportPage from './components/ReportPage.vue'
import './styles/app.css'

// 按平台分组的 case 中文名（缺名时由组件层用 caseId 兜底）
const CASE_NAMES_BY_PLATFORM = {
  hmPhone: {
    case1: '主题购买页面',
    case2: '音乐APP的页面',
    case3: '查看照片页面',
    case4: '运动健康页面',
    case5: '地图导航页面',
    case6: '路线导航浮层页面',
    case7: '90日天气页面',
    case8: '生活服务数据页面',
  },
  hmWatch: {},
  web: {},
}

const cases           = ref([])
const currentPlatform = ref('hmPhone')   // 当前选中的平台（影响 fetchCases / checkCase / imageUrl）
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

const DEBUG_COLORS = [
  '#2f6fed',
  '#17a36f',
  '#d68b00',
  '#8b5cf6',
  '#0ea5e9',
  '#ef4444',
  '#14b8a6',
  '#f97316',
  '#22c55e',
  '#a855f7',
  '#e11d48',
  '#2563eb',
]

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

    if (arkuiId) {
      processedArkuiIds.add(arkuiId)
    }

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

const FILE_SLOTS = [
  { key: 'designJson',  label: 'design.json',  required: true,  match: f => /design/i.test(f.name) && f.name.endsWith('.json') },
  { key: 'arkuiJson',   label: 'arkui.json',   required: true,  match: f => /arkui/i.test(f.name) && f.name.endsWith('.json') },
  { key: 'designImage', label: 'design 图片',  required: false, match: f => /design/i.test(f.name) && f.type.startsWith('image/') },
  { key: 'arkuiImage',  label: 'arkui 图片',   required: true,  match: f => /arkui/i.test(f.name)  && f.type.startsWith('image/') },
]

const uploadFiles = ref({ designJson: null, arkuiJson: null, designImage: null, arkuiImage: null })

const hasAnyFile = computed(() =>
  Object.values(uploadFiles.value).some(f => f !== null)
)

const blobUrls = ref({ design: '', arkui: '' })

function revokeBlobUrls() {
  if (blobUrls.value.design) URL.revokeObjectURL(blobUrls.value.design)
  if (blobUrls.value.arkui)  URL.revokeObjectURL(blobUrls.value.arkui)
  blobUrls.value = { design: '', arkui: '' }
}
onUnmounted(revokeBlobUrls)

function onStepPicked({ type, file }) {
  if (!file) return
  const next = { ...uploadFiles.value }
  if (type === 'arkuiJson') {
    next.arkuiJson = file
  } else if (type === 'arkuiImage') {
    next.arkuiImage = file
  } else if (type === 'designJson') {
    next.designJson = file
  } else if (type === 'designImage') {
    next.designImage = file
  }
  selectedCase.value = ''
  uploadFiles.value = next

  revokeBlobUrls()
  if (next.designImage) blobUrls.value.design = URL.createObjectURL(next.designImage)
  if (next.arkuiImage)  blobUrls.value.arkui  = URL.createObjectURL(next.arkuiImage)
}

function onDrop(e) {
  isDragOver.value = false
  assignFiles([...e.dataTransfer.files])
}

function assignFiles(files) {
  const next = { ...uploadFiles.value }
  const unmatched = []

  // 混合上传模式（从设计稿或拖拽）
  for (const f of files) {
    const slot = FILE_SLOTS.find(s => s.match(f))
    if (slot) {
      next[slot.key] = f
    } else {
      unmatched.push(f.name)
    }
  }

  const jsonFallback  = files.filter(f => f.name.endsWith('.json'))
  const imageFallback = files.filter(f => f.type.startsWith('image/'))
  if (!next.designJson  && jsonFallback[0]) next.designJson = jsonFallback[0]
  if (!next.arkuiJson   && jsonFallback[1]) next.arkuiJson  = jsonFallback[1]
  if (!next.designImage && imageFallback[0]) next.designImage = imageFallback[0]
  if (!next.arkuiImage  && imageFallback[1]) next.arkuiImage  = imageFallback[1]

  if (unmatched.length) ElMessage.info(`以下文件未能识别：${unmatched.join(', ')}`)

  selectedCase.value = ''
  uploadFiles.value  = next

  revokeBlobUrls()
  if (next.designImage) blobUrls.value.design = URL.createObjectURL(next.designImage)
  if (next.arkuiImage)  blobUrls.value.arkui  = URL.createObjectURL(next.arkuiImage)

  if (next.designJson && next.arkuiJson && next.arkuiImage) {
    nextTick(runUpload)
  }
}

const designImgSrc = computed(() =>
  selectedCase.value ? imageUrl(selectedCase.value, 'design', currentPlatform.value) : blobUrls.value.design
)
const arkuiImgSrc = computed(() =>
  selectedCase.value ? imageUrl(selectedCase.value, 'arkui', currentPlatform.value) : blobUrls.value.arkui
)

const scoreTagType = computed(() => {
  const s = result.value?.stats.score ?? 0
  if (s >= 90) return 'success'
  if (s >= 70) return 'warning'
  return 'danger'
})

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  debugMode.value = params.get('debugger') === '1'
  debugPipelineOn.value = false
  debugOverlayOn.value = false
  try { cases.value = await fetchCases(currentPlatform.value) }
  catch { ElMessage.warning('无法加载内置 Case') }
})

// debugger 模式下，UploadPage 切换平台或上传后自动识别平台时调用
async function onPlatformSwitch(platform) {
  if (!platform || platform === currentPlatform.value) return
  currentPlatform.value = platform
  selectedCase.value = ''
  try { cases.value = await fetchCases(platform) }
  catch { ElMessage.warning(`无法加载 ${platform} 的 Case 列表`) }
}

watch(debugMode, value => {
  if (!value) debugOverlayOn.value = false
})

function resetResult() {
  result.value        = null
  selectedCase.value  = ''
  activeDiff.value    = null
  selectedPair.value  = null
  lockedNodeIds.value = new Set()
  revokeBlobUrls()
  uploadFiles.value   = { designJson: null, arkuiJson: null, designImage: null, arkuiImage: null }
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
    if (designNode) {
      selectedPair.value = { matchType: 'unmatched', design: designNode, arkui: null }
    }
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
    if (arkuiNode) {
      selectedPair.value = { matchType: 'unmatched-dev', design: null, arkui: arkuiNode }
    }
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

function isTreeVisibleNode(node, side) {
  if (side !== 'arkui') return true
  return !isHiddenFrameworkTextNode(node) && !isOcrHiddenTextNode(node)
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
  if (next.has(nodeId) && selectedPair.value?.design?.id === nodeId) {
    selectedPair.value = null
  }
}

async function selectCase(id) {
  selectedCase.value  = id
  activeDiff.value    = null
  selectedPair.value  = null
  lockedNodeIds.value = new Set()
  loading.value       = true
  result.value        = null
  revokeBlobUrls()
  try { result.value = await checkCase(id, currentPlatform.value) }
  catch (e) { ElMessage.error(`分析失败：${e.response?.data?.error || e.message}`) }
  finally    { loading.value = false }
}

async function runUpload(platform) {
  // platform：从 UploadPage 传来的平台 key（'hmPhone' / 'hmWatch' / 'web'）
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

function confidenceText(confidence) {
  if (confidence === 'high') return '高置信'
  if (confidence === 'low') return '低置信'
  return '中置信'
}

function confidenceTagType(confidence) {
  if (confidence === 'high') return 'success'
  if (confidence === 'low') return 'warning'
  return 'primary'
}

function validationBg(status) {
  if (status === 'wrong')   return 'rgba(239, 68, 68, 0.18)'
  if (status === 'extra')   return 'rgba(234, 179, 8, 0.18)'
  if (status === 'missing') return 'rgba(150, 150, 150, 0.18)'
  return 'transparent'
}
</script>
