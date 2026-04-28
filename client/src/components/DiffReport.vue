<template>
  <div class="diff-panel">
    <!-- 顶部筛选栏 -->
    <div class="diff-toolbar">
      <div class="severity-tabs">
        <button
          v-for="s in SEVERITIES"
          :key="s.key"
          :class="['sev-tab', s.key, { active: visibleSet.has(s.key) }]"
          @click="toggleSeverity(s.key)"
        >
          {{ s.label }}
          <span class="badge">{{ counts[s.key] }}</span>
        </button>
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

    <!-- 差异列表 -->
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
        <!-- 左侧色条 -->
        <div :class="['sev-strip', d.severity]" />

        <div class="diff-body">
          <!-- 第一行：节点标识 -->
          <div class="diff-meta">
            <span :class="['sev-badge', d.severity]">{{ d.severity }}</span>
            <span class="prop-tag">{{ d.property }}</span>
            <span :class="['confidence-badge', d.confidence || 'medium']">
              {{ confidenceLabel(d.confidence) }}
            </span>
            <span class="match-tag">{{ d.matchType }}</span>
            <span v-if="d.textContent" class="text-snippet">「{{ truncate(d.textContent, 12) }}」</span>
          </div>

          <!-- 第二行：值对比 -->
          <div class="diff-values">
            <div class="val-block design">
              <span class="val-label">设计</span>
              <ColorDot v-if="isColorProp(d.property)" :hex="extractHex(d.designValue)" />
              <span class="val-text">{{ displayValue(d.property, d.designValue) }}</span>
            </div>
            <el-icon class="arrow"><ArrowRight /></el-icon>
            <div class="val-block arkui">
              <span class="val-label">开发</span>
              <ColorDot v-if="isColorProp(d.property)" :hex="extractHex(d.arkuiValue)" />
              <span class="val-text">{{ displayValue(d.property, d.arkuiValue) }}</span>
            </div>
          </div>

          <!-- 第三行：描述 -->
          <div class="diff-desc">{{ d.description }}</div>
        </div>
      </div>

      <!-- 未匹配区块 -->
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

// ── ColorDot 内联子组件 ───────────────────────────────────────────────────────
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
// ─────────────────────────────────────────────────────────────────────────────

const props = defineProps({
  diffs:     { type: Array, default: () => [] },
  unmatched: { type: Array, default: () => [] },
})
const emit = defineEmits(['select'])

const SEVERITIES = [
  { key: 'error',   label: 'Error' },
  { key: 'warning', label: 'Warning' },
  { key: 'info',    label: 'Info' },
]

const visibleSet  = ref(new Set(['error', 'warning']))
const search      = ref('')
const selectedIdx = ref(-1)
const listRef     = ref(null)

const counts = computed(() => ({
  error:   props.diffs.filter(d => d.severity === 'error').length,
  warning: props.diffs.filter(d => d.severity === 'warning').length,
  info:    props.diffs.filter(d => d.severity === 'info').length,
}))

const filteredDiffs = computed(() => {
  const q = search.value.trim().toLowerCase()
  let list = props.diffs.filter(d => visibleSet.value.has(d.severity))
  if (q) {
    list = list.filter(d =>
      d.property.toLowerCase().includes(q) ||
      (d.textContent || '').includes(q) ||
      d.description.toLowerCase().includes(q)
    )
  }
  const order = { error: 0, warning: 1, info: 2 }
  return list.slice().sort((a, b) => order[a.severity] - order[b.severity])
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

function toggleSeverity(key) {
  const s = new Set(visibleSet.value)
  s.has(key) ? s.delete(key) : s.add(key)
  visibleSet.value = s
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

const COLOR_PROPS = new Set(['fontColor', 'backgroundColor', 'border.color', 'shadow.color'])
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
</script>

<style scoped>
.diff-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* ── 顶部工具栏 ── */
.diff-toolbar {
  padding: 10px 12px 8px;
  border-bottom: 1px solid #e5e5e5;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
  background: #fff;
}

.severity-tabs { display: flex; gap: 6px; }

.sev-tab {
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
.sev-tab.active.error   { border-color: #cf0a2c; color: #cf0a2c; background: #fff1f3; }
.sev-tab.active.warning { border-color: #b7791f; color: #9a5b00; background: #fff8e8; }
.sev-tab.active.info    { border-color: #8a8a8a; color: #4d4d4d; background: #f5f5f5; }

.badge {
  background: currentColor;
  color: #fff;
  border-radius: 8px;
  padding: 0 5px;
  font-size: 10px;
  line-height: 16px;
  min-width: 16px;
  text-align: center;
}

.search-input { font-size: 12px; }

/* ── 列表区 ── */
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
.diff-item.selected { border-color: #cf0a2c; background: #fff7f8; box-shadow: 0 0 0 2px rgba(207,10,44,.10); }

/* 左侧色条 */
.sev-strip {
  width: 4px;
  border-radius: 4px 0 0 4px;
  flex-shrink: 0;
}
.sev-strip.error   { background: #cf0a2c; }
.sev-strip.warning { background: #b7791f; }
.sev-strip.info    { background: #8a8a8a; }

.diff-body { padding: 8px 10px; flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }

/* 第一行：meta */
.diff-meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }

.sev-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  text-transform: uppercase;
  flex-shrink: 0;
}
.sev-badge.error   { background: #fff1f3; color: #cf0a2c; }
.sev-badge.warning { background: #fff8e8; color: #9a5b00; }
.sev-badge.info    { background: #f5f5f5; color: #737373; }

.prop-tag {
  font-size: 11px;
  font-family: monospace;
  background: #f5f5f5;
  color: #cf0a2c;
  padding: 1px 5px;
  border-radius: 3px;
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

/* 第二行：值对比 */
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
.val-block.design { border-color: #e4e7ed; background: #fbfbfc; }
.val-block.arkui  { border-color: #f0c4cb; background: #fff8f9; }

.val-label {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 16px;
  padding: 0 4px;
  border-radius: 3px;
  font-weight: 700;
}
.val-block.design .val-label { color: #606266; background: #eef0f3; }
.val-block.arkui  .val-label { color: #cf0a2c; background: #fff1f3; }

.val-text {
  word-break: break-all;
  line-height: 1.4;
}
.val-block.design .val-text { color: #303133; }
.val-block.arkui  .val-text { color: #cf0a2c; }

.arrow { flex-shrink: 0; color: #c0c4cc; font-size: 12px; margin-top: 1px; }

:deep(.color-dot) {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid rgba(0,0,0,.12);
  flex-shrink: 0;
}

/* 第三行：描述 */
.diff-desc { font-size: 11px; color: #909399; line-height: 1.4; }

/* 未匹配区块 */
.section-divider {
  margin: 10px 8px 6px;
  font-size: 11px;
  color: #909399;
  padding-top: 10px;
  border-top: 1px dashed #e4e7ed;
}
.unmatched-chips { display: flex; flex-wrap: wrap; gap: 5px; padding: 0 8px 10px; }

/* 空状态 */
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
