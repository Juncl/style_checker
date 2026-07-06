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
    <main class="center-panel up-board ai-main-wrap">
      <!-- AI 侧边面板（在布局流中推挤画布） -->
      <AiChatDrawer :open="aiChatOpen" @close="aiChatOpen = false" />

      <!-- 触发按钮（悬浮，随面板展开同步移动） -->
      <button
        class="ai-sidebar-toggle"
        :class="{ 'ai-sidebar-toggle--open': aiChatOpen }"
        title="AI 检视助手"
        @click="aiChatOpen = !aiChatOpen"
      >
        <svg viewBox="0 0 6 10" width="6" height="10" fill="none">
          <path
            :d="aiChatOpen ? 'M5 1L1 5L5 9' : 'M1 1L5 5L1 9'"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

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
      />
      </div>
    </main>

    <!-- 右侧面板 -->
    <aside class="right-panel up-right-panel" style="position: relative;">
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
        :report-canvas-mode="canvasMode.mode"
        :has-manual-edits="manualDiffs.length > 0"
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
} from '../utils/tools.ts'
import { initApp } from './init/index'
import { UXLINT_CHECKLIST_EVENT } from './init/detectIframe'
import { processUxlintCheckList } from './init/processUxlintCheckList'
import { setUrlParams, removeUrlParams } from '../utils/urlParams'
import { parseOverrideValue } from './match/overrideValidator'
import { generateManualDiff, formatStyleValue, readStyleValue } from './match/compareNodes'
import { savePlatform } from './init/restorePlatform'
import AppLayout from './components/AppLayout.vue'
import AiChatDrawer from './components/AiChatDrawer.vue'
import ConsistencyTabbar from './components/ConsistencyTabbar.vue'
import UploadPage from './components/UploadPage.vue'
import ReportPage from './components/ReportPage.vue'
import UploadPanel from './components/UploadPanel.vue'
import ReportPanel from './components/ReportPanel.vue'
import '../../styles/app.css'
import { CASE_NAMES_BY_PLATFORM, DEBUG_COLORS } from '../utils/constants'
import { reportInteraction } from '../utils-inner/report'
import { useCanvasModeStore } from '../../stores/canvasMode'
import { useDebugStore } from '../../stores/debug'
import { useSelectionStore } from '../../stores/selection'
import { usePlatformStore } from '../../stores/platform'
import { useTempResultStore } from '../../stores/tempResult'

const route           = useRoute()
const platformStore = usePlatformStore()
const tempResultStore = useTempResultStore()
const CASE_NAMES      = computed(() => CASE_NAMES_BY_PLATFORM[platformStore.currentPlatform] || {})
const selectedCase    = ref('')
const loading         = ref(false)
const result          = ref(null)
const activeDiff      = ref(null)
const uploadPageRef   = ref(null)
const aiChatOpen      = ref(false)
const debugStore = useDebugStore()
const selectionStore = useSelectionStore()
const rerunLoading      = ref(false)
const reportPageRef     = ref(null)
/** 当前可用的匹配对：temp 激活时用 tempPairs，否则用正式 pairs */
const effectivePairs    = computed(() => tempResultStore.tempPairs ?? result.value?.pairs ?? [])
const manualDiffs       = ref([])   // 人工覆盖产生的差异卡片

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

function upsertManualDiff(newDiff) {
  const idx = manualDiffs.value.findIndex(d =>
    d.property === newDiff.property &&
    d.designNodeId === newDiff.designNodeId &&
    d.arkuiNodeId === newDiff.arkuiNodeId
  )
  if (idx >= 0) {
    manualDiffs.value[idx] = newDiff
  } else {
    manualDiffs.value.push(newDiff)
  }
  console.log('[manual-diff] 生成卡片:', JSON.stringify({
    property:   newDiff.property,
    _isManual:  newDiff._isManual,
    designValue:   newDiff.designValue,
    arkuiValue:    newDiff.arkuiValue,
    designNodeId:  newDiff.designNodeId,
    arkuiNodeId:   newDiff.arkuiNodeId,
    textContent:   newDiff.textContent,
    action:       idx >= 0 ? '覆盖' : '新增',
  }, null, 2))
}

function removeManualDiffByMatch(designId, arkuiId, property) {
  manualDiffs.value = manualDiffs.value.filter(d =>
    !(d.property === property && d.designNodeId === designId && d.arkuiNodeId === arkuiId)
  )
}

