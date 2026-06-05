<template>
  <AppLayout>
    <!-- loading 遮罩，覆盖整个 app-body -->
    <div v-if="loading" class="center-placeholder-wrapper">
      <div class="center-placeholder">
        <OctoLoading :size="48" />
        <p>加载中</p>
      </div>
    </div>

    <!-- 中间主区 -->
    <main class="center-panel up-board">
      <ConsistencyTabbar
        :view-mode="result ? 'report' : 'upload'"
        :deliverables="deliverables"
        :selected-deliverable="workingDeliverable"
        :pages="pages"
        :selected-page="workingPage"
        :dev-preview="devPreview"
        :dev-preview-loading="devPreviewLoading"
        :design-preview="designPreview"
        :design-preview-loading="designPreviewLoading"
        :dev-reuploading="devReuploading"
        :design-reuploading="designReuploading"
        @select-deliverable="onSelectDeliverable"
        @select-page="onSelectPage"
        @add-page="onAddPage"
        @clear-dev-preview="clearDevPreview"
        @clear-design-preview="clearDesignPreview"
        @recheck-dev="recheckDev"
        @recheck-design="recheckDesign"
      />

      <UploadPage
        v-if="!result"
        ref="uploadPageRef"
        :upload-files="uploadFiles"
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
      />

      <ReportPage
        v-if="result"
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
        :selected-case="selectedCase"
        :case-names="CASE_NAMES"
        :current-platform="currentPlatform"
        :dev-reuploading="devReuploading"
        :design-reuploading="designReuploading"
        :dev-preview="devPreview"
        :dev-preview-loading="devPreviewLoading"
        :design-preview="designPreview"
        :design-preview-loading="designPreviewLoading"
        :blob-dev-src="blobUrls.arkui"
        :blob-design-src="blobUrls.design"
        :upload-files="uploadFiles"
        :hovered-arkui-cross-id="hoveredArkuiCrossId"
        :hovered-design-cross-id="hoveredDesignCrossId"
        @select-case="selectCase"
        @arkui-node-click="onArkuiNodeClick"
        @design-node-click="onDesignNodeClick"
        @clear-pair="selectedPair = null"
        @step-picked="onStepPicked"
        @update:debug-pipeline-on="debugPipelineOn = $event"
        @update:debug-overlay-on="debugOverlayOn = $event"
        @arkui-hover="onArkuiHover"
        @design-hover="onDesignHover"
      />
    </main>

    <!-- 右侧面板 -->
    <aside class="right-panel up-right-panel" style="position: relative;">
      <UploadPanel
        v-if="!result"
        :loading="loading"
        :selected-case="selectedCase"
        :case-names="CASE_NAMES"
        :current-platform="currentPlatform"
        :upload-files="uploadFiles"
        :debug-mode="debugMode"
        @run-upload="runUpload"
        @select-case="selectCase"
        @platform-switch="onPlatformSwitch"
      />
      <ReportPanel
        v-if="result"
        :result="result"
        :active-pair-for-diff="activePairForDiff"
        :hover-pair-for-diff="hoverPairForDiff"
        :debug-mode="debugMode"
        :selected-pair="selectedPair"
        :design-nodes="designNodes"
        :all-arkui-nodes="allArkuiNodes"
        :locked-node-ids="lockedNodeIds"
        :rerun-loading="rerunLoading"
        :can-rerun="canRerun"
        :version-list="pageVersionList"
        :working-version-id="workingVersionId"
        @diff-select="onDiffSelect"
        @diff-hover="hoveredDiffPair = $event"
        @design-node-click="onDesignNodeClick"
        @arkui-node-click="onArkuiNodeClick"
        @toggle-lock="onToggleLock"
        @rerun="rerunCheck"
        @history-view="onHistoryView"
      />
    </aside>

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
import OctoLoading from './components/common/OctoLoading.vue'
import { checkCase, checkUpload, imageUrl, parseDevUpload, parseDesignUpload, convertDumpToJson } from '../../api/index.ts'
import { getTeamList, getSonListByTeamId, addConsistencyCheckDeliverable, addConsistencyCheckPage, getResultsByPageId, getPagesByDeliverableId, getConsistencyCheckDeliverables, fetchVersionJson } from '../../api/api.ts'
import {
  formatDateTime, fileToBase64, fileToText, buildProblems, base64ToFile, jsonToFile,
  isBlankLikeNode, isInteractiveImageNode, isSelectableNode, resolveSelectableNode,
} from '../utils/tools.ts'
import { initApp } from './init/index'
import { savePlatform } from './init/restorePlatform'
import AppLayout from './components/AppLayout.vue'
import ConsistencyTabbar from './components/ConsistencyTabbar.vue'
import UploadPage from './components/UploadPage.vue'
import ReportPage from './components/ReportPage.vue'
import UploadPanel from './components/UploadPanel.vue'
import ReportPanel from './components/ReportPanel.vue'
import '../../styles/app.css'
import { CASE_NAMES_BY_PLATFORM, DEBUG_COLORS, FILE_SLOTS } from '../utils/constants'

