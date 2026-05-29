<template>
  <div class="diff-panel">
    <!-- 工具栏：筛选标签 + 搜索 + 低置信开关 -->
    <div class="diff-toolbar">
      <div class="diff-tabs">
        <button
          v-for="group in issueGroups"
          :key="group.key"
          :class="['diff-tab', { active: activeIssue === group.key }]"
          @click="selectIssue(group.key)"
        >
          {{ group.label }}({{ issueCounts[group.key] || 0 }})
        </button>
      </div>
      <div class="diff-tools">
        <el-input
          v-if="debugMode"
          v-model="search"
          placeholder="搜索差异项"
          clearable
          class="diff-search"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <label class="diff-lowconf">
          <span>低置信</span>
          <el-switch v-model="showLowConfidence" />
        </label>
      </div>
    </div>

    <!-- 差异卡片列表 -->
    <div class="diff-cards" ref="listRef">
      <div v-if="filteredDiffs.length === 0" class="diff-empty">
        <el-icon size="40"><CircleCheck /></el-icon>
        <p>无差异项</p>
      </div>

      <div
        v-for="(d, idx) in filteredDiffs"
        :key="`${d.designNodeId}-${d.arkuiNodeId}-${d.property}-${idx}`"
        :class="['diff-card', {
          selected: selectedIdx === idx,
          'active-from-node': activeDiffKeys.has(foldKey(d)) && selectedIdx !== idx,
          'hover-from-node':  hoverDiffKeys.has(foldKey(d)) && selectedIdx !== idx && !activeDiffKeys.has(foldKey(d))
        }]"
        @click="selectItem(d, idx)"
      >
        <!-- 卡片头 -->
        <div class="diff-card-head">
          <span class="diff-card-name" :title="cardName(d)">{{ cardName(d) }}</span>
          <span class="diff-card-ops">
            <el-icon class="diff-card-more"><MoreFilled /></el-icon>
            <el-icon class="diff-card-fold" @click.stop="toggleFold(foldKey(d))">
              <ArrowUp v-if="!isFolded(foldKey(d))" />
              <ArrowDown v-else />
            </el-icon>
          </span>
        </div>

        <!-- 卡片体 -->
        <div v-show="!isFolded(foldKey(d))" class="diff-card-body">
          <div class="diff-prop-row">
            <span class="diff-prop-key">类型</span>
            <span class="diff-prop-val">{{ issueLabel(d.property) }}</span>
          </div>

          <div class="diff-cmp">
            <div class="diff-cmp-row">
              <span class="diff-cmp-key">开发</span>
              <span v-if="isEmptyVal(d.arkuiValue)" class="diff-cmp-none">无</span>
              <span v-else class="diff-cmp-val diff-cmp-val--dev">
                <ColorDot v-if="isColorProp(d.property)" :hex="extractHex(d.arkuiValue)" />
                <span class="diff-val-text" :title="String(d.arkuiValue)">{{ displayValue(d.property, d.arkuiValue) }}</span>
              </span>
            </div>
            <div class="diff-cmp-row">
              <span class="diff-cmp-key">设计</span>
              <span v-if="isEmptyVal(d.designValue)" class="diff-cmp-none">无</span>
              <span v-else class="diff-cmp-val diff-cmp-val--design">
                <ColorDot v-if="isColorProp(d.property)" :hex="extractHex(d.designValue)" />
                <span class="diff-val-text" :title="String(d.designValue)">{{ displayValue(d.property, d.designValue) }}</span>
              </span>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, defineComponent, h } from 'vue'
import { Search, CircleCheck, MoreFilled, ArrowUp, ArrowDown } from '@element-plus/icons-vue'

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
  diffs:      { type: Array,   default: () => [] },
  unmatched:  { type: Array,   default: () => [] },
  activePair: { type: Object,  default: null },
  hoverPair:  { type: Object,  default: null },
  debugMode:  { type: Boolean, default: false },
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
const folded      = ref(new Set())

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
      (d.designName || '').includes(q)
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

// ── 左侧节点联动高亮 ────────────────────────────────────────────────────────

function isDiffMatchPair(diff, pair) {
  if (!pair) return false
  if (pair.arkuiNodeId  && diff.arkuiNodeId  === pair.arkuiNodeId)  return true
  if (pair.designNodeId && diff.designNodeId === pair.designNodeId) return true
  return false
}

const activeDiffKeys = computed(() => {
  if (!props.activePair) return new Set()
  const keys = new Set()
  for (const d of filteredDiffs.value) {
    if (isDiffMatchPair(d, props.activePair)) keys.add(foldKey(d))
  }
  return keys
})

const hoverDiffKeys = computed(() => {
  if (!props.hoverPair) return new Set()
  const keys = new Set()
  for (const d of filteredDiffs.value) {
    if (isDiffMatchPair(d, props.hoverPair)) keys.add(foldKey(d))
  }
  return keys
})

let _skipScrollOnce = false

watch(() => props.activePair, (val) => {
  if (!val) return
  if (_skipScrollOnce) {
    _skipScrollOnce = false
    return
  }
  nextTick(() => {
    const listEl = listRef.value
    if (!listEl) return
    const idx = filteredDiffs.value.findIndex(d => isDiffMatchPair(d, val))
    if (idx < 0) return
    const card = listEl.querySelectorAll('.diff-card')[idx]
    if (card) {
      const cardTop    = card.getBoundingClientRect().top
      const listTop    = listEl.getBoundingClientRect().top
      listEl.scrollTop = listEl.scrollTop + (cardTop - listTop)
    }
  })
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
    _skipScrollOnce = true   // 右侧主动点击，阻止 watch 触发滚动
    selectedIdx.value = idx
    emit('select', d)
  }
}