const mergedDiffs = computed(() => {
  const base = tempResultStore.tempDiffs ?? result.value?.diffs ?? []
  const manual = manualDiffs.value
  const merged = [...base]
  for (const md of manual) {
    const idx = merged.findIndex(d =>
      d.property === md.property &&
      d.designNodeId === md.designNodeId &&
      d.arkuiNodeId === md.arkuiNodeId
    )
    if (idx >= 0) {
      console.log('[merged-diffs] 人工卡片覆盖算法卡片:', {
        property: md.property,
        old: { designValue: merged[idx].designValue, arkuiValue: merged[idx].arkuiValue, _isManual: merged[idx]._isManual ?? false },
        new: { designValue: md.designValue, arkuiValue: md.arkuiValue, _isManual: md._isManual ?? false },
      })
      merged[idx] = md
    } else {
      console.log('[merged-diffs] 人工卡片新增:', {
        property: md.property,
        designValue: md.designValue,
        arkuiValue: md.arkuiValue,
        designNodeId: md.designNodeId,
        arkuiNodeId: md.arkuiNodeId,
      })
      merged.push(md)
    }
  }
  console.log('[merged-diffs] 合并后总条数:', merged.length, '其中算法:', base.length, '人工:', manual.length)
  console.log('[merged-diffs] 全部diff:', JSON.parse(JSON.stringify(merged)))
  return merged
})

watch(() => result.value, () => {
  manualDiffs.value = []
  tempResultStore.clear()
})

const devReuploading    = ref(false)
const designReuploading = ref(false)
const canvasMode = useCanvasModeStore()

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

// ── hover 实时间距计算 ────────────────────────────────────────────────────────

// rectA/rectB：画布渲染坐标（缩放后），用于计算 spaceRect 位置
// sizeA/sizeB：展示数值坐标（原始 dp 或 vp），用于计算标注上显示的数字
function computeSpacingMarks(rectA, rectB, sizeA, sizeB) {
  if (!rectA || !rectB) return []
  const a = rectA, b = rectB
  const sa = sizeA || rectA, sb = sizeB || rectB

  const aContainsB = a.x <= b.x && a.y <= b.y && (a.x + a.w) >= (b.x + b.w) && (a.y + a.h) >= (b.y + b.h)
  const bContainsA = b.x <= a.x && b.y <= a.y && (b.x + b.w) >= (a.x + a.w) && (b.y + b.h) >= (a.y + a.h)
  const overlapsH  = a.x < b.x + b.w && b.x < a.x + a.w
  const overlapsV  = a.y < b.y + b.h && b.y < a.y + a.h

  if (overlapsH && overlapsV && !aContainsB && !bContainsA) return []

  const marks = []

  if (aContainsB || bContainsA) {
    const p  = aContainsB ? a : b,  sp = aContainsB ? sa : sb
    const c  = aContainsB ? b : a,  sc = aContainsB ? sb : sa
    const top    = c.y - p.y,         sTop    = sc.y - sp.y
    const bottom = (p.y + p.h) - (c.y + c.h), sBottom = (sp.y + sp.h) - (sc.y + sc.h)
    const left   = c.x - p.x,         sLeft   = sc.x - sp.x
    const right  = (p.x + p.w) - (c.x + c.w), sRight  = (sp.x + sp.w) - (sc.x + sc.w)
    if (top    > 0) marks.push({ type: 'spacing', axis: 'vertical',   spaceRect: { x: c.x, y: p.y,        w: c.w, h: top    }, value: String(Math.round(sTop))    })
    if (bottom > 0) marks.push({ type: 'spacing', axis: 'vertical',   spaceRect: { x: c.x, y: c.y + c.h, w: c.w, h: bottom }, value: String(Math.round(sBottom)) })
    if (left   > 0) marks.push({ type: 'spacing', axis: 'horizontal', spaceRect: { x: p.x, y: c.y,        w: left,  h: c.h  }, value: String(Math.round(sLeft))   })
    if (right  > 0) marks.push({ type: 'spacing', axis: 'horizontal', spaceRect: { x: c.x + c.w, y: c.y, w: right, h: c.h  }, value: String(Math.round(sRight))  })
  } else {
    if (!overlapsH) {
      const lR = a.x + a.w <= b.x ? a : b, slR = lR === a ? sa : sb
      const rR = lR === a ? b : a,           srR = lR === a ? sb : sa
      const yTop = Math.max(lR.y, rR.y), yBot = Math.min(lR.y + lR.h, rR.y + rR.h)
      const y = yTop < yBot ? yTop : Math.min(lR.y, rR.y)
      const h = yTop < yBot ? (yBot - yTop) : Math.max(lR.h, rR.h)
      const yMid = y + h / 2
      const sGap = srR.x - (slR.x + slR.w)
      marks.push({
        type: 'spacing', axis: 'horizontal',
        spaceRect: { x: lR.x + lR.w, y, w: rR.x - (lR.x + lR.w), h },
        capFirst:  { start: Math.min(lR.y, yMid), end: Math.max(lR.y + lR.h, yMid) },
        capSecond: { start: Math.min(rR.y, yMid), end: Math.max(rR.y + rR.h, yMid) },
        value: String(Math.round(sGap)),
      })
    }
    if (!overlapsV) {
      const tR = a.y + a.h <= b.y ? a : b, stR = tR === a ? sa : sb
      const bR = tR === a ? b : a,           sbR = tR === a ? sb : sa
      const xLeft = Math.max(tR.x, bR.x), xRight = Math.min(tR.x + tR.w, bR.x + bR.w)
      const x = xLeft < xRight ? xLeft : Math.min(tR.x, bR.x)
      const w = xLeft < xRight ? (xRight - xLeft) : Math.max(tR.w, bR.w)
      const xMid = x + w / 2
      const sGap = sbR.y - (stR.y + stR.h)
      marks.push({
        type: 'spacing', axis: 'vertical',
        spaceRect: { x, y: tR.y + tR.h, w, h: bR.y - (tR.y + tR.h) },
        capFirst:  { start: Math.min(tR.x, xMid), end: Math.max(tR.x + tR.w, xMid) },
        capSecond: { start: Math.min(bR.x, xMid), end: Math.max(bR.x + bR.w, xMid) },
        value: String(Math.round(sGap)),
      })
    }
  }
  return marks
}

