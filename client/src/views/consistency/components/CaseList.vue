<template>
  <div class="cases-block">
    <div class="cases-head">
      <span class="cases-head-title">试用案例</span>
      <span class="cases-head-hint">点击下方案例即刻体验~</span>
      <div v-if="debugMode" class="cases-platform-dropdown" ref="casesPlatformRef">
        <div class="cases-platform-trigger" @click="toggleCasesPlatform">
          <span class="cases-platform-text">{{ platformLabel }}</span>
          <el-icon class="cases-platform-arrow" :class="{ 'is-open': casesPlatformOpen }"><ArrowDown /></el-icon>
        </div>
        <div v-show="casesPlatformOpen" class="cases-platform-panel">
          <div
            v-for="opt in platformOptions"
            :key="opt.value"
            class="cases-platform-item"
            :class="{ 'is-selected': currentPlatform === opt.value }"
            @click="selectCasesPlatformOption(opt.value)"
          >{{ opt.label }}</div>
        </div>
      </div>
    </div>
    <div v-if="!cases.length" class="cases-loading">加载中…</div>
    <div class="cases-list">
      <div
        v-for="c in cases"
        :key="c.id"
        :class="['case-row', { active: selectedCase === c.id }]"
        @click="$emit('select-case', c.id)"
      >
        <div class="case-thumb">
          <img :src="caseImageUrl(c.id)" class="case-thumb-img" :alt="c.id" />
          <div v-if="loading && selectedCase === c.id" class="case-thumb-loading">
            <el-icon class="spin"><LoadingIcon /></el-icon>
          </div>
        </div>
        <div class="case-meta">
          <span class="case-name">{{ c.id.replace('case', '案例 ') }}</span>
          <span class="case-desc">{{ caseNames[c.id] || c.id }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { ArrowDown, Loading as LoadingIcon } from '@element-plus/icons-vue'
import { fetchCases, imageUrl } from '../../../api/index.ts'

const props = defineProps({
  currentPlatform: { type: String,  default: 'hmPhone' },
  selectedCase:    { type: String,  default: '' },
  caseNames:       { type: Object,  default: () => ({}) },
  loading:         { type: Boolean, default: false },
  debugMode:       { type: Boolean, default: false },
})

const emit = defineEmits(['select-case', 'platform-switch'])

const platformOptions = [
  { value: 'hmPhone', label: '鸿蒙-手机' },
  { value: 'hmWatch', label: '鸿蒙-手表' },
  { value: 'web',     label: 'web网页'  },
]

const platformLabel = computed(() =>
  platformOptions.find(o => o.value === props.currentPlatform)?.label ?? '鸿蒙-手机'
)

const cases            = ref([])
const casesPlatformOpen = ref(false)
const casesPlatformRef  = ref(null)

async function loadCases(platform) {
  cases.value = []
  try { cases.value = await fetchCases(platform) }
  catch { /* 静默失败，显示加载状态 */ }
}

onMounted(() => loadCases(props.currentPlatform))

watch(() => props.currentPlatform, (platform) => loadCases(platform))

function toggleCasesPlatform() {
  casesPlatformOpen.value = !casesPlatformOpen.value
}

function selectCasesPlatformOption(val) {
  casesPlatformOpen.value = false
  emit('platform-switch', val)
}

function handleDocumentClick(e) {
  if (casesPlatformRef.value && !casesPlatformRef.value.contains(e.target)) {
    casesPlatformOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', handleDocumentClick))
onUnmounted(() => document.removeEventListener('click', handleDocumentClick))

function caseImageUrl(caseId) {
  return imageUrl(caseId, 'arkui', props.currentPlatform)
}
</script>
