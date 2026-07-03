<template>
  <!-- ── Debugger 悬浮框 ── -->
  <div v-if="debugMode" class="debugger-float"
    :style="debugFloatX !== null ? { left: debugFloatX + 'px', right: 'auto' } : {}">
    <div class="debugger-head">
      <div class="debugger-title drag-handle" @mousedown="startDrag($event, 'debug')">
        <span>Debugger</span>
        <small>映射 {{ debugPairItems.length }} 对</small>
      </div>
      <div class="debugger-switches">
        <span class="debugger-switch-group" title="显示进入节点匹配阶段的节点轮廓">
          <span class="debugger-switch-label">框线</span>
          <el-switch :model-value="debugPipelineOn" size="small" @update:model-value="$emit('update:debug-pipeline-on', $event)" />
        </span>
        <span class="debugger-switch-group" title="显示节点映射关系">
          <span class="debugger-switch-label">匹配</span>
          <el-switch :model-value="debugOverlayOn" size="small" @update:model-value="$emit('update:debug-overlay-on', $event)" />
        </span>
      </div>
    </div>
    <div v-show="debugOverlayOn" class="debugger-body">
      <button
        class="debugger-summary-toggle"
        type="button"
        @click="debugMappingExpanded = !debugMappingExpanded"
      >
        <span class="debugger-summary-text">
          {{ debugMappingExpanded ? '收起映射列表' : '展开映射列表' }}
        </span>
        <span class="debugger-summary-meta">映射 {{ debugPairItems.length }} 对</span>
        <span class="debugger-summary-icon">{{ debugMappingExpanded ? '▾' : '▸' }}</span>
      </button>
      <div v-if="debugMappingExpanded" class="debugger-panel">
        <div v-if="!debugPairItems.length" class="debugger-empty">
          当前没有可展示的映射
        </div>
        <div v-else class="debugger-list">
          <div
            v-for="item in debugPairItems"
            :key="item.key"
            class="debugger-item"
            :style="{ background: validationBg(item.validationStatus), cursor: item.arkuiId ? 'pointer' : 'default' }"
            @click="item.arkuiId && $emit('arkui-node-click', item.arkuiId)"
          >
            <span class="debugger-swatch" :style="{ background: item.color }"></span>
            <span class="debugger-index">#{{ String(item.index + 1).padStart(2, '0') }}</span>
            <span class="debugger-cell" :title="`Dev ID: ${item.arkuiId}`">{{ item.arkuiId || '-' }}</span>
            <span class="debugger-cell" :title="`Design ID: ${item.designId}`">{{ item.designId || '-' }}</span>
            <span class="debugger-cell" :title="`RawType: ${item.arkuiRawType}`">{{ item.arkuiRawType }}</span>
            <span class="debugger-cell debugger-confidence" :title="`Confidence: ${item.confidence}`">{{ item.confidence }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ── 节点选中说明条（悬浮，左上角）── -->
  <transition name="fade">
    <div v-if="debugMode && selectedPair" class="node-bar" :style="{ left: nodeBarX + 'px' }">
      <div class="node-bar-head drag-handle" @mousedown="startDrag($event, 'nodebar')">
        <span>已选中实机节点</span>
        <button class="node-bar-close" @click.stop="$emit('clear-pair')">✕</button>
      </div>
      <div class="node-bar-body">
        <el-icon class="node-bar-icon"><Crop /></el-icon>
        <b class="node-bar-name">{{ selectedPair.arkui?.textContent || selectedPair.arkui?.name || selectedPair.design?.textContent || selectedPair.design?.name }}</b>
        <div class="node-bar-tags">
          <el-tag
            size="small"
            effect="plain"
            :type="confidenceTagType(selectedPair.confidence)"
          >
            {{ selectedPair.matchDetail?.pass ? selectedPair.matchDetail.pass + ': ' : '' }}{{ selectedPair.matchDetail?.type }}
          </el-tag>
          <el-tag
            v-if="selectedPair.confidence"
            size="small"
            effect="plain"
            :type="confidenceTagType(selectedPair.confidence)"
          >{{ confidenceText(selectedPair.confidence) }}</el-tag>
        </div>
        <div v-if="selectedPair.matchDetail?.desc" class="node-bar-desc">{{ selectedPair.matchDetail.desc }}</div>
      </div>
    </div>
  </transition>

  <!-- ── 中间主区：开发侧 + 设计侧 ── -->
  <div class="up-columns">
    <!-- 悬浮工具栏（底部居中） -->
    <div
      :class="['dev-float-bar', { 'dev-float-bar--collapsed': floatBarCollapsed }]"
      @click.stop="onFloatBarClick"
    >
      <div class="float-bar-row" :class="{ 'float-bar-row--hidden': floatBarCollapsed }">
        <button
          class="float-icon-btn"
          title="圆形"
          :class="{ 'float-icon-btn--active': nodeCanvasMode === 'edit' }"
          @click="onCircleClick"
        >
          <EditModeIcon />
        </button>
        <button
          class="float-icon-btn"
          title="矩形"
          :class="{ 'float-icon-btn--active': nodeCanvasMode === 'select' }"
          @click="onRectClick"
        >
          <SelectModeIcon />
        </button>
        <div class="float-bar-sep"></div>
        <button
          class="float-icon-btn"
          title="收起"
          @click.stop="onTriangleClick"
        >
          <MoveDownIcon />
        </button>
      </div>
      <div class="float-bar-row float-bar-row--collapsed" :class="{ 'float-bar-row--visible': floatBarCollapsed }">
        <MoveUpIcon />
      </div>
    </div>

    <!-- 开发侧 -->
    <section class="up-col up-col--dev">

      <div
        :class="['up-stage', devReuploading && !devPreview && !devPreviewLoading ? '' : 'up-stage--report']"
        @click="devReuploading ? undefined : $emit('clear-pair')"
      >
        <!-- 重新上传模式 -->
        <template v-if="devReuploading">
          <!-- 解析中 -->
          <div v-if="devPreviewLoading" class="phone-card">
            <div class="phone-bg"></div>
            <div class="phone-content phone-content--center">
              <div class="preview-loading">
                <OctoLoading :size="48" />
                <span class="preview-loading-text">正在解析节点…</span>
              </div>
            </div>
          </div>
          <!-- 新文件预览 -->
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
            :arkui-json="uploadFiles?.arkuiJson ?? null"
            :arkui-image="uploadFiles?.arkuiImage ?? null"
            :platform="currentPlatform"
            :show-download-link="false"
            @pick-json="file => $emit('step-picked', { type: 'arkuiJson', file })"
            @pick-image="file => $emit('step-picked', { type: 'arkuiImage', file })"
          />
        </template>
        <!-- 正常报告模式 -->
        <ImagePanel
          v-else
          ref="devPanelRef"
          :platform="currentPlatform"
          :src="arkuiImgSrc"
          :highlight="null"
          :highlight-pair="arkuiSpacingMark"
          :hover-highlight-pairs="hoverArkuiSpacingMarks"
          :canvas-w="result.canvas.arkui.w"
          :canvas-h="result.canvas.arkui.h"
          :nodes="arkuiNodes"
          :selected-id="effectiveDevSelectedId"
          :inspector-node="effectiveDevInspectorNode"
          :style-diffs="effectiveDevStyleDiffs"
          :external-hovered-id="hoveredArkuiCrossId"
          :debug-mode="debugMode"
          :debug-pipeline-visible="debugPipelineOn"
          :debug-visible="debugOverlayOn"
          :debug-pair-map="debugPairMap"

          :box-select-mode="nodeCanvasMode === 'select'"
          :edit-mode="nodeCanvasMode === 'edit'"
          :compare-active="compareActive"
          @node-click="onDevNodeClick"
          @node-hover="onArkuiHover"
          @bg-click="onDevBgClick"
          @box-select="onDevBoxSelect"
          @zoom="onDevPanelZoom"
          @extra-change="devExtraOverride = $event"
          @save-manual-style="e => emit('save-manual-style', { ...e, side: 'dev' })"
          @remove-manual-style="e => emit('remove-manual-style', { ...e, side: 'dev' })"
        />
      </div>
    </section>

    <!-- 设计侧 -->
    <section class="up-col up-col--design">
      <div
        :class="['up-stage', designReuploading && !designPreview && !designPreviewLoading ? '' : 'up-stage--report']"
        @click="designReuploading ? undefined : $emit('clear-pair')"
      >
        <!-- 重新上传模式 -->
        <template v-if="designReuploading">
          <!-- 解析中 -->
          <div v-if="designPreviewLoading" class="phone-card">
            <div class="phone-bg"></div>
            <div class="phone-content phone-content--center">
              <div class="preview-loading">
                <OctoLoading :size="48" />
                <span class="preview-loading-text">正在解析节点…</span>
              </div>
            </div>
          </div>
          <!-- 新文件预览 -->
          <ImagePanel
            v-else-if="designPreview"
            :src="blobDesignSrc"
            :canvas-w="designPreview.canvas.w"
            :canvas-h="designPreview.canvas.h"
            :nodes="designPreview.nodes"

          />
          <!-- 上传卡片 -->
          <DesignUploadCard
            v-else
            :design-json="uploadFiles?.designJson ?? null"
            :design-image="uploadFiles?.designImage ?? null"
            :debug-mode="debugMode"
            @step-picked="$emit('step-picked', $event)"
          />
        </template>
        <!-- 正常报告模式 -->
        <ImagePanel
          v-else
          ref="designPanelRef"
          :platform="currentPlatform"
          side="design"
          :src="designImgSrc"
          :highlight="null"
          :highlight-pair="designSpacingMark"
          :hover-highlight-pairs="hoverDesignSpacingMarks"
          :canvas-w="result.canvas.design.w"
          :canvas-h="result.canvas.design.h"
          :nodes="designNodes"
          :selected-id="effectiveDesignSelectedId"
          :inspector-node="effectiveDesignInspectorNode"
          :style-diffs="effectiveDesignStyleDiffs"
          :locked-ids="lockedNodeIds"
          :external-hovered-id="hoveredDesignCrossId"
          :debug-mode="debugMode"
          :debug-pipeline-visible="debugPipelineOn"
          :debug-visible="debugOverlayOn"
          :debug-pair-map="debugPairMap"

          :box-select-mode="nodeCanvasMode === 'select'"
          :edit-mode="nodeCanvasMode === 'edit'"
          :compare-active="compareActive"
          @node-click="onDesignNodeClickLocal"
          @node-hover="onDesignHover"
          @bg-click="onDesignBgClick"
          @box-select="onDesignBoxSelect"
          @zoom="onDesignPanelZoom"
          @extra-change="designExtraOverride = $event"
          @save-manual-style="e => emit('save-manual-style', { ...e, side: 'design' })"
          @remove-manual-style="e => emit('remove-manual-style', { ...e, side: 'design' })"
        />
      </div>
    </section>

  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Crop } from '@element-plus/icons-vue'
