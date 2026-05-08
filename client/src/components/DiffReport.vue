<template>
  <div class="diff-panel">
    <div class="diff-toolbar">
      <div class="issue-tabs">
        <button
          v-for="group in issueGroups"
          :key="group.key"
          :class="['issue-tab', { active: activeIssue === group.key }]"
          @click="selectIssue(group.key)"
        >
          {{ group.label }}
          <span class="badge">{{ issueCounts[group.key] || 0 }}</span>
        </button>
      </div>
      <div class="toolbar-row">
        <div class="severity-summary">
          <span v-for="s in severitySummary" :key="s.key" :class="['severity-chip', s.key]">
            {{ s.label }} {{ s.count }}
          </span>
        </div>
        <label class="confidence-toggle">
          <span>低置信</span>
          <el-switch v-model="showLowConfidence" size="small" />
        </label>
      </div>
      <el-input
        v-model="search"
        size="small"
        placeholder="搜索..."
        clearable
        class="search-input"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
    </div>

    <div class="diff-list" ref="listRef">
      <template v-if="filteredDiffs.length === 0">
        <div class="empty-state">
          <el-icon size="36" color="#c0c4cc"><CircleCheck /></el-icon>
          <p>无差异项</p>
        </div>
      </template>

      <div
        v-for="(d, idx) in filteredDiffs"
        :key="`${d.designNodeId}-${d.property}-${idx}`"
        :class="['diff-item', d.severity, { selected: selectedIdx === idx }]"
        @click="selectItem(d, idx)"
      >
        <div class="diff-body">
          <div class="diff-meta">
            <span class="issue-badge">{{ issueLabel(d.property) }}</span>
            <span class="prop-tag">{{ d.property }}</span>
            <span :class="['confidence-badge', d.confidence || 'medium']">
              {{ confidenceLabel(d.confidence) }}
            </span>
            <span class="match-tag">{{ d.matchType }}</span>
            <span v-if="d.relatedDesignName" class="relation-tag">
              {{ d.designName }} ↔ {{ d.relatedDesignName }}
            </span>
            <span v-if="d.textContent" class="text-snippet">「{{ truncate(d.textContent, 12) }}」</span>
          </div>

          <div class="diff-values">
            <div class="val-block arkui">
              <span class="val-label">开发</span>
              <ColorDot v-if="isColorProp(d.property)" :hex="extractHex(d.arkuiValue)" />
              <span class="val-text">{{ displayValue(d.property, d.arkuiValue) }}</span>
            </div>
            <el-icon class="arrow"><ArrowRight /></el-icon>
            <div class="val-block design">
              <span class="val-label">设计</span>
              <ColorDot v-if="isColorProp(d.property)" :hex="extractHex(d.designValue)" />
              <span class="val-text">{{ displayValue(d.property, d.designValue) }}</span>
            </div>
          </div>

          <div class="diff-desc">{{ d.description }}</div>
        </div>
      </div>

      <template v-if="unmatched.length > 0">
        <div v-show="false">
          <div class="section-divider">
            设计稿未匹配节点 ({{ filteredUnmatched.length }}/{{ unmatched.length }})
          </div>
          <div class="unmatched-chips">
            <el-tag
              v-for="n in filteredUnmatched"
              :key="n.id"
              type="warning" effect="plain" size="small"
            >
              {{ n.textContent ? truncate(n.textContent, 14) : truncate(n.name, 14) }}
            </el-tag>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, defineComponent, h } from 'vue'

const ColorDot = defineComponent({
  props: { hex: String },
  setup(props) {
    const bg = computed(() => {
      const h = (props.hex || '').replace('#', '')
      if (h.length === 8) {
        const a = parseInt(h.slice(0, 2), 16) / 255
        const r = parseInt(h.slice(2, 4), 16)
        const g = parseInt(h.slice(4, 6), 16)
        const b = parseInt(h.slice(6, 8), 16)
        return `rgba(${r},${g},${b},${a.toFixed(2)})`
      }
      return `#${h}`
    })
    return () => props.hex
      ? h('span', { class: 'color-dot', style: { background: bg.value }, title: props.hex })
      : null
  },
})

const props = defineProps({
  diffs:     { type: Array, default: () => [] },
  unmatched: { type: Array, default: () => [] },
})
const emit = defineEmits(['select'])

const ISSUE_GROUPS = [
  { key: 'all', label: '全部' },
  { key: 'fontSize', label: '字号' }, { key: 'fontFamily', label: '字体' }, { key: 'fontWeight', label: '字重' },
  { key: 'color', label: '颜色' }, { key: 'fill', label: '填充' }, { key: 'borderColor', label: '描边颜色' },
  { key: 'borderWidth', label: '描边宽度' }, { key: 'borderRadius', label: '圆角' }, { key: 'shadow', label: '阴影' },
  { key: 'backdropBlur', label: '模糊' },
  { key: 'opacity', label: '不透明度' }, { key: 'padding', label: '内边距' },
  { key: 'spacing', label: '间距' }, { key: 'fontSize.scale', label: '字体缩放' }, { key: 'other', label: '其它' },
]

