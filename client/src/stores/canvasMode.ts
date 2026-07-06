import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export type CanvasMode = 'default' | 'select' | 'edit'

export const useCanvasModeStore = defineStore('canvasMode', () => {
  const _mode = ref<CanvasMode>('default')

  // 只读：其他组件只能读，不能直接赋值
  const mode = computed(() => _mode.value)

  // 仅 dev-float-bar（ReportPage）通过此方法写入
  function setMode(val: CanvasMode) {
    _mode.value = val
  }

  return { mode, setMode }
})
