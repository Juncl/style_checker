<template>
  <div class="cases-block">
    <div class="cases-head">
      <span class="cases-head-title">试用案例</span>
      <span class="cases-head-hint">点击下方案例即刻体验~</span>
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
            <OctoLoading :size="48" />
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
import { ref, watch, onMounted } from 'vue'
import OctoLoading from './common/OctoLoading.vue'
import { fetchCases, imageUrl } from '../../../api/index.ts'
import { usePlatformStore } from '../../../stores'

const platformStore = usePlatformStore()

const props = defineProps({
  selectedCase:    { type: String,  default: '' },
  caseNames:       { type: Object,  default: () => ({}) },
  loading:         { type: Boolean, default: false },
})

const cases = ref([])

async function loadCases(platform) {
  cases.value = []
  try { cases.value = await fetchCases(platform) }
  catch { /* 静默失败，显示加载状态 */ }
}

onMounted(() => loadCases(platformStore.currentPlatform))

watch(() => platformStore.currentPlatform, (platform) => loadCases(platform))

function caseImageUrl(caseId) {
  return imageUrl(caseId, 'arkui', platformStore.currentPlatform)
}
</script>