import OctoLoading from './common/OctoLoading.vue'
import ImagePanel from './ImagePanel.vue'
import DevUploadCard from './DevUploadCard.vue'
import DesignUploadCard from './DesignUploadCard.vue'
import EditModeIcon from '@/views/svg-vue/EditModeIcon.vue'
import SelectModeIcon from '@/views/svg-vue/SelectModeIcon.vue'
import MoveDownIcon from '@/views/svg-vue/MoveDownIcon.vue'
import MoveUpIcon from '@/views/svg-vue/MoveUpIcon.vue'
import { validationBg, confidenceText, confidenceTagType } from '../../utils/tools.ts'
import { compareNodeStyles } from '../match/compareNodes.ts'
import { normalizeSelection } from '../match/normalizeSelection.ts'
import { matchNodes } from '../../../api/index.ts'

const props = defineProps({
  result:               { type: Object,  required: true },
  arkuiImgSrc:          { type: String,  required: true },
  designImgSrc:         { type: String,  required: true },
  designNodes:          { type: Array,   default: () => [] },
  allArkuiNodes:        { type: Array,   default: () => [] },
  arkuiNodes:           { type: Array,   default: () => [] },
  selectedPair:         { type: Object,  default: null },
  activeDiff:           { type: Object,  default: null },
  debugMode:            { type: Boolean, default: false },
  debugPipelineOn:      { type: Boolean, default: false },
  debugOverlayOn:       { type: Boolean, default: false },
  debugPairItems:       { type: Array,   default: () => [] },
  debugPairMap:         { type: Object,  default: () => ({}) },
  lockedNodeIds:        { type: Set,     default: () => new Set() },
  selectedDesignDiffs:  { type: Array,   default: () => [] },
  selectedArkuiDiffs:   { type: Array,   default: () => [] },
  selectedCase:         { type: String,  default: '' },
  caseNames:            { type: Object,  default: () => ({}) },
  currentPlatform:      { type: String,  default: 'hmPhone' },
  devReuploading:       { type: Boolean, default: false },
  designReuploading:    { type: Boolean, default: false },
  devPreview:           { type: Object,  default: null },
  devPreviewLoading:    { type: Boolean, default: false },
  designPreview:        { type: Object,  default: null },
  designPreviewLoading: { type: Boolean, default: false },
  blobDevSrc:           { type: String,  default: '' },
  blobDesignSrc:        { type: String,  default: '' },
  uploadFiles:          { type: Object,  default: () => ({}) },
  hoveredArkuiCrossId:  { type: String,  default: null },
  hoveredDesignCrossId: { type: String,  default: null },
  hoverArkuiSpacingMarks:  { type: Array, default: () => [] },
  hoverDesignSpacingMarks: { type: Array, default: () => [] },
})