const hoverArkuiSpacingMarks = computed(() => {
  const selNode = selectionStore.selectedPair?.arkui
  if (!selNode?.rect) return []
  const hoverId = hoveredArkuiNodeId.value || hoveredArkuiCrossId.value
  if (!hoverId || hoverId === selNode.id) return []
  // 优先从 pairs 中取坐标，保证与 selectedPair 同源，避免不同数据流坐标系不一致
  const hoverNode = result.value?.pairs?.find(p => p.arkui?.id === hoverId)?.arkui
                 ?? allArkuiNodes.value.find(n => n.id === hoverId)
  return hoverNode?.rect ? computeSpacingMarks(selNode.rect, hoverNode.rect, null, null) : []
})

const hoverDesignSpacingMarks = computed(() => {
  const selNode = selectionStore.selectedPair?.design
  if (!selNode?.rect) return []
  const hoverId = hoveredDesignNodeId.value || hoveredDesignCrossId.value
  if (!hoverId || hoverId === selNode.id) return []
  // 优先从 pairs 中取坐标，保证与 selectedPair 同源，避免不同数据流坐标系不一致
  const hoverNode = result.value?.pairs?.find(p => p.design?.id === hoverId)?.design
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
  if (route.query.deliverableId && route.query.pageId && route.query.versionId) {
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
      removeUrlParams(['deliverableId', 'pageId', 'versionId'])
    }
    return
  }

  // 保存 iframe 清理函数
  stopListenFn = initResult.stopListenFn

  platformStore.setPlatform(initResult.platform)

  const { deliverable } = initResult
  if (deliverable) {
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
      platformStore.currentPlatform,
      devPreview.value?.canvas?.w,
    )
  } catch { /* 静默失败 */ }
  finally { designPreviewLoading.value = false }
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
      setUrlParams({ deliverableId: String(dId), pageId: String(pageId), versionId: String(versionId) })
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
      diffs: mergedDiffs.value,
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
      setUrlParams({ deliverableId: String(dId), pageId: String(pageId), versionId: String(versionId) })
    }
    // 清空人工 diff 列表，隐藏存储按钮
    manualDiffs.value = []
    ElMessage.success('存储成功')
  } catch (e) {
    console.error('存储失败', e)
    ElMessage.error('存储失败')
  }
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

  const mySide    = side === 'design' ? 'design' : 'arkui'
  const otherSide = side === 'design' ? 'arkui' : 'design'
  const pairs = result.value?.pairs ?? []
  const pair = pairs.find(p => p[mySide]?.id === nodeId)

  if (pair) {
    const manualDiff = generateManualDiff(pair, key, platformStore.currentPlatform)
    if (manualDiff) {
      upsertManualDiff(manualDiff)
      selectionStore.select(pair)
    } else {
      upsertManualDiff({
        property:      key,
        designValue:   formatStyleValue(key, readStyleValue(pair.design, key), platformStore.currentPlatform),
        arkuiValue:    formatStyleValue(key, readStyleValue(pair.arkui,  key), platformStore.currentPlatform),
        severity:      'warning',
        confidence:    'high',
        designNodeId:  pair.design?.id ?? null,
        arkuiNodeId:   pair.arkui?.id  ?? null,
        _isManual:     true,
        _isResolved:   true,
        textContent:   pair.design?.textContent ?? pair.design?.name ?? pair.arkui?.textContent ?? '',
        designName:    pair.design?.name,
      })
    }
  } else {
    const diff = {
      property: key,
      [`${mySide}Value`]: formatStyleValue(key, parsedValue, platformStore.currentPlatform),
      [`${otherSide}Value`]: '—',
      severity: 'warning',
      confidence: 'high',
      [`${mySide}NodeId`]: nodeId,
      [`${otherSide}NodeId`]: null,
      _isManual: true,
      textContent: node.textContent ?? node.name ?? '',
      designName: side === 'design' ? (node.name ?? '') : undefined,
    }
    upsertManualDiff(diff)
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

  const mySide    = side === 'design' ? 'design' : 'arkui'
  const otherSide = side === 'design' ? 'arkui' : 'design'
  const pairs = result.value?.pairs ?? []
  const pair = pairs.find(p => p[mySide]?.id === nodeId)
  if (pair) {
    const manualDiff = generateManualDiff(pair, key, platformStore.currentPlatform)
    if (manualDiff) {
      upsertManualDiff(manualDiff)
    } else {
      removeManualDiffByMatch(pair.design?.id ?? null, pair.arkui?.id ?? null, key)
    }
  } else {
    removeManualDiffByMatch(
      mySide === 'design' ? nodeId : null,
      mySide === 'arkui' ? nodeId : null,
      key
    )
  }
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

  // 合并 diffs：temp 涉及的任一侧节点 id，删掉正式 diff 中对应的全部条目，用 temp 替换
  const tempDesignIds = new Set(tempResultStore.tempDiffs.map(d => d.designNodeId).filter(Boolean))
  const tempArkuiIds  = new Set(tempResultStore.tempDiffs.map(d => d.arkuiNodeId).filter(Boolean))
  const filteredDiffs = (result.value.diffs ?? []).filter(d =>
    !tempDesignIds.has(d.designNodeId) && !tempArkuiIds.has(d.arkuiNodeId)
  )
  const mergedDiffsArr = [...filteredDiffs, ...tempResultStore.tempDiffs]
  console.log('[mergeTemp] 删除正式diff:', (result.value.diffs ?? []).length - filteredDiffs.length, '覆盖temp-diff:', tempResultStore.tempDiffs.length)

  // 合并 pairs：双向覆盖去交集
  const arkuiMap = new Map()
  const designMap = new Map()
  for (const p of (result.value.pairs ?? [])) {
    if (p.arkui?.id) arkuiMap.set(p.arkui.id, p)
    if (p.design?.id) designMap.set(p.design.id, p)
  }
  for (const p of tempResultStore.tempPairs) {
    if (p.arkui?.id) arkuiMap.set(p.arkui.id, p)
    if (p.design?.id) designMap.set(p.design.id, p)
  }
  const pairKeySet = new Set()
  const mergedPairs = []
  for (const p of arkuiMap.values()) {
    const key = `${p.design?.id}|${p.arkui?.id}`
    if (pairKeySet.has(key)) continue
    const designPair = p.design?.id ? designMap.get(p.design.id) : null
    if (designPair && designPair.arkui?.id === p.arkui?.id) {
      pairKeySet.add(key)
      mergedPairs.push(p)
    }
  }

  result.value = {
    ...result.value,
    diffs: mergedDiffsArr,
    pairs: mergedPairs,
  }

  // 清除 temp 状态，回到 select-select
  tempResultStore.clear()
  reportPageRef.value?.clearCompare?.()
  ElMessage.success('已添加到分析结果')
}

