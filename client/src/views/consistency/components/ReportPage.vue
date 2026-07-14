<template>
  <!-- ── Debugger 悬浮框 ── -->
  <div v-if="debugStore.debugMode" class="debugger-float"
    :style="debugFloatX !== null ? { left: debugFloatX + 'px', right: 'auto' } : {}">
    <div class="debugger-head">
      <div class="debugger-title drag-handle" @mousedown="startDrag($event, 'debug')">
        <span>Debugger</span>
        <small>映射 {{ debugPairItems.length }} 对</small>
      </div>
      <div class="debugger-switches">
        <span class="debugger-switch-group" title="显示进入节点匹配阶段的节点轮廓">
          <span class="debugger-switch-label">框线</span>
          <el-switch :model-value="debugStore.debugPipelineOn" size="small" @update:model-value="debugStore.setDebugPipelineOn($event)" />
        </span>
        <span class="debugger-switch-group" title="显示节点映射关系">
          <span class="debugger-switch-label">匹配</span>
          <el-switch :model-value="debugStore.debugOverlayOn" size="small" @update:model-value="debugStore.setDebugOverlayOn($event)" />
        </span>
      </div>
    </div>
    <div v-show="debugStore.debugOverlayOn" class="debugger-body">
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
    <div v-if="debugStore.debugMode && selectionStore.selectedPair" class="node-bar" :style="{ left: nodeBarX + 'px' }">
      <div class="node-bar-head drag-handle" @mousedown="startDrag($event, 'nodebar')">
        <span>已选中实机节点</span>
        <button class="node-bar-close" @click.stop="selectionStore.clear()">✕</button>
      </div>
      <div class="node-bar-body">
        <el-icon class="node-bar-icon"><Crop /></el-icon>
        <b class="node-bar-name">{{ selectionStore.selectedPair.arkui?.textContent || selectionStore.selectedPair.arkui?.name || selectionStore.selectedPair.design?.textContent || selectionStore.selectedPair.design?.name }}</b>
        <div class="node-bar-tags">
          <el-tag
            size="small"
            effect="plain"
            :type="confidenceTagType(selectionStore.selectedPair.confidence)"
          >
            {{ selectionStore.selectedPair.matchDetail?.pass ? selectionStore.selectedPair.matchDetail.pass + ': ' : '' }}{{ selectionStore.selectedPair.matchDetail?.type }}
          </el-tag>
          <el-tag
            v-if="selectionStore.selectedPair.confidence"
            size="small"
            effect="plain"
            :type="confidenceTagType(selectionStore.selectedPair.confidence)"
          >{{ confidenceText(selectionStore.selectedPair.confidence) }}</el-tag>
        </div>
        <div v-if="selectionStore.selectedPair.matchDetail?.desc" class="node-bar-desc">{{ selectionStore.selectedPair.matchDetail.desc }}</div>
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
          :class="{ 'float-icon-btn--active': canvasMode.mode === 'edit' }"
          @click="onCircleClick"
        >
          <EditModeIcon />
        </button>
        <button
          class="float-icon-btn"
          title="矩形"
          :class="{ 'float-icon-btn--active': canvasMode.mode === 'select' }"
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
        :class="['up-stage', devReuploading && !devPreview ? '' : 'up-stage--report']"
        @click="devReuploading ? undefined : selectionStore.clear()"
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
            :platform="platformStore.currentPlatform"
            :show-download-link="false"
            @pick-json="file => $emit('step-picked', { type: 'arkuiJson', file })"
            @pick-image="file => $emit('step-picked', { type: 'arkuiImage', file })"
          />
        </template>
        <!-- 正常报告模式 -->
        <ImagePanel
          v-else
          ref="devPanelRef"
          :platform="platformStore.currentPlatform"
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
          :debug-pair-map="debugPairMap"

          :box-select-mode="canvasMode.mode === 'select'"
          :edit-mode="canvasMode.mode === 'edit'"
          :compare-active="compareActive"
          :selected-node-ids="devSelectedNodeIds"
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
        :class="['up-stage', designReuploading && !designPreview ? '' : 'up-stage--report']"
        @click="designReuploading ? undefined : selectionStore.clear()"
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
            @step-picked="$emit('step-picked', $event)"
          />
        </template>
        <!-- 正常报告模式 -->
        <ImagePanel
          v-else
          ref="designPanelRef"
          :platform="platformStore.currentPlatform"
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
          :external-hovered-id="hoveredDesignCrossId"
          :debug-pair-map="debugPairMap"

          :box-select-mode="canvasMode.mode === 'select'"
          :edit-mode="canvasMode.mode === 'edit'"
          :compare-active="compareActive"
          :selected-node-ids="designSelectedNodeIds"
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
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
import { normalizeSelection } from '../match/normalizeSelection.ts'
import { matchNodes } from '../../../api/index.ts'
import { useCanvasModeStore, useSelectionStore, usePlatformStore, useTempResultStore, useSelectNodesStore } from '../../../stores'
import { useDebugStore } from '../../../stores/debug'
import { reportInteraction } from '../../utils-inner/report'
import { inIframe } from '../../utils/tools'