const emit = defineEmits([
  'arkui-node-click',
  'design-node-click',
  'clear-pair',
  'step-picked',
  'update:debug-pipeline-on',
  'update:debug-overlay-on',
  'select-case',
  'arkui-hover',
  'design-hover',
  'dev-switch-change',
  'compare-nodes',
  'temp-diffs',
  'temp-pairs',
  'save-manual-style',
  'remove-manual-style',
  'node-canvas-mode-change',
])


const devPanelRef    = ref(null)
const designPanelRef = ref(null)
const debugMappingExpanded = ref(false)

const nodeCanvasMode     = ref('default')   // 'default' | 'select' | 'edit'
const floatBarCollapsed  = ref(false)
const localArkuiId       = ref(null)
const localDesignId      = ref(null)
const localArkuiNodeList  = ref([])    // 开发侧框选节点列表
const localDesignNodeList = ref([])    // 设计侧框选节点列表
const pendingDiffs       = ref(null)   // 当前临时对比结果；非 null 即为对比激活状态
const compareActive      = computed(() => pendingDiffs.value !== null)

watch(nodeCanvasMode, (val) => emit('node-canvas-mode-change', val))

// 两侧 Inspector 自定义对比行的人工覆盖：{ nodeId, key, value } | null
const devExtraOverride    = ref(null)
const designExtraOverride = ref(null)

