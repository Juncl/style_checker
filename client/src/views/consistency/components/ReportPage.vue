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
  <main class="center-panel up-board">
    <div class="up-columns">
      <!-- 开发侧 -->
      <section class="up-col up-col--dev">
        <div class="up-tabbar up-tabbar--soft">
          <img :src="iconDev" alt="" class="up-tab-icon" />
          <span class="up-tab-text">开发环境</span>
          <DeliverableDropdown
            :items="deliverables"
            :selected="selectedDeliverable"
            placeholder="选择"
            empty-text="暂无交付件"
            @select="selectedDeliverable = $event; selectedPage = null"
          />
          <DeliverableDropdown
            :items="pages"
            :selected="selectedPage"
            placeholder="选择页面"
            empty-text="暂无页面"
            @select="selectedPage = $event"
          />
          <button
            v-if="!devReuploading"
            class="up-tab-action"
            @click="$emit('recheck-dev')"
          >重新上传</button>
          <button
            v-else-if="devPreview || devPreviewLoading"
            class="up-tab-action"
            @click="$emit('clear-dev-preview')"
          >重新上传</button>
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
        <div class="up-tabbar">
          <img :src="iconDesign" alt="" class="up-tab-icon" />
          <span class="up-tab-text">设计页面</span>
          <button
            v-if="!designReuploading"
            class="up-tab-action"
            @click="$emit('recheck-design')"
          >重新上传</button>
          <button
            v-else-if="designPreview || designPreviewLoading"
            class="up-tab-action"
            @click="$emit('clear-design-preview')"
          >重新上传</button>
        </div>
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
  </main>

  <!-- ── 右侧差异报告面板 ── -->
  <aside class="right-panel up-right-panel" style="position: relative;">
    <!-- 标签栏 -->
    <div class="up-tabbar up-tabbar--report">
      <span class="report-tab-title">分析结果</span>
      <div class="report-links">
        <button class="report-link" @click="$emit('share')">分享</button>
        <span class="report-link-sep"></span>
        <button class="report-link">历史报告</button>
        <span class="report-link-sep"></span>
        <button
          class="report-link"
          :class="{ 'report-link--disabled': !canRerun }"
          :disabled="!canRerun"
          @click="$emit('rerun')"
        >重新对比</button>
      </div>
    </div>

    <!-- debugger 模式：差异 / 节点树 切换 -->
    <div v-if="debugMode" class="right-tabs">
      <button
        :class="['rtab', { active: rightTab === 'diff' }]"
        @click="rightTab = 'diff'"
      >
        差异报告
        <span class="rtab-badge error">{{ result.stats.errorCount }}</span>
        <span class="rtab-badge warning">{{ result.stats.warningCount }}</span>
      </button>
      <button
        :class="['rtab', { active: rightTab === 'tree' }]"
        @click="rightTab = 'tree'"
      >
        节点树
        <span class="rtab-badge neutral">{{ treeNodes.length }}</span>
      </button>
    </div>

    <DiffReport
      v-show="!debugMode || rightTab === 'diff'"
      :diffs="result.diffs"
      :unmatched="result.unmatchedDesignNodes"
      :active-pair="activePairForDiff"
      :hover-pair="hoverPairForDiff"
      :debug-mode="debugMode"
      @select="$emit('diff-select', $event)"
      @diff-hover="hoveredDiffPair = $event"
    />

    <div v-show="debugMode && rightTab === 'tree'" class="tree-source-switch">
      <button
        :class="{ active: treeSide === 'design' }"
        @click="treeSide = 'design'"
      >
        设计 <span>{{ designNodes.length }}</span>
      </button>
      <button
        :class="{ active: treeSide === 'arkui' }"
        @click="treeSide = 'arkui'"
      >
        开发 <span>{{ allArkuiNodes.length }}</span>
      </button>
    </div>
    <NodeTree
      v-show="debugMode && rightTab === 'tree'"
      :nodes="treeNodes"
      :selected-id="treeSelectedId"
      :locked-ids="treeSide === 'design' ? lockedNodeIds : emptyLockedIds"
      :lockable="treeSide === 'design'"
      @select="treeSide === 'design' ? $emit('design-node-click', $event) : $emit('arkui-node-click', $event)"
      @toggle-lock="$emit('toggle-lock', $event)"
    />

    <transition name="fade">
      <div v-if="rerunLoading" class="rerun-loading-mask">
        <el-icon class="rerun-spin" size="28"><Loading /></el-icon>
        <span>正在重新对比…</span>
      </div>
    </transition>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Crop, Loading } from '@element-plus/icons-vue'
import DiffReport from './DiffReport.vue'
import ImagePanel from './ImagePanel.vue'
import NodeTree from './NodeTree.vue'
import DevUploadCard from './DevUploadCard.vue'
import DesignUploadCard from './DesignUploadCard.vue'
import DeliverableDropdown from './DeliverableDropdown.vue'
import { imageUrl } from '../../../api/index.ts'
import { validationBg, confidenceText, confidenceTagType, matchTypePass } from '../../utils/tools.ts'

import iconDev from '@/assets/icon-dev.png'
import iconDesign from '@/assets/icon-design.png'

