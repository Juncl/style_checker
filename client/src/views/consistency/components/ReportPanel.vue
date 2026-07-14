<template>
  <!-- 标签栏 -->
  <div class="up-tabbar up-tabbar--report">
    <span class="report-tab-title">分析结果</span>
    <div class="report-links">
      <template v-if="isSaveVisible">
        <button
          class="report-link"
          :class="{ 'report-link--disabled': isSaveDisabled }"
          :disabled="isSaveDisabled"
          @click="handleSave"
        >存储</button>
        <span class="report-link-sep"></span>
      </template>
      <button class="report-link" @click="handleShare">分享</button>
      <span class="report-link-sep"></span>
      <button class="report-link" @click="showHistoryPanel = true">历史结果</button>
      <span class="report-link-sep"></span>
      <button
        class="report-link"
        :class="{ 'report-link--disabled': !canRerun }"
        :disabled="!canRerun"
        @click="handleRerun"
      >重新对比</button>
    </div>
  </div>

  <!-- debugger 模式：差异 / 节点树 切换 -->
  <div v-if="debugStore.debugMode" class="right-tabs">
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
    v-show="!debugStore.debugMode || rightTab === 'diff'"
    :diffs="mergedDiffs"
    :unmatched="tempResultStore.tempDiffs ? [] : result.unmatchedDesignNodes"
    :active-pair="activePairForDiff"
    :hover-pair="hoverPairForDiff"
    :version-id="workingVersionId"
    :platform="platformStore.currentPlatform"
    @select="$emit('diff-select', $event)"
    @diff-hover="$emit('diff-hover', $event)"
  />

  <div v-if="tempResultStore.tempDiffs" class="temp-diff-action-bar">
    <button class="temp-diff-action-btn" @click="onTempDiffAction">
      添加到分析结果
    </button>
  </div>

  <div v-show="debugStore.debugMode && rightTab === 'tree'" class="tree-source-switch">
    <button :class="{ active: treeSide === 'design' }" @click="treeSide = 'design'">
      设计 <span>{{ designNodes.length }}</span>
    </button>
    <button :class="{ active: treeSide === 'arkui' }" @click="treeSide = 'arkui'">
      开发 <span>{{ allArkuiNodes.length }}</span>
    </button>
  </div>
  <NodeTree
    v-show="debugStore.debugMode && rightTab === 'tree'"
    :nodes="treeNodes"
    :selected-id="treeSelectedId"
    @select="treeSide === 'design' ? $emit('design-node-click', $event) : $emit('arkui-node-click', $event)"
  />

  <transition name="fade">
    <div v-if="rerunLoading" class="rerun-loading-mask">
      <OctoLoading :size="48" class="rerun-spin" />
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
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useSelectionStore, usePlatformStore, useTempResultStore } from '../../../stores'
import OctoLoading from './common/OctoLoading.vue'
import DiffReport from './DiffReport.vue'
import NodeTree from './NodeTree.vue'
import ShareDialog from './ShareDialog.vue'
import HistoryPanel from './HistoryPanel.vue'
import { useDebugStore } from '../../../stores/debug'

const debugStore = useDebugStore()
const selectionStore = useSelectionStore()
const platformStore = usePlatformStore()
const tempResultStore = useTempResultStore()

const props = defineProps({
  result:           { type: Object,  required: true },
  activePairForDiff:{ type: Object,  default: null },
  hoverPairForDiff: { type: Object,  default: null },
  designNodes:      { type: Array,   default: () => [] },
  allArkuiNodes:    { type: Array,   default: () => [] },
  rerunLoading:     { type: Boolean, default: false },
  canRerun:         { type: Boolean, default: false },
  versionList:       { type: Array,              default: () => [] },
  workingVersionId:  { type: [Number, String],   default: null },
  closeHistoryKey:   { type: Number,             default: 0 },
  mergedDiffs:       { type: Array,              default: () => [] },
  reportCanvasMode:  { type: String,             default: 'default' },
  hasManualEdits:    { type: Boolean,            default: false },
  savingLoading:     { type: Boolean,            default: false },
})

const emit = defineEmits([
  'diff-select',
  'diff-hover',
  'design-node-click',
  'arkui-node-click',
  'rerun',
  'history-view',
  'temp-diff-action',
  'save',
])

function onTempDiffAction() {
  emit('temp-diff-action')
}

const rightTab = ref('diff')
const treeSide = ref('design')

const isSaveDisabled = computed(() => !props.hasManualEdits || props.savingLoading)
const isSaveVisible  = computed(() => props.hasManualEdits)
const showShareDialog  = ref(false)
const showHistoryPanel = ref(false)

// 父组件切换交付件/页面时通过 closeHistoryKey 发信号关闭面板
watch(() => props.closeHistoryKey, () => {
  showHistoryPanel.value = false
})

function onHistoryView(item) {
  showHistoryPanel.value = false
  emit('history-view', item)
}

function handleRerun() {
  showHistoryPanel.value = false
  emit('rerun')
}

function handleSave() {
  emit('save')
}

function handleShare() {
  const href = window.location.href
  if (!href.includes('deliverableId=') || !href.includes('pageId=')) {
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
    ? selectionStore.selectedPair?.design?.id || null
    : selectionStore.selectedPair?.arkui?.id  || null
)
</script>

<style scoped>
.rerun-loading-mask {
  position: fixed;
  inset: 0;
  z-index: 210;
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

.temp-diff-action-bar {
  position: sticky;
  bottom: 16px;
  padding: 0 16px;
  margin-top: 16px;
  flex-shrink: 0;
}

.temp-diff-action-btn {
  width: 100%;
  height: 32px;
  padding: 4px 16px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  color: #fff;
  background: var(--octo-primary);
  cursor: pointer;
  transition: background 150ms ease;
}

.temp-diff-action-btn:hover {
  background: #0056B3;
}
</style>
