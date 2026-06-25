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
    <!-- 开发侧 -->
    <section class="up-col up-col--dev">
      <!-- 悬浮开关（右上角，仅 debugger 模式） -->
      <div v-if="debugMode" class="dev-float-switch" @click.stop>
        <button
          class="octo-toggle"
          :class="{ 'octo-toggle--on': devSwitchOn }"
          @click="toggleDevSwitch"
        >
          <span class="octo-toggle-thumb"></span>
        </button>
      </div>

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
          :selected-id="devSwitchOn ? localArkuiId : (selectedPair?.arkui?.id || null)"
          :inspector-node="devSwitchOn ? localArkuiNode : (selectedPair?.arkui || null)"
          :style-diffs="devSwitchOn ? [] : selectedArkuiDiffs"
          :external-hovered-id="hoveredArkuiCrossId"
          :debug-mode="debugMode"
          :debug-pipeline-visible="debugPipelineOn"
          :debug-visible="debugOverlayOn"
          :debug-pair-map="debugPairMap"

          :box-select-mode="devSwitchOn"
          @node-click="onDevNodeClick"
          @node-hover="onArkuiHover"
          @bg-click="onDevBgClick"
          @box-select="onDevBoxSelect"
          @zoom="onDevPanelZoom"
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
          :selected-id="devSwitchOn ? localDesignId : (selectedPair?.design?.id || null)"
          :inspector-node="devSwitchOn ? localDesignNode : (selectedPair?.design || null)"
          :style-diffs="devSwitchOn ? [] : selectedDesignDiffs"
          :locked-ids="lockedNodeIds"
          :external-hovered-id="hoveredDesignCrossId"
          :debug-mode="debugMode"
          :debug-pipeline-visible="debugPipelineOn"
          :debug-visible="debugOverlayOn"
          :debug-pair-map="debugPairMap"

          :box-select-mode="devSwitchOn"
          @node-click="onDesignNodeClickLocal"
          @node-hover="onDesignHover"
          @bg-click="onDesignBgClick"
          @box-select="onDesignBoxSelect"
          @zoom="onDesignPanelZoom"
        />
      </div>
    </section>

    <!-- 节点对比悬浮面板（单选或框选两侧都有节点时出现） -->
    <transition name="fade">
      <div v-if="showComparePanel" class="node-compare-panel">
        <!-- 操作按钮行 -->
        <div class="node-compare-actions">
          <button class="node-compare-btn node-compare-btn--primary" @click.stop="runCompare">对比</button>
          <button v-if="!isBatchMode" class="node-compare-btn node-compare-btn--ghost" @click.stop="$emit('add-diff', { arkuiId: localArkuiId, designId: localDesignId })">新增差异</button>
        </div>
        <!-- diff 报告 -->
        <div v-if="localCompareDiffs !== null" class="node-compare-result">
          <div v-if="localCompareDiffs.length === 0" class="node-compare-empty">
            ✓ 样式一致，未发现差异
          </div>
          <template v-else>
            <div class="node-compare-diff-header">
              <span>类型</span>
              <span>开发</span>
              <span>设计</span>
            </div>
            <div
              v-for="d in localCompareDiffs"
              :key="d.property"
              class="node-compare-diff-row"
            >
              <span class="diff-label">{{ d.label }}</span>
              <span class="diff-dev" :title="d.devValue">{{ d.devValue }}</span>
              <span class="diff-design" :title="d.designValue">{{ d.designValue }}</span>
            </div>
          </template>
        </div>
      </div>
    </transition>
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
import { validationBg, confidenceText, confidenceTagType } from '../../utils/tools.ts'
import { compareNodeStyles } from '../match/compareNodes.ts'

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
  'add-diff',
])


const devPanelRef    = ref(null)
const designPanelRef = ref(null)
const debugMappingExpanded = ref(false)

const devSwitchOn        = ref(false)
const localArkuiId       = ref(null)
const localDesignId      = ref(null)
const localCompareDiffs  = ref(null)   // null=未执行，[]+=已执行
const localArkuiNodeList  = ref([])    // 开发侧框选节点列表
const localDesignNodeList = ref([])    // 设计侧框选节点列表

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
const showComparePanel = computed(() =>
  devSwitchOn.value && currentDevNodes.value.length > 0 && currentDesignNodes.value.length > 0
)

const localArkuiNode  = computed(() =>
  devSwitchOn.value && localArkuiId.value
    ? (props.allArkuiNodes?.find(n => n.id === localArkuiId.value) ?? null)
    : null
)
const localDesignNode = computed(() =>
  devSwitchOn.value && localDesignId.value
    ? ((props.result?.allDesignNodes ?? props.designNodes)?.find(n => n.id === localDesignId.value) ?? null)
    : null
)

