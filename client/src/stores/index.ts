import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

// ============================================================================
// 一、画布模式 Store
// ============================================================================

/**
 * 画布模式 Store
 *
 * 全局变量 mode：画布当前工作模式。
 *   - `default` — 普通浏览模式，点击画布节点触发全局选中
 *   - `select`  — 框选对比模式，ReportPage 浮动工具栏切换进入，支持框选节点后手动对比
 *   - `edit`    — 编辑模式，允许在画布上直接修改节点属性值并触发重新对比
 */
export type CanvasMode = 'default' | 'select' | 'edit'

export const useCanvasModeStore = defineStore('canvasMode', () => {
  const _mode = ref<CanvasMode>('default')

  const mode = computed(() => _mode.value)

  /** 仅 dev-float-bar（ReportPage）通过此方法写入 */
  function setMode(val: CanvasMode) {
    _mode.value = val
  }

  return { mode, setMode }
})

// ============================================================================
// 二、平台类型 Store
// ============================================================================

/**
 * 平台类型 Store
 *
 * 全局变量 currentPlatform：当前设计还原平台类型。
 *   - `hmPhone` — 鸿蒙手机（ArkUI 解析器，designScale = 1）
 *   - `hmWatch` — 鸿蒙手表（ArkUI 解析器，designScale = 0.5）
 *   - `web`     — Web 网页（Web DOM 解析器，designScale = 1）
 * 影响案例列表过滤、设计稿缩放比、ArkUI 解析方式、图像 URL 构建、打点埋点 platform 字段。
 */
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

// ============================================================================
// 三、节点选中状态 Store
// ============================================================================

/**
 * 节点选中状态 Store
 *
 * 全局变量 selectedPair：当前选中的设计 ↔ 开发节点匹配对（含 matchDetail 信息）。
 * 驱动画布红色高亮、Inspector 属性面板、差异卡片联动高亮与滚动。
 * 取值：{ design, arkui, confidence, matchDetail } 对象或 null。
 */
export const useSelectionStore = defineStore('selection', () => {
  const _pair = ref(null)

  const selectedPair = computed(() => _pair.value)

  /** 选中一个已匹配的 pair */
  function select(pair) {
    _pair.value = pair
  }
  /** 选中一个未匹配的单侧节点（design 侧 type='unmatched'，arkui 侧 type='unmatched-dev'） */
  function selectUnmatched(side, node) {
    _pair.value = {
      matchDetail: { type: side === 'design' ? 'unmatched' : 'unmatched-dev' },
      design: side === 'design' ? node : null,
      arkui: side === 'arkui' ? node : null,
    }
  }
  /** 清空选中 */
  function clear() {
    _pair.value = null
  }

  return { selectedPair, select, selectUnmatched, clear }
})

// ============================================================================
// 四、临时对比结果 Store
// ============================================================================

/**
 * 临时对比结果 Store
 *
 * 全局变量 tempDiffs：select 模式下"重新对比"产生的临时差异列表。
 * 全局变量 tempPairs：select 模式下"重新对比"产生的临时匹配对列表。
 * 写入方：ReportPage.runCompare / runBoxCompare
 * 读取方：ReportPanel（显示"添加到分析结果"按钮）、ConsistencyView.mergeTempToResult（合并到正式结果）
 * 清除方：ReportPage.clearCompare / clearSelectState、ConsistencyView.mergeTempToResult
 */
export const useTempResultStore = defineStore('tempResult', () => {
  const _diffs = ref(null)
  const _pairs = ref(null)

  const tempDiffs = computed(() => _diffs.value)
  const tempPairs = computed(() => _pairs.value)

  /** 仅 ReportPage.runCompare / runBoxCompare 调用 */
  function setResult(diffs, pairs) {
    _diffs.value = diffs
    _pairs.value = pairs
  }
  /** ReportPage.clearCompare / clearSelectState / ConsistencyView.mergeTempToResult 调用 */
  function clear() {
    _diffs.value = null
    _pairs.value = null
  }

  return { tempDiffs, tempPairs, setResult, clear }
})

// ============================================================================
// 五、select 模式选中节点 Store
// ============================================================================

/**
 * select 模式选中节点 Store
 *
 * 在 select 模式下，点选和框选选中的节点统一存储于此，不再区分来源。
 * 点选一个节点 → devNodes/designNodes 为单元素数组
 * 框选多个节点 → devNodes/designNodes 为多元素数组
 * 空白点击 / 退出 select 模式 → 清空对应侧数组
 *
 * 消费者：
 *   - ReportPage.currentDevNodes / currentDesignNodes（computed 透传）
 *   - ReportPage.isBatchMode（任一侧 >= 2 个节点时走批量 API 对比）
 *   - ReportPage.runCompare / runBoxCompare（取节点列表发起对比）
 *   - ImagePanel selectedId（取 devNodes[0]?.id 作为画布高亮目标）
 */
export const useSelectNodesStore = defineStore('selectNodes', () => {
  const devNodes = ref([])
  const designNodes = ref([])

  function setDevNodes(nodes) { devNodes.value = nodes }
  function setDesignNodes(nodes) { designNodes.value = nodes }
  function clearDevNodes() { devNodes.value = [] }
  function clearDesignNodes() { designNodes.value = [] }
  function clearAll() { devNodes.value = []; designNodes.value = [] }

  return {
    devNodes, designNodes,
    setDevNodes, setDesignNodes,
    clearDevNodes, clearDesignNodes, clearAll,
  }
})