const route           = useRoute()
const currentPlatform = ref('hmPhone')
const CASE_NAMES      = computed(() => CASE_NAMES_BY_PLATFORM[currentPlatform.value] || {})
const selectedCase    = ref('')
const loading         = ref(false)
const result          = ref(null)
const activeDiff      = ref(null)
const selectedPair    = ref(null)
const lockedNodeIds   = ref(new Set())
const isDragOver      = ref(false)
const uploadPageRef   = ref(null)
const debugMode       = ref(false)
const debugPipelineOn = ref(false)
const debugOverlayOn  = ref(false)
const rerunLoading      = ref(false)
const devReuploading    = ref(false)
const designReuploading = ref(false)

const deliverables     = ref([])
const pages            = ref([])
const workingDeliverable  = ref(null)
const workingPage         = ref(null)
const pageVersionList     = ref([])
const workingVersionId    = ref(null)

// 上传页预览状态
const devPreview           = ref(null)
const designPreview        = ref(null)
const devPreviewLoading    = ref(false)
const designPreviewLoading = ref(false)

// ── hover 联动状态（从 ReportPage 提升）──────────────────────────────────────
const hoveredArkuiNodeId  = ref(null)
const hoveredDesignNodeId = ref(null)
const hoveredDiffPair     = ref(null)

const activePairForDiff = computed(() => {
  if (!selectedPair.value) return null
  return {
    designNodeId: selectedPair.value.design?.id ?? null,
    arkuiNodeId:  selectedPair.value.arkui?.id  ?? null,
  }
})

const hoverPairForDiff = computed(() => {
  if (!hoveredArkuiNodeId.value && !hoveredDesignNodeId.value) return null
  return {
    arkuiNodeId:  hoveredArkuiNodeId.value  ?? null,
    designNodeId: hoveredDesignNodeId.value ?? null,
  }
})

const hoveredDesignCrossId = computed(() => {
  if (hoveredDiffPair.value?.designNodeId) return hoveredDiffPair.value.designNodeId
  if (!hoveredArkuiNodeId.value) return null
  const pair = result.value?.pairs?.find(p => p.arkui?.id === hoveredArkuiNodeId.value)
  return pair?.design?.id ?? null
})

const hoveredArkuiCrossId = computed(() => {
  if (hoveredDiffPair.value?.arkuiNodeId) return hoveredDiffPair.value.arkuiNodeId
  if (!hoveredDesignNodeId.value) return null
  const pair = result.value?.pairs?.find(p => p.design?.id === hoveredDesignNodeId.value)
  return pair?.arkui?.id ?? null
})

function onArkuiHover(id) {
  hoveredArkuiNodeId.value  = id
  hoveredDesignNodeId.value = null
}
function onDesignHover(id) {
  hoveredDesignNodeId.value = id
  hoveredArkuiNodeId.value  = null
}

const canRerun = computed(() => {
  const devOk    = !devReuploading.value    || !!devPreview.value
  const designOk = !designReuploading.value || !!designPreview.value
  return devOk && designOk && !rerunLoading.value
})

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
const blobUrls    = ref({ design: '', arkui: '' })

function revokeBlobUrls() {
  if (blobUrls.value.design) URL.revokeObjectURL(blobUrls.value.design)
  if (blobUrls.value.arkui)  URL.revokeObjectURL(blobUrls.value.arkui)
  blobUrls.value = { design: '', arkui: '' }
}
onUnmounted(revokeBlobUrls)

