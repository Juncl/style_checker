<template>
  <!-- 标签栏 -->
  <div class="up-tabbar up-tabbar--report">
    <span class="report-tab-title">差异报告</span>
  </div>

  <div class="report-body">
    <!-- 空状态卡片 -->
    <div class="report-empty">
      <img :src="iconEmpty" class="report-empty-img" alt="" />
      <p class="report-empty-hint">请完成操作指引<br />导入待检查页面后开始检查</p>
      <div class="report-device-row" ref="platformDropdownRef">
        <div class="report-device-trigger" @click="togglePlatformDropdown">
          <span class="report-device-text">{{ platformLabel }}</span>
          <el-icon class="report-device-arrow" :class="{ 'is-open': platformDropdownOpen }"><ArrowDown /></el-icon>
        </div>
        <div v-show="platformDropdownOpen" class="platform-dropdown-panel">
          <div
            v-for="opt in platformOptions"
            :key="opt.value"
            class="platform-dropdown-item"
            :class="{ 'is-selected': currentPlatform === opt.value }"
            @click="selectPlatformOption(opt.value)"
          >{{ opt.label }}</div>
        </div>
      </div>
      <el-button
        type="primary"
        :loading="loading"
        :disabled="!canStartCheck"
        class="report-start-btn"
        @click="$emit('run-upload', currentPlatform)"
      >开始对比</el-button>
    </div>

    <!-- 试用案例 -->
    <CaseList
      :current-platform="currentPlatform"
      :selected-case="selectedCase"
      :case-names="caseNames"
      :loading="loading"
      :debug-mode="debugMode"
      @select-case="$emit('select-case', $event)"
      @platform-switch="$emit('platform-switch', $event)"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import iconEmpty from '@/assets/svg/empty-report.svg'
import CaseList from './CaseList.vue'

const props = defineProps({
  loading:         { type: Boolean, default: false },
  selectedCase:    { type: String,  default: '' },
  caseNames:       { type: Object,  default: () => ({}) },
  currentPlatform: { type: String,  default: 'hmPhone' },
  uploadFiles:     { type: Object,  required: true },
  debugMode:       { type: Boolean, default: false },
})

const emit = defineEmits(['run-upload', 'select-case', 'platform-switch'])

const platformOptions = [
  { value: 'hmPhone', label: '鸿蒙-手机' },
  { value: 'hmWatch', label: '鸿蒙-手表' },
  { value: 'web',     label: 'web网页'  },
]

const platformLabel = computed(() =>
  platformOptions.find(o => o.value === props.currentPlatform)?.label ?? '鸿蒙-手机'
)

const platformDropdownOpen = ref(false)
const platformDropdownRef  = ref(null)

function togglePlatformDropdown() {
  platformDropdownOpen.value = !platformDropdownOpen.value
}

function selectPlatformOption(val) {
  platformDropdownOpen.value = false
  emit('platform-switch', val)
}

function handleDocumentClick(e) {
  if (platformDropdownRef.value && !platformDropdownRef.value.contains(e.target)) {
    platformDropdownOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', handleDocumentClick))
onUnmounted(() => document.removeEventListener('click', handleDocumentClick))

const canStartCheck = computed(() => {
  const f = props.uploadFiles
  return !!(f.designJson && f.arkuiJson && f.arkuiImage && f.designImage)
})
</script>
