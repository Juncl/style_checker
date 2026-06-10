<template>
  <div class="diff-panel" @click="activeMoreCardKey = null">
    <!-- 无差异状态：居中插图 -->
    <div v-if="hasNoDiffs" class="diff-noproblem">
      <img :src="noproblemSvg" class="noproblem-img" alt="" />
      <p class="noproblem-text">真棒！未检查出问题~</p>
    </div>

    <template v-else>
    <!-- 模式 tab：精准检查 / 模糊比对 -->
    <div class="match-mode-tabs">
      <div class="match-mode-slider" :style="sliderStyle"></div>
      <button
        ref="preciseTabRef"
        :class="['match-mode-tab', { active: matchMode === 'precise' }]"
        @click="matchMode = 'precise'"
      >精准检查</button>
      <div class="fuzzy-tab-wrap" ref="fuzzyTabWrapRef">
        <button
          :class="['match-mode-tab', { active: matchMode === 'fuzzy' }]"
          @click="matchMode = 'fuzzy'"
        >模糊比对</button>
        <div class="fuzzy-hint-wrap"
          @mouseenter="questionHovered = true"
          @mouseleave="questionHovered = false"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8.00001 15.3267C9.32445 15.3267 10.5489 15 11.6733 14.3467C12.7978 13.6889 13.6889 12.7978 14.3467 11.6733C15 10.5489 15.3267 9.32445 15.3267 8.00001C15.3267 6.67556 15 5.45112 14.3467 4.32667C13.6889 3.20223 12.7978 2.31112 11.6733 1.65334C10.5489 1.00001 9.32445 0.67334 8.00001 0.67334C6.67556 0.67334 5.45112 1.00001 4.32667 1.65334C3.20223 2.31112 2.31112 3.20223 1.65334 4.32667C1.00001 5.45112 0.67334 6.67556 0.67334 8.00001C0.67334 9.32445 1.00001 10.5467 1.65334 11.6667C2.31112 12.7867 3.20223 13.6756 4.32667 14.3333C5.45112 14.9956 6.67556 15.3267 8.00001 15.3267ZM8.00001 1.66667C9.14223 1.66667 10.1978 1.95112 11.1667 2.52001C12.14 3.0889 12.9111 3.86001 13.48 4.83334C14.0489 5.80223 14.3333 6.85778 14.3333 8.00001C14.3333 9.14223 14.0489 10.1978 13.48 11.1667C12.9111 12.14 12.14 12.9111 11.1667 13.48C10.1978 14.0489 9.14223 14.3333 8.00001 14.3333C6.85778 14.3333 5.80223 14.0489 4.83334 13.48C3.86001 12.9111 3.0889 12.14 2.52001 11.1667C1.95112 10.1978 1.66667 9.14223 1.66667 8.00001C1.66667 6.85778 1.95112 5.80223 2.52001 4.83334C3.0889 3.86001 3.86001 3.0889 4.83334 2.52001C5.80223 1.95112 6.85778 1.66667 8.00001 1.66667Z" fill="currentColor" fill-rule="nonzero" />
            <path d="M7.99982 9.96678C8.1376 9.96678 8.2576 9.92011 8.35982 9.82678C8.46204 9.729 8.51315 9.61122 8.51315 9.47344L8.51315 9.07344C8.51315 8.93567 8.55315 8.809 8.63315 8.69345C8.71315 8.58233 8.82648 8.49567 8.97315 8.43344C9.46648 8.20678 9.83537 7.85789 10.0798 7.38678C10.3243 6.91122 10.3998 6.40678 10.3065 5.87345C10.2309 5.40233 10.0132 4.99122 9.65315 4.64011C9.2976 4.289 8.88426 4.07122 8.41315 3.98678C8.06204 3.93344 7.71982 3.949 7.38648 4.03344C7.04871 4.11789 6.74648 4.27122 6.47982 4.49344C6.21315 4.72011 6.00871 4.99122 5.86648 5.30678C5.71982 5.61789 5.64648 5.94456 5.64648 6.28678C5.64648 6.42456 5.6976 6.54456 5.79982 6.64678C5.90204 6.749 6.02204 6.80011 6.15982 6.80011C6.2976 6.80011 6.41537 6.749 6.51315 6.64678C6.60648 6.54456 6.65315 6.42456 6.65315 6.28678C6.65315 6.09567 6.6976 5.909 6.78648 5.72678C6.87093 5.54456 6.98648 5.39122 7.13315 5.26678C7.28426 5.13789 7.45537 5.049 7.64648 5.00011C7.83759 4.95122 8.03537 4.94233 8.23982 4.97344C8.51537 5.02678 8.75315 5.15344 8.95315 5.35345C9.14871 5.549 9.26871 5.78011 9.31315 6.04678C9.36648 6.35789 9.32426 6.64678 9.18648 6.91344C9.04426 7.18011 8.83537 7.38233 8.55982 7.52011C8.23093 7.65789 7.97315 7.86678 7.78648 8.14678C7.59982 8.42233 7.50648 8.73122 7.50648 9.07344L7.50648 9.47344C7.50648 9.61122 7.55315 9.729 7.64648 9.82678C7.74426 9.92011 7.86204 9.96678 7.99982 9.96678ZM7.32648 11.3134C7.32648 11.5046 7.39315 11.6646 7.52648 11.7934C7.65982 11.9223 7.8176 11.9868 7.99982 11.9868C8.18204 11.9868 8.33982 11.9223 8.47315 11.7934C8.60648 11.6646 8.67315 11.5046 8.67315 11.3134C8.67315 11.1312 8.60648 10.9757 8.47315 10.8468C8.33982 10.7179 8.18204 10.6534 7.99982 10.6534C7.8176 10.6534 7.65982 10.7179 7.52648 10.8468C7.39315 10.9757 7.32648 11.1312 7.32648 11.3134Z" fill="currentColor" fill-rule="nonzero" />
          </svg>
          <transition name="tooltip-fade">
            <div v-if="questionHovered" class="fuzzy-tooltip">
              <span class="fuzzy-tooltip-arrow"></span>
              匹配非精准结果，仅供参考
            </div>
          </transition>
        </div>
      </div>
    </div>

    <!-- 工具栏：筛选标签 + 搜索 -->
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
        :key="d.spaceId ? `space-${d.spaceId}-${idx}` : `${d.designNodeId}-${d.arkuiNodeId}-${d.property}-${idx}`"
        :class="['diff-card', {
          selected: selectedIdx === idx,
          'active-from-node': activeDiffKeys.has(foldKey(d)) && selectedIdx !== idx,
          'hover-from-node':  hoverDiffKeys.has(foldKey(d)) && selectedIdx !== idx && !activeDiffKeys.has(foldKey(d))
        }]"
        @click="selectItem(d, idx)"
        @mouseenter="!d.property?.startsWith('spacing.') && emit('diff-hover', { arkuiNodeId: d.arkuiNodeId, designNodeId: d.designNodeId })"
        @mouseleave="emit('diff-hover', null)"
      >
        <!-- 卡片头 -->
        <div class="diff-card-head">
          <div class="diff-card-title">
            <span v-if="d.confidence === 'low'" class="diff-low-badge">仅参考</span>
            <span class="diff-card-name" :title="cardName(d)">{{ cardName(d) }}</span>
          </div>
          <span class="diff-card-ops">
            <span v-if="notIssueKeys.has(foldKey(d))" class="not-issue-tag">非问题</span>
            <span class="diff-card-more" @click.stop="toggleMoreMenu(foldKey(d))">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="1.667" cy="8" r="1" fill="rgb(25,25,25)" />
                <circle cx="8" cy="8" r="1" fill="rgb(25,25,25)" />
                <circle cx="14.333" cy="8" r="1" fill="rgb(25,25,25)" />
              </svg>
              <transition name="more-pop">
                <div v-if="activeMoreCardKey === foldKey(d)" class="more-menu" @click.stop>
                  <button class="more-menu-item" @click.stop="toggleNotIssue(foldKey(d))">
                    {{ notIssueKeys.has(foldKey(d)) ? '取消非问题' : '非问题' }}
                  </button>
                </div>
              </transition>
            </span>
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
                <ColorDot v-if="isColorProp(d.property)" :hex="displayValue(d.property, d.arkuiValue)" />
                <span class="diff-val-text" :title="String(d.arkuiValue)">{{ displayValue(d.property, d.arkuiValue) }}</span>
              </span>
            </div>
            <div class="diff-cmp-row">
              <span class="diff-cmp-key">设计</span>
              <span v-if="isEmptyVal(d.designValue)" class="diff-cmp-none">无</span>
              <span v-else class="diff-cmp-val diff-cmp-val--design">
                <ColorDot v-if="isColorProp(d.property)" :hex="displayValue(d.property, d.designValue)" />
                <span class="diff-val-text" :title="String(d.designValue)">{{ displayValue(d.property, d.designValue) }}</span>
              </span>
            </div>
          </div>

        </div>
      </div>
    </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, defineComponent, h } from 'vue'