const activeIssue = ref('all')
const showLowConfidence = ref(false)
const search      = ref('')
const selectedIdx = ref(-1)
const listRef     = ref(null)

const visibleDiffs = computed(() =>
  showLowConfidence.value ? props.diffs : props.diffs.filter(d => d.confidence !== 'low')
)
const IGNORED_ISSUE_PROPS = new Set(['textAlign'])
const issueGroups = computed(() =>
  ISSUE_GROUPS.filter(group => group.key === 'all' || (issueCounts.value[group.key] || 0) > 0)
)
const issueCounts = computed(() => {
  const counts = { all: visibleDiffs.value.length }
  for (const d of visibleDiffs.value) {
    const key = issueKey(d.property)
    if (key === '__ignored__') continue
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
})
const severitySummary = computed(() => [
  { key: 'error', label: 'Error', count: visibleDiffs.value.filter(d => d.severity === 'error').length },
  { key: 'warning', label: 'Warning', count: visibleDiffs.value.filter(d => d.severity === 'warning').length },
  { key: 'info', label: 'Info', count: visibleDiffs.value.filter(d => d.severity === 'info').length },
])
const filteredDiffs = computed(() => {
  const q = search.value.trim().toLowerCase()
  let list = activeIssue.value === 'all'
    ? visibleDiffs.value
    : visibleDiffs.value.filter(d => issueKey(d.property) === activeIssue.value)
  if (q) {
    list = list.filter(d =>
      d.property.toLowerCase().includes(q) ||
      issueLabel(d.property).includes(q) ||
      (d.textContent || '').includes(q) ||
      d.description.toLowerCase().includes(q)
    )
  }
  const sevOrder = { error: 0, warning: 1, info: 2 }
  const issueOrder = Object.fromEntries(ISSUE_GROUPS.map((g, idx) => [g.key, idx]))
  return list.slice().sort((a, b) => {
    const issueDelta = (issueOrder[issueKey(a.property)] ?? 99) - (issueOrder[issueKey(b.property)] ?? 99)
    if (activeIssue.value === 'all' && issueDelta !== 0) return issueDelta
    return (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9)
  })
})
const filteredUnmatched = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.unmatched
  return props.unmatched.filter(n =>
    (n.name || '').toLowerCase().includes(q) ||
    (n.textContent || '').toLowerCase().includes(q) ||
    (n.type || '').toLowerCase().includes(q)
  )
})
function selectIssue(key) {
  activeIssue.value = key
  selectedIdx.value = -1
  emit('select', null)
}
function selectItem(d, idx) {
  if (selectedIdx.value === idx) {
    selectedIdx.value = -1
    emit('select', null)
  } else {
    selectedIdx.value = idx
    emit('select', d)
  }
}