// 每侧当前选中的节点列表（框选优先；没有框选则用单击 id 拼成单元素数组）
const currentDevNodes = computed(() => {
  if (localArkuiNodeList.value.length > 0) return localArkuiNodeList.value
  if (localArkuiId.value) {
    const n = props.allArkuiNodes?.find(n => n.id === localArkuiId.value)
    return n ? [n] : []
  }
  return []
})
const currentDesignNodes = computed(() => {
  if (localDesignNodeList.value.length > 0) return localDesignNodeList.value
  if (localDesignId.value) {
    const n = (props.result?.allDesignNodes ?? props.designNodes)?.find(n => n.id === localDesignId.value)
    return n ? [n] : []
  }
  return []
})

// 任意一边 >= 2 → 批量模式（后台对比）；两边各 1 → 单节点模式（前端对比）
const isBatchMode = computed(() =>
  currentDevNodes.value.length > 1 || currentDesignNodes.value.length > 1
)

const localArkuiNode  = computed(() =>
  nodeCanvasMode.value === 'select' && localArkuiId.value
    ? (props.allArkuiNodes?.find(n => n.id === localArkuiId.value) ?? null)
    : null
)
const localDesignNode = computed(() =>
  nodeCanvasMode.value === 'select' && localDesignId.value
    ? ((props.result?.allDesignNodes ?? props.designNodes)?.find(n => n.id === localDesignId.value) ?? null)
    : null
)

// ── select 模式下的分支切换 ──────────────────────────────────────────────────
// select-select：纯 select，画布/Inspector 由本地状态驱动（localArkuiId 等）
// select-tempPairs：已执行重新对比，画布/Inspector 由 selectedPair 驱动（同 default/edit）
// 两分支切换：进入 tempPairs 有且只有"重新对比"按钮触发（runCompare 设置 pendingDiffs）
//            退出 tempPairs：① 悬浮框切出 select → clearSelectState
//                           ② 画布空白点击 → clearCompare + emit clear-pair
//                           ③ "添加到分析结果"按钮（待实现）

const selectBranchMode = computed(() =>
  nodeCanvasMode.value === 'select'
    ? (pendingDiffs.value !== null ? 'select-tempPairs' : 'select-select')
    : null
)

/** 画布是否使用 selectedPair 驱动（default/edit 或 tempPairs 模式） */
function usePair() { return nodeCanvasMode.value !== 'select' || selectBranchMode.value === 'select-tempPairs' }

