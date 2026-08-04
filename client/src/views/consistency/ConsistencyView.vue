<template>
  <AppLayout>
    <!-- loading 遮罩，覆盖整个 app-body -->
    <div v-if="loading || saveDebounce.loading.value || rerunDebounce.loading.value || caseDebounce.loading.value || uploadDebounce.loading.value || historyDebounce.loading.value" class="center-placeholder-wrapper">
      <div class="center-placeholder">
        <OctoLoading :size="48" />
        <p>{{ saveDebounce.loading.value ? '存储中' : historyDebounce.loading.value ? '加载中' : rerunDebounce.loading.value ? '对比中' : caseDebounce.loading.value ? '加载中' : uploadDebounce.loading.value ? '上传中' : '加载中' }}</p>
      </div>
    </div>

    <!-- AI 侧边面板（与 main 同级，在布局流中推挤画布） -->
    <AiChatDrawer ref="aiChatDrawerRef" :open="aiChatOpen" @close="aiChatOpen = false" @toggle="aiChatOpen = !aiChatOpen" @report-ready="onAiReportReady" @reset-report="aiReportData = null" @loading-start="aiLoading = true" @loading-end="aiLoading = false" />

    <div class="ai-center-wrapper">
      <!-- AI 分析中遮罩 -->
      <div v-if="aiLoading" class="center-placeholder-wrapper">
        <div class="center-placeholder">
          <OctoLoading :size="48" />
          <p>生成中...</p>
        </div>
      </div>

      <!-- 中间主区（正常模式） -->
      <main v-show="!showAiReport" class="center-panel up-board ai-main-wrap">

        <!-- 画布内容区（被 AI 面板推挤） -->
        <div class="ai-canvas-area">
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
          @replace-design="onReplaceDesign"
          @page-renamed="onPageRenamed"
        />

        <UploadPage
          v-if="!result"
          ref="uploadPageRef"
          :upload-files="uploadFiles"
          :dev-preview="devPreview"
          :design-preview="designPreview"
          :dev-preview-loading="devPreviewLoading"
          :design-preview-loading="designPreviewLoading"
          :blob-dev-src="blobUrls.arkui"
          :blob-design-src="blobUrls.design"
          @step-picked="onStepPicked"
        />

        <ReportPage
          v-if="result"
          ref="reportPageRef"
          :result="result"
          :arkui-img-src="arkuiImgSrc"
          :design-img-src="designImgSrc"
          :design-nodes="designNodes"
          :all-arkui-nodes="allArkuiNodes"
          :arkui-nodes="arkuiNodes"
          :active-diff="activeDiff"
          :debug-pair-items="debugPairItems"
          :debug-pair-map="debugPairMap"
          :selected-design-diffs="selectedDesignDiffs"
          :selected-arkui-diffs="selectedArkuiDiffs"
          :selected-case="selectedCase"
          :case-names="CASE_NAMES"
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
          :hover-arkui-spacing-marks="hoverArkuiSpacingMarks"
          :hover-design-spacing-marks="hoverDesignSpacingMarks"
          @select-case="selectCase"
          @arkui-node-click="onArkuiNodeClick"
          @design-node-click="onDesignNodeClick"
          @step-picked="onStepPicked"
          @arkui-hover="onArkuiHover"
          @design-hover="onDesignHover"
          @save-manual-style="onSaveManualStyle"
          @remove-manual-style="onRemoveManualStyle"
          @clear-active-diff="onCanvasClearActiveDiff"
        />
        </div>
      </main>

    <!-- 右侧面板（正常模式） -->
    <aside v-show="!showAiReport" class="right-panel up-right-panel" style="position: relative;">
      <UploadPanel
        v-if="!result"
        :loading="loading"
        :selected-case="selectedCase"
        :case-names="CASE_NAMES"
        :upload-files="uploadFiles"
        @run-upload="runUpload"
        @select-case="selectCase"
        @platform-switch="onPlatformSwitch"
      />
      <ReportPanel
        v-if="result"
        :result="result"
        :active-pair-for-diff="activePairForDiff"
        :hover-pair-for-diff="hoverPairForDiff"
        :design-nodes="designNodes"
        :all-arkui-nodes="allArkuiNodes"
        :rerun-loading="rerunLoading"
        :can-rerun="canRerun"
        :version-list="pageVersionList"
        :working-version-id="workingVersionId"
        :close-history-key="closeHistoryKey"
        :merged-diffs="mergedDiffs"
        :deselect-tick="deselectTick"
        :report-canvas-mode="canvasMode.mode"
        :has-manual-edits="hasManualInReport"
        :saving-loading="saveDebounce.loading.value"
        @diff-select="onDiffSelect"
        @diff-hover="hoveredDiffPair = $event"
        @design-node-click="onDesignNodeClick"
        @arkui-node-click="onArkuiNodeClick"
        @rerun="rerunCheck"
        @history-view="onHistoryView"
        @temp-diff-action="mergeTempToResult"
        @save="onSave"
      />
    </aside>

    <!-- AI 报告视图（替换正常 main+aside） -->
    <AiReportView
      v-show="showAiReport"
      :report-data="aiReportData"
      :design-selected-id="aiDesignSelectedId"
      :dev-selected-id="aiDevSelectedId"
      :design-hover-id="aiDesignHoverId"
      :dev-hover-id="aiDevHoverId"
      :active-pair="aiActivePair"
      :hover-pair="aiHoverPair"
      :platform="platformStore.currentPlatform"
      @select="onAiDiffSelect"
      @diff-hover="onAiDiffHover"
      @exit="aiChatDrawerRef?.resetAll()"
    />
    </div>

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
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import OctoLoading from './components/common/OctoLoading.vue'
import { checkCase, checkUpload, matchNodes, imageUrl, parseDevUpload, parseDesignUpload, convertDumpToJson } from '../../api/index.ts'
import { getTeamList, getSonListByTeamId, addConsistencyCheckDeliverable, addConsistencyCheckPage, getResultsByPageId, getPagesByDeliverableId, getConsistencyCheckDeliverables, fetchVersionJson } from '../../api/api.ts'
import { ADMIN_BASE_URL } from '../../api/adminEnv.ts'
import {
  formatDateTime, fileToBase64, fileToText, buildProblems, adaptLegacyProblem, jsonToFile, resolveImageFile,
  isBlankLikeNode, isInteractiveImageNode, isSelectableNode, resolveSelectableNode, getUserAccount, inIframe,
  useDebounceLoading, computeSpacingMarks,
} from '../utils/tools.ts'
import { initApp } from './init/index'
import { UXLINT_CHECKLIST_EVENT } from './init/detectIframe'
import { processUxlintCheckList } from './init/processUxlintCheckList'
import { setUrlParams, removeUrlParams } from '../utils/urlParams'
import { parseOverrideValue } from './match/overrideValidator'
import { generateManualDiff, formatStyleValue } from './match/compareNodes'
import { savePlatform } from './init/restorePlatform'
import AppLayout from './components/AppLayout.vue'
import AiChatDrawer from './components/AiChatDrawer.vue'
import AiReportView from './components/AiReportView.vue'
import ConsistencyTabbar from './components/ConsistencyTabbar.vue'
import UploadPage from './components/UploadPage.vue'
import ReportPage from './components/ReportPage.vue'
import UploadPanel from './components/UploadPanel.vue'
import ReportPanel from './components/ReportPanel.vue'
import '../../styles/app.css'
import { CASE_NAMES_BY_PLATFORM, DEBUG_COLORS, TEXT_STYLE_OPTIONS, CONTAINER_STYLE_OPTIONS } from '../utils/constants'
import { reportInteraction } from '../utils-inner/report'
import { useCanvasModeStore, useSelectionStore, usePlatformStore, useTempResultStore } from '../../stores'
import { useDebugStore } from '../../stores/debug'

