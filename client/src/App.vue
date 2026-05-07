<template>
  <div class="app-layout">
    <!-- ── 顶部导航 ────────────────────────────────────────────────── -->
    <header class="app-header">
      <div class="header-left">
        <img class="logo" src="/logo.svg" alt="Octo UI" />
        <span class="title">UI 一致性检查</span>
      </div>
      <div class="header-right">
        <el-tag v-if="result" :type="scoreTagType" size="large" effect="dark">
          还原度评分 {{ result.stats.score }} 分
        </el-tag>
      </div>
    </header>

    <div class="app-body">
      <!-- ── 左侧面板 ─────────────────────────────────────────────── -->
      <aside class="sidebar">
        <!-- Case 选择 -->
        <el-card class="side-card" shadow="never">
          <template #header>
            <div class="card-title"><el-icon><FolderOpened /></el-icon>内置 Case</div>
          </template>
          <div v-if="!cases.length" class="hint">加载中…</div>
          <div class="case-grid">
            <el-button
              v-for="c in cases" :key="c.id"
              :type="selectedCase === c.id ? 'primary' : 'default'"
              size="small"
              :loading="loading && selectedCase === c.id"
              @click="selectCase(c.id)"
            >{{ c.id }}</el-button>
          </div>
        </el-card>

        <!-- 文件上传 -->
        <el-card class="side-card" shadow="never">
          <template #header>
            <div class="card-title"><el-icon><Upload /></el-icon>上传分析</div>
          </template>

          <!-- 拖拽 / 点击选择区 -->
          <div
            :class="['drop-zone', { 'drag-over': isDragOver }]"
            @click="triggerPicker"
            @dragover.prevent="isDragOver = true"
            @dragleave.prevent="isDragOver = false"
            @drop.prevent="onDrop"
          >
            <el-icon size="22" color="#c0c4cc"><FolderOpened /></el-icon>
            <span class="drop-hint">点击或拖拽文件到此处</span>
            <span class="drop-sub">同时选择 design / arkui JSON 和 arkui 图片</span>
          </div>
          <!-- 隐藏原生 input -->
          <input
            ref="pickerRef"
            type="file"
            multiple
            accept=".json,image/*"
            style="display:none"
            @change="onFilesPicked"
          />

          <!-- 文件识别状态 -->
          <ul class="file-slots">
            <li v-for="slot in FILE_SLOTS" :key="slot.key">
              <span :class="['slot-icon', uploadFiles[slot.key] ? 'ok' : 'empty']">
                {{ uploadFiles[slot.key] ? '✓' : '○' }}
              </span>
              <span class="slot-label" :class="{ required: slot.required }">{{ slot.label }}</span>
              <span v-if="uploadFiles[slot.key]" class="slot-filename">
                {{ uploadFiles[slot.key].name }}
              </span>
              <span v-else class="slot-missing">未选择</span>
            </li>
          </ul>

          <el-button
            type="primary" size="small" style="width:100%;margin-top:6px"
            :loading="loading"
              :disabled="!uploadFiles.designJson || !uploadFiles.arkuiJson || !uploadFiles.arkuiImage"
              @click="runUpload"
            >开始分析</el-button>
        </el-card>

        <!-- 统计信息 -->
        <div v-if="result" v-show="false">
          <SummaryCard :stats="result.stats" />
        </div>

        <!-- 画布信息 -->
        <el-card v-if="result" v-show="false" class="side-card" shadow="never">
          <template #header>
            <div class="card-title"><el-icon><InfoFilled /></el-icon>环境信息</div>
          </template>
          <div class="info-rows">
            <div class="info-row"><span>设计画布</span><b>{{ result.canvas.design.w }}×{{ result.canvas.design.h }} dp</b></div>
            <div class="info-row"><span>ArkUI 视口</span><b>{{ Math.round(result.canvas.arkui.w) }}×{{ Math.round(result.canvas.arkui.h) }} vp</b></div>
            <div class="info-row"><span>分辨率</span><b>{{ result.canvas.arkui.resolution }}×</b></div>
            <div class="info-row"><span>耗时</span><b>{{ result.duration }} ms</b></div>
          </div>
        </el-card>
      </aside>

      <!-- ── 中间图片对比区 ───────────────────────────────────────── -->
      <main class="center-panel">
        <!-- 初始 / 加载态 -->
        <div v-if="!result && !loading" class="center-placeholder">
          <el-icon size="56" color="#dcdfe6"><PictureFilled /></el-icon>
          <p>选择左侧 Case 或上传文件开始检查</p>
        </div>
        <div v-else-if="loading" class="center-placeholder">
          <el-icon class="spin" size="48"><Loading /></el-icon>
          <p>正在分析…</p>
        </div>

        <!-- 双图对比 -->
        <template v-else-if="result">
          <div v-if="debugMode" class="debugger-float">
            <div class="debugger-head">
              <div class="debugger-title">
                <span>Debugger</span>
                <small>映射 {{ debugPairItems.length }} 对</small>
              </div>
              <el-switch v-model="debugOverlayOn" size="small" />
            </div>
            <div v-show="debugOverlayOn" class="debugger-body">
              <button
                class="debugger-summary-toggle"
                type="button"
                @click="debugMappingExpanded = !debugMappingExpanded"
              >
                <span class="debugger-summary-text">
                  {{ debugMappingExpanded ? '收起映射列表' : '展开映射列表' }}
                </span>
                <span class="debugger-summary-meta">映射 {{ debugPairItems.length }} 对</span>
                <span class="debugger-summary-icon">{{ debugMappingExpanded ? '▾' : '▸' }}</span>
              </button>
              <div v-if="debugMappingExpanded" class="debugger-panel">
                <div v-if="!debugPairItems.length" class="debugger-empty">
                  当前没有可展示的映射
                </div>
                <div v-else class="debugger-list">
                  <div v-for="item in debugPairItems" :key="item.key" class="debugger-item">
                    <span class="debugger-swatch" :style="{ background: item.color }"></span>
                    <span class="debugger-index">#{{ String(item.index + 1).padStart(2, '0') }}</span>
                    <span class="debugger-text" :title="item.arkuiLabel">{{ item.arkuiLabel }}</span>
                    <span class="debugger-arrow">↔</span>
                    <span class="debugger-text" :title="item.designLabel">{{ item.designLabel }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 高亮说明条：diff 选中 -->
          <transition name="fade">
            <div v-if="activeDiff && !selectedPair" class="highlight-bar">
              <el-icon><Location /></el-icon>
              正在高亮：<b>{{ activeDiff.relatedDesignName ? `${activeDiff.designName} ↔ ${activeDiff.relatedDesignName}` : (activeDiff.textContent || activeDiff.designName) }}</b>
              的 <code>{{ activeDiff.property }}</code>
              <el-tag v-if="activeDiff.confidence" size="small" effect="plain" :type="confidenceTagType(activeDiff.confidence)">
                {{ confidenceText(activeDiff.confidence) }}
              </el-tag>
              <el-button link size="small" @click="activeDiff = null">✕ 取消</el-button>
            </div>
          </transition>

          <!-- 节点选中说明条 -->
          <transition name="fade">
            <div v-if="selectedPair" class="highlight-bar node-bar">
              <el-icon><Crop /></el-icon>
              已选中实机节点：<b>{{ selectedPair.arkui?.textContent || selectedPair.arkui?.name || selectedPair.design?.textContent || selectedPair.design?.name }}</b>
              <el-tag size="small" effect="plain" style="margin-left:4px">{{ selectedPair.matchType }}</el-tag>
              <el-tag
                v-if="selectedPair.confidence"
                size="small"
                effect="plain"
                :type="confidenceTagType(selectedPair.confidence)"
              >
                {{ confidenceText(selectedPair.confidence) }}
              </el-tag>
              <el-button link size="small" style="margin-left:auto" @click="selectedPair = null">✕ 取消</el-button>
            </div>
          </transition>

          <div class="image-row">
            <ImagePanel
              label="实机截图"
              :src="arkuiImgSrc"
              :highlight="!selectedPair && activeDiff?.arkuiRect || null"
              :highlight-pair="!selectedPair && activeDiff?.relationRects?.arkui ? { rects: activeDiff.relationRects.arkui, axis: activeDiff.relationRects.axis } : null"
              :canvas-w="result.canvas.arkui.w"
              :canvas-h="result.canvas.arkui.h"
              :nodes="arkuiNodes"
              :selected-id="selectedPair?.arkui?.id || null"
              :inspector-node="selectedPair?.arkui || null"
              :style-diffs="selectedArkuiDiffs"
              :debug-visible="debugOverlayOn"
              :debug-pair-map="debugPairMap"
              @node-click="onArkuiNodeClick"
            />
            <ImagePanel
              label="设计稿"
              :src="designImgSrc"
              :highlight="!selectedPair && activeDiff?.designRect || null"
              :highlight-pair="!selectedPair && activeDiff?.relationRects?.design ? { rects: activeDiff.relationRects.design, axis: activeDiff.relationRects.axis } : null"
              :canvas-w="result.canvas.design.w"
              :canvas-h="result.canvas.design.h"
              :nodes="designNodes"
              :selected-id="selectedPair?.design?.id || null"
              :inspector-node="selectedPair?.design || null"
              :style-diffs="selectedDesignDiffs"
              :locked-ids="lockedNodeIds"
              :debug-visible="debugOverlayOn"
              :debug-pair-map="debugPairMap"
              @node-click="onDesignNodeClick"
            />
          </div>
        </template>
      </main>

      <!-- ── 右侧面板（差异报告 / 节点树） ───────────────────────── -->
      <aside v-if="result" class="right-panel">
        <!-- 标签页头 -->
        <div class="right-tabs">
          <button
            :class="['rtab', { active: rightTab === 'diff' }]"
            @click="rightTab = 'diff'"
          >
            差异报告
            <span class="rtab-badge error">{{ result.stats.errorCount }}</span>
            <span class="rtab-badge warning">{{ result.stats.warningCount }}</span>
          </button>
          <button
            :class="['rtab', { active: rightTab === 'tree' }]"
            @click="rightTab = 'tree'"
          >
            节点树
            <span class="rtab-badge neutral">{{ treeNodes.length }}</span>
          </button>
        </div>

        <!-- 差异报告 -->
        <DiffReport
          v-show="rightTab === 'diff'"
          :diffs="result.diffs"
          :unmatched="result.unmatchedDesignNodes"
          @select="onDiffSelect"
        />

        <!-- 节点树 -->
        <div v-show="rightTab === 'tree'" class="tree-source-switch">
          <button
            :class="{ active: treeSide === 'design' }"
            @click="treeSide = 'design'"
          >
            设计 <span>{{ designNodes.length }}</span>
          </button>
          <button
            :class="{ active: treeSide === 'arkui' }"
            @click="treeSide = 'arkui'"
          >
            开发 <span>{{ allArkuiNodes.length }}</span>
          </button>
        </div>
        <NodeTree
          v-show="rightTab === 'tree'"
          :nodes="treeNodes"
          :selected-id="treeSelectedId"
          :locked-ids="treeSide === 'design' ? lockedNodeIds : emptyLockedIds"
          :lockable="treeSide === 'design'"
          @select="onTreeNodeSelect"
          @toggle-lock="onToggleLock"
        />
      </aside>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchCases, checkCase, checkUpload, imageUrl } from './api/index.js'
