import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export type Platform = 'hmPhone' | 'hmWatch' | 'web'

export const usePlatformStore = defineStore('platform', () => {
  const _platform = ref<Platform>('hmPhone')

  const currentPlatform = computed(() => _platform.value)

  /** 仅 ConsistencyView 初始化/切换/检测时调用 */
  function setPlatform(val: Platform) {
    _platform.value = val
  }

  return { currentPlatform, setPlatform }
})
