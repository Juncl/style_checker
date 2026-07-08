<template>
  <div v-if="reportData" class="ai-report-view">
    <div class="ai-report-images">
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
        :debug-pair-map="{}"
      />
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
        :debug-pair-map="{}"
      />
    </div>
    <aside class="ai-report-diff-panel">
      <DiffReport
        :diffs="reportData.diffs"
        :unmatched="reportData.unmatchedDesignNodes"
        :active-pair="activePair"
        :hover-pair="hoverPair"
        :platform="platform"
        @select="(diff) => $emit('select', diff)"
        @diff-hover="(pair) => $emit('diff-hover', pair)"
      />
    </aside>
  </div>
</template>

<script setup>
import ImagePanel from './ImagePanel.vue'
import DiffReport from './DiffReport.vue'

defineProps({
  reportData:          { type: Object, required: true },
  designNodes:         { type: Array, default: () => [] },
  devNodes:            { type: Array, default: () => [] },
  designSelectedId:    { type: String, default: null },
  devSelectedId:       { type: String, default: null },
  designHoverId:       { type: String, default: null },
  devHoverId:          { type: String, default: null },
  activePair:          { type: Object, default: null },
  hoverPair:           { type: Object, default: null },
  platform:            { type: String, required: true },
})

defineEmits(['select', 'diff-hover'])
</script>

<style scoped>
.ai-report-view {
  display: flex;
  flex: 1;
  min-width: 0;
}

.ai-report-images {
  flex: 1;
  display: flex;
  min-width: 0;
}
.ai-report-images > :deep(.img-panel) {
  flex: 1;
  min-width: 0;
}

.ai-report-diff-panel {
  width: 336px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--octo-surface-page);
  border-left: 1px solid var(--octo-border-default);
}
</style>
