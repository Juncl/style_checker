<template>
  <el-card class="summary-card" shadow="never">
    <div class="summary-grid">
      <!-- 评分 -->
      <div class="score-block">
        <el-progress
          type="circle"
          :percentage="stats.score"
          :color="scoreColor"
          :width="80"
          :stroke-width="8"
        />
        <div class="score-label">还原度评分</div>
      </div>

      <!-- 统计数字 -->
      <div class="stat-items">
        <div class="stat-item error">
          <div class="stat-num">{{ stats.errorCount }}</div>
          <div class="stat-label">
            <el-icon><CircleCloseFilled /></el-icon> Error
          </div>
        </div>
        <div class="stat-item warning">
          <div class="stat-num">{{ stats.warningCount }}</div>
          <div class="stat-label">
            <el-icon><WarningFilled /></el-icon> Warning
          </div>
        </div>
        <div class="stat-item info">
          <div class="stat-num">{{ stats.infoCount }}</div>
          <div class="stat-label">
            <el-icon><InfoFilled /></el-icon> Info
          </div>
        </div>
      </div>

      <!-- 匹配统计 -->
      <div class="match-items">
        <div class="match-row">
          <span class="match-label">设计节点</span>
          <el-tag size="small" type="info">{{ stats.designNodes }}</el-tag>
        </div>
        <div class="match-row">
          <span class="match-label">ArkUI 节点</span>
          <el-tag size="small" type="info">{{ stats.arkuiNodes }}</el-tag>
        </div>
        <div class="match-row">
          <span class="match-label">成功匹配</span>
          <el-tag size="small" type="success">{{ stats.matchedPairs }}</el-tag>
        </div>
        <div class="match-row">
          <span class="match-label">覆盖率</span>
          <el-tag size="small" :type="stats.matchCoverage >= 40 ? 'success' : 'warning'">
            {{ stats.matchCoverage ?? 0 }}%
          </el-tag>
        </div>
        <div class="match-row">
          <span class="match-label">低置信匹配</span>
          <el-tag size="small" :type="stats.lowConfidencePairs > 0 ? 'warning' : 'info'">
            {{ stats.lowConfidencePairs ?? 0 }}
          </el-tag>
        </div>
        <div class="match-row">
          <span class="match-label">设计未匹配</span>
          <el-tag size="small" :type="stats.unmatchedDesign > 0 ? 'warning' : 'info'">
            {{ stats.unmatchedDesign }}
          </el-tag>
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({ stats: Object })

const scoreColor = computed(() => {
  const s = props.stats.score
  if (s >= 90) return '#67c23a'
  if (s >= 70) return '#e6a23c'
  return '#f56c6c'
})
</script>

<style scoped>
.summary-card { border-radius: 8px; }
.summary-card :deep(.el-card__body) { padding: 16px 20px; }

.summary-grid {
  display: flex; align-items: center; gap: 32px; flex-wrap: wrap;
}

.score-block { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.score-label { font-size: 12px; color: #909399; }

.stat-items { display: flex; gap: 24px; }
.stat-item { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.stat-num { font-size: 28px; font-weight: 700; line-height: 1; }
.stat-label { display: flex; align-items: center; gap: 3px; font-size: 12px; color: #606266; }

.stat-item.error .stat-num   { color: #f56c6c; }
.stat-item.warning .stat-num { color: #e6a23c; }
.stat-item.info .stat-num    { color: #909399; }

.match-items { display: flex; flex-direction: column; gap: 6px; margin-left: auto; }
.match-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.match-label { font-size: 12px; color: #606266; }
</style>