const COLOR_PROPS = new Set(['fontColor', 'backgroundColor', 'border.color', 'borderColor', 'shadow.color'])
function isColorProp(p)  { return COLOR_PROPS.has(p) }
function extractHex(val) { return (String(val || '').match(/#[0-9A-Fa-f]{6,8}/) || [''])[0] }
function displayValue(prop, val) {
  const text = String(val ?? '')
  if (!isColorProp(prop)) return text
  return extractHex(text) || text.replace(/\s*\(rgba\([^)]+\)\)/i, '')
}
function truncate(s, n)  { return s.length > n ? s.slice(0, n) + '…' : s }
function confidenceLabel(confidence) {
  if (confidence === 'high') return '高'
  if (confidence === 'low') return '低'
  return '中'
}
function issueKey(property = '') {
  const p = String(property)
  if (p === 'fontSize.scale') return 'fontSize.scale'
  if (IGNORED_ISSUE_PROPS.has(p)) return '__ignored__'
  if (p === 'fontSize') return 'fontSize'
  if (p === 'fontFamily') return 'fontFamily'
  if (p === 'fontWeight') return 'fontWeight'
  if (p === 'fontColor') return 'color'
  if (p === 'backgroundColor') return 'fill'
  if (p === 'borderColor' || p === 'border.color') return 'borderColor'
  if (p === 'borderWidth') return 'borderWidth'
  if (p === 'borderRadius') return 'borderRadius'
  if (p === 'shadow' || p.startsWith('shadow.')) return 'shadow'
  if (p === 'blur' || p === 'backdropBlur') return 'backdropBlur'
  if (p === 'opacity') return 'opacity'
  if (p === 'padding') return 'padding'
  if (p === 'itemSpacing' || p.startsWith('spacing.')) return 'spacing'
  return 'other'
}
function issueLabel(property) {
  const key = issueKey(property)
  if (key === '__ignored__') return '对齐'
  return ISSUE_GROUPS.find(g => g.key === key)?.label || '其它'
}
</script>

<style scoped>
.diff-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.diff-toolbar {
  padding: 10px 12px 8px;
  border-bottom: 1px solid #e5e5e5;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
  background: #fff;
}

.issue-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.issue-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 12px;
  border: 1.5px solid transparent;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  background: #f5f5f5;
  color: #737373;
  transition: all .15s;
}
.issue-tab.active {
  border-color: #0a59f7;
  color: #0a59f7;
  background: #f3f7ff;
}

.badge {
  background: #fff;
  color: currentColor;
  border: 1px solid currentColor;
  border-radius: 8px;
  padding: 0 5px;
  font-size: 10px;
  line-height: 16px;
  min-width: 16px;
  text-align: center;
  font-weight: 700;
}

.severity-summary {
  display: none;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  min-width: 0;
}
.severity-chip {
  font-size: 10px;
  font-weight: 700;
  border-radius: 10px;
  padding: 2px 7px;
}
.severity-chip.error   { background: #fff3f2; color: #d93026; }
.severity-chip.warning { background: #fff8e8; color: #9a5b00; }
.severity-chip.info    { background: #f5f5f5; color: #737373; }

.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.confidence-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  font-size: 12px;
  color: #5f6d82;
}

.search-input { font-size: 12px; }

.diff-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}

.diff-item {
  display: flex;
  align-items: stretch;
  padding: 0;
  margin: 4px 8px;
  border-radius: 8px;
  border: 1px solid #e5e5e5;
  background: #fff;
  cursor: pointer;
  transition: all .15s;
}
.diff-item:hover { border-color: #d8d8d8; background: #fafafa; }
.diff-item.selected { border-color: #0a59f7; background: #f3f7ff; box-shadow: 0 0 0 2px rgba(10,89,247,.10); }

.diff-body { padding: 8px 10px; flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }

.diff-meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }

.prop-tag {
  font-size: 11px;
  font-family: monospace;
  background: #f5f5f5;
  color: #0a59f7;
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
}

.issue-badge {
  font-size: 10px;
  font-weight: 700;
  color: #0a59f7;
  background: #eef4ff;
  border: 1px solid #d8e6ff;
  border-radius: 4px;
  padding: 1px 5px;
  flex-shrink: 0;
}

.match-tag {
  font-size: 10px;
  color: #909399;
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 3px;
  padding: 0 4px;
  flex-shrink: 0;
}

.relation-tag {
  font-size: 10px;
  color: #8a5c00;
  background: #fff7ea;
  border: 1px solid #f0d8aa;
  border-radius: 3px;
  padding: 0 5px;
  flex-shrink: 0;
}

.confidence-badge {
  font-size: 10px;
  font-weight: 700;
  border-radius: 4px;
  padding: 1px 5px;
  flex-shrink: 0;
}
.confidence-badge.high   { background: #eef8f1; color: #1f8f45; }
.confidence-badge.medium { background: #f0f3f7; color: #4d6073; }
.confidence-badge.low    { background: #fff8e8; color: #9a5b00; }

.text-snippet {
  font-size: 11px;
  color: #909399;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.diff-values {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 11px;
}

.val-block {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
  padding: 4px 6px;
  border: 1px solid #ebeef5;
  border-radius: 5px;
  background: #fafafa;
}
.val-block.design { border-color: #dce6f7; background: #f8fbff; }
.val-block.arkui  { border-color: #e4e7ed; background: #fbfbfc; }

.val-label {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 16px;
  padding: 0 4px;
  border-radius: 3px;
  font-weight: 700;
}
.val-block.arkui  .val-label { color: #4e5969; background: #eef0f3; }
.val-block.design .val-label { color: #0a59f7; background: #eef4ff; }

.val-text {
  word-break: break-all;
  line-height: 1.4;
}
.val-block.arkui  .val-text { color: #303133; }
.val-block.design .val-text { color: #0a59f7; }

.arrow { flex-shrink: 0; color: #c0c4cc; font-size: 12px; margin-top: 1px; }

:deep(.color-dot) {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid rgba(0,0,0,.12);
  flex-shrink: 0;
}

.diff-desc { font-size: 11px; color: #909399; line-height: 1.4; }

.section-divider {
  margin: 10px 8px 6px;
  font-size: 11px;
  color: #909399;
  padding-top: 10px;
  border-top: 1px dashed #e4e7ed;
}
.unmatched-chips { display: flex; flex-wrap: wrap; gap: 5px; padding: 0 8px 10px; }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
  color: #c0c4cc;
  gap: 8px;
  font-size: 13px;
}
</style>