const props = defineProps({
  result:               { type: Object,  required: true },
  arkuiImgSrc:          { type: String,  required: true },
  designImgSrc:         { type: String,  required: true },
  designNodes:          { type: Array,   default: () => [] },
  allArkuiNodes:        { type: Array,   default: () => [] },
  arkuiNodes:           { type: Array,   default: () => [] },
  activeDiff:           { type: Object,  default: null },
  debugPairItems:       { type: Array,   default: () => [] },
  debugPairMap:         { type: Object,  default: () => ({}) },
  selectedDesignDiffs:  { type: Array,   default: () => [] },
  selectedArkuiDiffs:   { type: Array,   default: () => [] },
  selectedCase:         { type: String,  default: '' },
  caseNames:            { type: Object,  default: () => ({}) },
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
  'step-picked',
  'select-case',
  'arkui-hover',
  'design-hover',
  'compare-nodes',
  'save-manual-style',
  'remove-manual-style',
  'clear-active-diff',
])

const canvasMode = useCanvasModeStore()
const debugStore = useDebugStore()
const selectionStore = useSelectionStore()
const platformStore = usePlatformStore()
const tempResultStore = useTempResultStore()
const selectNodesStore = useSelectNodesStore()

const devPanelRef    = ref(null)
const designPanelRef = ref(null)
const debugMappingExpanded = ref(false)

const floatBarCollapsed  = ref(false)
const pendingDiffs       = ref(null)   // 当前临时对比结果；非 null 即为对比激活状态
const compareActive      = computed(() => pendingDiffs.value !== null)

// 两侧 Inspector 自定义对比行的人工覆盖：{ nodeId, key, value } | null
const devExtraOverride    = ref(null)
const designExtraOverride = ref(null)

// 每侧当前选中的节点列表（点选/框选统一存储在 store 中）
// 直接读 selectNodesStore，不再包 computed（store 内部已是 ref，Pinia 自动解包）
const devSelectedNodeIds = computed(() => selectNodesStore.devNodes.map(n => n.id))
const designSelectedNodeIds = computed(() => selectNodesStore.designNodes.map(n => n.id))

const localArkuiNode  = computed(() =>
  canvasMode.mode === 'select' && selectNodesStore.devNodes.length === 1
    ? selectNodesStore.devNodes[0]
    : null
)
const localDesignNode = computed(() =>
  canvasMode.mode === 'select' && selectNodesStore.designNodes.length === 1
    ? selectNodesStore.designNodes[0]
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
  canvasMode.mode === 'select'
    ? (pendingDiffs.value !== null ? 'select-tempPairs' : 'select-select')
    : null
)

/** 画布是否使用 selectedPair 驱动（default/edit 或 tempPairs 模式） */
function usePair() { return canvasMode.mode !== 'select' || selectBranchMode.value === 'select-tempPairs' }

const effectiveDevSelectedId     = computed(() => usePair() ? (selectionStore.selectedPair?.arkui?.id || null) : ((selectNodesStore.devNodes.length === 1 ? selectNodesStore.devNodes[0]?.id : null) ?? null))
const effectiveDevInspectorNode  = computed(() => usePair() ? (selectionStore.selectedPair?.arkui || null)       : localArkuiNode.value)
const effectiveDevStyleDiffs     = computed(() => usePair() ? (props.selectedArkuiDiffs ?? [])           : [])
const effectiveDesignSelectedId  = computed(() => usePair() ? (selectionStore.selectedPair?.design?.id || null)   : ((selectNodesStore.designNodes.length === 1 ? selectNodesStore.designNodes[0]?.id : null) ?? null))
const effectiveDesignInspectorNode = computed(() => usePair() ? (selectionStore.selectedPair?.design || null)      : localDesignNode.value)
const effectiveDesignStyleDiffs  = computed(() => usePair() ? (props.selectedDesignDiffs ?? [])          : [])

