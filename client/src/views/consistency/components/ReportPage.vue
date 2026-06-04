<template>
  <!-- ── Case 列表悬浮框 ── -->
  <div v-if="debugMode" class="case-list-float"
    :style="{ left: caseListX + 'px' }">
    <div class="clf-head drag-handle" @mousedown="startDrag($event, 'caselist')">
      <div class="clf-head-left">
        <span class="clf-title">Cases</span>
        <span class="clf-count">{{ cases.length }}</span>
      </div>
      <button class="clf-chevron" @click.stop="caseListExpanded = !caseListExpanded">
        {{ caseListExpanded ? '▾' : '▸' }}
      </button>
    </div>
    <div v-if="caseListExpanded" class="clf-body">
      <button
        v-for="c in cases"
        :key="c.id"
        class="clf-row"
        :class="{ 'clf-row--active': selectedCase === c.id }"
        @click="$emit('select-case', c.id)"
      >
        <div class="clf-thumb">
          <img :src="caseImageUrl(c.id)" class="clf-thumb-img" alt="" />
        </div>
        <span class="clf-name">{{ c.id }}</span>
      </button>
    </div>
  </div>

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
            :type="matchTypePass(selectedPair.matchType) ? 'primary' : ''"
            :class="{ 'tag-unmatched': !matchTypePass(selectedPair.matchType) }"
          >
            {{ matchTypePass(selectedPair.matchType)
              ? matchTypePass(selectedPair.matchType) + ': ' + selectedPair.matchType
              : selectedPair.matchType }}
          </el-tag>
          <el-tag
            v-if="selectedPair.confidence"
            size="small"
            effect="plain"
            :type="confidenceTagType(selectedPair.confidence)"
          >{{ confidenceText(selectedPair.confidence) }}</el-tag>
        </div>
      </div>
    </div>
  </transition>

  <!-- ── 中间主区：开发侧 + 设计侧 ── -->
  <div class="up-columns">
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
                <el-icon class="spin" size="32"><Loading /></el-icon>
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
          :src="arkuiImgSrc"
          :highlight="null"
          :highlight-pair="null"
          :canvas-w="result.canvas.arkui.w"
          :canvas-h="result.canvas.arkui.h"
          :nodes="arkuiNodes"
          :selected-id="selectedPair?.arkui?.id || null"
          :inspector-node="selectedPair?.arkui || null"
          :style-diffs="selectedArkuiDiffs"
          :external-hovered-id="hoveredArkuiCrossId"
          :debug-mode="debugMode"
          :debug-pipeline-visible="debugPipelineOn"
          :debug-visible="debugOverlayOn"
          :debug-pair-map="debugPairMap"
          @node-click="$emit('arkui-node-click', $event)"
          @node-hover="onArkuiHover"
          @bg-click="$emit('clear-pair')"
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
                <el-icon class="spin" size="32"><Loading /></el-icon>
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
          side="design"
          :src="designImgSrc"
          :highlight="null"
          :highlight-pair="null"
          :canvas-w="result.canvas.design.w"
          :canvas-h="result.canvas.design.h"
          :nodes="designNodes"
          :selected-id="selectedPair?.design?.id || null"
          :inspector-node="selectedPair?.design || null"
          :style-diffs="selectedDesignDiffs"
          :locked-ids="lockedNodeIds"
          :external-hovered-id="hoveredDesignCrossId"
          :debug-mode="debugMode"
          :debug-pipeline-visible="debugPipelineOn"
          :debug-visible="debugOverlayOn"
          :debug-pair-map="debugPairMap"
          @node-click="$emit('design-node-click', $event)"
          @node-hover="onDesignHover"
          @bg-click="$emit('clear-pair')"
          @zoom="onDesignPanelZoom"
        />
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { Crop, Loading } from '@element-plus/icons-vue'
import ImagePanel from './ImagePanel.vue'
import DevUploadCard from './DevUploadCard.vue'
import DesignUploadCard from './DesignUploadCard.vue'
import { fetchCases, imageUrl } from '../../../api/index.ts'
import { validationBg, confidenceText, confidenceTagType, matchTypePass } from '../../utils/tools.ts'

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
])

const cases = ref([])

async function loadCases(platform) {
  cases.value = []
  try { cases.value = await fetchCases(platform) } catch { /* 静默 */ }
}

onMounted(() => loadCases(props.currentPlatform))
watch(() => props.currentPlatform, loadCases)

const devPanelRef    = ref(null)
const designPanelRef = ref(null)
const debugMappingExpanded = ref(false)

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

// 拖拽位置
const debugFloatX      = ref(null)
const nodeBarX         = ref(240)
const caseListX        = ref(10)
const caseListExpanded = ref(false)

function startDrag(e, which) {
  e.preventDefault()
  const startMouseX = e.clientX
  const W = which === 'caselist' ? 220 : 280
  const startX = which === 'debug'
    ? (debugFloatX.value ?? (window.innerWidth - W - 10))
    : which === 'caselist'
      ? caseListX.value
      : nodeBarX.value
  const onMove = (ev) => {
    const newX = Math.max(0, Math.min(window.innerWidth - W, startX + ev.clientX - startMouseX))
    if (which === 'debug') debugFloatX.value = newX
    else if (which === 'caselist') caseListX.value = newX
    else nodeBarX.value = newX
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function caseImageUrl(caseId) {
  return imageUrl(caseId, 'design', props.currentPlatform)
}
</script>

<style scoped>
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