import { Search, CircleCheck, ArrowUp, ArrowDown } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { updateConsistencyCheckProblem } from '../../../api/api.ts'
import noproblemSvg from '../../../assets/svg/noproblem.svg'

const ColorDot = defineComponent({
  props: { hex: String },
  setup(props) {
    const bg = computed(() => {
      const val = (props.hex || '').trim()
      if (!val) return 'transparent'
      if (/^(linear|radial|conic)-gradient\(/i.test(val)) {
        return val.replace(/#([0-9A-Fa-f]{8})\b/g, (_, hex) => {
          const a = parseInt(hex.slice(0, 2), 16) / 255
          const r = parseInt(hex.slice(2, 4), 16)
          const g = parseInt(hex.slice(4, 6), 16)
          const b = parseInt(hex.slice(6, 8), 16)
          return `rgba(${r},${g},${b},${a.toFixed(2)})`
        })
      }
      const h = val.replace('#', '')
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
  versionId:  { type: [Number, String], default: null },
})
const emit = defineEmits(['select', 'diff-hover'])

const ISSUE_GROUPS = [
  { key: 'all', label: '全部' },
  { key: 'fontSize', label: '字号' }, { key: 'fontFamily', label: '字体' }, { key: 'fontWeight', label: '字重' },
  { key: 'color', label: '颜色' }, { key: 'fill', label: '填充' }, { key: 'borderColor', label: '描边颜色' },
  { key: 'borderWidth', label: '描边宽度' }, { key: 'borderRadius', label: '圆角' }, { key: 'shadow', label: '阴影' },
  { key: 'backdropBlur', label: '模糊' },
  { key: 'opacity', label: '不透明度' }, { key: 'padding', label: '内边距' },
  { key: 'spacing', label: '间距' }, { key: 'fontSize.scale', label: '字体缩放' }, { key: 'other', label: '其它' },
]

const hasNoDiffs = computed(() => props.diffs.length === 0)

const activeIssue      = ref('all')
const matchMode        = ref('precise')  // 'precise'=高中置信 | 'fuzzy'=高中低
const questionHovered  = ref(false)
const preciseTabRef    = ref(null)
const fuzzyTabWrapRef  = ref(null)
const sliderStyle      = ref({ left: '2px', width: '0px' })

function updateSlider() {
  const el = matchMode.value === 'precise' ? preciseTabRef.value : fuzzyTabWrapRef.value
  if (!el) return
  sliderStyle.value = { left: `${el.offsetLeft}px`, width: `${el.offsetWidth}px` }
}

onMounted(() => nextTick(updateSlider))
const search           = ref('')
const selectedIdx      = ref(-1)
const listRef          = ref(null)
const folded           = ref(new Set())
const activeMoreCardKey = ref(null)
const notIssueKeys     = ref(new Set())

// 当 diffs 变化时，根据数据中的 _isNotProblem 重建非问题标记（不保留旧值）
watch(() => props.diffs, (diffs) => {
  const next = new Set()
  for (const d of (diffs ?? [])) {
    if (d._isNotProblem) next.add(foldKey(d))
  }
  notIssueKeys.value = next
}, { immediate: true })

const visibleDiffs = computed(() =>
  matchMode.value === 'fuzzy' ? props.diffs : props.diffs.filter(d => d.confidence !== 'low')
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
  const confOrder  = { high: 0, medium: 1, low: 2 }
  const issueOrder = Object.fromEntries(ISSUE_GROUPS.map((g, idx) => [g.key, idx]))
  return list.slice().sort((a, b) => {
    const confDelta = (confOrder[a.confidence] ?? 1) - (confOrder[b.confidence] ?? 1)
    if (confDelta !== 0) return confDelta
    if (activeIssue.value === 'all') {
      return (issueOrder[issueKey(a.property)] ?? 99) - (issueOrder[issueKey(b.property)] ?? 99)
    }
    return 0
  })
})

// ── 左侧节点联动高亮 ────────────────────────────────────────────────────────

function isDiffMatchPair(diff, pair) {
  if (!pair) return false
  if (diff.property?.startsWith('spacing.')) return false
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
  if (!val) {
    selectedIdx.value = -1
    return
  }
  if (_skipScrollOnce) {
    _skipScrollOnce = false
    return
  }
  selectedIdx.value = -1
  nextTick(() => {
    const listEl = listRef.value
    if (!listEl) return
    const idx = filteredDiffs.value.findIndex(d => isDiffMatchPair(d, val))
    if (idx < 0) return
    const card = listEl.querySelectorAll('.diff-card')[idx]
    if (card) {
      const cardTop    = card.getBoundingClientRect().top
      const listTop    = listEl.getBoundingClientRect().top
      listEl.scrollTo({ top: listEl.scrollTop + (cardTop - listTop), behavior: 'smooth' })
    }
  })
})

watch(matchMode, () => {
  selectedIdx.value = -1
  emit('select', null)
  if (activeIssue.value !== 'all' && filteredDiffs.value.length === 0) {
    activeIssue.value = 'all'
  }
  nextTick(updateSlider)
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

// ── 非问题标记（标记/取消）──
function toggleMoreMenu(key) {
  activeMoreCardKey.value = activeMoreCardKey.value === key ? null : key
}
async function toggleNotIssue(key) {
  if (!props.versionId) {
    ElMessage.warning('请先保存版本后再标记')
    return
  }
  const diff = filteredDiffs.value.find(d => foldKey(d) === key)
  if (!diff) return
  const isMarked = notIssueKeys.value.has(key)
  const isNotProblem = isMarked ? 0 : 1
  try {
    const problemId = diff._problemId || `${diff.arkuiNodeId}-${diff.property}`
    await updateConsistencyCheckProblem({
      id:           problemId,
      versionId:    props.versionId,
      key:          diff.nodeType || 'container',
      desc:         diff.description || '',
      type:         diff.property,
      data:         diff._problemData || JSON.stringify(diff),
      isNotProblem,
    })
    const next = new Set(notIssueKeys.value)
    if (isMarked) {
      next.delete(key)
    } else {
      next.add(key)
    }
    notIssueKeys.value = next
    activeMoreCardKey.value = null
    ElMessage.success(isMarked ? '已取消非问题' : '已标记为非问题')
  } catch (e) {
    ElMessage.error('操作失败')
  }
}

// ── 折叠状态（按节点+属性的稳定 key）──
function foldKey(d) {
  if (d.spaceId) return `space|${d.spaceId}`
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
  if (property === 'spacing.top')  return '竖向间距'
  if (property === 'spacing.left') return '横向间距'
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

.diff-noproblem {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
}

.noproblem-img {
  width: 160px;
  height: 160px;
}

.noproblem-text {
  margin: 0;
  font-size: 14px;
  color: var(--octo-text-secondary);
}

/* ── 工具栏 ── */
.diff-toolbar {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 16px 0;
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

.match-mode-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  width: fit-content;
  background: rgba(25, 25, 25, 0.05);
  border-radius: 6px;
  padding: 2px;
  margin: 16px 16px 0;
  position: relative;
}

.match-mode-slider {
  position: absolute;
  top: 2px;
  height: calc(100% - 4px);
  background: #fff;
  border-radius: 4px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
  transition: left 200ms ease, width 200ms ease;
  pointer-events: none;
  z-index: 0;
}

.match-mode-tab {
  position: relative;
  z-index: 1;
  height: 28px;
  padding: 0 16px;
  border: none;
  background: transparent;
  border-radius: 4px;
  font-size: 14px;
  color: var(--octo-text-secondary);
  cursor: pointer;
  transition: color 150ms ease;
}

.match-mode-tab.active {
  color: var(--octo-primary);
}

/* ── 卡片列表 ── */
.diff-cards {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 16px 16px;
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
  border-color: var(--octo-primary);
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

.diff-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.diff-low-badge {
  flex-shrink: 0;
  height: 24px;
  padding: 2px 8px;
  background: rgba(208, 216, 253, 0.50);
  color: #1F55B5;
  border-radius: 4px;
  font-size: 10px;
  line-height: 20px;
  white-space: nowrap;
}

.diff-card-name {
  flex: 1;
  min-width: 0;
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
  position: relative;
  display: inline-flex;
  align-items: center;
  font-size: 16px;
  cursor: pointer;
  border-radius: 4px;
  transition: background 150ms ease;
}

.diff-card-more:hover {
  background: rgba(0, 0, 0, 0.06);
}

.not-issue-tag {
  height: 22px;
  padding: 2px 8px;
  background: #9999991a;
  color: #999;
  border-radius: 4px;
  font-size: 10px;
  line-height: 18px;
  white-space: nowrap;
  flex-shrink: 0;
}

.more-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 10;
  background: var(--octo-surface-page);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 4px;
  min-width: 80px;
}

.more-menu-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: var(--octo-text-primary);
  border-radius: 4px;
  transition: background 150ms ease;
  white-space: nowrap;
}

.more-menu-item:hover {
  background: var(--octo-surface-hover);
}

.more-pop-enter-active,
.more-pop-leave-active {
  transition: opacity 100ms ease, transform 100ms ease;
}
.more-pop-enter-from,
.more-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.97);
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
  font-size: 14px;
  line-height: 22px;
}

.diff-cmp-val--dev {
  color: var(--report-dev-color);
}

.diff-cmp-val--design {
  color: var(--report-design-color);
}

.diff-cmp-val--dev .diff-val-text {
  background: var(--report-dev-bg);
  padding: 0 6px;
  border-radius: 4px;
}

.diff-cmp-val--design .diff-val-text {
  background: var(--report-design-bg);
  padding: 0 6px;
  border-radius: 4px;
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

/* ── 模糊比对 tooltip ── */
.fuzzy-tab-wrap {
  display: flex;
  align-items: center;
}

.fuzzy-tab-wrap .match-mode-tab {
  padding-right: 0;
}

.fuzzy-hint-wrap {
  position: relative;
  display: flex;
  align-items: center;
  cursor: pointer;
  color: #777777;
  transition: color 150ms ease;
  margin-left: 4px;
  padding-right: 16px;
}
.fuzzy-hint-wrap:hover {
  color: #2E86DE;
}

.fuzzy-tooltip {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  background: #fff;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 14px;
  line-height: 22px;
  color: #191919;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
  pointer-events: none;
  z-index: 100;
}

.fuzzy-tooltip-arrow {
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 6px solid #fff;
}

.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px);
}
</style>
