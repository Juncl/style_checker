<template>
  <div v-if="reportData" class="ai-report-view">
    <div class="ai-report-main">
      <!-- 顶部 tabbar（仅图标 + 文字两列） -->
      <div class="c-tabbar">
        <div class="c-tabbar-col c-tabbar-col--dev">
          <img :src="iconDev" alt="" class="up-tab-icon" />
          <span class="up-tab-text">开发环境</span>
        </div>
        <div class="c-tabbar-col c-tabbar-col--design">
          <img :src="iconDesign" alt="" class="up-tab-icon" />
          <span class="up-tab-text">设计页面</span>
        </div>
      </div>

      <div class="ai-report-images">
        <div class="ai-report-image-box">
          <ImagePanel
            :src="reportData.devImg"
            :canvas-w="1"
            :canvas-h="1"
            :nodes="devNodes"
            :selected-id="devSelectedId"
            :external-hovered-id="devHoverId"
            side="dev"
            :platform="platform"
            :style-diffs="[]"
            :debug-pair-map="pairMap"
          />
        </div>
        <div class="ai-report-images-sep"></div>
        <div class="ai-report-image-box">
          <ImagePanel
            :src="reportData.designImg"
            :canvas-w="1"
            :canvas-h="1"
            :nodes="designNodes"
            :selected-id="designSelectedId"
            :external-hovered-id="designHoverId"
            side="design"
            :platform="platform"
            :style-diffs="[]"
            :debug-pair-map="pairMap"
          />
        </div>
      </div>
    </div>
    <aside class="ai-report-diff-panel">
      <div class="up-tabbar up-tabbar--report">
        <span class="report-tab-title">分析结果</span>
      </div>
      <DiffReport
        :diffs="reportData.diffs"
        :unmatched="reportData.unmatchedDesignNodes"
        :active-pair="activePair"
        :hover-pair="hoverPair"
        :platform="platform"
        fuzzy-only
        @select="(diff) => $emit('select', diff)"
        @diff-hover="(pair) => $emit('diff-hover', pair)"
      />
    </aside>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import ImagePanel from './ImagePanel.vue'
import DiffReport from './DiffReport.vue'
import iconDev from '@/assets/icon-dev.png'
import iconDesign from '@/assets/icon-design.png'

const props = defineProps({
  reportData:          { type: Object, default: null },
  designSelectedId:    { type: String, default: null },
  devSelectedId:       { type: String, default: null },
  designHoverId:       { type: String, default: null },
  devHoverId:          { type: String, default: null },
  activePair:          { type: Object, default: null },
  hoverPair:           { type: Object, default: null },
  platform:            { type: String, required: true },
})

defineEmits(['select', 'diff-hover'])

const designNodes = computed(() => props.reportData?.designNodes ?? [])
const devNodes    = computed(() => props.reportData?.devNodes    ?? [])
const pairMap     = computed(() => props.reportData?.pairMap     ?? {})
</script>

<style scoped>
.ai-report-view {
  display: flex;
  flex: 1;
  min-width: 0;
}

.ai-report-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* ── 顶部 tabbar（仅图标 + 文字两列） ── */
.c-tabbar {
  display: flex;
  height: var(--octo-tabbar-height);
  border-bottom: 1px solid var(--octo-border-separator);
  flex-shrink: 0;
}
.c-tabbar-col {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 24px;
  background: var(--octo-surface-page);
}
.c-tabbar-col--dev {
  border-right: 1px solid var(--octo-border-separator);
}
.up-tab-icon {
  width: 20px;
  height: 20px;
  border-radius: 2px;
  display: block;
  flex-shrink: 0;
}
.up-tab-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--octo-text-primary);
  white-space: nowrap;
}

.ai-report-images {
  flex: 1;
  display: flex;
  min-width: 0;
}
.ai-report-image-box {
  flex: 1;
  min-width: 0;
  display: flex;
  padding: 16px;
}
.ai-report-image-box > :deep(.img-panel) {
  flex: 1;
  min-width: 0;
}
.ai-report-images-sep {
  width: 1px;
  flex-shrink: 0;
  background: var(--octo-border-separator);
}

.ai-report-diff-panel {
  width: 336px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--octo-surface-page);
  border-left: 1px solid var(--octo-border-default);
}

/* ── 报告侧 tabbar（仅"分析结果"文字） ── */
.ai-report-diff-panel .up-tabbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--octo-tabbar-height);
  padding: 0 16px;
  background: var(--octo-surface-page);
  border-bottom: 1px solid var(--octo-border-separator);
  flex-shrink: 0;
}
.ai-report-diff-panel .report-tab-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--octo-text-primary);
}
</style>
