import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const useSelectionStore = defineStore('selection', () => {
  const _pair = ref(null)

  const selectedPair = computed(() => _pair.value)

  function select(pair) {
    _pair.value = pair
  }
  function selectUnmatched(side, node) {
    _pair.value = {
      matchDetail: { type: side === 'design' ? 'unmatched' : 'unmatched-dev' },
      design: side === 'design' ? node : null,
      arkui: side === 'arkui' ? node : null,
    }
  }
  function clear() {
    _pair.value = null
  }

  return { selectedPair, select, selectUnmatched, clear }
})