async function rerunCheck() {
  if (canvasMode.mode === 'select') {
    reportPageRef.value?.runCompare()
    return
  }
  if (!result.value) {
    ElMessage.warning('没有可用的数据，请重新上传')
    return
  }
  activeDiff.value    = null
  selectionStore.clear()
  rerunLoading.value  = true
  try {
    // 将人工覆盖的属性值 patch 到对应节点的副本上，再送入重跑
    const activeOverrides = reportPageRef.value?.getActiveOverrides?.() ?? {}
    const patchedDesignNodes = applyExtraOverride(result.value.allDesignNodes, activeOverrides.design)
    const patchedArkuiNodes  = applyExtraOverride(result.value.allArkuiNodes,  activeOverrides.dev)

    const matchResult = await matchNodes(
      patchedDesignNodes,
      patchedArkuiNodes,
      result.value.canvas,
      platformStore.currentPlatform,
      'all',
    )
    result.value = {
      ...result.value,
      diffs:                matchResult.diffs,
      pairs:                resolvePairsToNodes(matchResult.pairs, result.value.allDesignNodes, result.value.allArkuiNodes),
      unmatchedDesignNodes: matchResult.unmatchedDesignNodes,
      unmatchedArkuiNodes:  matchResult.unmatchedArkuiNodes,
      stats:                matchResult.stats,
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
      extend: { user: getUserAccount(), curTime: new Date().toISOString(), caseName: id, platform: platformStore.currentPlatform, isFrom: inIframe() ? 'hiscenario' : 'octo' },
    })

    const rawDesignJson = data._rawDesignJson
    const rawDevContent = data._rawDevContent
    const devImgExt     = data._devImgExt || 'png'
    delete data._rawDesignJson
    delete data._rawDevContent
    delete data._devImgExt
    result.value = data
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
        diff._problemData = p.data
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
    diffs,
    canvas:               { arkui: devParsed.canvas ?? designParsed.canvas, design: designParsed.canvas ?? devParsed.canvas },
    stats:                { errorCount, warningCount },
    allArkuiNodes:        _allArkui,
    allDesignNodes:       _allDesign,
    unmatchedDesignNodes: [],
  }
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
      setUrlParams({ deliverableId: String(dId), pageId: String(page.id), versionId: String(version.id) })
    }
  } catch (e) {
    console.error('加载历史版本失败', e)
    ElMessage.warning('加载历史版本失败')
  } finally {
    loading.value = false
  }
}