const route           = useRoute()
const platformStore = usePlatformStore()
const tempResultStore = useTempResultStore()
const CASE_NAMES      = computed(() => CASE_NAMES_BY_PLATFORM[platformStore.currentPlatform] || {})
const selectedCase    = ref('')
const loading         = ref(false)
const result          = ref(null)
const activeDiff      = ref(null)
const deselectTick   = ref(0)
const uploadPageRef   = ref(null)

function onCanvasClearActiveDiff() {
  activeDiff.value = null
  deselectTick.value++
}
const aiChatOpen      = ref(false)
const aiChatDrawerRef = ref(null)
const aiReportData    = ref(null)
const aiLoading       = ref(false)
const showAiReport    = computed(() => !!aiReportData.value)

function onAiReportReady(data) {
  aiReportData.value = data
}

// ── AI 报告联动状态 ──────────────────────────────────────────────────────────
const aiActivePair = ref(null)
const aiHoverPair  = ref(null)

const aiDesignSelectedId = computed(() => aiActivePair.value?.designNodeId ?? null)
const aiDevSelectedId     = computed(() => aiActivePair.value?.arkuiNodeId ?? null)
const aiDesignHoverId    = computed(() => aiHoverPair.value?.designNodeId ?? null)
const aiDevHoverId       = computed(() => aiHoverPair.value?.arkuiNodeId ?? null)

function onAiDiffSelect(diff) {
  aiActivePair.value = diff
    ? { designNodeId: diff.designNodeId, arkuiNodeId: diff.arkuiNodeId }
    : null
}
function onAiDiffHover(pair) {
  aiHoverPair.value = pair
}
const debugStore = useDebugStore()
const selectionStore = useSelectionStore()
const rerunLoading      = ref(false)
const reportPageRef     = ref(null)

const saveDebounce = useDebounceLoading()
const rerunDebounce = useDebounceLoading()
const caseDebounce = useDebounceLoading()
const uploadDebounce = useDebounceLoading()
const historyDebounce = useDebounceLoading()
/** 当前可用的匹配对：temp 激活时用 tempPairs，否则用正式 pairs */
const effectivePairs    = computed(() => tempResultStore.tempPairs ?? result.value?.pairs ?? [])
const builtinStyleKeys   = new Set([...TEXT_STYLE_OPTIONS.map(o => o.value), ...CONTAINER_STYLE_OPTIONS.map(o => o.value)])
function diffKey(d) {
  if (d.spaceId) return `space|${d.spaceId}`
  return `${d.designNodeId ?? ''}|${d.arkuiNodeId ?? ''}|${d.property}`
}

function serializeSnapshot(r, manual, allDiffs) {
  const diffs = (allDiffs ?? [])
    .map(d => [diffKey(d), d.designValue ?? '', d.arkuiValue ?? '', d.severity ?? '', d._isManual ?? false, d.diffSource ?? ''])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const pairs = (r?.pairs ?? [])
    .map(p => [`${p.design?.id ?? ''}|${p.arkui?.id ?? ''}`, p.confidence ?? '', p.matchDetail?.pass ?? '', p.matchDetail?.type ?? ''])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return JSON.stringify({ diffs, pairs, manual })
}

const initialSnapshot = ref('')

function snapshotInitial() {
  initialSnapshot.value = result.value
    ? serializeSnapshot(result.value, nodeManualAttr.value, mergedDiffs.value)
    : ''
}

const hasManualInReport = computed(() => {
  if (!result.value) return false
  return serializeSnapshot(result.value, nodeManualAttr.value, mergedDiffs.value) !== initialSnapshot.value
})

// 从节点树上收集所有人工覆盖属性，结构：{ dev: { id: { key: val } }, design: { id: { key: val } } }
const nodeManualAttr = computed(() => {
  const dev = {}
  const design = {}
  for (const n of result.value?.allArkuiNodes ?? []) {
    if (n.manualStyle && Object.keys(n.manualStyle).length) {
      dev[n.id] = { ...n.manualStyle }
    }
  }
  for (const n of result.value?.allDesignNodes ?? []) {
    if (n.manualStyle && Object.keys(n.manualStyle).length) {
      design[n.id] = { ...n.manualStyle }
    }
  }
  return { dev, design }
})

// ── 统一 diff/pairs 合并 ──────────────────────────────────────────────────────

function mergePairs(existingPairs, tempPairs) {
  const arkuiMap = new Map()
  const designMap = new Map()
  for (const p of existingPairs) {
    if (p.arkui?.id) arkuiMap.set(p.arkui.id, p)
    if (p.design?.id) designMap.set(p.design.id, p)
  }
  for (const p of tempPairs) {
    if (p.arkui?.id) arkuiMap.set(p.arkui.id, p)
    if (p.design?.id) designMap.set(p.design.id, p)
  }
  const pairKeySet = new Set()
  const merged = []
  for (const p of arkuiMap.values()) {
    const key = `${p.design?.id}|${p.arkui?.id}`
    if (pairKeySet.has(key)) continue
    const designPair = p.design?.id ? designMap.get(p.design.id) : null
    if (designPair && designPair.arkui?.id === p.arkui?.id) {
      pairKeySet.add(key)
      merged.push(p)
    }
  }
  return merged
}

/**
 * 从节点 manualStyle 全量重建 edit 池（editDiffs ref）。
 * 基于当前 result.value 的 pairs + 节点树，不依赖外部传参。
 * 内置 key 走 generateManualDiff（含 _isResolved 处理）；
 * 非内置 key 直接构造单侧 diff。
 */
