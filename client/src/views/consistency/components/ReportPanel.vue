<template>
  <!-- 标签栏 -->
  <div class="up-tabbar up-tabbar--report">
    <span class="report-tab-title">分析结果</span>
    <div class="report-links">
      <button class="report-link" @click="handleShare">分享</button>
      <span class="report-link-sep"></span>
      <button class="report-link" @click="showHistoryPanel = true">历史报告</button>
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
    @diff-hover="$emit('diff-hover', $event)"
  />

  <div v-show="debugMode && rightTab === 'tree'" class="tree-source-switch">
    <button :class="{ active: treeSide === 'design' }" @click="treeSide = 'design'">
      设计 <span>{{ designNodes.length }}</span>
    </button>
    <button :class="{ active: treeSide === 'arkui' }" @click="treeSide = 'arkui'">
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

  <ShareDialog
    v-if="showShareDialog"
    @close="showShareDialog = false"
  />

  <HistoryPanel
    :visible="showHistoryPanel"
    :items="versionList"
    :working-version-id="workingVersionId"
    @close="showHistoryPanel = false"
    @view="onHistoryView"
  />
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import DiffReport from './DiffReport.vue'
import NodeTree from './NodeTree.vue'
import ShareDialog from './ShareDialog.vue'
import HistoryPanel from './HistoryPanel.vue'

const props = defineProps({
  result:           { type: Object,  required: true },
  activePairForDiff:{ type: Object,  default: null },
  hoverPairForDiff: { type: Object,  default: null },
  debugMode:        { type: Boolean, default: false },
  selectedPair:     { type: Object,  default: null },
  designNodes:      { type: Array,   default: () => [] },
  allArkuiNodes:    { type: Array,   default: () => [] },
  lockedNodeIds:    { type: Set,     default: () => new Set() },
  rerunLoading:     { type: Boolean, default: false },
  canRerun:         { type: Boolean, default: false },
  versionList:       { type: Array,              default: () => [] },
  workingVersionId:  { type: [Number, String],   default: null },
})

const emit = defineEmits([
  'diff-select',
  'diff-hover',
  'design-node-click',
  'arkui-node-click',
  'toggle-lock',
  'rerun',
  'history-view',
])

const rightTab = ref('diff')
const treeSide = ref('design')
const emptyLockedIds = new Set()

const showShareDialog  = ref(false)
const showHistoryPanel = ref(false)

function onHistoryView(item) {
  showHistoryPanel.value = false
  emit('history-view', item)
}

function handleShare() {
  const href = window.location.href
  if (!href.includes('deliverableId=') || !href.includes('pageId=') || !href.includes('versionId=')) {
    ElMessage.warning('当前页面暂无分享链接，请先完成上传对比')
    return
  }
  showShareDialog.value = true
}

const treeNodes = computed(() =>
  treeSide.value === 'design' ? props.designNodes : props.allArkuiNodes
)

const treeSelectedId = computed(() =>
  treeSide.value === 'design'
    ? props.selectedPair?.design?.id || null
    : props.selectedPair?.arkui?.id  || null
)
</script>

<style scoped>
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