import SummaryCard from './components/SummaryCard.vue'
import DiffReport  from './components/DiffReport.vue'
import ImagePanel  from './components/ImagePanel.vue'
import NodeTree    from './components/NodeTree.vue'
import './styles/app.css'

const cases        = ref([])
const selectedCase = ref('')
const loading      = ref(false)
const result       = ref(null)
const activeDiff   = ref(null)
const selectedPair   = ref(null)
const rightTab       = ref('diff')
const treeSide       = ref('design')
const lockedNodeIds  = ref(new Set())   // 图片侧锁定的设计节点 id 集合
const isDragOver     = ref(false)
const pickerRef    = ref(null)
const debugMode      = ref(false)
const debugOverlayOn = ref(false)
const debugMappingExpanded = ref(false)

const DEBUG_COLORS = [
  '#2f6fed',
  '#17a36f',
  '#d68b00',
  '#8b5cf6',
  '#0ea5e9',
  '#ef4444',
  '#14b8a6',
  '#f97316',
  '#22c55e',
  '#a855f7',
  '#e11d48',
  '#2563eb',
]

// 双图所有节点；实机侧是主走查入口，设计侧用于高亮匹配目标和节点树。
const designNodes = computed(() => result.value?.allDesignNodes ?? [])
const allArkuiNodes = computed(() => result.value?.allArkuiNodes ?? [])
const arkuiNodes  = computed(() =>
  (allArkuiNodes.value.length ? allArkuiNodes.value : result.value?.pairs?.map(p => p.arkui) ?? [])
    .filter(node => !isBlankLikeNode(node) && isInteractiveImageNode(node))
)
const emptyLockedIds = new Set()
const treeNodes = computed(() => (treeSide.value === 'design' ? designNodes.value : allArkuiNodes.value)
  .filter(node => !isBlankLikeNode(node) && isTreeVisibleNode(node, treeSide.value)))