const effectiveDevSelectedId     = computed(() => usePair() ? (props.selectedPair?.arkui?.id || null) : localArkuiId.value)
const effectiveDevInspectorNode  = computed(() => usePair() ? (props.selectedPair?.arkui || null)       : localArkuiNode.value)
const effectiveDevStyleDiffs     = computed(() => usePair() ? (props.selectedArkuiDiffs ?? [])           : [])
const effectiveDesignSelectedId  = computed(() => usePair() ? (props.selectedPair?.design?.id || null)   : localDesignId.value)
const effectiveDesignInspectorNode = computed(() => usePair() ? (props.selectedPair?.design || null)      : localDesignNode.value)
const effectiveDesignStyleDiffs  = computed(() => usePair() ? (props.selectedDesignDiffs ?? [])          : [])

function clearCompare() {
  pendingDiffs.value = null
  emit('temp-diffs', null)
  emit('temp-pairs', null)
}

function clearSelectState() {
  localArkuiId.value        = null
  localDesignId.value       = null
  localArkuiNodeList.value  = []
  localDesignNodeList.value = []
  pendingDiffs.value        = null
  emit('temp-diffs', null)
  emit('temp-pairs', null)
  emit('dev-switch-change', false)
}

function onCircleClick() {
  if (nodeCanvasMode.value === 'edit') {
    nodeCanvasMode.value = 'default'
  } else {
    if (nodeCanvasMode.value === 'select') clearSelectState()
    nodeCanvasMode.value = 'edit'
  }
}

function onRectClick() {
  if (nodeCanvasMode.value === 'select') {
    nodeCanvasMode.value = 'default'
    clearSelectState()
  } else {
    nodeCanvasMode.value = 'select'
    emit('dev-switch-change', true)
  }
}

function onFloatBarClick() {
  if (floatBarCollapsed.value) {
    floatBarCollapsed.value = false
  }
}

function onTriangleClick() {
  floatBarCollapsed.value = true
}

function onDevBoxSelect(nodes) {
  localArkuiNodeList.value = nodes
}
function onDesignBoxSelect(nodes) {
  localDesignNodeList.value = nodes
}

/** select 模式下的节点点击：select-select 仅写本地；select-tempPairs 同步 emit 以驱动全局联动 */
function handleCanvasNodeClick(id, localRef, eventName) {
  if (nodeCanvasMode.value === 'select') {
    localRef.value = id
    if (selectBranchMode.value === 'select-tempPairs') emit(eventName, id)
  } else {
    emit(eventName, id)
  }
}

/** select 模式下的画布空白点击：select-select 仅清本地；select-tempPairs 清 temp 并抛 clear-pair */
function handleCanvasBgClick(localRef) {
  if (nodeCanvasMode.value === 'select') {
    localRef.value = null
    if (selectBranchMode.value === 'select-tempPairs') { clearCompare(); emit('clear-pair') }
  } else {
    emit('clear-pair')
  }
}

function onDevNodeClick(id) { handleCanvasNodeClick(id, localArkuiId, 'arkui-node-click') }
function onDesignNodeClickLocal(id) { handleCanvasNodeClick(id, localDesignId, 'design-node-click') }
function onDevBgClick() { handleCanvasBgClick(localArkuiId) }
function onDesignBgClick() { handleCanvasBgClick(localDesignId) }

function runCompare() {
  if (isBatchMode.value) {
    runBoxCompare()
    return
  }
  const devNode    = currentDevNodes.value[0]
  const designNode = currentDesignNodes.value[0]
  if (!devNode || !designNode) { return }

  // 构建人工覆盖：只有覆盖节点与当前选中节点一致时才带入
  const overrides = {
    dev:    devExtraOverride.value?.nodeId    === devNode.id
              ? { [devExtraOverride.value.key]:    devExtraOverride.value.value    } : {},
    design: designExtraOverride.value?.nodeId === designNode.id
              ? { [designExtraOverride.value.key]: designExtraOverride.value.value } : {},
  }

  if (designNode.type !== devNode.type) {
    ElMessage.warning('文本节点不能与容器节点对比，请重新选择')
    return
  }

  const raw = compareNodeStyles(designNode, devNode, overrides)
  const diffs = raw.map(d => ({
    property:     d.property,
    designValue:  d.designValue,
    arkuiValue:   d.devValue,
    severity:     'error',
    description:  '',
    confidence:   'high',
    nodeType:     designNode.type ?? 'container',
    textContent:  designNode.textContent ?? null,
    designName:   designNode.name ?? null,
    arkuiName:    devNode.name    ?? null,
    matchType:    'select-手动选择',
    iou:          null,
    topologyScore: null,
    regionScore:  null,
    designNodeId: designNode.id ?? null,
    arkuiNodeId:  devNode.id    ?? null,
    designRect:   designNode.rect ?? null,
    arkuiRect:    devNode.rect    ?? null,
    relatedArkuiNodeId:  d.relatedArkuiNodeId,
    relatedDesignNodeId: d.relatedDesignNodeId,
    relationKind: d.relationKind,
    relationAxis: d.relationAxis,
    _isManual:    true,
  }))
  pendingDiffs.value = diffs
  emit('temp-diffs', diffs)
  emit('temp-pairs', [{
    design: designNode,
    arkui: devNode,
    confidence: 'high',
    matchDetail: { pass: 'select', type: 'select-手动选择' },
  }])
}