function toggleDevSwitch() {
  devSwitchOn.value = !devSwitchOn.value
  if (!devSwitchOn.value) {
    localArkuiId.value       = null
    localDesignId.value      = null
    localCompareDiffs.value  = null
    localArkuiNodeList.value  = []
    localDesignNodeList.value = []
  }
  emit('dev-switch-change', devSwitchOn.value)
}

function onDevBoxSelect(nodes) {
  localArkuiNodeList.value = nodes
}
function onDesignBoxSelect(nodes) {
  localDesignNodeList.value = nodes
}

function onDevNodeClick(id) {
  if (devSwitchOn.value) { localArkuiId.value = id; localCompareDiffs.value = null }
  else emit('arkui-node-click', id)
}
function onDesignNodeClickLocal(id) {
  if (devSwitchOn.value) { localDesignId.value = id; localCompareDiffs.value = null }
  else emit('design-node-click', id)
}
function onDevBgClick() {
  if (devSwitchOn.value) { localArkuiId.value = null; localCompareDiffs.value = null }
  else emit('clear-pair')
}
function onDesignBgClick() {
  if (devSwitchOn.value) { localDesignId.value = null; localCompareDiffs.value = null }
  else emit('clear-pair')
}

function runCompare() {
  if (isBatchMode.value) {
    runBoxCompare()
    return
  }
  // 单节点前端对比（两边各 1 个）
  const devNode    = currentDevNodes.value[0]
  const designNode = currentDesignNodes.value[0]
  if (!devNode || !designNode) { localCompareDiffs.value = []; return }
  localCompareDiffs.value = compareNodeStyles(designNode, devNode)
}

function runBoxCompare() {
  // TODO: 调用后台批量对比接口
  ElMessage({ message: '算法准备中...', type: 'info' })
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
</script>

<style scoped>
.up-columns {
  position: relative;
}

.up-col--dev {
  position: relative;
}

.node-compare-panel {
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 0;
  background: rgba(255, 255, 255, 0.97);
  backdrop-filter: blur(6px);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.16);
  min-width: 320px;
  max-width: 420px;
  overflow: hidden;
}

.node-compare-actions {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
}

.node-compare-btn {
  height: 32px;
  padding: 4px 16px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  font-size: 14px;
  transition: all 150ms ease;
}

.node-compare-btn--primary {
  background: #0067D1;
  color: #ffffff;
}
.node-compare-btn--primary:hover {
  background: #0058B3;
}

.node-compare-btn--ghost {
  background: #ffffff;
  color: #191919;
  border: 1px solid #D1D5DC;
}
.node-compare-btn--ghost:hover {
  background: #F5F5F5;
}

.node-compare-result {
  border-top: 1px solid #EAECF0;
  max-height: 260px;
  overflow-y: auto;
  padding: 4px 0;
}

.node-compare-empty {
  padding: 10px 14px;
  font-size: 12px;
  color: #52C41A;
}

.node-compare-diff-header {
  display: grid;
  grid-template-columns: 56px 1fr 1fr;
  gap: 6px;
  padding: 4px 14px;
  font-size: 11px;
  color: #AAAAAA;
  background: #FAFAFA;
  border-bottom: 1px solid #EAECF0;
}

.node-compare-diff-row {
  display: grid;
  grid-template-columns: 56px 1fr 1fr;
  gap: 6px;
  align-items: baseline;
  padding: 5px 14px;
  font-size: 12px;
  line-height: 1.4;
  border-left: 3px solid #0067D1;
  background: rgba(0, 103, 209, 0.04);
}

.diff-label {
  color: #777;
  font-size: 11px;
}

.diff-design {
  color: var(--report-design-color);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-dev {
  color: var(--report-dev-color);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dev-float-switch {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 20;
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.90);
  backdrop-filter: blur(6px);
  padding: 4px 6px;
  border-radius: 9999px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.14);
}

.octo-toggle {
  width: 38px;
  height: 20px;
  border-radius: 9999px;
  border: none;
  background: #D1D5DC;
  padding: 0;
  cursor: pointer;
  position: relative;
  transition: background 200ms ease;
  outline: none;
}

.octo-toggle--on {
  background: #0067D1;
}

.octo-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 9999px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.20);
  transition: transform 200ms ease;
}

.octo-toggle--on .octo-toggle-thumb {
  transform: translateX(18px);
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
