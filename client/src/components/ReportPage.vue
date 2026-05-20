<template>
  <!-- ── Debugger 悬浮框 ── -->
  <div v-if="debugMode" class="debugger-float">
    <div class="debugger-head">
      <div class="debugger-title">
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

  <!-- ── 中间主区 ── -->
  <main class="center-panel">
    <div class="report-container">
      <!-- 节点选中说明条 -->
      <transition name="fade">
        <div v-if="selectedPair" class="highlight-bar node-bar">
          <el-icon><Crop /></el-icon>
          已选中实机节点：<b>{{ selectedPair.arkui?.textContent || selectedPair.arkui?.name || selectedPair.design?.textContent || selectedPair.design?.name }}</b>
          <el-tag size="small" effect="plain" style="margin-left:4px">{{ selectedPair.matchType }}</el-tag>
          <el-tag
            v-if="selectedPair.confidence"
            size="small"
            effect="plain"
            :type="confidenceTagType(selectedPair.confidence)"
          >
            {{ confidenceText(selectedPair.confidence) }}
          </el-tag>
          <el-button link size="small" style="margin-left:auto" @click="$emit('clear-pair')">✕ 取消</el-button>
        </div>
      </transition>
      <!-- 开发侧列 -->
      <div class="report-col">
        <div class="report-col-title">
          <div>
            <img :src="iconDev" alt="" class="report-col-title-icon" />
            <span>开发环境</span>
          </div>
          <button class="upload-col-reupload" @click="$emit('reupload')">重新上传</button>
        </div>
        <ImagePanel
          :src="arkuiImgSrc"
          :highlight="null"
          :highlight-pair="null"
          :canvas-w="result.canvas.arkui.w"
          :canvas-h="result.canvas.arkui.h"
          :nodes="arkuiNodes"
          :selected-id="selectedPair?.arkui?.id || null"
          :inspector-node="selectedPair?.arkui || null"
          :style-diffs="selectedArkuiDiffs"
          :debug-mode="debugMode"
          :debug-pipeline-visible="debugPipelineOn"
          :debug-visible="debugOverlayOn"
          :debug-pair-map="debugPairMap"
          @node-click="$emit('arkui-node-click', $event)"
        />
      </div>

      <!-- 设计侧列 -->
      <div class="report-col">
        <div class="report-col-title">
          <div>
            <img :src="iconDesign" alt="" class="report-col-title-icon" />
            <span>设计页面</span>
          </div>
          <button class="upload-col-reupload" @click="$emit('reupload')">重新上传</button>
        </div>
        <ImagePanel
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
          :debug-mode="debugMode"
          :debug-pipeline-visible="debugPipelineOn"
          :debug-visible="debugOverlayOn"
          :debug-pair-map="debugPairMap"
          @node-click="$emit('design-node-click', $event)"
        />
      </div>
    </div>
  </main>

  <!-- ── 右侧面板 ── -->
  <aside class="right-panel">
    <!-- 标题栏 -->
    <div class="right-panel-header">
      <span class="right-panel-title">差异报告</span>
      <button class="rpa-link" @click="$emit('share')">分享</button>
      <button class="rpa-link">历史预览</button>
      <button class="rpa-link" @click="$emit('recheck')">重新对比</button>
    </div>

    <!-- 标签页 + 内容 -->
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
      @select="$emit('diff-select', $event)"
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
  </aside>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Location, Crop } from '@element-plus/icons-vue'
import DiffReport from './DiffReport.vue'
import ImagePanel from './ImagePanel.vue'
import NodeTree from './NodeTree.vue'

const iconDev = '/src/assets/a4.png'
const iconDesign = '/src/assets/a5.png'

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
  }
})

defineEmits([
  'arkui-node-click',
  'design-node-click',
  'clear-diff',
  'clear-pair',
  'share',
  'recheck',
  'diff-select',
  'toggle-lock',
  'update:debug-pipeline-on',
  'update:debug-overlay-on'
])

const rightTab = ref('diff')
const treeSide = ref('design')
const debugMappingExpanded = ref(false)
const emptyLockedIds = new Set()

const treeNodes = computed(() =>
  (treeSide.value === 'design' ? props.designNodes : props.allArkuiNodes)
)

const treeSelectedId = computed(() =>
  treeSide.value === 'design'
    ? props.selectedPair?.design?.id || null
    : props.selectedPair?.arkui?.id || null
)

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