async function runBoxCompare() {
  const devNodes    = currentDevNodes.value
  const designNodes = currentDesignNodes.value
  if (!devNodes.length || !designNodes.length) return

  const devResult    = normalizeSelection(devNodes)
  const designResult = normalizeSelection(designNodes)

  const newDevNodes    = devResult.items.map(({ node, newRect }) => ({ ...node, rect: newRect, rawRect: { ...node.rect } }))
  const newDesignNodes = designResult.items.map(({ node, newRect }) => ({ ...node, rect: newRect, rawRect: { ...node.rect } }))

  const canvas = {
    design: { w: designResult.root.w, h: designResult.root.h },
    arkui:  { w: devResult.root.w,    h: devResult.root.h },
  }

  try {
    const result = await matchNodes(newDesignNodes, newDevNodes, canvas, props.currentPlatform, 'part')
    const diffs = (result.diffs ?? []).map(d => ({
      ...d,
      _isManual: true,
    }))
    pendingDiffs.value = diffs
    emit('temp-diffs', diffs)
    const tempPairs = (result.pairs ?? []).map(p => {
      const did = p.design?.id ?? p.designId ?? p.designNodeId
      const aid = p.arkui?.id ?? p.arkuiId ?? p.arkuiNodeId
      const designNode = newDesignNodes.find(n => n.id === did)
      const devNode = newDevNodes.find(n => n.id === aid)
      if (!designNode || !devNode) return null
      if (designNode.rawRect) designNode.rect = designNode.rawRect
      if (devNode.rawRect) devNode.rect = devNode.rawRect
      return {
        design: designNode,
        arkui: devNode,
        confidence: p.confidence ?? 'high',
        matchDetail: p.matchDetail ?? { pass: 'select', type: 'select-框选' },
      }
    }).filter(Boolean)
    emit('temp-pairs', tempPairs)
  } catch (e) {
    ElMessage.error(`对比失败：${e.response?.data?.error || e.message}`)
  }
}

function onDevPanelZoom({ factor, normX, normY }) {
  designPanelRef.value?.applyZoom(factor, normX, normY)
}
function onDesignPanelZoom({ factor, normX, normY }) {
  devPanelRef.value?.applyZoom(factor, normX, normY)
}

function onWindowResize() {
  devPanelRef.value?.resetZoom()
  designPanelRef.value?.resetZoom()
  emit('clear-pair')
}

onMounted(() => window.addEventListener('resize', onWindowResize))
onUnmounted(() => window.removeEventListener('resize', onWindowResize))

function onArkuiHover(id) {
  emit('arkui-hover', id)
}
function onDesignHover(id) {
  emit('design-hover', id)
}

// 间距 diff 选中时给两侧画布画 H 形间距标注
// activeDiff.property 形如 'spacing.top' / 'spacing.left'
// activeDiff.spaceRect = { design: rect, arkui: rect }
// activeDiff.relationRects = { design: [anchor, self], arkui: [anchor, self], axis }
const designSpacingMark = computed(() => buildSpacingMark(props.activeDiff, 'design', props.designNodes))
const arkuiSpacingMark  = computed(() => buildSpacingMark(props.activeDiff, 'arkui',  props.arkuiNodes))