const treeSelectedId = computed(() =>
  treeSide.value === 'design'
    ? selectedPair.value?.design?.id || null
    : selectedPair.value?.arkui?.id || null
)

const selectedDesignDiffs = computed(() =>
  selectedPair.value?.design?.id
    ? nodeDiffsFor('designNodeId', selectedPair.value.design.id)
    : []
)

const selectedArkuiDiffs = computed(() =>
  selectedPair.value?.arkui?.id
    ? nodeDiffsFor('arkuiNodeId', selectedPair.value.arkui.id)
    : []
)

const debugPairItems = computed(() =>
  (result.value?.pairs ?? []).map((pair, index) => ({
    key: `${pair.design?.id || 'd'}::${pair.arkui?.id || 'a'}::${index}`,
    index,
    color: DEBUG_COLORS[index % DEBUG_COLORS.length],
    designId: pair.design?.id || null,
    arkuiId: pair.arkui?.id || null,
    designLabel: nodeDebugLabel(pair.design, true),
    arkuiLabel: nodeDebugLabel(pair.arkui, true),
  }))
)

const debugPairMap = computed(() => {
  const map = {}
  for (const item of debugPairItems.value) {
    if (item.designId) map[item.designId] = { color: item.color, index: item.index }
    if (item.arkuiId) map[item.arkuiId] = { color: item.color, index: item.index }
  }
  return map
})