async function onHistoryView(item) {
  const dId = workingDeliverable.value?.id
  const pId = workingPage.value?.id
  if (!dId || !pId) return
  workingVersionId.value = item.id ? String(item.id) : null
  setUrlParams({ deliverableId: String(dId), pageId: String(pId), versionId: String(item.id) })
  loading.value = true
  try {
    await loadHistoryVersion(item, workingPage.value?.deviceType ?? platformStore.currentPlatform)
  } catch (e) {
    console.error('加载历史版本失败', e)
    ElMessage.warning('加载历史版本失败')
  } finally {
    loading.value = false
  }
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
      setUrlParams({ deliverableId: String(deliverableId), pageId: String(pageId), versionId: String(versionId) })
    }
    reportCompareResult()
  } catch (e) {
    console.error('提交结果失败', e)
  }
}

async function runUpload(platform) {
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
}

function reportCompareResult() {
  const diffs = result.value?.diffs ?? []
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
        ? result.value?.allDesignNodes?.find(n => n.id === diff.designNodeId) ?? null
        : null
      const arkuiNode = diff.arkuiNodeId
        ? result.value?.allArkuiNodes?.find(n => n.id === diff.arkuiNodeId) ?? null
        : null
      selectionStore.select({
        matchDetail: { type: 'unmatched' },
        design: designNode,
        arkui:  arkuiNode,
      })
    } else {
      selectionStore.clear()
    }
  }
}
</script>

<style>
/* main 改为 flex row，AI 面板和画布并排 */
.ai-main-wrap {
  display: flex !important;
  flex-direction: row !important;
  position: relative;
}

/* 画布内容区：占剩余空间，垂直 flex column */
.ai-canvas-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 触发按钮：悬浮定位，随面板宽度过渡同步移动 */
.ai-sidebar-toggle {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 12px;
  height: 48px;
  background: #ffffff;
  border: 1px solid #DFDFDF;
  border-left: none;
  border-radius: 0 4px 4px 0;
  cursor: pointer;
  z-index: 101;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #777777;
  padding: 0;
  transition: left 220ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
              background 150ms ease, color 150ms ease, border-color 150ms ease;
}
.ai-sidebar-toggle:hover {
  background: #f5f5f5;
  color: #191919;
}
.ai-sidebar-toggle--open {
  left: 374px;
}
</style>