function buildSpacingMark(diff, side, nodes) {
  if (!diff?.property?.startsWith('spacing.')) return null

  const selfId   = side === 'design' ? diff.designNodeId        : diff.arkuiNodeId
  const anchorId = side === 'design' ? diff.relatedDesignNodeId : diff.relatedArkuiNodeId
  if (!selfId || !anchorId) return null

  const nodesMap  = Object.fromEntries(nodes.map(n => [n.id, n]))
  const node      = nodesMap[selfId]
  const neighbor  = nodesMap[anchorId]
  if (!node?.rect || !neighbor?.rect) return null

  const axis      = diff.relationAxis || (diff.property === 'spacing.top' ? 'vertical' : 'horizontal')
  const isParent = diff.relationKind === 'parent-child'
  const nr = node.rect
  const nbr = neighbor.rect

  let spaceRect
  if (axis === 'vertical') {
    const top = isParent ? nbr.y : nbr.y + nbr.h
    spaceRect = { x: nr.x, y: top, w: nr.w, h: nr.y - top }
  } else {
    const left = isParent ? nbr.x : nbr.x + nbr.w
    spaceRect = { x: left, y: nr.y, w: nr.x - left, h: nr.h }
  }

  const value = side === 'design' ? diff.designValue : diff.arkuiValue
  const label = diff.property === 'spacing.top' ? '竖向间距' : '横向间距'
  return {
    type: 'spacing',
    axis,
    spaceRect,
    rects: [nbr, nr],
    value: value != null ? String(value) : null,
    label,
  }
}

// 拖拽位置
const debugFloatX      = ref(null)
const nodeBarX         = ref(240)

function startDrag(e, which) {
  e.preventDefault()
  const startMouseX = e.clientX
  const W = which === 'debug' ? 280 : 280
  const startX = which === 'debug'
    ? (debugFloatX.value ?? (window.innerWidth - W - 10))
    : nodeBarX.value
  const onMove = (ev) => {
    const newX = Math.max(0, Math.min(window.innerWidth - W, startX + ev.clientX - startMouseX))
    if (which === 'debug') debugFloatX.value = newX
    else nodeBarX.value = newX
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

/** 供 ConsistencyView 全量重跑前读取当前人工覆盖 */
function getActiveOverrides() {
  return {
    dev:    devExtraOverride.value    ?? null,
    design: designExtraOverride.value ?? null,
  }
}

defineExpose({ runCompare, getActiveOverrides, clearCompare })
</script>

<style scoped>
.up-columns {
  position: relative;
}

.up-col--dev {
  position: relative;
}

.dev-float-bar {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  align-items: center;
  width: 136px;
  height: 48px;
  gap: 8px;
  background: #F9F9F9;
  padding: 8px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
  overflow: hidden;
  transition: width 450ms cubic-bezier(0.4, 0, 0.2, 1),
              height 450ms cubic-bezier(0.4, 0, 0.2, 1),
              padding 450ms cubic-bezier(0.4, 0, 0.2, 1),
              gap 450ms cubic-bezier(0.4, 0, 0.2, 1);
}

.float-bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  transition: transform 450ms cubic-bezier(0.4, 0, 0.2, 1);
}

.float-bar-row--hidden {
  transform: scale(0);
  pointer-events: none;
  position: absolute;
  transition: transform 0s;
}

.float-bar-row--collapsed {
  transform: scale(0);
  pointer-events: none;
  transition: transform 0s;
}

.float-bar-row--visible {
  transform: scale(1);
  pointer-events: auto;
  position: static;
  transition: transform 450ms cubic-bezier(0.4, 0, 0.2, 1);
}

.float-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  padding: 0;
  outline: none;
  color: #191919;
  transition: background 150ms ease, color 150ms ease;
}

.float-icon-btn:hover {
  background: rgba(0, 0, 0, 0.06);
}

.float-icon-btn--active {
  background: #E6F2FD;
  color: var(--octo-primary, #0067D1);
}

.float-icon-btn--active:hover {
  background: #E6F2FD;
  color: var(--octo-primary, #0067D1);
}

.dev-float-bar--collapsed {
  width: 44px;
  height: 24px;
  padding: 6px 16px;
  gap: 0;
  justify-content: center;
  cursor: pointer;
}

.dev-float-bar--collapsed svg {
  color: rgba(0, 0, 0, 0.4);
}

.float-bar-sep {
  width: 1px;
  height: 12px;
  background: rgba(0, 0, 0, 0.10);
  flex-shrink: 0;
}


.phone-content--center {
  align-items: center;
  justify-content: center;
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