// 文件槽定义（key、标签、是否必填、识别规则）
const FILE_SLOTS = [
  { key: 'designJson',  label: 'design.json',  required: true,  match: f => /design/i.test(f.name) && f.name.endsWith('.json') },
  { key: 'arkuiJson',   label: 'arkui.json',   required: true,  match: f => /arkui/i.test(f.name) && f.name.endsWith('.json') },
  { key: 'designImage', label: 'design 图片',  required: false, match: f => /design/i.test(f.name) && f.type.startsWith('image/') },
  { key: 'arkuiImage',  label: 'arkui 图片',   required: true,  match: f => /arkui/i.test(f.name)  && f.type.startsWith('image/') },
]

const uploadFiles = ref({ designJson: null, arkuiJson: null, designImage: null, arkuiImage: null })

// blob URL 用于展示上传的图片
const blobUrls = ref({ design: '', arkui: '' })

function revokeBlobUrls() {
  if (blobUrls.value.design) URL.revokeObjectURL(blobUrls.value.design)
  if (blobUrls.value.arkui)  URL.revokeObjectURL(blobUrls.value.arkui)
  blobUrls.value = { design: '', arkui: '' }
}
onUnmounted(revokeBlobUrls)

function triggerPicker() { pickerRef.value?.click() }

function onFilesPicked(e) { assignFiles([...e.target.files]); e.target.value = '' }

function onDrop(e) {
  isDragOver.value = false
  assignFiles([...e.dataTransfer.files])
}