// ── 折叠状态（按节点+属性的稳定 key）──
function foldKey(d) {
  return `${d.designNodeId || ''}|${d.arkuiNodeId || ''}|${d.property}`
}
function isFolded(key) {
  return folded.value.has(key)
}
function toggleFold(key) {
  const next = new Set(folded.value)
  next.has(key) ? next.delete(key) : next.add(key)
  folded.value = next
}

// ── 卡片头节点名 ──
function cardName(d) {
  return d.textContent || d.designName || d.relatedDesignName || d.name || '节点'
}
function isEmptyVal(val) {
  const s = String(val ?? '').trim()
  return s === '' || s === '无' || s === 'none' || s === 'null'
}

const COLOR_PROPS = new Set(['fontColor', 'backgroundColor', 'border.color', 'borderColor', 'shadow.color'])
function isColorProp(p)  { return COLOR_PROPS.has(p) }
function extractHex(val) { return (String(val || '').match(/#[0-9A-Fa-f]{6,8}/) || [''])[0] }
function displayValue(prop, val) {
  const text = String(val ?? '')
  if (!isColorProp(prop)) return text
  // 渐变色保留完整字符串，由 CSS 处理缩略
  if (text.startsWith('linear-gradient(') || text.startsWith('radial-gradient(')) {
    return text
  }
  return extractHex(text) || text.replace(/\s*\(rgba\([^)]+\)\)/i, '')
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

/* ── 工具栏 ── */
.diff-toolbar {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.diff-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.diff-tab {
  height: 28px;
  padding: 3px 8px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  background: rgba(25, 25, 25, 0.05);
  color: var(--octo-text-primary);
  transition: background 150ms ease, color 150ms ease;
}

.diff-tab.active {
  background: var(--octo-primary-subtle);
  color: var(--octo-primary);
}

.diff-tools {
  display: flex;
  align-items: center;
  gap: 12px;
}


.diff-search {
  flex: 1;
  min-width: 0;
}

.diff-search :deep(.el-input__wrapper) {
  height: 32px;
  border-radius: 4px;
}

.diff-search :deep(.el-input__inner) {
  font-size: 13px;
}

.diff-search :deep(.el-input__inner::placeholder) {
  color: var(--octo-text-placeholder);
}

.diff-lowconf {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  font-size: 14px;
  color: var(--octo-text-secondary);
  cursor: pointer;
}

/* ── 卡片列表 ── */
.diff-cards {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 16px 16px;
}

.diff-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
  gap: 8px;
  color: var(--octo-text-disabled);
  font-size: 14px;
}

.diff-empty p {
  margin: 0;
}

/* ── 差异卡片 ── */
.diff-card {
  background: var(--octo-bg-canvas);
  border: 1px solid transparent;
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease;
}

.diff-card:last-child {
  margin-bottom: 0;
}

.diff-card:hover {
  background: var(--octo-surface-hover);
  border-color: var(--octo-border-default);
}

.diff-card.selected {
  background: var(--octo-surface-selected);
  border-color: var(--octo-primary);
}

.diff-card.active-from-node {
  background: var(--octo-primary-subtle);
  border-color: var(--octo-border-default);
}

.diff-card.hover-from-node {
  background: var(--octo-surface-hover);
  border-color: var(--octo-border-default);
}

.diff-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 36px;
  padding: 0 8px;
  cursor: pointer;
}

.diff-card-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--octo-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-card-ops {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  color: var(--octo-text-primary);
}

.diff-card-more {
  font-size: 16px;
}

.diff-card-fold {
  font-size: 16px;
  cursor: pointer;
  transition: color 150ms ease;
}

.diff-card-fold:hover {
  color: var(--octo-primary);
}

.diff-card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 8px 8px;
}

/* 属性类型行 */
.diff-prop-row {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 36px;
  padding: 0 8px;
}

.diff-prop-key {
  font-size: 14px;
  color: var(--octo-text-secondary);
  flex-shrink: 0;
}

.diff-prop-val {
  font-size: 14px;
  color: var(--octo-text-primary);
}

/* 开发 / 设计对比 */
.diff-cmp {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.diff-cmp-row {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 36px;
  padding: 7px 8px;
  background: var(--octo-surface-page);
  border-radius: 8px;
}

.diff-cmp-key {
  font-size: 14px;
  color: var(--octo-text-secondary);
  flex-shrink: 0;
}

.diff-cmp-none {
  font-size: 14px;
  color: var(--octo-text-primary);
}

.diff-cmp-val {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 14px;
  line-height: 22px;
}

.diff-cmp-val--dev {
  color: var(--report-dev-color);
  background: var(--report-dev-bg);
}

.diff-cmp-val--design {
  color: var(--report-design-color);
  background: var(--report-design-bg);
}

.diff-val-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}


:deep(.color-dot) {
  display: inline-block;
  width: 16px;
  height: 16px;
  border-radius: 2px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  flex-shrink: 0;
}
</style>