function clearCompare() {
  pendingDiffs.value = null
  tempResultStore.clear()
}

function clearSelectState() {
  selectNodesStore.clearAll()
  pendingDiffs.value = null
  tempResultStore.clear()
}

function onCircleClick() {
  if (canvasMode.mode === 'edit') {
    canvasMode.setMode('default')
  } else {
    if (canvasMode.mode === 'select') clearSelectState()
    canvasMode.setMode('edit')
  }
}

function onRectClick() {
  if (canvasMode.mode === 'select') {
    canvasMode.setMode('default')
    clearSelectState()
  } else {
    canvasMode.setMode('select')
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
  selectNodesStore.setDevNodes(nodes)
}
function onDesignBoxSelect(nodes) {
  selectNodesStore.setDesignNodes(nodes)
}

/** select 模式下的节点点击：点选单节点，写入 store；select-tempPairs 同步 emit 以驱动全局联动 */
function onDevNodeClick(id) {
  if (canvasMode.mode === 'select') {
    const node = props.allArkuiNodes?.find(n => n.id === id)
    selectNodesStore.setDevNodes(node ? [node] : [])
    if (selectBranchMode.value === 'select-tempPairs') emit('arkui-node-click', id)
  } else {
    emit('arkui-node-click', id)
  }
}
function onDesignNodeClickLocal(id) {
  if (canvasMode.mode === 'select') {
    const node = (props.result?.allDesignNodes ?? props.designNodes)?.find(n => n.id === id)
    selectNodesStore.setDesignNodes(node ? [node] : [])
    if (selectBranchMode.value === 'select-tempPairs') emit('design-node-click', id)
  } else {
    emit('design-node-click', id)
  }
}

/** select 模式下的画布空白点击：select-select 清空对应侧；select-tempPairs 清 temp 并抛 clear-pair */
function onDevBgClick() {
  if (canvasMode.mode === 'select') {
    selectNodesStore.clearDevNodes()
    if (selectBranchMode.value === 'select-tempPairs') { clearCompare(); selectionStore.clear() }
  } else {
    selectionStore.clear()
    emit('clear-active-diff')
  }
}
function onDesignBgClick() {
  if (canvasMode.mode === 'select') {
    selectNodesStore.clearDesignNodes()
    if (selectBranchMode.value === 'select-tempPairs') { clearCompare(); selectionStore.clear() }
  } else {
    selectionStore.clear()
    emit('clear-active-diff')
  }
}

async function runCompare() {
  const devNodes = selectNodesStore.devNodes
  const designNodes = selectNodesStore.designNodes
  if (!devNodes.length || !designNodes.length) {
    ElMessage.warning('请选中两边的节点后再进行重新对比')
    return
  }

  // 类型校验：单节点时两侧类型必须一致
  if (devNodes.length === 1 && designNodes.length === 1) {
    if (designNodes[0].type !== devNodes[0].type) {
      ElMessage.warning('文本节点不能与容器节点对比，请重新选择')
      return
    }
  }

  const devResult    = normalizeSelection(devNodes)
  const designResult = normalizeSelection(designNodes)

  const newDevNodes    = devResult.items.map(({ node, newRect }) => ({ ...node, rect: newRect, rawRect: { ...node.rect } }))
  const newDesignNodes = designResult.items.map(({ node, newRect }) => ({ ...node, rect: newRect, rawRect: { ...node.rect } }))

  const canvas = {
    design: { w: designResult.root.w, h: designResult.root.h },
    arkui:  { w: devResult.root.w,    h: devResult.root.h },
  }

  try {
    const result = await matchNodes(newDesignNodes, newDevNodes, canvas, platformStore.currentPlatform, 'part')
    const diffs = (result.diffs ?? []).map(d => ({
      ...d,
      _isManual: true,
      diffSource: 'select-diff',
    }))
    pendingDiffs.value = diffs
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
        matchDetail: p.matchDetail ?? { pass: 'select', type: devNodes.length > 1 ? 'select-框选' : 'select-手动选择' },
      }
    }).filter(Boolean)
    tempResultStore.setResult(diffs, tempPairs)
    const errorlist = { all: diffs.length }
    for (const d of diffs) {
      errorlist[d.property] = (errorlist[d.property] || 0) + 1
    }
    reportInteraction({
      name: 'clickCompare',
      event: 'clickCompare',
      extend: { errorlist, platform: platformStore.currentPlatform, isFrom: inIframe() ? 'hiscenario' : 'octo' },
    })
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
  selectionStore.clear()
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