/** 根据文件名规则将文件分配到对应槽位 */
function assignFiles(files) {
  const next = { designJson: null, arkuiJson: null, designImage: null, arkuiImage: null }
  const unmatched = []

  for (const f of files) {
    const slot = FILE_SLOTS.find(s => s.match(f))
    if (slot) {
      next[slot.key] = f
    } else {
      unmatched.push(f.name)
    }
  }

  // 无法按名称识别时，按扩展名顺序回退分配
  const jsonFallback  = files.filter(f => f.name.endsWith('.json'))
  const imageFallback = files.filter(f => f.type.startsWith('image/'))
  if (!next.designJson  && jsonFallback[0]) next.designJson = jsonFallback[0]
  if (!next.arkuiJson   && jsonFallback[1]) next.arkuiJson  = jsonFallback[1]
  if (!next.designImage && imageFallback[0]) next.designImage = imageFallback[0]
  if (!next.arkuiImage  && imageFallback[1]) next.arkuiImage  = imageFallback[1]

  // 切换到上传模式：清掉 case 选中状态
  selectedCase.value = ''
  uploadFiles.value  = next

  // 更新图片 blob URL
  revokeBlobUrls()
  if (next.designImage) blobUrls.value.design = URL.createObjectURL(next.designImage)
  if (next.arkuiImage)  blobUrls.value.arkui  = URL.createObjectURL(next.arkuiImage)

  if (unmatched.length) ElMessage.info(`以下文件未能识别：${unmatched.join(', ')}`)

  // 三个必需文件就位时自动触发分析
  if (next.designJson && next.arkuiJson && next.arkuiImage) {
    nextTick(runUpload)
  }
}

// 图片来源：case 模式用 API URL，上传模式用 blob URL
const designImgSrc = computed(() =>
  selectedCase.value ? imageUrl(selectedCase.value, 'design') : blobUrls.value.design
)
const arkuiImgSrc = computed(() =>
  selectedCase.value ? imageUrl(selectedCase.value, 'arkui') : blobUrls.value.arkui
)

const scoreTagType = computed(() => {
  const s = result.value?.stats.score ?? 0
  if (s >= 90) return 'success'
  if (s >= 70) return 'warning'
  return 'danger'
})

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  debugMode.value = params.get('debugger') === '1'
  debugOverlayOn.value = false
  debugMappingExpanded.value = false
  try { cases.value = await fetchCases() }
  catch { ElMessage.warning('无法加载内置 Case') }
})

watch(debugOverlayOn, value => {
  if (!value) debugMappingExpanded.value = false
})

function onDesignNodeClick(nodeId) {
  const node = resolveSelectableNode(designNodes.value, nodeId)
  if (!isSelectableNode(node)) return
  const pair = result.value?.pairs?.find(p => p.design.id === (node?.id || nodeId))
  if (pair) {
    selectedPair.value = pair
  } else {
    const designNode = node || result.value?.allDesignNodes?.find(n => n.id === nodeId)
    if (designNode) {
      selectedPair.value = { matchType: 'unmatched', design: designNode, arkui: null }
    }
  }
  activeDiff.value = null
}

function onArkuiNodeClick(nodeId) {
  const node = resolveSelectableNode(allArkuiNodes.value, nodeId)
  if (!isSelectableNode(node)) return
  const pair = result.value?.pairs?.find(p => p.arkui.id === (node?.id || nodeId))
  if (pair) {
    selectedPair.value = pair
  } else {
    const arkuiNode = node || result.value?.allArkuiNodes?.find(n => n.id === nodeId)
    if (arkuiNode) {
      selectedPair.value = { matchType: 'unmatched-dev', design: null, arkui: arkuiNode }
    }
  }
  activeDiff.value = null
}

function isInteractiveImageNode(node) {
  return node &&
    !isBlankLikeNode(node) &&
    node.visible !== false &&
    !isHiddenFrameworkTextNode(node) &&
    !isOcrHiddenTextNode(node) &&
    !node.visualOccluded &&
    node.rect &&
    node.rect.w > 4 &&
    node.rect.h > 4
}

function isSelectableNode(node) {
  return !!(node &&
    node.visible !== false &&
    !isHiddenFrameworkTextNode(node) &&
    !isOcrHiddenTextNode(node) &&
    !node.visualOccluded &&
    node.rect?.w > 4 &&
    node.rect?.h > 4)
}

function isBlankLikeNode(node) {
  return String(node?.type || node?.name || '').trim().toLowerCase() === 'blank'
}

function isHiddenFrameworkTextNode(node) {
  return !!(node && node.type === 'text' && node.hiddenFrameworkAncestor)
}