function rebuildEditDiffs() {
  if (!result.value) { editDiffs.value = []; resolvedKeys.value = new Set(); return }
  const allDesignNodes = result.value.allDesignNodes ?? []
  const allArkuiNodes  = result.value.allArkuiNodes  ?? []
  const pairs          = result.value.pairs ?? []
  const platform       = platformStore.currentPlatform
  const diffs = []
  const resolved = new Set()

  const buildOne = (designNodeId, arkuiNodeId, property, designNode, arkuiNode) => {
    if (builtinStyleKeys.has(property) && designNode && arkuiNode) {
      const diff = generateManualDiff({ design: designNode, arkui: arkuiNode }, property, platform)
      if (diff) {
        diffs.push(diff)
      } else {
        // generateManualDiff 返回 null 且有 manualStyle → 值一致，记录已解决
        if (designNode?.manualStyle?.[property] !== undefined || arkuiNode?.manualStyle?.[property] !== undefined) {
          resolved.add(`${property}|${designNodeId}|${arkuiNodeId}`)
        }
      }
      return
    }
    let mySide, myNode
    if (designNode?.manualStyle?.[property] !== undefined) { mySide = 'design'; myNode = designNode }
    else if (arkuiNode?.manualStyle?.[property] !== undefined) { mySide = 'arkui'; myNode = arkuiNode }
    else return
    const otherSide = mySide === 'design' ? 'arkui' : 'design'
    diffs.push({
      property,
      [`${mySide}Value`]:    formatStyleValue(property, myNode.manualStyle[property], platform),
      [`${otherSide}Value`]: '—',
      severity:     'warning',
      confidence:   'high',
      designNodeId,
      arkuiNodeId,
      _isManual:    true,
      diffSource:   'edit-diff',
      textContent:  myNode.textContent ?? myNode.name ?? '',
      designName:   designNode?.name,
      [`${mySide}Name`]: myNode.name,
    })
  }

  for (const n of allDesignNodes) {
    if (!n.manualStyle) continue
    const pair = pairs.find(p => p.design?.id === n.id)
    for (const key of Object.keys(n.manualStyle)) {
      buildOne(n.id, pair?.arkui?.id ?? null, key, n, pair?.arkui ?? null)
    }
  }
  for (const n of allArkuiNodes) {
    if (!n.manualStyle) continue
    const pair = pairs.find(p => p.arkui?.id === n.id)
    for (const key of Object.keys(n.manualStyle)) {
      if (pair?.design?.manualStyle?.[key] !== undefined) continue
      buildOne(pair?.design?.id ?? null, n.id, key, pair?.design ?? null, n)
    }
  }

  editDiffs.value = diffs
  resolvedKeys.value = resolved
}

// ── 三池 diff 架构 ─────────────────────────────────────────────────────────────
// 算法池：result.value.diffs（后端全量跑的原始算法 diff，只读不可变）
// select 池：selectDiffs（select 局部对比结果，节点级覆盖算法池）
// edit 池：editDiffs（edit 人工标注，三元组级覆盖 select 池/算法池）
// resolvedKeys：值一致的已解决三元组集合（不生成 diff 卡片，但需删除算法池对应条目）
const selectDiffs = ref([])
const editDiffs   = ref([])
const resolvedKeys = ref(new Set())

/**
 * 将算法池、select 池、edit 池按优先级叠加（edit > select > 算法）。
 * - select 池节点级覆盖：selectDiffs 涉及的节点 id 集合，算法池中命中该集合的 diff 被排除
 * - edit 池三元组级覆盖：editDiffs 的 (property, designNodeId, arkuiNodeId) 集合，前序结果命中则排除
 */
function overlayDiffs(algorithmDiffs, selDiffs, edtDiffs, resolvedSet) {
  const selectCoverIds = new Set()
  for (const d of selDiffs) {
    if (d.designNodeId) selectCoverIds.add(d.designNodeId)
    if (d.arkuiNodeId)  selectCoverIds.add(d.arkuiNodeId)
  }
  const base = (algorithmDiffs ?? []).filter(d =>
    !selectCoverIds.has(d.designNodeId) && !selectCoverIds.has(d.arkuiNodeId)
  )
  const selectAndAlgo = [...base, ...selDiffs]

  const editKeys = new Set(edtDiffs.map(d => `${d.property}|${d.designNodeId ?? ''}|${d.arkuiNodeId ?? ''}`))
  const withoutEdit = selectAndAlgo.filter(d => {
    const k = `${d.property}|${d.designNodeId ?? ''}|${d.arkuiNodeId ?? ''}`
    if (editKeys.has(k)) return false      // edit 池覆盖
    if (resolvedSet?.has(k)) return false  // 已解决，直接删除
    return true
  })
  return [...withoutEdit, ...edtDiffs]
}

const canvasMode = useCanvasModeStore()
const devReuploading    = ref(false)
const designReuploading = ref(false)

const mergedDiffs = computed(() => {
  if (canvasMode.mode === 'select' && tempResultStore.tempDiffs) return tempResultStore.tempDiffs
  return overlayDiffs(result.value?.diffs ?? [], selectDiffs.value, editDiffs.value, resolvedKeys.value)
})

watch(() => result.value, () => {
  tempResultStore.clear()
  // selectDiffs 由各场景手动清空/赋值（selectCase / rerunCheck 清空，loadHistoryVersion 赋值）
  // editDiffs 基于 result 新 pairs + 节点树重建
  rebuildEditDiffs()
  // 快照基线需在 rebuild 后记录，确保 mergedDiffs 已反映新 edit 池
  snapshotInitial()
})

const deliverables     = ref([])
const pages            = ref([])
const workingDeliverable  = ref(null)
const workingPage         = ref(null)
const pageVersionList     = ref([])
const workingVersionId    = ref(null)
const closeHistoryKey     = ref(0)
let stopListenFn = null

// 单版本预处理：优先使用 nodeMatchs，回退到兼容旧格式 problems 末尾的 matchedPairIds 特殊项
function preprocessVersion(v) {
  if (!v || (v._matchedPairIds !== undefined && v._nodeManualAttr !== undefined)) return v

  // 新格式：nodeMatchs 独立字段（优先级最高）
  if (v.nodeMatchs) {
    try {
      const parsed = JSON.parse(v.nodeMatchs)
      const matchedPairIds = JSON.stringify(parsed.matchedPairIds ?? [])
      const nodeManualAttr = parsed.nodeManualAttr ?? null
      const problems = [...(v.problems ?? [])]
      // 库存数据可能仍有旧格式特殊项，清理掉
      const idx = problems.findIndex(p => p.id === 'matchedPairIds')
      if (idx >= 0) problems.splice(idx, 1)
      return { ...v, problems, _matchedPairIds: matchedPairIds, _nodeManualAttr: nodeManualAttr }
    } catch { /* 解析失败则回退 */ }
  }

  // 旧格式兼容（存量数据无 nodeMatchs 时）
  const problems = [...(v.problems ?? [])]
  const idx = problems.findIndex(p => p.id === 'matchedPairIds')
  const matchedPairIds = idx >= 0 ? problems[idx].data : null
  if (idx >= 0) problems.splice(idx, 1)
  return { ...v, problems, _matchedPairIds: matchedPairIds, _nodeManualAttr: null }
}

