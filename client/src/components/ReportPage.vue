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

  <!-- ── 中间主区：开发侧 + 设计侧 ── -->
  <main class="center-panel up-board">
    <div class="up-columns">
      <!-- 开发侧 -->
      <section class="up-col up-col--dev">
        <div class="up-tabbar up-tabbar--soft">
          <img :src="iconDev" alt="" class="up-tab-icon" />
          <span class="up-tab-text">开发环境</span>
          <span class="up-tab-sep">/</span>
          <span class="up-tab-text">20260306 10:50:15</span>
          <el-icon class="up-tab-arrow"><ArrowRight /></el-icon>
          <button class="up-tab-action" @click="$emit('recheck')">重新上传</button>
        </div>
        <div class="up-stage up-stage--report">
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
      </section>

      <!-- 设计侧 -->
      <section class="up-col up-col--design">
        <div class="up-tabbar">
          <img :src="iconDesign" alt="" class="up-tab-icon" />
          <span class="up-tab-text">设计页面</span>
          <span class="up-tab-sep">/</span>
          <span class="up-tab-text">主题购买页面示例</span>
          <el-icon class="up-tab-arrow"><ArrowRight /></el-icon>
          <button class="up-tab-action" @click="$emit('recheck')">重新上传</button>
        </div>
        <div class="up-stage up-stage--report">
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
      </section>
    </div>
  </main>

  <!-- ── 右侧差异报告面板 ── -->
  <aside class="right-panel up-right-panel">
    <!-- 标签栏 -->
    <div class="up-tabbar up-tabbar--report">
      <span class="report-tab-title">差异报告</span>
      <div class="report-links">
        <button class="report-link" @click="$emit('share')">分享</button>
        <span class="report-link-sep"></span>
        <button class="report-link">历史报告</button>
        <span class="report-link-sep"></span>
        <button class="report-link" @click="$emit('recheck')">重新对比</button>
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
import { ArrowRight } from '@element-plus/icons-vue'
import DiffReport from './DiffReport.vue'
import ImagePanel from './ImagePanel.vue'
import NodeTree from './NodeTree.vue'

const iconDev = '/src/assets/icon-dev.png'
const iconDesign = '/src/assets/icon-design.png'

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

function validationBg(status) {
  if (status === 'wrong')   return 'rgba(239, 68, 68, 0.18)'
  if (status === 'extra')   return 'rgba(234, 179, 8, 0.18)'
  if (status === 'missing') return 'rgba(150, 150, 150, 0.18)'
  return 'transparent'
}
</script>