async function onStepPicked({ type, file }) {
  if (!file) return
  let resolvedFile = file
  if (type === 'arkuiJson' && file.name.endsWith('.dump')) {
    try {
      const initJson = await convertDumpToJson(file)
      resolvedFile = jsonToFile(initJson, 'arkui.json')
    } catch {
      ElMessage.error('dump 文件转换失败，请检查文件格式')
      return
    }
  }
  const next = { ...uploadFiles.value }
  if (type === 'arkuiJson')        next.arkuiJson    = resolvedFile
  else if (type === 'arkuiImage')  next.arkuiImage   = file
  else if (type === 'designJson')  next.designJson   = file
  else if (type === 'designImage') next.designImage  = file
  selectedCase.value = ''
  uploadFiles.value = next

  if (type === 'arkuiJson' || type === 'arkuiImage') {
    if (blobUrls.value.arkui) URL.revokeObjectURL(blobUrls.value.arkui)
    blobUrls.value = { ...blobUrls.value, arkui: next.arkuiImage ? URL.createObjectURL(next.arkuiImage) : '' }
  } else {
    if (blobUrls.value.design) URL.revokeObjectURL(blobUrls.value.design)
    blobUrls.value = { ...blobUrls.value, design: next.designImage ? URL.createObjectURL(next.designImage) : '' }
  }

  if (type === 'arkuiJson') {
    const detected = await detectPlatformFromJson(file)
    if (detected && detected !== currentPlatform.value) {
      currentPlatform.value = detected
      savePlatform(detected)
    }
  }

  if (type === 'arkuiJson' || type === 'arkuiImage') {
    if (next.arkuiJson && next.arkuiImage) triggerDevPreview(next)
  }
  if (type === 'designJson' || type === 'designImage') {
    if (next.designJson && next.designImage) triggerDesignPreview(next)
  }
}

function onDrop(e) {
  isDragOver.value = false
  assignFiles([...e.dataTransfer.files])
}

async function assignFiles(files) {
  const next = { ...uploadFiles.value }
  const unmatched = []

  for (const f of files) {
    const slot = FILE_SLOTS.find(s => s.match(f))
    if (slot) next[slot.key] = f
    else unmatched.push(f.name)
  }

  const jsonFallback  = files.filter(f => f.name.endsWith('.json'))
  const dumpFallback  = files.filter(f => f.name.endsWith('.dump'))
  const imageFallback = files.filter(f => f.type.startsWith('image/'))
  if (!next.designJson  && jsonFallback[0])  next.designJson  = jsonFallback[0]
  if (!next.arkuiJson   && jsonFallback[1])  next.arkuiJson   = jsonFallback[1]
  if (!next.arkuiJson   && dumpFallback[0])  next.arkuiJson   = dumpFallback[0]
  if (!next.designImage && imageFallback[0]) next.designImage = imageFallback[0]
  if (!next.arkuiImage  && imageFallback[1]) next.arkuiImage  = imageFallback[1]

  if (next.arkuiJson?.name.endsWith('.dump')) {
    try {
      const initJson = await convertDumpToJson(next.arkuiJson)
      next.arkuiJson = jsonToFile(initJson, 'arkui.json')
    } catch {
      ElMessage.error('dump 文件转换失败，请检查文件格式')
      return
    }
  }

  if (unmatched.length) ElMessage.info(`以下文件未能识别：${unmatched.join(', ')}`)

  selectedCase.value = ''
  uploadFiles.value  = next
  revokeBlobUrls()
  if (next.designImage) blobUrls.value.design = URL.createObjectURL(next.designImage)
  if (next.arkuiImage)  blobUrls.value.arkui  = URL.createObjectURL(next.arkuiImage)

  const devReady    = next.arkuiJson && next.arkuiImage
  const designReady = next.designJson && next.designImage

  if (devReady && designReady) {
    nextTick(runUpload)
  } else {
    if (devReady) triggerDevPreview(next)
    if (designReady) triggerDesignPreview(next)
  }
}

const designImgSrc = computed(() => blobUrls.value.design)
const arkuiImgSrc  = computed(() => blobUrls.value.arkui)