const props = defineProps({
  result: {
    type: Object,
    required: true
  },
  arkuiImgSrc: {
    type: String,
    required: true
  },
  designImgSrc: {
    type: String,
    required: true
  },
  designNodes: {
    type: Array,
    default: () => []
  },
  allArkuiNodes: {
    type: Array,
    default: () => []
  },
  arkuiNodes: {
    type: Array,
    default: () => []
  },
  selectedPair: {
    type: Object,
    default: null
  },
  activeDiff: {
    type: Object,
    default: null
  },
  debugMode: {
    type: Boolean,
    default: false
  },
  debugPipelineOn: {
    type: Boolean,
    default: false
  },
  debugOverlayOn: {
    type: Boolean,
    default: false
  },
  debugPairItems: {
    type: Array,
    default: () => []
  },
  debugPairMap: {
    type: Object,
    default: () => ({})
  },
  lockedNodeIds: {
    type: Set,
    default: () => new Set()
  },
  selectedDesignDiffs: {
    type: Array,
    default: () => []
  },
  selectedArkuiDiffs: {
    type: Array,
    default: () => []
  },
  cases: {
    type: Array,
    default: () => []
  },
  selectedCase: {
    type: String,
    default: ''
  },
  caseNames: {
    type: Object,
    default: () => ({})
  },
  currentPlatform: {
    type: String,
    default: 'hmPhone'
  },
  rerunLoading: {
    type: Boolean,
    default: false
  },
  devReuploading: {
    type: Boolean,
    default: false
  },
  designReuploading: {
    type: Boolean,
    default: false
  },
  devPreview: {
    type: Object,
    default: null
  },
  devPreviewLoading: {
    type: Boolean,
    default: false
  },
  designPreview: {
    type: Object,
    default: null
  },
  designPreviewLoading: {
    type: Boolean,
    default: false
  },
  blobDevSrc: {
    type: String,
    default: ''
  },
  blobDesignSrc: {
    type: String,
    default: ''
  },
  uploadFiles: {
    type: Object,
    default: () => ({})
  },
  deliverables: {
    type: Array,
    default: () => []
  },
  pages: {
    type: Array,
    default: () => []
  },
})

const emit = defineEmits([
  'arkui-node-click',
  'design-node-click',
  'clear-diff',
  'clear-pair',
  'share',
  'recheck',
  'recheck-dev',
  'recheck-design',
  'clear-design-preview',
  'rerun',
  'diff-select',
  'toggle-lock',
  'update:debug-pipeline-on',
  'update:debug-overlay-on',
  'select-case',
  'step-picked',
  'clear-dev-preview',
])

const selectedDeliverable = ref(null)
const selectedPage        = ref(null)

const rightTab = ref('diff')
const treeSide = ref('design')

const canRerun = computed(() => {
  const devOk    = !props.devReuploading    || !!props.devPreview
  const designOk = !props.designReuploading || !!props.designPreview
  return devOk && designOk && !props.rerunLoading
})
const debugMappingExpanded = ref(false)
const emptyLockedIds = new Set()

const devPanelRef    = ref(null)
const designPanelRef = ref(null)

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

// ── 左侧 canvas → 右侧 DiffReport 联动 ──────────────────────────────────────
const hoveredArkuiNodeId  = ref(null)
const hoveredDesignNodeId = ref(null)
const hoveredDiffPair     = ref(null)   // 右侧差异栏 hover 传来的 { arkuiNodeId, designNodeId }

const activePairForDiff = computed(() => {
  if (!props.selectedPair) return null
  return {
    designNodeId: props.selectedPair.design?.id ?? null,
    arkuiNodeId:  props.selectedPair.arkui?.id  ?? null,
  }
})

const hoverPairForDiff = computed(() => {
  if (!hoveredArkuiNodeId.value && !hoveredDesignNodeId.value) return null
  return {
    arkuiNodeId:  hoveredArkuiNodeId.value  ?? null,
    designNodeId: hoveredDesignNodeId.value ?? null,
  }
})

// hover 时，在 pairs 里查找对方画布的映射节点 id
// 右侧差异栏 hover 优先，否则退回到跨画布联动
const hoveredDesignCrossId = computed(() => {
  if (hoveredDiffPair.value?.designNodeId) return hoveredDiffPair.value.designNodeId
  if (!hoveredArkuiNodeId.value) return null
  const pair = props.result?.pairs?.find(p => p.arkui?.id === hoveredArkuiNodeId.value)
  return pair?.design?.id ?? null
})
const hoveredArkuiCrossId = computed(() => {
  if (hoveredDiffPair.value?.arkuiNodeId) return hoveredDiffPair.value.arkuiNodeId
  if (!hoveredDesignNodeId.value) return null
  const pair = props.result?.pairs?.find(p => p.design?.id === hoveredDesignNodeId.value)
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

// 拖拽位置（null = 使用 CSS 默认值）
const debugFloatX  = ref(null)
const nodeBarX     = ref(240)
const caseListX    = ref(10)
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

const treeNodes = computed(() =>
  (treeSide.value === 'design' ? props.designNodes : props.allArkuiNodes)
)

const treeSelectedId = computed(() =>
  treeSide.value === 'design'
    ? props.selectedPair?.design?.id || null
    : props.selectedPair?.arkui?.id || null
)

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

.rerun-loading-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(255, 255, 255, 0.88);
  font-size: 13px;
  color: #555;
}

.rerun-spin {
  animation: rerun-rotate 0.8s linear infinite;
}

@keyframes rerun-rotate {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
</style>
