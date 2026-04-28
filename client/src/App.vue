<template>
  <div class="app-layout">
    <!-- ── 顶部导航 ────────────────────────────────────────────────── -->
    <header class="app-header">
      <div class="header-left">
        <span class="logo">🔍</span>
        <span class="title">HarmonyOS 设计还原检查</span>
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
            <span class="drop-sub">同时选择 4 个文件</span>
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
            :disabled="!uploadFiles.designJson || !uploadFiles.arkuiJson"
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
          <!-- 高亮说明条：diff 选中 -->
          <transition name="fade">
            <div v-if="activeDiff && !selectedPair" class="highlight-bar">
              <el-icon><Location /></el-icon>
              正在高亮：<b>{{ activeDiff.textContent || activeDiff.designName }}</b>
              的 <code>{{ activeDiff.property }}</code>
              <el-tag size="small" effect="plain" :type="confidenceTagType(activeDiff.confidence)">
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
              :canvas-w="result.canvas.arkui.w"
              :canvas-h="result.canvas.arkui.h"
              :nodes="arkuiNodes"
              :selected-id="selectedPair?.arkui?.id || null"
              :inspector-node="selectedPair?.arkui || null"
              :style-diffs="selectedArkuiDiffs"
              @node-click="onArkuiNodeClick"
            />
            <ImagePanel
              label="设计稿"
              :src="designImgSrc"
              :highlight="!selectedPair && activeDiff?.designRect || null"
              :canvas-w="result.canvas.design.w"
              :canvas-h="result.canvas.design.h"
              :nodes="designNodes"
              :selected-id="selectedPair?.design?.id || null"
              :inspector-node="selectedPair?.design || null"
              :style-diffs="selectedDesignDiffs"
              :locked-ids="lockedNodeIds"
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
            <span class="rtab-badge neutral">{{ result.allDesignNodes?.length ?? 0 }}</span>
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
        <NodeTree
          v-show="rightTab === 'tree'"
          :nodes="result.allDesignNodes ?? []"
          :selected-design-id="selectedPair?.design?.id || null"
          :locked-ids="lockedNodeIds"
          @select="onTreeNodeSelect"
          @toggle-lock="onToggleLock"
        />
      </aside>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchCases, checkCase, checkUpload, imageUrl } from './api/index.js'
import SummaryCard from './components/SummaryCard.vue'
import DiffReport  from './components/DiffReport.vue'
import ImagePanel  from './components/ImagePanel.vue'
import NodeTree    from './components/NodeTree.vue'

const cases        = ref([])
const selectedCase = ref('')
const loading      = ref(false)
const result       = ref(null)
const activeDiff   = ref(null)
const selectedPair   = ref(null)
const rightTab       = ref('diff')
const lockedNodeIds  = ref(new Set())   // 图片侧锁定的设计节点 id 集合
const isDragOver     = ref(false)
const pickerRef    = ref(null)