onMounted(async () => {
  debugMode.value = route.query['debugger'] === '1'
  debugPipelineOn.value = false
  debugOverlayOn.value = false

  // URL 含三参数时提前遮住上传页，避免等待 API 期间闪现
  if (route.query.deliverableId && route.query.pageId && route.query.versionId) {
    loading.value = true
  }

  let initResult = null
  try {
    initResult = await initApp(route)
  } catch (e) {
    loading.value = false
    console.error('初始化加载失败', e)
    ElMessage.warning(e?.message ?? '加载失败，请重试')
    if (e.clearUrl) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash.split('?')[0]}`)
    }
    return
  }

  currentPlatform.value = initResult.platform

  const { deliverable } = initResult
  if (deliverable) {
    try {
      deliverables.value     = deliverable.deliverableList
      pages.value            = deliverable.pageList
      workingDeliverable.value = deliverable.deliverableItem
      workingPage.value      = deliverable.currentPage
      pageVersionList.value  = deliverable.versionList
      workingVersionId.value = deliverable.urlVersionId
      await loadHistoryVersion(deliverable.currentVersion, deliverable.deviceType)
    } catch (e) {
      console.error('历史结果加载失败', e)
      ElMessage.warning('历史结果加载失败，请重试')
    } finally {
      loading.value = false
    }
    return
  }

  getConsistencyCheckDeliverables().then(list => {
    deliverables.value = (list ?? []).sort((a, b) => (b.createTime ?? 0) - (a.createTime ?? 0))
  })
})

function onPlatformSwitch(platform) {
  if (!platform || platform === currentPlatform.value) return
  currentPlatform.value = platform
  savePlatform(platform)
  selectedCase.value = ''
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

async function triggerDevPreview(files) {
  devPreview.value   = null
  devPreviewLoading.value = true
  try {
    devPreview.value = await parseDevUpload(
      files.arkuiJson,
      files.arkuiImage ?? null,
      currentPlatform.value,
    )
  } catch { /* 静默失败 */ }
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

function onAddPage() {
  workingPage.value          = { id: '__new__', name: '新增页面' }
  result.value               = null
  selectedCase.value         = ''
  activeDiff.value           = null
  selectedPair.value         = null
  lockedNodeIds.value        = new Set()
  devPreview.value           = null
  designPreview.value        = null
  devPreviewLoading.value    = false
  designPreviewLoading.value = false
  devReuploading.value       = false
  designReuploading.value    = false
  revokeBlobUrls()
  uploadFiles.value = { designJson: null, arkuiJson: null, designImage: null, arkuiImage: null }
}

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

async function submitRerunVersion() {
  const pageId = workingPage.value?.id
  if (!pageId || pageId === '__new__') return
  try {
    const now = formatDateTime(new Date())
    const [devBase64, designBase64, devJsonStr, designJsonStr] = await Promise.all([
      fileToBase64(uploadFiles.value.arkuiImage),
      fileToBase64(uploadFiles.value.designImage),
      fileToText(uploadFiles.value.arkuiJson),
      fileToText(uploadFiles.value.designJson),
    ])
    await addConsistencyCheckPage({
      id:                    String(pageId),
      deliverableId:         String(workingDeliverable.value?.id ?? ''),
      name:                  workingPage.value?.name ?? '',
      deviceType:            currentPlatform.value,
      versionName:           now,
      devImageBase64Data:    devBase64,
      devJson:               devJsonStr,
      designImageBase64Data: designBase64,
      designJson:            designJsonStr,
      problems:              buildProblems(result.value),
    })

    const pageResult = await getResultsByPageId(pageId, 1, 999)
    pageVersionList.value  = pageResult?.list ?? []
    const versionId = Array.isArray(pageResult?.list) ? pageResult.list[0]?.id : null
    workingVersionId.value = versionId ?? null

    const dId = workingDeliverable.value?.id
    if (dId && versionId) {
      const hashPath = window.location.hash.split('?')[0]
      window.history.replaceState(null, '', `${window.location.pathname}${hashPath}?deliverableId=${dId}&pageId=${pageId}&versionId=${versionId}`)
    }
  } catch (e) {
    console.error('重新对比存档失败', e)
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
    submitRerunVersion()
  } catch (e) {
    ElMessage.error(`分析失败：${e.response?.data?.error || e.message}`)
  } finally {
    rerunLoading.value = false
  }
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

function nodeDiffsFor(key, nodeId) {
  return (result.value?.diffs ?? []).filter(d => d[key] === nodeId)
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

    const rawDesignJson = data._rawDesignJson
    const rawDevContent = data._rawDevContent
    const devImgExt     = data._devImgExt || 'png'
    delete data._rawDesignJson
    delete data._rawDevContent
    delete data._devImgExt
    result.value = data

    const designJsonFile = jsonToFile(rawDesignJson, 'design.json')
    const devJsonFile    = jsonToFile(rawDevContent,  'arkui.json')

    const arkuiImgUrl  = imageUrl(id, 'arkui',  currentPlatform.value)
    const designImgUrl = imageUrl(id, 'design', currentPlatform.value)
    const [arkuiImgBlob, designImgBlob] = await Promise.all([
      fetch(arkuiImgUrl).then(r => r.blob()),
      fetch(designImgUrl).then(r => r.blob()),
    ])
    const arkuiImgFile  = new File([arkuiImgBlob],  `arkui.${devImgExt}`,  { type: arkuiImgBlob.type  || `image/${devImgExt}` })
    const designImgFile = new File([designImgBlob], 'design.png', { type: designImgBlob.type || 'image/png' })

    uploadFiles.value = {
      designJson:  designJsonFile,
      arkuiJson:   devJsonFile,
      designImage: designImgFile,
      arkuiImage:  arkuiImgFile,
    }

    blobUrls.value = {
      arkui:  URL.createObjectURL(arkuiImgBlob),
      design: URL.createObjectURL(designImgBlob),
    }
    submitResult()
  }
  catch (e) { ElMessage.error(`分析失败：${e.response?.data?.error || e.message}`) }
  finally    { loading.value = false }
}

async function loadHistoryVersion(version, deviceType) {
  const [devJsonData, designJsonData] = await Promise.all([
    fetchVersionJson(version.devJsonUrl),
    fetchVersionJson(version.designJsonUrl),
  ])

  const devImageFile    = base64ToFile(version.devBase64Data,    'arkui.jpg')
  const designImageFile = base64ToFile(version.designBase64Data, 'design.jpg')
  const devJsonFile     = jsonToFile(devJsonData,    'arkui.json')
  const designJsonFile  = jsonToFile(designJsonData, 'design.json')

  const [devParsed, designParsed] = await Promise.all([
    parseDevUpload(devJsonFile, devImageFile, deviceType),
    parseDesignUpload(designJsonFile, designImageFile, deviceType),
  ])

  const diffs = (version.problems ?? []).map(p => {
    try { return JSON.parse(p.data) } catch { return null }
  }).filter(Boolean)

  const pairMap = new Map()
  for (const diff of diffs) {
    if (!diff.arkuiNodeId || !diff.designNodeId) continue
    const key = `${diff.arkuiNodeId}::${diff.designNodeId}`
    if (!pairMap.has(key)) pairMap.set(key, { arkuiNodeId: diff.arkuiNodeId, designNodeId: diff.designNodeId })
  }
  const arkuiNodeMap  = new Map((devParsed.nodes  ?? []).map(n => [n.id, n]))
  const designNodeMap = new Map((designParsed.nodes ?? []).map(n => [n.id, n]))
  const pairs = [...pairMap.values()]
    .map(p => ({ arkui: arkuiNodeMap.get(p.arkuiNodeId), design: designNodeMap.get(p.designNodeId) }))
    .filter(p => p.arkui && p.design)

  const errorCount   = diffs.filter(d => d.severity === 'error').length
  const warningCount = diffs.filter(d => d.severity === 'warning').length

  result.value = {
    pairs,
    diffs,
    canvas:               { arkui: devParsed.canvas, design: designParsed.canvas },
    stats:                { errorCount, warningCount },
    allArkuiNodes:        devParsed.nodes  ?? [],
    allDesignNodes:       designParsed.nodes ?? [],
    unmatchedDesignNodes: [],
  }
  blobUrls.value = { arkui: version.devBase64Data, design: version.designBase64Data }
  uploadFiles.value = {
    designJson:  designJsonFile,
    arkuiJson:   devJsonFile,
    designImage: designImageFile,
    arkuiImage:  devImageFile,
  }
}

// 统一的交付件切换逻辑（上传页 + 报告页共用）
async function onSelectDeliverable(d) {
  workingDeliverable.value = d
  const pageList = await getPagesByDeliverableId(String(d.id))
  pages.value = Array.isArray(pageList)
    ? pageList.slice().sort((a, b) => (b.createTime ?? 0) - (a.createTime ?? 0))
    : []
  if (pages.value.length === 0) return
  await onSelectPage(pages.value[0])
}

// 统一的页面切换逻辑
async function onSelectPage(page) {
  workingPage.value = page
  const versionResult = await getResultsByPageId(page.id, 1, 999)
  pageVersionList.value  = versionResult?.list ?? []
  const version = versionResult?.list?.[0]
  workingVersionId.value = version?.id ?? null
  if (!version) return
  loading.value = true
  try {
    await loadHistoryVersion(version, page.deviceType ?? 'hmPhone')
    const dId = workingDeliverable.value?.id
    if (dId && page.id && version.id) {
      const hashPath = window.location.hash.split('?')[0]
      const params = `deliverableId=${dId}&pageId=${page.id}&versionId=${version.id}`
      window.history.replaceState(null, '', `${window.location.pathname}${hashPath}?${params}`)
    }
  } catch (e) {
    console.error('加载历史版本失败', e)
    ElMessage.warning('加载历史版本失败')
  } finally {
    loading.value = false
  }
}

function onHistoryView(item) {
  const dId = workingDeliverable.value?.id
  const pId = workingPage.value?.id
  if (!dId || !pId) return
  const hashPath = window.location.hash.split('?')[0]
  const params = `deliverableId=${dId}&pageId=${pId}&versionId=${item.id}`
  window.history.replaceState(null, '', `${window.location.pathname}${hashPath}?${params}`)
  window.location.reload()
}

async function submitResult() {
  try {
    const isNewPage = workingPage.value?.id === '__new__' && !!workingDeliverable.value?.id
    const now = formatDateTime(new Date())
    let deliverableId

    if (isNewPage) {
      // 新增页面：当前交付件下新建，跳过步骤 1-3
      deliverableId = String(workingDeliverable.value.id)
    } else {
      // 正常存档：新建交付件（步骤 1-3）
      const teams = await getTeamList()
      const teamId = Array.isArray(teams) ? teams[0]?.teamId : null
      if (!teamId) return

      const sonTeams = await getSonListByTeamId(teamId)
      const subTeamId = Array.isArray(sonTeams) ? sonTeams[0]?.teamId : null
      if (!subTeamId) return

      deliverableId = await addConsistencyCheckDeliverable(String(subTeamId), now)
      if (!deliverableId) return
    }

    // 步骤 4：新建页面
    const existingPages = await getPagesByDeliverableId(String(deliverableId))
    const pageCount = Array.isArray(existingPages) ? existingPages.length : 0
    const pageName = `page${pageCount + 1}`

    const [devBase64, designBase64, devJsonStr, designJsonStr] = await Promise.all([
      fileToBase64(uploadFiles.value.arkuiImage),
      fileToBase64(uploadFiles.value.designImage),
      fileToText(uploadFiles.value.arkuiJson),
      fileToText(uploadFiles.value.designJson),
    ])

    const pageId = await addConsistencyCheckPage({
      deliverableId:         String(deliverableId),
      name:                  pageName,
      deviceType:            currentPlatform.value,
      versionName:           now,
      devImageBase64Data:    devBase64,
      devJson:               devJsonStr,
      designImageBase64Data: designBase64,
      designJson:            designJsonStr,
      problems:              buildProblems(result.value),
    })
    if (!pageId) return

    // 步骤 5：取 versionId，同时更新页面版本列表
    const pageResult = await getResultsByPageId(pageId, 1, 999)
    pageVersionList.value  = pageResult?.list ?? []
    const versionId  = Array.isArray(pageResult?.list) ? pageResult.list[0]?.id : null
    workingVersionId.value = versionId ?? null

    // 步骤 6：刷新页面列表
    const pageList = await getPagesByDeliverableId(String(deliverableId))
    pages.value = Array.isArray(pageList)
      ? pageList.slice().sort((a, b) => (b.createTime ?? 0) - (a.createTime ?? 0))
      : []
    workingPage.value = pages.value.find(p => String(p.id) === String(pageId)) ?? null

    // 非新增页面：同步刷新交付件列表和选中态
    if (!isNewPage) {
      const deliverableList = await getConsistencyCheckDeliverables()
      deliverables.value = (deliverableList ?? []).sort((a, b) => (b.createTime ?? 0) - (a.createTime ?? 0))
      workingDeliverable.value = deliverables.value.find(d => String(d.id) === String(deliverableId)) ?? null
    }

    // 步骤 7：更新 URL
    if (deliverableId && pageId && versionId) {
      const hashPath = window.location.hash.split('?')[0]
      const params = `deliverableId=${deliverableId}&pageId=${pageId}&versionId=${versionId}`
      window.history.replaceState(null, '', `${window.location.pathname}${hashPath}?${params}`)
    }
  } catch (e) {
    console.error('提交结果失败', e)
  }
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
    submitResult()
  } catch (e) { ElMessage.error(`分析失败：${e.response?.data?.error || e.message}`) }
  finally     { loading.value = false }
}

function onDiffSelect(diff) {
  activeDiff.value = diff
  if (!diff) {
    selectedPair.value = null
  } else if (!diff.property?.startsWith('spacing.')) {
    const pair = result.value?.pairs?.find(p =>
      p.design.id === diff.designNodeId && p.arkui.id === diff.arkuiNodeId
    )
    selectedPair.value = pair || null
  }
  // spacing diff 不触发节点高亮
}
</script>