function isOcrHiddenTextNode(node) {
  return !!(node &&
    node.type === 'text' &&
    (node.visualOccluded || node.ocrVisibility?.visible === false))
}

function isTreeVisibleNode(node, side) {
  if (side !== 'arkui') return true
  return !isHiddenFrameworkTextNode(node) && !isOcrHiddenTextNode(node)
}

function nodeDiffsFor(key, nodeId) {
  return (result.value?.diffs ?? []).filter(d => d[key] === nodeId)
}

function onTreeNodeSelect(nodeId) {
  if (treeSide.value === 'design') onDesignNodeClick(nodeId)
  else onArkuiNodeClick(nodeId)
}

function resolveSelectableNode(nodes, nodeId) {
  const node = nodes.find(n => n.id === nodeId)
  if (!node) return null
  if (isHiddenFrameworkTextNode(node) || isOcrHiddenTextNode(node)) return null
  if (node.type === 'text' || !node.textContent) return node

  const targetText = normalizeLooseText(node.textContent)
  if (!targetText) return node

  const descendants = nodes.filter(n =>
    n.type === 'text' &&
    normalizeLooseText(n.textContent) === targetText &&
    isPathPrefix(node.path, n.path) &&
    n.visible !== false &&
    !n.visualOccluded &&
    !isHiddenFrameworkTextNode(n) &&
    !isOcrHiddenTextNode(n)
  )

  if (!descendants.length) return node
  return descendants.sort((a, b) => {
    const da = (a.path?.length ?? 0) - (node.path?.length ?? 0)
    const db = (b.path?.length ?? 0) - (node.path?.length ?? 0)
    if (da !== db) return db - da
    return (a.rect.w * a.rect.h) - (b.rect.w * b.rect.h)
  })[0]
}

function normalizeLooseText(text) {
  return String(text || '').replace(/\s+/g, '').trim()
}

function isPathPrefix(prefix, path) {
  if (!Array.isArray(prefix) || !Array.isArray(path)) return false
  if (prefix.length >= path.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== path[i]) return false
  }
  return true
}

function onToggleLock(nodeId) {
  const next = new Set(lockedNodeIds.value)
  next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId)
  lockedNodeIds.value = next
  // 若锁定的节点正好是当前选中节点，取消选中
  if (next.has(nodeId) && selectedPair.value?.design?.id === nodeId) {
    selectedPair.value = null
  }
}

async function selectCase(id) {
  selectedCase.value  = id
  activeDiff.value    = null
  selectedPair.value  = null
  treeSide.value      = 'design'
  lockedNodeIds.value = new Set()
  loading.value       = true
  result.value        = null
  revokeBlobUrls()
  try { result.value = await checkCase(id) }
  catch (e) { ElMessage.error(`分析失败：${e.response?.data?.error || e.message}`) }
  finally    { loading.value = false }
}

async function runUpload() {
  selectedCase.value  = ''
  activeDiff.value    = null
  selectedPair.value  = null
  treeSide.value      = 'design'
  lockedNodeIds.value = new Set()
  loading.value       = true
  result.value        = null
  try {
    result.value = await checkUpload(
      uploadFiles.value.designJson,
      uploadFiles.value.arkuiJson,
      uploadFiles.value.designImage,
      uploadFiles.value.arkuiImage,
    )
    ElMessage.success('分析完成')
  } catch (e) { ElMessage.error(`分析失败：${e.response?.data?.error || e.message}`) }
  finally     { loading.value = false }
}

function onDiffSelect(diff) {
  selectedPair.value = null
  activeDiff.value = diff
}

function confidenceText(confidence) {
  if (confidence === 'high') return '高置信'
  if (confidence === 'low') return '低置信'
  return '中置信'
}

function confidenceTagType(confidence) {
  if (confidence === 'high') return 'success'
  if (confidence === 'low') return 'warning'
  return 'primary'
}

function nodeDebugLabel(node, withId = false) {
  if (!node) return '空'
  const label = String(node.textContent || node.name || '节点').trim()
  const displayLabel = label || '节点'
  if (!withId) return displayLabel
  const id = node.id ?? '无ID'
  return `${id}-${displayLabel}`
}
</script>