// 双图所有节点；实机侧是主走查入口，设计侧用于高亮匹配目标和节点树。
const designNodes = computed(() => result.value?.allDesignNodes ?? [])
const arkuiNodes  = computed(() =>
  (result.value?.allArkuiNodes ?? result.value?.pairs?.map(p => p.arkui) ?? [])
    .filter(isInteractiveImageNode)
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

// 4 个文件槽定义（key、标签、是否必填、识别规则）
const FILE_SLOTS = [
  { key: 'designJson',  label: 'design.json',  required: true,  match: f => /design/i.test(f.name) && f.name.endsWith('.json') },
  { key: 'arkuiJson',   label: 'arkui.json',   required: true,  match: f => /arkui/i.test(f.name)  && f.name.endsWith('.json') },
  { key: 'designImage', label: 'design 图片',  required: false, match: f => /design/i.test(f.name) && f.type.startsWith('image/') },
  { key: 'arkuiImage',  label: 'arkui 图片',   required: false, match: f => /arkui/i.test(f.name)  && f.type.startsWith('image/') },
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
  if (!next.designJson  && jsonFallback[0])  next.designJson  = jsonFallback[0]
  if (!next.arkuiJson   && jsonFallback[1])  next.arkuiJson   = jsonFallback[1]
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

  // 两个必填 JSON 均就位时自动触发分析
  if (next.designJson && next.arkuiJson) {
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
  try { cases.value = await fetchCases() }
  catch { ElMessage.warning('无法加载内置 Case') }
})

function onDesignNodeClick(nodeId) {
  const pair = result.value?.pairs?.find(p => p.design.id === nodeId)
  if (pair) {
    selectedPair.value = pair
  } else {
    const designNode = result.value?.allDesignNodes?.find(n => n.id === nodeId)
    if (designNode) {
      selectedPair.value = { matchType: 'unmatched', design: designNode, arkui: null }
    }
  }
  activeDiff.value = null
}

function onArkuiNodeClick(nodeId) {
  const pair = result.value?.pairs?.find(p => p.arkui.id === nodeId)
  if (pair) {
    selectedPair.value = pair
  } else {
    const arkuiNode = result.value?.allArkuiNodes?.find(n => n.id === nodeId)
    if (arkuiNode) {
      selectedPair.value = { matchType: 'unmatched-dev', design: null, arkui: arkuiNode }
    }
  }
  activeDiff.value = null
}

function isInteractiveImageNode(node) {
  return node &&
    node.visible !== false &&
    !node.visualOccluded &&
    node.rect &&
    node.rect.w > 4 &&
    node.rect.h > 4
}

function nodeDiffsFor(key, nodeId) {
  return (result.value?.diffs ?? []).filter(d => d[key] === nodeId)
}

function onTreeNodeSelect(nodeId) {
  onDesignNodeClick(nodeId)
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
</script>

<style>
*, *::before, *::after { box-sizing: border-box; }
:root {
  --hw-red: #cf0a2c;
  --hw-red-soft: #fff1f3;
  --hw-text: #1f1f1f;
  --hw-subtext: #666;
  --hw-muted: #999;
  --hw-border: #e5e5e5;
  --hw-bg: #f7f7f7;
  --hw-panel: #fff;
}
body {
  margin: 0;
  font-family: 'HarmonyOS Sans', 'PingFang SC', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--hw-bg);
  color: var(--hw-text);
}

.app-layout {
  --el-color-primary: var(--hw-red);
  --el-color-primary-light-9: var(--hw-red-soft);
  --el-border-radius-base: 8px;
}

.app-layout { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: var(--hw-bg); }

/* ── 顶部导航 ── */
.app-header {
  display: flex; align-items: center; justify-content: space-between;
  height: 52px; padding: 0 18px;
  background: var(--hw-panel); border-bottom: 1px solid var(--hw-border); flex-shrink: 0;
}
.header-left  { display: flex; align-items: center; gap: 8px; }
.logo         { font-size: 18px; color: var(--hw-red); }
.title        { font-size: 15px; font-weight: 700; color: var(--hw-text); letter-spacing: 0; }

/* ── 主体三列 ── */
.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ── 左侧边栏 ── */
.sidebar {
  width: 240px;
  flex-shrink: 0;
  overflow-y: auto;
  padding: 10px 8px;
  background: var(--hw-panel);
  border-right: 1px solid var(--hw-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.side-card { border-color: var(--hw-border); border-radius: 8px; }
.side-card :deep(.el-card__header) { padding: 8px 12px; border-bottom-color: #f0f0f0; }
.side-card :deep(.el-card__body)   { padding: 10px 12px; }

.card-title { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: var(--hw-text); }

.case-grid { display: flex; flex-wrap: wrap; gap: 5px; }

.hint { font-size: 12px; color: var(--hw-muted); }

.info-rows { display: flex; flex-direction: column; gap: 6px; }
.info-row  { display: flex; justify-content: space-between; font-size: 12px; color: var(--hw-subtext); }
.info-row b { color: var(--hw-text); }

/* ── 上传拖拽区 ── */
.drop-zone {
  border: 1px dashed #d8d8d8;
  border-radius: 8px;
  padding: 14px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  transition: border-color .2s, background .2s;
  background: #fafafa;
}
.drop-zone:hover, .drop-zone.drag-over {
  border-color: var(--hw-red);
  background: var(--hw-red-soft);
}
.drop-hint { font-size: 12px; color: var(--hw-subtext); font-weight: 500; }
.drop-sub  { font-size: 11px; color: var(--hw-muted); }

/* 文件槽状态列表 */
.file-slots {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.file-slots li {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  min-width: 0;
}
.slot-icon {
  width: 14px;
  text-align: center;
  font-size: 12px;
  flex-shrink: 0;
}
.slot-icon.ok    { color: #1f8f45; }
.slot-icon.empty { color: #d8d8d8; }
.slot-label {
  color: var(--hw-subtext);
  flex-shrink: 0;
  width: 72px;
}
.slot-label.required::after { content: ' *'; color: var(--hw-red); }
.slot-filename {
  color: var(--hw-red);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.slot-missing { color: var(--hw-muted); }

/* ── 中间主区 ── */
.center-panel {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  background: var(--hw-bg);
  min-height: 0;
}

.center-placeholder {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; gap: 12px; color: var(--hw-muted); font-size: 14px;
}
.center-placeholder p { margin: 0; }

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg) } }

/* 高亮提示条 */
.highlight-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: #fff8e8;
  border-bottom: 1px solid #f4dfb8;
  font-size: 12px;
  color: var(--hw-subtext);
  flex-shrink: 0;
}
.highlight-bar code { font-size: 11px; background: #f5f5f5; padding: 1px 4px; border-radius: 3px; color: var(--hw-red); }
.node-bar { background: var(--hw-red-soft); border-bottom-color: #f0c4cb; }
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* 双图并排 */
.image-row {
  display: flex;
  gap: 20px;
  padding: 20px;
  align-items: flex-start;
  flex: 1;
  min-height: min-content;
}

@media (max-width: 1180px) {
  .app-body { overflow: auto; }
  .center-panel { overflow: visible; }
  .image-row {
    flex-direction: column;
  }
}

/* ── 右侧差异面板 ── */
.right-panel {
  width: 360px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--hw-panel);
  border-left: 1px solid var(--hw-border);
  overflow: hidden;
}

.right-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid #f0f0f0;
  flex-shrink: 0;
}
.right-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--hw-text);
  margin-right: auto;
}

/* ── 右侧标签页 ── */
.right-tabs {
  display: flex;
  border-bottom: 1px solid var(--hw-border);
  flex-shrink: 0;
}

.rtab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--hw-muted);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color .15s, border-color .15s;
}
.rtab:hover  { color: #a64b5b; background: #faf5f6; }
.rtab.active { color: #a64b5b; border-bottom-color: #d98a98; background: #fff8f9; }

.rtab-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 0 4px;
  border-radius: 8px;
  line-height: 15px;
  min-width: 15px;
  text-align: center;
}
.rtab-badge.error   { background: #fff3f5; color: #b84b5f; }
.rtab-badge.warning { background: #fff9ef; color: #a8752b; }
.rtab-badge.neutral { background: #f5f5f5; color: var(--hw-muted); }
</style>
