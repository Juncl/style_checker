import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const useDebugStore = defineStore('debug', () => {
  const _debugMode = ref(false)
  const _debugPipelineOn = ref(false)
  const _debugOverlayOn = ref(false)

  // 只读：其他组件只能读，不能直接赋值
  const debugMode = computed(() => _debugMode.value)
  const debugPipelineOn = computed(() => _debugPipelineOn.value)
  const debugOverlayOn = computed(() => _debugOverlayOn.value)

  // 仅 ConsistencyView 初始化 和 ReportPage debugger-ui 开关通过此方法写入
  function setDebugMode(val: boolean) {
    _debugMode.value = val
    if (!val) _debugOverlayOn.value = false
  }
  function setDebugPipelineOn(val: boolean) { _debugPipelineOn.value = val }
  function setDebugOverlayOn(val: boolean) { _debugOverlayOn.value = val }

  return { debugMode, debugPipelineOn, debugOverlayOn, setDebugMode, setDebugPipelineOn, setDebugOverlayOn }
})