function preprocessVersionList(list) {
  return (list ?? []).map(preprocessVersion)
}

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
  if (!selectionStore.selectedPair) return null
  return {
    designNodeId: selectionStore.selectedPair.design?.id ?? null,
    arkuiNodeId:  selectionStore.selectedPair.arkui?.id  ?? null,
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
  const pair = effectivePairs.value.find(p => p.arkui?.id === hoveredArkuiNodeId.value)
  return pair?.design?.id ?? null
})

const hoveredArkuiCrossId = computed(() => {
  if (hoveredDiffPair.value?.arkuiNodeId) return hoveredDiffPair.value.arkuiNodeId
  if (!hoveredDesignNodeId.value) return null
  const pair = effectivePairs.value.find(p => p.design?.id === hoveredDesignNodeId.value)
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

// ── hover 实时间距计算 ────────────────────────────────────────────────────────

const hoverArkuiSpacingMarks = computed(() => {
  const selNode = selectionStore.selectedPair?.arkui
  if (!selNode?.rect) return []
  const hoverId = hoveredArkuiNodeId.value || hoveredArkuiCrossId.value
  if (!hoverId || hoverId === selNode.id) return []
  // 优先从 pairs 中取坐标，保证与 selectedPair 同源，避免不同数据流坐标系不一致
  const hoverNode = effectivePairs.value.find(p => p.arkui?.id === hoverId)?.arkui
                 ?? allArkuiNodes.value.find(n => n.id === hoverId)
  return hoverNode?.rect ? computeSpacingMarks(selNode.rect, hoverNode.rect, null, null) : []
})

const hoverDesignSpacingMarks = computed(() => {
  const selNode = selectionStore.selectedPair?.design
  if (!selNode?.rect) return []
  const hoverId = hoveredDesignNodeId.value || hoveredDesignCrossId.value
  if (!hoverId || hoverId === selNode.id) return []
  // 优先从 pairs 中取坐标，保证与 selectedPair 同源，避免不同数据流坐标系不一致
  const hoverNode = effectivePairs.value.find(p => p.design?.id === hoverId)?.design
                 ?? designNodes.value.find(n => n.id === hoverId)
  return hoverNode?.rect ? computeSpacingMarks(selNode.rect, hoverNode.rect, selNode.size, hoverNode.size) : []
})
const arkuiNodes  = computed(() =>
  (allArkuiNodes.value.length ? allArkuiNodes.value : result.value?.pairs?.map(p => p.arkui) ?? [])
    .filter(node => !isBlankLikeNode(node) && isInteractiveImageNode(node))
)

const selectedDesignDiffs = computed(() =>
  selectionStore.selectedPair?.design?.id
    ? nodeDiffsFor('designNodeId', selectionStore.selectedPair.design.id)
    : []
)

const selectedArkuiDiffs = computed(() =>
  selectionStore.selectedPair?.arkui?.id
    ? nodeDiffsFor('arkuiNodeId', selectionStore.selectedPair.arkui.id)
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

function cleanup() {
  revokeBlobUrls()
  if (stopListenFn) stopListenFn()
  window.removeEventListener(UXLINT_CHECKLIST_EVENT, onUxlintCheckList)
}

onUnmounted(cleanup)

async function resolveArkuiJsonFile(file) {
  if (!file.name.endsWith('.dump')) return file
  const initJson = await convertDumpToJson(file)
  return jsonToFile(initJson, 'arkui.json')
}

async function applyPlatformDetection(file) {
  const detected = await detectPlatformFromJson(file)
  const isExistingPage = workingPage.value && workingPage.value.id !== '__new__'
  if (isExistingPage && detected) {
    const expectedType = workingPage.value.deviceType ?? 'hmPhone'
    if (detected !== expectedType) {
      const PLATFORM_NAMES = { hmPhone: '鸿蒙-手机', hmWatch: '鸿蒙-手表', web: 'Web' }
      ElMessage.error(`请上传 ${PLATFORM_NAMES[expectedType] ?? expectedType} 平台的数据`)
      return false
    }
  } else if (detected && detected !== platformStore.currentPlatform) {
    platformStore.setPlatform(detected)
    savePlatform(detected)
    reportPlatformChange(detected)
  }
  return true
}

async function onStepPicked({ type, file }) {
  if (!file) return
  let resolvedFile = file
  if (type === 'arkuiJson') {
    try { resolvedFile = await resolveArkuiJsonFile(file) }
    catch { ElMessage.error('dump 文件转换失败，请检查文件格式'); return }
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
    const ok = await applyPlatformDetection(resolvedFile)
    if (!ok) { uploadFiles.value = { ...uploadFiles.value, arkuiJson: null }; return }
  }

  if (type === 'arkuiJson' || type === 'arkuiImage') {
    if (next.arkuiJson && next.arkuiImage) triggerDevPreview(next)
  }
  if (type === 'designJson' || type === 'designImage') {
    if (next.designJson && next.designImage) triggerDesignPreview(next)
  }
}


const designImgSrc = computed(() => blobUrls.value.design)
const arkuiImgSrc  = computed(() => blobUrls.value.arkui)

// 处理 iframe 父页面下发的 uxlint checkList：批量创建交付件/页面，展示最后一个页面的空结果
async function onUxlintCheckList(e) {
  const list = e.detail
  loading.value = true
  try {
    const checkResult = await processUxlintCheckList(list)

    deliverables.value       = checkResult.deliverableList
    workingDeliverable.value = checkResult.deliverableList.find(d => String(d.id) === checkResult.deliverableId) ?? null
    pages.value              = checkResult.pageList
    workingPage.value        = checkResult.lastPage
    workingVersionId.value   = checkResult.lastVersion?.id ? String(checkResult.lastVersion.id) : null

    // 复用历史版本渲染：开发侧有数据 → 画布；设计侧为空 → 卡片
    if (checkResult.lastVersion) {
      await loadHistoryVersion(checkResult.lastVersion, 'hmPhone')
    }
  } catch (err) {
    console.error('[uxlint] 处理失败', err)
    ElMessage.error('uxlint 数据处理失败，请检查控制台')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  debugStore.setDebugMode(route.query['debugger'] === '1')
  debugStore.setDebugPipelineOn(false)
  debugStore.setDebugOverlayOn(false)

  // URL 含三参数时提前遮住上传页，避免等待 API 期间闪现
  if (route.query.deliverableId && route.query.pageId) {
    loading.value = true
  }

  // 监听 iframe 父页面下发的 uxlint checkList 事件
  window.addEventListener(UXLINT_CHECKLIST_EVENT, onUxlintCheckList)

  let initResult = null
  try {
    initResult = await initApp(route)
  } catch (e) {
    loading.value = false
    console.error('初始化加载失败', e)
    ElMessage.warning(e?.message ?? '加载失败，请重试')
    if (e.clearUrl) {
      removeUrlParams(['deliverableId', 'pageId'])
    }
    return
  }

  // 保存 iframe 清理函数
  stopListenFn = initResult.stopListenFn

  platformStore.setPlatform(initResult.platform)

  const { deliverable } = initResult
  if (deliverable) {
    // 历史报告的平台以实际数据为准，覆盖 localStorage 缓存的平台值
    if (deliverable.deviceType && deliverable.deviceType !== platformStore.currentPlatform) {
      platformStore.setPlatform(deliverable.deviceType)
      savePlatform(deliverable.deviceType)
    }
    try {
      deliverables.value     = deliverable.deliverableList
      pages.value            = deliverable.pageList
      workingDeliverable.value = deliverable.deliverableItem
      workingPage.value      = deliverable.currentPage
      pageVersionList.value  = preprocessVersionList(deliverable.versionList)
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
  if (!platform || platform === platformStore.currentPlatform) return
  platformStore.setPlatform(platform)
  savePlatform(platform)
  selectedCase.value = ''
  reportPlatformChange(platform)
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

watch(devPreview, val => {
  if (val && result.value && devReuploading.value) {
    ElMessage.success('上传成功，点击右侧重新对比分析')
  }
})
watch(designPreview, val => {
  if (val && result.value && designReuploading.value) {
    if (inIframe()) {
      rerunCheck()
    } else {
      ElMessage.success('上传成功，点击右侧重新对比分析')
    }
  }
})

async function triggerDevPreview(files) {
  devPreview.value   = null
  devPreviewLoading.value = true
  try {
    devPreview.value = await parseDevUpload(
      files.arkuiJson,
      files.arkuiImage ?? null,
      platformStore.currentPlatform,
    )
  } catch (e) {
    /* 静默失败 */
  } finally {
    devPreviewLoading.value = false
  }
}

async function triggerDesignPreview(files) {
  designPreview.value   = null
  designPreviewLoading.value = true
  try {
    designPreview.value = await parseDesignUpload(
      files.designJson,
      files.designImage ?? null,
      platformStore.currentPlatform,
      devPreview.value?.canvas?.w,
    )
  } catch (e) {
    /* 静默失败 */
  } finally {
    designPreviewLoading.value = false
  }
}

function onAddPage() {
  workingPage.value          = { id: '__new__', name: '新增页面' }
  result.value               = null
  selectedCase.value         = ''
  activeDiff.value    = null
  selectionStore.clear()
  tempResultStore.clear()
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
  selectionStore.clear()
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
  selectionStore.clear()
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

async function onReplaceDesign({ designJson, designImage }) {
  if (!designJson || !designImage) return
  if (blobUrls.value.design) URL.revokeObjectURL(blobUrls.value.design)
  const next = { ...uploadFiles.value, designJson, designImage }
  uploadFiles.value = next
  blobUrls.value = { ...blobUrls.value, design: URL.createObjectURL(designImage) }
  selectedCase.value = ''
  designReuploading.value = true
  await triggerDesignPreview(next)
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
    const { problems: addPageProblems, nodeMatchs: addPageNodeMatchs } = buildProblems(result.value, {
      nodeManualAttr: nodeManualAttr.value,
    })
    await addConsistencyCheckPage({
      id:                    String(pageId),
      deliverableId:         String(workingDeliverable.value?.id ?? ''),
      name:                  workingPage.value?.name ?? '',
      deviceType:            platformStore.currentPlatform,
      versionName:           now,
      devImageBase64Data:    devBase64,
      devJson:               devJsonStr,
      designImageBase64Data: designBase64,
      designJson:            designJsonStr,
      problems:              addPageProblems,
      nodeMatchs:            addPageNodeMatchs,
    })

    const pageResult = await getResultsByPageId(pageId, 1, 999)
    pageVersionList.value  = preprocessVersionList(pageResult?.list)
    const versionId = Array.isArray(pageResult?.list) ? pageResult.list[0]?.id : null
    workingVersionId.value = versionId ?? null

    const dId = workingDeliverable.value?.id
    if (dId && versionId) {
      setUrlParams({ deliverableId: String(dId), pageId: String(pageId) })
    }
    // 保存后给当前 diffs 注入 _problemId，确保非问题标记能取到 id
    if (result.value?.diffs) {
      for (const d of result.value.diffs) {
        if (!d._problemId) d._problemId = `${d.arkuiNodeId}-${d.property}`
      }
    }
    reportCompareResult()
  } catch (e) {
    console.error('重新对比存档失败', e)
  }
}

// 存储按钮：仅存档当前人工标注和合并后的 diff，不重跑算法
async function onSave() {
  await saveDebounce.run(async () => {
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
    const { problems, nodeMatchs } = buildProblems(result.value, {
      diffs: [...(result.value?.diffs ?? []), ...selectDiffs.value],
      nodeManualAttr: nodeManualAttr.value,
    })
    await addConsistencyCheckPage({
      id:                    String(pageId),
      deliverableId:         String(workingDeliverable.value?.id ?? ''),
      name:                  workingPage.value?.name ?? '',
      deviceType:            platformStore.currentPlatform,
      versionName:           now,
      devImageBase64Data:    devBase64,
      devJson:               devJsonStr,
      designImageBase64Data: designBase64,
      designJson:            designJsonStr,
      problems,
      nodeMatchs,
    })

    const pageResult = await getResultsByPageId(pageId, 1, 999)
    pageVersionList.value  = preprocessVersionList(pageResult?.list)
    const versionId = Array.isArray(pageResult?.list) ? pageResult.list[0]?.id : null
    workingVersionId.value = versionId ?? null

    const dId = workingDeliverable.value?.id
    if (dId && versionId) {
      setUrlParams({ deliverableId: String(dId), pageId: String(pageId) })
    }
    ElMessage.success('存储成功')
    snapshotInitial()
    try {
      const manualDiffs = [...editDiffs.value, ...selectDiffs.value]
      const nodeIds = new Set()
      for (const d of manualDiffs) {
        if (d.arkuiNodeId) nodeIds.add(`arkui:${d.arkuiNodeId}`)
        if (d.designNodeId) nodeIds.add(`design:${d.designNodeId}`)
      }
      const manualAttr = { nodeCount: nodeIds.size, totalCount: manualDiffs.length, otherCount: manualDiffs.filter(d => !builtinStyleKeys.has(d.property)).length }
      const manualDiff = { all: manualDiffs.length }
      for (const d of manualDiffs) {
        manualDiff[d.property] = (manualDiff[d.property] || 0) + 1
      }
      reportInteraction({
        name: 'devlint',
        event: 'ManualSave',
        extend: { manualAttr, manualDiff, platform: platformStore.currentPlatform, isFrom: inIframe() ? 'hiscenario' : 'octo' },
      })
    } catch { /* 打点失败不影响主流程 */ }
  } catch (e) {
    console.error('存储失败', e)
    ElMessage.error('存储失败')
    }
  })
}

// pairs[].design / pairs[].arkui 替换为 allNodes 里的同一对象引用，
// 确保两条路径（select 模式 / 普通模式）读写的是同一份数据
function resolvePairsToNodes(pairs, allDesignNodes, allArkuiNodes) {
  if (!pairs?.length) return pairs ?? []
  const deMap = Object.fromEntries((allDesignNodes ?? []).map(n => [n.id, n]))
  const hmMap = Object.fromEntries((allArkuiNodes  ?? []).map(n => [n.id, n]))
  return pairs.map(p => ({
    ...p,
    design: deMap[p.design?.id] ?? p.design,
    arkui:  hmMap[p.arkui?.id]  ?? p.arkui,
  }))
}

function onSaveManualStyle({ side, nodeId, key, parsedValue }) {
  const nodes = side === 'design' ? result.value?.allDesignNodes : result.value?.allArkuiNodes
  const node  = nodes?.find(n => n.id === nodeId)
  if (!node) return
  node.manualStyle = { ...(node.manualStyle || {}), [key]: parsedValue }

  // 全量重建 edit 池（算法池、select 池不动，算法 diff 自动在 mergedDiffs 中保留/恢复）
  rebuildEditDiffs()

  // 维持选中态（供 Inspector 展示已保存行）
  const mySide = side === 'design' ? 'design' : 'arkui'
  const pairs  = result.value?.pairs ?? []
  const pair   = pairs.find(p => p[mySide]?.id === nodeId)
  if (pair) {
    selectionStore.select(pair)
  } else {
    selectionStore.selectUnmatched(mySide === 'design' ? 'design' : 'arkui', node)
  }
}

function onRemoveManualStyle({ side, nodeId, key }) {
  const nodes = side === 'design' ? result.value?.allDesignNodes : result.value?.allArkuiNodes
  const node  = nodes?.find(n => n.id === nodeId)
  if (!node?.manualStyle) return
  const updated = { ...node.manualStyle }
  delete updated[key]
  node.manualStyle = Object.keys(updated).length ? updated : undefined

  // 全量重建 edit 池；算法 diff / select diff 自动在 mergedDiffs 中恢复显示
  rebuildEditDiffs()
}

function applyExtraOverride(nodes, override) {
  if (!override?.nodeId || !override?.key || override?.value == null) return nodes
  const idx = nodes.findIndex(n => n.id === override.nodeId)
  if (idx < 0) return nodes
  const patched = [...nodes]
  const parsedVal = parseOverrideValue(override.key, override.value)
  const existing = patched[idx].manualStyle || {}
  patched[idx] = { ...patched[idx], manualStyle: { ...existing, [override.key]: parsedVal } }
  return patched
}

/** "添加到分析结果"：将 temp-diffs/temp-pairs 合并到正式 diffs/pairs，清除 temp 状态 */
function mergeTempToResult() {
  if (!tempResultStore.tempDiffs || !tempResultStore.tempPairs || !result.value) return

  // 1. pairs 合并（temp 覆盖 existing）
  const newPairs = mergePairs(result.value.pairs ?? [], tempResultStore.tempPairs)

  // 2. select 池更新：tempDiffs 涉及的节点 id 集合，覆盖旧 select-diff（节点级）
  const tempDiffs = tempResultStore.tempDiffs
  const newCoverIds = new Set()
  for (const d of tempDiffs) {
    if (d.designNodeId) newCoverIds.add(d.designNodeId)
    if (d.arkuiNodeId)  newCoverIds.add(d.arkuiNodeId)
  }
  const keptSelect = selectDiffs.value.filter(d =>
    !newCoverIds.has(d.designNodeId) && !newCoverIds.has(d.arkuiNodeId)
  )
  selectDiffs.value = [...keptSelect, ...tempDiffs]

  // 3. 算法池不动（result.value.diffs 保持只读）
  result.value.pairs = resolvePairsToNodes(newPairs, result.value.allDesignNodes, result.value.allArkuiNodes)

  // 4. 基于 newPairs 全量重建 edit 池
  rebuildEditDiffs()

  // 清除 temp 状态，回到 select-select
  tempResultStore.clear()
  reportPageRef.value?.clearCompare?.()
  ElMessage.success('已添加到分析结果')
}

async function rerunCheck() {
  if (canvasMode.mode === 'select') {
    await rerunDebounce.run(() => reportPageRef.value?.runCompare())
    return
  }
  if (!result.value) {
    ElMessage.warning('没有可用的数据，请重新上传')
    return
  }
  await rerunDebounce.run(async () => {
    activeDiff.value    = null
    selectionStore.clear()
    rerunLoading.value  = true
    try {
    // 当前画布渲染的节点：重新上传过则用新解析结果，否则用现有 result
    const curDesignNodes = designPreview.value?.nodes ?? result.value.allDesignNodes
    const curArkuiNodes  = devPreview.value?.nodes    ?? result.value.allArkuiNodes
    const curCanvas = {
      design: designPreview.value?.canvas ?? result.value.canvas.design,
      arkui:  devPreview.value?.canvas    ?? result.value.canvas.arkui,
    }

    // 将人工覆盖的属性值 patch 到对应节点的副本上，再送入重跑
    const activeOverrides = reportPageRef.value?.getActiveOverrides?.() ?? {}
    const patchedDesignNodes = applyExtraOverride(curDesignNodes, activeOverrides.design)
    const patchedArkuiNodes  = applyExtraOverride(curArkuiNodes,  activeOverrides.dev)

    const matchResult = await matchNodes(
      patchedDesignNodes,
      patchedArkuiNodes,
      curCanvas,
      platformStore.currentPlatform,
      'all',
    )
    result.value = {
      ...result.value,
      canvas:               curCanvas,
      allDesignNodes:       curDesignNodes,
      allArkuiNodes:        curArkuiNodes,
      diffs:                matchResult.diffs,
      pairs:                resolvePairsToNodes(matchResult.pairs, curDesignNodes, curArkuiNodes),
      unmatchedDesignNodes: matchResult.unmatchedDesignNodes,
      unmatchedArkuiNodes:  matchResult.unmatchedArkuiNodes,
      stats:                matchResult.stats,
    }
    selectDiffs.value = []
    devReuploading.value    = false
    designReuploading.value = false
    devPreview.value        = null
    designPreview.value     = null
    ElMessage.success('重新对比完成')
    submitRerunVersion()
  } catch (e) {
    ElMessage.error(`分析失败：${e.response?.data?.error || e.message}`)
  } finally {
    rerunLoading.value = false
  }
  })
}

function onDesignNodeClick(nodeId) {
  const node = resolveSelectableNode(designNodes.value, nodeId)
  if (!isSelectableNode(node)) return
  const pair = effectivePairs.value.find(p => p.design?.id === (node?.id || nodeId))
  if (pair) {
    selectionStore.select(pair)
  } else {
    const designNode = node || result.value?.allDesignNodes?.find(n => n.id === nodeId)
    if (designNode) selectionStore.selectUnmatched('design', designNode)
  }
  activeDiff.value = null
}

function onArkuiNodeClick(nodeId) {
  const node = resolveSelectableNode(allArkuiNodes.value, nodeId)
  if (!isSelectableNode(node)) return
  const pair = effectivePairs.value.find(p => p.arkui?.id === (node?.id || nodeId))
  if (pair) {
    selectionStore.select(pair)
  } else {
    const arkuiNode = node || result.value?.allArkuiNodes?.find(n => n.id === nodeId)
    if (arkuiNode) selectionStore.selectUnmatched('arkui', arkuiNode)
  }
  activeDiff.value = null
}

function nodeDiffsFor(key, nodeId) {
  return mergedDiffs.value.filter(d => d[key] === nodeId)
}

async function selectCase(id) {
  await caseDebounce.run(async () => {
    selectedCase.value  = id
    activeDiff.value    = null
    selectionStore.clear()
    loading.value       = true
    result.value        = null
    revokeBlobUrls()
    try {
    const data = await checkCase(id, platformStore.currentPlatform)
    // 案例选择打点
    reportInteraction({
      name: 'selectCase',
      event: 'selectCase',
      extend: { caseName: id, platform: platformStore.currentPlatform, isFrom: inIframe() ? 'hiscenario' : 'octo' },
    })

    const rawDesignJson = data._rawDesignJson
    const rawDevContent = data._rawDevContent
    const devImgExt     = data._devImgExt || 'png'
    delete data._rawDesignJson
    delete data._rawDevContent
    delete data._devImgExt
    result.value = data
    selectDiffs.value = []
    result.value.pairs = resolvePairsToNodes(result.value.pairs, result.value.allDesignNodes, result.value.allArkuiNodes)

    const designJsonFile = jsonToFile(rawDesignJson, 'design.json')
    const devJsonFile    = jsonToFile(rawDevContent,  'arkui.json')

    const arkuiImgUrl  = imageUrl(id, 'arkui',  platformStore.currentPlatform)
    const designImgUrl = imageUrl(id, 'design', platformStore.currentPlatform)
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
  })
}

async function loadHistoryVersion(rawVersion, deviceType) {
  const version = preprocessVersion(rawVersion)

  // 以图片 base64 是否为空判断该侧有无数据（mock 把空 JSON 存成 {}、空图片存成 ''）
  const devEmpty    = !version.devBase64Data
  const designEmpty = !version.designBase64Data

  // 只解析非空侧，空侧跳过以免解析占位 {} 产生垃圾节点
  let devParsed    = { canvas: null, nodes: [] }
  let designParsed = { canvas: null, nodes: [] }
  let devJsonFile = null,    devImageFile = null
  let designJsonFile = null, designImageFile = null

  if (!devEmpty) {
    const devJsonData = await fetchVersionJson(version.devJsonUrl)
    devImageFile = await resolveImageFile(version.devBase64Data, 'arkui.jpg', ADMIN_BASE_URL)
    devJsonFile  = jsonToFile(devJsonData, 'arkui.json')
    devParsed    = await parseDevUpload(devJsonFile, devImageFile, deviceType)
  }
  if (!designEmpty) {
    const designJsonData = await fetchVersionJson(version.designJsonUrl)
    designImageFile = await resolveImageFile(version.designBase64Data, 'design.jpg', ADMIN_BASE_URL)
    designJsonFile  = jsonToFile(designJsonData, 'design.json')
    designParsed    = await parseDesignUpload(designJsonFile, designImageFile, deviceType, devParsed.canvas?.w)
  }

  // 任一侧为空则无从配对/比对，pairs 与 diffs 均为空
  let diffs = []
  let pairs = []
  if (!devEmpty && !designEmpty) {
    diffs = (version.problems ?? []).map(p => {
      try {
        const diff = JSON.parse(adaptLegacyProblem(p).data)
        if (p.isNotProblem === 1) diff._isNotProblem = true
        diff._problemId = String(p.id)
        return diff
      } catch { return null }
    }).filter(Boolean)

    const arkuiNodeMap  = new Map((devParsed.nodes  ?? []).map(n => [n.id, n]))
    const designNodeMap = new Map((designParsed.nodes ?? []).map(n => [n.id, n]))

    if (version._matchedPairIds) {
      const pairIds = JSON.parse(version._matchedPairIds)
      pairs = pairIds
        .map(([aId, dId]) => ({ arkui: arkuiNodeMap.get(aId), design: designNodeMap.get(dId) }))
        .filter(p => p.arkui && p.design)
    } else {
      // 旧版本数据兼容：从 diffs 反推有差异的节点对
      const pairMap = new Map()
      for (const diff of diffs) {
        if (!diff.arkuiNodeId || !diff.designNodeId) continue
        const key = `${diff.arkuiNodeId}::${diff.designNodeId}`
        if (!pairMap.has(key)) pairMap.set(key, { arkuiNodeId: diff.arkuiNodeId, designNodeId: diff.designNodeId })
      }
      pairs = [...pairMap.values()]
        .map(p => ({ arkui: arkuiNodeMap.get(p.arkuiNodeId), design: designNodeMap.get(p.designNodeId) }))
        .filter(p => p.arkui && p.design)
    }
  }

  const errorCount   = diffs.filter(d => d.severity === 'error').length
  const warningCount = diffs.filter(d => d.severity === 'warning').length

  // 三池分离：算法池（无 diffSource）+ select 池（select-diff）；edit-diff 丢弃后由 manualStyle rebuild
  const algoDiffs    = diffs.filter(d => !d.diffSource)
  const loadedSelect = diffs.filter(d => d.diffSource === 'select-diff')

  // 空侧停在上传卡片状态；非空侧正常渲染报告画布
  devReuploading.value    = devEmpty
  designReuploading.value = designEmpty
  devPreview.value        = null
  designPreview.value     = null

  const _allArkui  = devParsed.nodes    ?? []
  const _allDesign = designParsed.nodes ?? []

  // 还原存储时的人工标注属性到节点上
  if (version._nodeManualAttr) {
    const { dev, design } = version._nodeManualAttr
    for (const n of _allArkui) {
      if (dev?.[n.id]) n.manualStyle = { ...dev[n.id] }
    }
    for (const n of _allDesign) {
      if (design?.[n.id]) n.manualStyle = { ...design[n.id] }
    }
  }

  result.value = {
    pairs:                resolvePairsToNodes(pairs, _allDesign, _allArkui),
    diffs:                algoDiffs,
    canvas:               { arkui: devParsed.canvas ?? designParsed.canvas, design: designParsed.canvas ?? devParsed.canvas },
    stats:                { errorCount, warningCount },
    allArkuiNodes:        _allArkui,
    allDesignNodes:       _allDesign,
    unmatchedDesignNodes: [],
  }
  // select 池与 edit 池：edit 池由 watch(result) 触发 rebuildEditDiffs 重建
  selectDiffs.value = loadedSelect
  blobUrls.value = {
    arkui:  devEmpty    ? '' : version.devBase64Data,
    design: designEmpty ? '' : version.designBase64Data,
  }
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
  closeHistoryKey.value++
  const pageList = await getPagesByDeliverableId(String(d.id))
  pages.value = Array.isArray(pageList)
    ? pageList.slice().sort((a, b) => (b.createTime ?? 0) - (a.createTime ?? 0))
    : []
  if (pages.value.length === 0) return
  await onSelectPage(pages.value[0])
}

// 统一的页面切换逻辑
function onPageRenamed({ pageId, name }) {
  const page = pages.value.find(p => String(p.id) === String(pageId))
  if (page) page.name = name
}

async function onSelectPage(page) {
  workingPage.value = page
  closeHistoryKey.value++
  const deviceType = page.deviceType ?? 'hmPhone'
  if (deviceType !== platformStore.currentPlatform) {
    platformStore.setPlatform(deviceType)
    savePlatform(deviceType)
    reportPlatformChange(deviceType)
  }
  const versionResult = await getResultsByPageId(page.id, 1, 999)
  pageVersionList.value  = preprocessVersionList(versionResult?.list)
  const version = versionResult?.list?.[0]
  workingVersionId.value = version?.id ?? null
  if (!version) return
  loading.value = true
  try {
    await loadHistoryVersion(version, deviceType)
    const dId = workingDeliverable.value?.id
    if (dId && page.id && version.id) {
      setUrlParams({ deliverableId: String(dId), pageId: String(page.id) })
    }
  } catch (e) {
    console.error('加载历史版本失败', e)
    ElMessage.warning('加载历史版本失败')
  } finally {
    loading.value = false
  }
}

async function onHistoryView(item) {
  await historyDebounce.run(async () => {
    workingVersionId.value = item.id ? String(item.id) : null
    loading.value = true
    try {
      await loadHistoryVersion(item, workingPage.value?.deviceType ?? platformStore.currentPlatform)
    } catch (e) {
      console.error('加载历史版本失败', e)
      ElMessage.warning('加载历史版本失败')
    } finally {
      loading.value = false
    }
  })
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

    const { problems: saveProblems, nodeMatchs: saveNodeMatchs } = buildProblems(result.value, {
      nodeManualAttr: nodeManualAttr.value,
    })
    const pageId = await addConsistencyCheckPage({
      deliverableId:         String(deliverableId),
      name:                  pageName,
      deviceType:            platformStore.currentPlatform,
      versionName:           now,
      devImageBase64Data:    devBase64,
      devJson:               devJsonStr,
      designImageBase64Data: designBase64,
      designJson:            designJsonStr,
      problems:              saveProblems,
      nodeMatchs:            saveNodeMatchs,
    })
    if (!pageId) return

    // 步骤 5：取 versionId，同时更新页面版本列表
    const pageResult = await getResultsByPageId(pageId, 1, 999)
    pageVersionList.value  = preprocessVersionList(pageResult?.list)
    const versionId  = Array.isArray(pageResult?.list) ? pageResult.list[0]?.id : null
    workingVersionId.value = versionId ?? null

    // 保存后给当前 diffs 注入 _problemId，确保非问题标记能取到 id
    if (result.value?.diffs) {
      for (const d of result.value.diffs) {
        if (!d._problemId) d._problemId = `${d.arkuiNodeId}-${d.property}`
      }
    }

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
      setUrlParams({ deliverableId: String(deliverableId), pageId: String(pageId) })
    }
    reportCompareResult()
  } catch (e) {
    console.error('提交结果失败', e)
  }
}

async function runUpload(platform) {
  await uploadDebounce.run(async () => {
    selectedCase.value  = ''
    activeDiff.value    = null
    selectionStore.clear()
  loading.value       = true
  result.value        = null
  if (platform && platform !== platformStore.currentPlatform) {
    platformStore.setPlatform(platform)
    reportPlatformChange(platform)
  }
  try {
    result.value = await checkUpload(
      uploadFiles.value.designJson,
      uploadFiles.value.arkuiJson,
      uploadFiles.value.designImage,
      uploadFiles.value.arkuiImage,
      platform || platformStore.currentPlatform,
    )
    result.value.pairs = resolvePairsToNodes(result.value.pairs, result.value.allDesignNodes, result.value.allArkuiNodes)
    ElMessage.success('分析完成')
    submitResult()
  } catch (e) { ElMessage.error(`分析失败：${e.response?.data?.error || e.message}`) }
  finally     { loading.value = false }
  })
}

function reportCompareResult() {
  const diffs = mergedDiffs.value ?? []
  const errorlist = { all: diffs.length }
  for (const d of diffs) {
    const key = d.property
    errorlist[key] = (errorlist[key] || 0) + 1
  }
  reportInteraction({
    name: 'clickCompare',
    event: 'clickCompare',
    extend: { errorlist, platform: platformStore.currentPlatform, isFrom: inIframe() ? 'hiscenario' : 'octo' },
  })
}

function reportPlatformChange(platform) {
  reportInteraction({
    name: 'platformChange',
    event: 'platformChange',
    extend: { platform, isFrom: inIframe() ? 'hiscenario' : 'octo' },
  })
}


function onDiffSelect(diff) {
  activeDiff.value = diff
  if (!diff) {
    selectionStore.clear()
  } else if (!diff.property?.startsWith('spacing.')) {
    const pair = effectivePairs.value.find(p =>
      p.design?.id === diff.designNodeId && p.arkui?.id === diff.arkuiNodeId
    )
    if (pair) {
      selectionStore.select(pair)
    } else if (diff.designNodeId || diff.arkuiNodeId) {
      const designNode = diff.designNodeId
        ? effectivePairs.value.find(p => p.design?.id === diff.designNodeId)?.design
          ?? result.value?.allDesignNodes?.find(n => n.id === diff.designNodeId) ?? null
        : null
      const arkuiNode = diff.arkuiNodeId
        ? effectivePairs.value.find(p => p.arkui?.id === diff.arkuiNodeId)?.arkui
          ?? result.value?.allArkuiNodes?.find(n => n.id === diff.arkuiNodeId) ?? null
        : null
      selectionStore.select({
        matchDetail: { type: 'unmatched' },
        design: designNode,
        arkui:  arkuiNode,
      })
    } else {
      selectionStore.clear()
    }
  } else {
    selectionStore.clear()
  }
}
</script>

<style>
/* ── AI 分析加载 + 主区/右侧面板包装 ── */
.ai-center-wrapper {
  flex: 1;
  min-width: 0;
  display: flex;
  position: relative;
}

/* ── 画布内容区：占剩余空间，垂直 flex column ── */
.ai-canvas-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

</style>
