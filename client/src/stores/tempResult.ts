import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const useTempResultStore = defineStore('tempResult', () => {
  const _diffs = ref(null)
  const _pairs = ref(null)

  const tempDiffs = computed(() => _diffs.value)
  const tempPairs = computed(() => _pairs.value)

  /** 仅 ReportPage.runCompare/runBoxCompare 调用 */
  function setResult(diffs, pairs) {
    _diffs.value = diffs
    _pairs.value = pairs
  }
  /** ReportPage.clearCompare/clearSelectState / ConsistencyView.mergeTempToResult 调用 */
  function clear() {
    _diffs.value = null
    _pairs.value = null
  }

  return { tempDiffs, tempPairs, setResult, clear }
})
