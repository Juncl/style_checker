<template>
  <div class="img-panel" ref="panelRef">
    <div class="img-wrapper" ref="wrapperRef" @click.self="onWrapperBgClick" @mousedown="onBoxStart">
      <div class="zoom-clip" ref="zoomClipRef">
        <div class="zoom-layer" ref="zoomLayerRef">
          <img :src="src" ref="imgRef" :alt="label" @load="onImgLoad" />
          <canvas
            ref="canvasRef"
            class="overlay-canvas"
            @click="onCanvasClick"
            @dblclick="onCanvasDblClick"
            @mousemove="onMouseMove"
            @mouseleave="onMouseLeave"
          />
        </div>
      </div>
    </div>

    <Transition name="inspector-fade">
      <div
        v-if="isSpacingInspector || (inspectorNode && (displayStyle.length || hasManualStyle || debugStore.debugMode || editMode))"
        ref="inspectorRef"
        class="node-inspector"
        :class="{ dragging: isDraggingInspector, 'inspector--design': side === 'design' }"
        :style="inspectorPos"
        @click.stop
      >
        <div
          class="inspector-header"
          title="拖动调整位置，双击回到节点旁"
          @pointerdown="startInspectorDrag"
          @dblclick.stop="resetInspectorPosition"
        >
          <span class="inspector-name">
            {{ isSpacingInspector ? (highlightPair.label || '间距') : (inspectorNode?.textContent || inspectorNode?.name) }}
          </span>
          <span v-if="debugStore.debugMode && !isSpacingInspector" class="inspector-badge">{{ inspectorNode?.rawType || inspectorNode?.type }}</span>
          <button
            v-if="!isSpacingInspector && editMode"
            class="inspector-add-btn"
            :disabled="showPendingRow"
            title="添加自定义对比项"
            @click.stop="showPendingRow = true"
            @pointerdown.stop
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2.76 10.0501L11.5567 1.25678C12.3433 0.466778 13.62 0.470111 14.4067 1.25678C15.1967 2.04344 15.1967 3.32011 14.4067 4.11011L5.61333 12.9034L1 14.6668L2.76 10.0501Z" stroke="currentColor" stroke-linejoin="round" stroke-width="1"/>
              <path d="M10.8833 1.92676L13.7333 4.77676" stroke="currentColor" stroke-linecap="square" stroke-width="1"/>
              <path d="M8.33325 14.8333L14.3333 14.8333" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/>
            </svg>
          </button>
        </div>
        <div class="inspector-body">
          <!-- 间距模式 -->
          <template v-if="isSpacingInspector">
            <div class="prop-row diff-weak">
              <span class="prop-key">距离</span>
              <span class="prop-val">{{ highlightPair.value }}</span>
            </div>
          </template>
          <!-- 节点模式 -->
          <template v-else>
            <div v-if="debugStore.debugMode" class="prop-row">
              <span class="prop-key">id</span>
              <span class="prop-val">
                {{ inspectorNode?.id }}
                <el-icon class="copy-icon" @click.stop="copyId"><CopyDocument /></el-icon>
              </span>
            </div>
            <div
              v-for="item in displayStyle"
              :key="item.key"
              :class="['prop-row', item.diff ? (item.diff.confidence === 'low' ? 'diff-weak' : 'diff-strong') : '']"
              :title="item.diff?.description || ''"
            >
              <span class="prop-key">{{ item.label }}</span>
              <span :class="['prop-val', item.truncate && 'prop-val--truncate']" :title="item.truncate ? item.val : undefined">
                <span v-if="item.color" class="color-dot" :style="{ background: item.color }"></span>
                {{ item.val }}
              </span>
            </div>
            <!-- 已保存的人工属性行（只读 + 删除按钮） -->
            <div
              v-for="row in savedRows"
              :key="row.key"
              class="prop-row prop-row--saved"
              @click.stop
            >
              <span class="prop-key">{{ rowLabel(row.key) }}</span>
              <span class="prop-val">{{ row.rawValue }}</span>
              <button v-if="editMode" class="extra-action-btn extra-delete-btn" title="删除" @click.stop="deleteRow(row.key)">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
            <!-- 待确认的新行（编辑中） -->
            <div v-if="showPendingRow" class="extra-edit-panel" @click.stop>
              <div class="prop-row prop-row--extra">
                <el-select v-model="pendingKey" class="extra-select" popper-class="extra-select-popper" placeholder="属性">
                  <el-option
                    v-for="opt in extraRowOptions"
                    :key="opt.value"
                    :value="opt.value"
                    :label="opt.label"
                  />
                </el-select>
                <div class="extra-input-wrap">
                  <el-input
                    v-model="pendingValue"
                    class="extra-input"
                    :class="{ 'extra-input--error': extraError }"
                    :placeholder="getInputPlaceholder(pendingKey)"
                  />
                  <span v-if="extraError" class="extra-error-tip">{{ extraError }}</span>
                </div>
              </div>
              <div class="extra-actions">
                <button class="extra-cancel-btn" @click.stop="cancelExtra">取消</button>
                <button
                  class="extra-submit-btn"
                  :disabled="!canConfirm"
                  @click.stop="confirmExtra"
                >确定</button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { toWebColorDisplay } from '../../utils/tools.ts'
import { TEXT_STYLE_OPTIONS, CONTAINER_STYLE_OPTIONS } from '../../utils/constants'
import { validateOverrideInput, getInputPlaceholder, parseOverrideValue } from '../match/overrideValidator'
import '../../../styles/image-panel.css'
import { useDebugStore } from '../../../stores/debug'

const debugStore = useDebugStore()

const props = defineProps({
  src:          { type: String,  default: '' },
  label:        { type: String,  default: '' },
  highlight:    { type: Object,  default: null },
  highlightPair:{ type: Object,  default: null },
  canvasW:      { type: Number,  default: 360 },
  canvasH:      { type: Number,  default: 792 },
  nodes:        { type: Array,   default: () => [] },
  selectedId:   { type: String,  default: null },
  inspectorNode:{ type: Object,  default: null },
  styleDiffs:   { type: Array,   default: () => [] },
  externalHoveredId: { type: String,  default: null },
  side:              { type: String,  default: 'dev' },   // 'dev' | 'design'
  debugPairMap:  { type: Object,  default: () => ({}) },
  hoverHighlightPairs: { type: Array, default: () => [] },
  platform:            { type: String, default: 'hmPhone' },
  boxSelectMode:       { type: Boolean, default: false },
  editMode:            { type: Boolean, default: false },
  compareActive:       { type: Boolean, default: false },
  selectedNodeIds:     { type: Array,   default: () => [] },  // select 模式下由 store 驱动的选中节点 id 列表
})

const emit = defineEmits(['node-click', 'bg-click', 'node-hover', 'zoom', 'box-select', 'extra-change', 'save-manual-style', 'remove-manual-style'])

const panelRef     = ref(null)
const labelRef     = ref(null)
const wrapperRef   = ref(null)
const zoomClipRef  = ref(null)
const zoomLayerRef = ref(null)
const imgRef       = ref(null)
const canvasRef    = ref(null)
const inspectorRef = ref(null)
const hoveredId    = ref(null)
const inspectorPos = ref({})
const isDraggingInspector = ref(false)
const inspectorDragPos = ref(null)
const dragStart = ref(null)

const zoomScale = ref(1)

// 缩放基准（非响应式，DOM 派生量）：
// fitW/fitH = 图片 contain 贴合 wrapper 的尺寸（缩放倍数 1 时的渲染尺寸）
// wrapW/wrapH = wrapper(≈img-panel) 可用尺寸，即 zoom-clip 视口能放大到的上限
let fitW = 0, fitH = 0, wrapW = 0, wrapH = 0

// 框选状态
const boxDrag    = ref(null)        // { startPx, startPy, startCX, startCY }
const boxRect    = ref(null)        // { x, y, w, h } 当前框（画布坐标）
const boxHitIds  = ref(new Set())   // 当前框内命中的节点 id
const frozenMaskRects = ref(null)  // 进入 tempPairs 时快照的遮盖区域，之后不变
let   suppressClick = false         // 框选完成后阻止下一次 click 事件

// 本地同步记录当前选中 id，用于双击下钻
// 不能直接用 props.selectedId：dblclick 触发时 Vue 响应式更新尚未完成
const localSelectedId = ref(null)

const isSpacingInspector = computed(() =>
  props.highlightPair?.type === 'spacing' && props.highlightPair?.value != null
)

// 当父组件通过树/diff等外部方式改变 selectedId 时，同步本地状态并聚焦
watch(() => props.selectedId, (id) => {
  localSelectedId.value = id
  nextTick(() => {
    draw()
    if (id && zoomScale.value > 1) {
      const node = props.nodes.find(n => n.id === id)
      if (node?.rect) focusToRect(node.rect)
    }
  })
})

let ro = null
onMounted(() => {
  ro = new ResizeObserver(() => { updateClipSize(); draw(); updateInspectorPos() })
  if (wrapperRef.value) ro.observe(wrapperRef.value)
  window.addEventListener('pointermove', onInspectorDrag)
  window.addEventListener('pointerup', endInspectorDrag)
  canvasRef.value?.addEventListener('wheel', onCanvasWheel, { passive: false })
  zoomClipRef.value?.addEventListener('scroll', onClipScroll, { passive: true })
})
onUnmounted(() => {
  ro?.disconnect()
  window.removeEventListener('pointermove', onInspectorDrag)
  window.removeEventListener('pointerup', endInspectorDrag)
  window.removeEventListener('mousemove', onBoxMove)
  window.removeEventListener('mouseup',   onBoxEnd)
  canvasRef.value?.removeEventListener('wheel', onCanvasWheel)
  zoomClipRef.value?.removeEventListener('scroll', onClipScroll)
  if (zoomRafId) cancelAnimationFrame(zoomRafId)
})

// 视口平移（滚动条/滚轮）时，画布跟随 zoom-layer 一起滚动无需重绘，
// 但浮动 inspector 相对 panel 定位，需要同步刷新位置
function onClipScroll() { updateInspectorPos() }

function onImgLoad() { nextTick(() => { updateClipSize(); draw(); updateInspectorPos() }) }

// 重新测量 wrapper 与图片，算出 contain 基准尺寸 fitW/fitH，再按当前缩放布局
function updateClipSize() {
  const wrapper = wrapperRef.value
  const img     = imgRef.value
  const clip    = zoomClipRef.value
  if (!wrapper || !img || !clip) return
  const nW = img.naturalWidth
  const nH = img.naturalHeight
  if (!nW || !nH) return
  wrapW = wrapper.clientWidth
  wrapH = wrapper.clientHeight
  const ratio = nW / nH
  if (ratio > wrapW / wrapH) {
    fitW = wrapW; fitH = wrapW / ratio
  } else {
    fitH = wrapH; fitW = wrapH * ratio
  }
  applyLayout()
}

// 按当前 zoomScale 设置渲染层与视口尺寸：
// - zoom-layer 实际宽高 = fit × scale（等比放大，保持图片比例）
// - zoom-clip 视口 = min(render, panel)，居中；放大到撑满 panel 后不再变大，
//   超出部分由 clip 的 overflow:auto 滚动（cover 效果）
function applyLayout() {
  const clip  = zoomClipRef.value
  const layer = zoomLayerRef.value
  if (!clip || !layer || !fitW || !fitH) return
  const s = zoomScale.value
  const renderW = fitW * s
  const renderH = fitH * s
  const clipW = Math.min(renderW, wrapW)
  const clipH = Math.min(renderH, wrapH)
  layer.style.width  = renderW + 'px'
  layer.style.height = renderH + 'px'
  clip.style.width  = clipW + 'px'
  clip.style.height = clipH + 'px'
  clip.style.left   = ((wrapW - clipW) / 2) + 'px'
  clip.style.top    = ((wrapH - clipH) / 2) + 'px'
}

watch(() => props.highlight,     () => nextTick(draw))
watch(() => props.highlightPair, (hp) => nextTick(() => {
  draw()
  if (hp?.type === 'spacing' && hp?.value != null) inspectorDragPos.value = null
  updateInspectorPos()
  if (hp?.type === 'spacing' && zoomScale.value > 1) {
    const rects = [...(hp.rects || []), hp.spaceRect].filter(Boolean)
    if (rects.length) focusToRect(unionRects(rects))
  }
}))
watch(() => props.hoverHighlightPairs, () => nextTick(draw), { deep: true })
watch(() => [props.canvasW, props.canvasH], () => nextTick(draw))
watch(() => debugStore.debugPipelineOn,  () => nextTick(draw))
watch(() => debugStore.debugOverlayOn,          () => nextTick(draw))
watch(() => props.externalHoveredId,     () => nextTick(draw))
watch(() => props.compareActive, (active) => {
  if (active) {
    const boxSet = boxHitIds.value
    const propSet = new Set(props.selectedNodeIds || [])
    const allIds = new Set([...boxSet, ...propSet])
    frozenMaskRects.value = allIds.size > 0
      ? props.nodes.filter(n => allIds.has(n.id) && n.rect).map(n => n.rect)
      : ((props.selectedId || localSelectedId.value)
          ? [props.nodes.find(n => n.id === (props.selectedId || localSelectedId.value))?.rect].filter(Boolean)
          : [])
  } else {
    frozenMaskRects.value = null
  }
  nextTick(draw)
})
watch(() => props.boxSelectMode, (on) => {
  if (!on) {
    boxHitIds.value       = new Set()
    localSelectedId.value = null
    nextTick(draw)
  }
})
watch(() => props.debugPairMap,  () => nextTick(draw), { deep: true })
watch(() => props.inspectorNode?.id, () => {
  inspectorDragPos.value = null
  showPendingRow.value = false
  pendingKey.value     = ''
  pendingValue.value   = ''
  emit('extra-change', null)

  // 从节点的 manualStyle 还原已保存行（切换节点后重新展示已有人工值）
  const ms = props.inspectorNode?.manualStyle
  savedRows.value = ms && typeof ms === 'object'
    ? Object.entries(ms).map(([key, val]) => ({ key, rawValue: parsedValToDisplay(key, val) }))
    : []

  nextTick(updateInspectorPos)
})

// ── 坐标转换 ────────────────────────────────────────────────────────────────

function getCanvasCoords(e) {
  const canvas = canvasRef.value
  if (!canvas) return null
  const r = canvas.getBoundingClientRect()
  return {
    px: (e.clientX - r.left) / r.width  * props.canvasW,
    py: (e.clientY - r.top)  / r.height * props.canvasH,
  }
}

/** 返回该坐标所有命中节点（排除锁定层），按面积升序（小在前=上层在前） */
function hitNodesAt(px, py) {
  return props.nodes
    .filter(n =>
      n.visible !== false &&
      !isHiddenTextNode(n) &&
      !n.visualOccluded &&
      n.rect &&
      px >= n.rect.x && px <= n.rect.x + n.rect.w &&
      py >= n.rect.y && py <= n.rect.y + n.rect.h
    )
    .sort((a, b) => {
      const typeDelta = hitTypePriority(a) - hitTypePriority(b)
      if (typeDelta !== 0) return typeDelta
      return a.rect.w * a.rect.h - b.rect.w * b.rect.h
    })
}

function findHitNode(px, py) {
  return hitNodesAt(px, py)[0] ?? null
}

/** 判断节点在框选区域内是否有至少一个点可被 hover 到（5 点采样） */
function canHoverInSel(node, sel) {
  const ix  = Math.max(node.rect.x, sel.x)
  const iy  = Math.max(node.rect.y, sel.y)
  const ix2 = Math.min(node.rect.x + node.rect.w, sel.x + sel.w)
  const iy2 = Math.min(node.rect.y + node.rect.h, sel.y + sel.h)
  const pts = [
    [(ix + ix2) / 2, (iy + iy2) / 2],
    [ix + 1,  iy + 1 ],
    [ix2 - 1, iy + 1 ],
    [ix + 1,  iy2 - 1],
    [ix2 - 1, iy2 - 1],
  ]
  return pts.some(([px, py]) => findHitNode(px, py)?.id === node.id)
}

function hitTypePriority(node) {
  if (node.type === 'text') return 0
  if (node.type === 'container') return 1
  return 2
}

function isHiddenTextNode(node) {
  return !!(node &&
    node.type === 'text' &&
    (node.visualOccluded || node.ocrVisibility?.visible === false))
}

// ── 交互事件 ────────────────────────────────────────────────────────────────

function onCanvasClick(e) {
  if (suppressClick) { suppressClick = false; if (!(e.ctrlKey || e.metaKey)) return }
  if (e.detail >= 2) return  // 双击序列中的第二次 click，交给 dblclick 处理

  // Ctrl/Cmd+点击：select 模式下切换单个节点的命中状态（tempPairs 模式不触发）
  if ((e.ctrlKey || e.metaKey) && props.boxSelectMode && !props.compareActive) {
    const coords = getCanvasCoords(e)
    if (!coords) return
    const hit = findHitNode(coords.px, coords.py)
    if (hit) {
      e.stopPropagation()
      const next = new Set(boxHitIds.value)
      if (next.has(hit.id)) next.delete(hit.id)
      else next.add(hit.id)
      boxHitIds.value = next
      draw()
      emit('box-select', props.nodes.filter(n => boxHitIds.value.has(n.id)))
    }
    return
  }

  const coords = getCanvasCoords(e)
  if (!coords) return
  const hit = findHitNode(coords.px, coords.py)
  if (hit) {
    e.stopPropagation()  // 命中节点时阻止冒泡，避免触发 stage 的 clear-pair
    localSelectedId.value = hit.id
    emit('node-click', hit.id)
  } else {
    emit('bg-click')
  }
}

/** img-wrapper 上的 @click.self：框选松手后 suppressClick 生效期间不触发 bg-click */
function onWrapperBgClick() {
  if (suppressClick) { suppressClick = false; return }
  emit('bg-click')
}

/** 双击下钻：在当前坐标的所有命中节点中循环选取下一层 */
function onCanvasDblClick(e) {
  e.stopPropagation()
  const coords = getCanvasCoords(e)
  if (!coords) return
  const hits = hitNodesAt(coords.px, coords.py)
  if (hits.length < 2) return
  const curIdx = hits.findIndex(n => n.id === localSelectedId.value)
  const nextIdx = curIdx >= 0 ? (curIdx + 1) % hits.length : 1
  const next = hits[nextIdx]
  localSelectedId.value = next.id
  emit('node-click', next.id)
}

function onMouseMove(e) {
  if (boxDrag.value) return   // 框选中，跳过 hover
  const coords = getCanvasCoords(e)
  if (!coords) return
  let hit = findHitNode(coords.px, coords.py)
  // 对比激活时，白色遮罩覆盖区域（选中范围外）不触发 hover
  if (props.compareActive && hit) {
    const inSelected = boxHitIds.value.size > 0
      ? boxHitIds.value.has(hit.id)
      : hit.id === (props.selectedId || localSelectedId.value)
    if (!inSelected) hit = null
  }
  const newId = hit?.id ?? null
  if (newId !== hoveredId.value) {
    hoveredId.value = newId
    if (canvasRef.value) canvasRef.value.style.cursor = newId ? 'pointer' : 'default'
    emit('node-hover', newId)
    draw()
  }
}

function onMouseLeave() {
  if (hoveredId.value !== null) {
    hoveredId.value = null
    if (canvasRef.value) canvasRef.value.style.cursor = 'default'
    emit('node-hover', null)
    draw()
  }
}

// ── 框选 ─────────────────────────────────────────────────────────────────────

function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y
}

function onBoxStart(e) {
  if (!props.boxSelectMode || e.button !== 0) return
  if (e.ctrlKey || e.metaKey) return
  if (props.compareActive) return  // tempPairs 模式不启动框选，光标保持 pointer/default
  const coords = getCanvasCoords(e)
  if (!coords) return
  e.preventDefault()
  boxDrag.value   = { startPx: coords.px, startPy: coords.py, startCX: e.clientX, startCY: e.clientY }
  boxRect.value   = null
  boxHitIds.value = new Set()   // 重新框选清空上次高亮
  suppressClick   = false
  if (canvasRef.value) canvasRef.value.style.cursor = 'crosshair'
  window.addEventListener('mousemove', onBoxMove)
  window.addEventListener('mouseup',   onBoxEnd)
}

function onBoxMove(e) {
  if (!boxDrag.value) return
  // 超出 img-wrapper 边界 → 自动停止
  const wr = wrapperRef.value?.getBoundingClientRect()
  if (wr && (e.clientX < wr.left || e.clientX > wr.right || e.clientY < wr.top || e.clientY > wr.bottom)) {
    finishBox()
    return
  }
  const coords = getCanvasCoords(e)
  if (!coords) return
  const dx = e.clientX - boxDrag.value.startCX
  const dy = e.clientY - boxDrag.value.startCY
  if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return   // 抖动容差，不开始绘框
  suppressClick = true
  const x = Math.min(boxDrag.value.startPx, coords.px)
  const y = Math.min(boxDrag.value.startPy, coords.py)
  const w = Math.abs(coords.px - boxDrag.value.startPx)
  const h = Math.abs(coords.py - boxDrag.value.startPy)
  boxRect.value = { x, y, w, h }
  const sel = { x, y, w, h }
  const hits = props.nodes.filter(n =>
    n.visible !== false && !n.visualOccluded && n.rect && rectsIntersect(sel, n.rect) &&
    !(n.rect.x >= -2 && n.rect.x <= 2 && n.rect.y >= -2 && n.rect.y <= 2 &&
      n.rect.w >= props.canvasW - 2 && n.rect.h >= props.canvasH - 2) &&
    canHoverInSel(n, sel)
  )
  boxHitIds.value = new Set(hits.map(n => n.id))
  draw()
}

function onBoxEnd() {
  finishBox()
}

function finishBox() {
  window.removeEventListener('mousemove', onBoxMove)
  window.removeEventListener('mouseup',   onBoxEnd)
  if (!boxDrag.value) return
  if (suppressClick && boxHitIds.value.size > 0) {
    const selectedNodes = props.nodes.filter(n => boxHitIds.value.has(n.id))
    emit('box-select', selectedNodes)
  }
  boxDrag.value = null
  boxRect.value = null
  // boxHitIds 保留，高亮维持到下次单击或重新框选
  if (canvasRef.value) canvasRef.value.style.cursor = ''
  draw()
}

// 缩放节流：一帧内的多次滚轮/双指捏合事件累积成一次渲染，避免事件风暴压垮画布重绘
let zoomRafId    = null
let pendingZoom  = null   // { factor, normX, normY }，factor 为本帧累积的连乘缩放量

function onCanvasWheel(e) {
  if (!e.ctrlKey) return
  e.preventDefault()
  // 根据 deltaY 大小调整缩放倍数
  // 鼠标 deltaY≈120，触摸板 deltaY 通常 1-10
  // 小 deltaY 用小倍数，避免触摸板多事件累乘太快
  const absDelta = Math.abs(e.deltaY)
  const base = absDelta > 50 ? 1.1 : 1.01 + (absDelta / 120) * 0.14
  const factor = e.deltaY < 0 ? base : 1 / base
  const clip = zoomClipRef.value
  if (!clip) return
  const rect = clip.getBoundingClientRect()
  const normX = (e.clientX - rect.left) / rect.width
  const normY = (e.clientY - rect.top) / rect.height

  // 累积本帧缩放量；焦点取最近一次事件的位置
  if (pendingZoom) {
    pendingZoom.factor *= factor
    pendingZoom.normX = normX
    pendingZoom.normY = normY
  } else {
    pendingZoom = { factor, normX, normY }
  }
  if (!zoomRafId) zoomRafId = requestAnimationFrame(flushZoom)
}

// rAF 回调：把本帧累积的缩放一次性应用并渲染，同时联动对侧
function flushZoom() {
  zoomRafId = null
  const z = pendingZoom
  pendingZoom = null
  if (!z) return
  // 每帧最大缩放步长 = 单次滚轮步长：鼠标一帧仅 1 个事件不受影响，
  // 触摸板捏合一帧塞入大量事件（factor 连乘暴冲）则被压到与鼠标一致的节奏
  const MAX_STEP = 1.1
  z.factor = Math.max(1 / MAX_STEP, Math.min(MAX_STEP, z.factor))
  applyZoom(z.factor, z.normX, z.normY)
  emit('zoom', z)
}

// ── 聚焦 ────────────────────────────────────────────────────────────────────

function unionRects(rects) {
  const xs = rects.flatMap(r => [r.x, r.x + r.w])
  const ys = rects.flatMap(r => [r.y, r.y + r.h])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

// 将 rect（画布坐标系）平移到 zoom-clip 视口中央，边缘处取最近可行位置
function focusToRect(rect) {
  if (!rect) return
  const clip  = zoomClipRef.value
  const layer = zoomLayerRef.value
  if (!clip || !layer) return
  const renderW = layer.offsetWidth
  const renderH = layer.offsetHeight
  if (!renderW || !renderH) return

  // 节点中心在渲染层（已放大）坐标系中的位置
  const cx = (rect.x + rect.w / 2) / props.canvasW * renderW
  const cy = (rect.y + rect.h / 2) / props.canvasH * renderH

  // 通过滚动让节点中心落在视口正中央，越界则 clamp 到可滚动范围
  clip.scrollLeft = Math.max(0, Math.min(cx - clip.clientWidth  / 2, renderW - clip.clientWidth))
  clip.scrollTop  = Math.max(0, Math.min(cy - clip.clientHeight / 2, renderH - clip.clientHeight))

  nextTick(updateInspectorPos)
}

// ── 绘制 ────────────────────────────────────────────────────────────────────

function draw() {
  const canvas = canvasRef.value
  const img    = imgRef.value
  if (!canvas || !img) return

  const W = img.clientWidth   // 已是 fit × zoomScale 的实际渲染宽度
  const H = img.clientHeight
  if (!W || !H) return

  const dpr  = window.devicePixelRatio || 1
  // 缓冲区分辨率系数：缩放 ≤4 时按真实渲染像素绘制；>4 时封顶（高倍下轻微模糊，避免显存爆涨）
  const q    = Math.min(zoomScale.value, 4) / zoomScale.value
  const bufW = Math.round(W * dpr * q)
  const bufH = Math.round(H * dpr * q)

  // 只有缓冲区尺寸真正变化时才重建 GPU 纹理，mousemove 时通常不触发
  if (canvas.width !== bufW || canvas.height !== bufH) {
    canvas.width  = bufW
    canvas.height = bufH
  }

  canvas.style.left = '0'
  canvas.style.top  = '0'

  const ctx = canvas.getContext('2d')
  ctx.save()
  ctx.scale(dpr * q, dpr * q)
  ctx.clearRect(0, 0, W, H)

  const sx = W / props.canvasW
  const sy = H / props.canvasH

  // Debugger 节点轮廓：显示进入匹配阶段的全部节点
  if (debugStore.debugPipelineOn) {
    for (const n of props.nodes) {
      if (n.visible === false || !n.rect) continue
      drawNodeRect(ctx, n.rect, sx, sy, 'rgba(255,0,0,0)', '#ff0000', 1, [])
    }
  }

  // Debugger 映射框（同一 pair 的设计侧 / 开发侧使用同一颜色）
  if (debugStore.debugOverlayOn && props.debugPairMap && Object.keys(props.debugPairMap).length) {
    for (const n of props.nodes) {
      const meta = props.debugPairMap[n.id]
      if (!meta || n.visible === false || !n.rect) continue
      const color = meta.color || '#2f6fed'
      drawNodeRect(ctx, n.rect, sx, sy, 'rgba(47,111,237,0.04)', color, 2, [5, 3])
      const px = n.rect.x * sx
      const py = n.rect.y * sy
      const badgeW = 14
      const badgeH = 14
      if (n.rect.w * sx > 18 && n.rect.h * sy > 14) {
        ctx.fillStyle = color
        ctx.fillRect(px, py, badgeW, badgeH)
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 9px sans-serif'
        ctx.fillText(String((meta.index ?? 0) + 1), px + 3, py + 10)
      }
    }
  }

  // 悬停节点（红色虚线 + 浅红背景）
  if (hoveredId.value && hoveredId.value !== props.selectedId) {
    const n = props.nodes.find(n => n.id === hoveredId.value)
    if (n) drawNodeRect(ctx, n.rect, sx, sy, 'rgba(224,33,40,0.10)', '#E02128', 1, [4, 3])
  }
  // 对方画布联动的映射 hover（同色虚线框）
  if (props.externalHoveredId && props.externalHoveredId !== props.selectedId && props.externalHoveredId !== hoveredId.value) {
    const n = props.nodes.find(n => n.id === props.externalHoveredId)
    if (n) drawNodeRect(ctx, n.rect, sx, sy, 'rgba(224,33,40,0.10)', '#E02128', 1, [4, 3])
  }

  // 选中节点（红色实线 + 红色背景）
  if (props.selectedId) {
    const n = props.nodes.find(n => n.id === props.selectedId)
    if (n) drawNodeRect(ctx, n.rect, sx, sy, 'rgba(224,33,40,0.20)', '#E02128', 1, [])
  }

  // diff 高亮（橙色）
  const hr = props.highlight
  const hp = props.highlightPair
  if (hp && props.canvasW && props.canvasH) {
    if (hp.type === 'spacing') {
      drawSpacingMark(ctx, hp, sx, sy)
    } else {
      drawRelationHighlight(ctx, hp, sx, sy)
    }
  } else if (hr && props.canvasW && props.canvasH) {
    drawNodeRect(ctx, hr, sx, sy, 'rgba(255,80,0,0.15)', '#ff5000', 2, [])
    const hx = hr.x * sx, hy = hr.y * sy
    ctx.fillStyle = '#ff5000'
    ctx.fillRect(hx, hy - 18, Math.min(hr.w * sx, 80), 18)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 11px sans-serif'
    ctx.fillText('◉', hx + 4, hy - 5)
  }

  // hover 实时间距标注（蓝色）
  if (props.hoverHighlightPairs.length && props.canvasW && props.canvasH) {
    for (const mark of props.hoverHighlightPairs) {
      drawHoverSpacingMark(ctx, mark, sx, sy)
    }
  }

  // 框选命中节点高亮（红色实线，无背景；对比激活时不绘制）
  if (boxHitIds.value.size > 0 && !props.compareActive) {
    for (const n of props.nodes) {
      if (boxHitIds.value.has(n.id) && n.rect) {
        drawNodeRect(ctx, n.rect, sx, sy, 'rgba(0,0,0,0)', '#E02128', 1.5, [])
      }
    }
  }
  // 框选矩形（蓝色虚线框；对比激活时不绘制）
  if (boxRect.value && !props.compareActive) {
    const r = boxRect.value
    ctx.strokeStyle = '#0067D1'
    ctx.lineWidth = 1
    ctx.setLineDash([5, 3])
    ctx.fillStyle = 'rgba(0,103,209,0.06)'
    ctx.fillRect(r.x * sx, r.y * sy, r.w * sx, r.h * sy)
    ctx.strokeRect(r.x * sx, r.y * sy, r.w * sx, r.h * sy)
    ctx.setLineDash([])
  }

  // 对比激活：在选中区外绘制白色遮罩，快照于进入 tempPairs 时刻，之后不变
  if (props.compareActive && frozenMaskRects.value) {
    const hitRects = frozenMaskRects.value
    if (hitRects.length > 0) {
      const u = unionRects(hitRects)
      const mX = u.x * sx, mY = u.y * sy, mW = u.w * sx, mH = u.h * sy
      ctx.fillStyle = 'rgba(255,255,255,0.72)'
      ctx.fillRect(0, 0, W, mY)                      // 上
      ctx.fillRect(0, mY + mH, W, H - mY - mH)       // 下
      ctx.fillRect(0, mY, mX, mH)                     // 左
      ctx.fillRect(mX + mW, mY, W - mX - mW, mH)     // 右
    }
  }

  ctx.restore()
}

function drawNodeRect(ctx, rect, sx, sy, fill, stroke, lineWidth, dash) {
  const x = rect.x * sx, y = rect.y * sy, w = rect.w * sx, h = rect.h * sy
  ctx.fillStyle = fill
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = stroke
  ctx.lineWidth = lineWidth
  ctx.setLineDash(dash)
  ctx.strokeRect(x, y, w, h)
  ctx.setLineDash([])
}

function drawRelationHighlight(ctx, relation, sx, sy) {
  const rects = Array.isArray(relation?.rects) ? relation.rects.filter(Boolean) : []
  if (!rects.length) return
  for (const rect of rects) {
    drawNodeRect(ctx, rect, sx, sy, 'rgba(255,176,0,0.10)', '#ff9800', 2, [4, 3])
  }
  if (rects.length < 2) return

  const [a, b] = rects
  const axis = relation.axis
  const band = axis === 'vertical'
    ? verticalGapBand(a, b)
    : axis === 'horizontal'
      ? horizontalGapBand(a, b)
      : null
  if (!band) return

  ctx.fillStyle = 'rgba(255,176,0,0.18)'
  ctx.strokeStyle = 'rgba(255,140,0,0.85)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([5, 4])
  ctx.fillRect(band.x * sx, band.y * sy, band.w * sx, band.h * sy)
  ctx.strokeRect(band.x * sx, band.y * sy, band.w * sx, band.h * sy)
  ctx.setLineDash([])
}

// 箭头辅助：在 (tx, ty) 处沿角度 angle 画实心箭头头部
function drawArrowHead(ctx, tx, ty, angle, size) {
  ctx.save()
  ctx.translate(tx, ty)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(-size, -size * 0.45)
  ctx.lineTo(-size, size * 0.45)
  ctx.closePath()
  ctx.fillStyle = ctx.strokeStyle
  ctx.fill()
  ctx.restore()
}

// 间距标注（参考设计稿"组合 31777"）：中间带双箭头实线 + 两端虚线端帽，颜色 #E02128
function drawSpacingMark(ctx, mark, sx, sy) {
  const sr = mark?.spaceRect
  if (!sr) return
  const COLOR     = '#E02128'
  const DASH      = [3, 3]
  const ARROW_SZ  = 5

  ctx.strokeStyle = COLOR
  ctx.lineWidth   = 1

  if (mark.axis === 'horizontal') {
    const xL    = sr.x * sx
    const xR    = (sr.x + sr.w) * sx
    const yMid  = (sr.y + sr.h / 2) * sy
    const capTop    = sr.y * sy
    const capBottom = (sr.y + sr.h) * sy

    // 主线（实线）
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(xL, yMid)
    ctx.lineTo(xR, yMid)
    ctx.stroke()

    // 箭头：左端朝左，右端朝右
    drawArrowHead(ctx, xL, yMid, Math.PI, ARROW_SZ)
    drawArrowHead(ctx, xR, yMid, 0, ARROW_SZ)

    // 两端端帽（虚线）
    ctx.setLineDash(DASH)
    ctx.beginPath()
    ctx.moveTo(xL, capTop); ctx.lineTo(xL, capBottom)
    ctx.moveTo(xR, capTop); ctx.lineTo(xR, capBottom)
    ctx.stroke()
    ctx.setLineDash([])
    return
  }

  // 纵向：主线竖直，端帽水平
  const yT    = sr.y * sy
  const yB    = (sr.y + sr.h) * sy
  const xMid  = (sr.x + sr.w / 2) * sx
  const capLeft  = sr.x * sx
  const capRight = (sr.x + sr.w) * sx

  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(xMid, yT)
  ctx.lineTo(xMid, yB)
  ctx.stroke()

  // 箭头：上端朝上，下端朝下
  drawArrowHead(ctx, xMid, yT, -Math.PI / 2, ARROW_SZ)
  drawArrowHead(ctx, xMid, yB, Math.PI / 2, ARROW_SZ)

  ctx.setLineDash(DASH)
  ctx.beginPath()
  ctx.moveTo(capLeft, yT); ctx.lineTo(capRight, yT)
  ctx.moveTo(capLeft, yB); ctx.lineTo(capRight, yB)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawSpacingLabel(ctx, text, x, y) {
  const FONT_SIZE = 10
  ctx.font = `bold ${FONT_SIZE}px sans-serif`
  const tw = ctx.measureText(text).width
  const padX = 4, padY = 2
  const bw = tw + padX * 2, bh = FONT_SIZE + padY * 2
  ctx.fillStyle = '#0067D1'
  ctx.fillRect(x - bw / 2, y - bh / 2, bw, bh)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

function drawHoverSpacingMark(ctx, mark, sx, sy) {
  const sr = mark?.spaceRect
  if (!sr) return
  const COLOR    = '#0067D1'
  const DASH     = [3, 3]
  const ARROW_SZ = 4

  ctx.save()
  ctx.strokeStyle = COLOR
  ctx.fillStyle   = COLOR
  ctx.lineWidth   = 1

  if (mark.axis === 'horizontal') {
    if (sr.w < 0.5) { ctx.restore(); return }
    const xL   = sr.x * sx
    const xR   = (sr.x + sr.w) * sx
    const yMid = (sr.y + sr.h / 2) * sy
    const c1T  = (mark.capFirst  ? mark.capFirst.start  : sr.y) * sy
    const c1B  = (mark.capFirst  ? mark.capFirst.end    : sr.y + sr.h) * sy
    const c2T  = (mark.capSecond ? mark.capSecond.start : sr.y) * sy
    const c2B  = (mark.capSecond ? mark.capSecond.end   : sr.y + sr.h) * sy
    ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(xL, yMid); ctx.lineTo(xR, yMid); ctx.stroke()
    drawArrowHead(ctx, xL, yMid, Math.PI, ARROW_SZ)
    drawArrowHead(ctx, xR, yMid, 0, ARROW_SZ)
    ctx.setLineDash(DASH)
    ctx.beginPath()
    ctx.moveTo(xL, c1T); ctx.lineTo(xL, c1B)
    ctx.moveTo(xR, c2T); ctx.lineTo(xR, c2B)
    ctx.stroke()
    ctx.setLineDash([])
    if (mark.value != null) drawSpacingLabel(ctx, mark.value, (xL + xR) / 2, yMid)
  } else {
    if (sr.h < 0.5) { ctx.restore(); return }
    const yT   = sr.y * sy
    const yB   = (sr.y + sr.h) * sy
    const xMid = (sr.x + sr.w / 2) * sx
    const c1L  = (mark.capFirst  ? mark.capFirst.start  : sr.x) * sx
    const c1R  = (mark.capFirst  ? mark.capFirst.end    : sr.x + sr.w) * sx
    const c2L  = (mark.capSecond ? mark.capSecond.start : sr.x) * sx
    const c2R  = (mark.capSecond ? mark.capSecond.end   : sr.x + sr.w) * sx
    ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(xMid, yT); ctx.lineTo(xMid, yB); ctx.stroke()
    drawArrowHead(ctx, xMid, yT, -Math.PI / 2, ARROW_SZ)
    drawArrowHead(ctx, xMid, yB, Math.PI / 2, ARROW_SZ)
    ctx.setLineDash(DASH)
    ctx.beginPath()
    ctx.moveTo(c1L, yT); ctx.lineTo(c1R, yT)
    ctx.moveTo(c2L, yB); ctx.lineTo(c2R, yB)
    ctx.stroke()
    ctx.setLineDash([])
    if (mark.value != null) drawSpacingLabel(ctx, mark.value, xMid, (yT + yB) / 2)
  }

  ctx.restore()
}

function horizontalGapBand(a, b) {
  const left = a.x + a.w <= b.x ? a : b
  const right = left === a ? b : a
  const x1 = left.x + left.w
  const x2 = right.x
  const y1 = Math.max(left.y, right.y)
  const y2 = Math.min(left.y + left.h, right.y + right.h)
  const y = y2 > y1 ? y1 : Math.min(left.y, right.y)
  const h = y2 > y1 ? (y2 - y1) : Math.max(left.h, right.h)
  return { x: x1, y, w: Math.max(0, x2 - x1), h }
}

function verticalGapBand(a, b) {
  const top = a.y + a.h <= b.y ? a : b
  const bottom = top === a ? b : a
  const y1 = top.y + top.h
  const y2 = bottom.y
  const x1 = Math.max(top.x, bottom.x)
  const x2 = Math.min(top.x + top.w, bottom.x + bottom.w)
  const x = x2 > x1 ? x1 : Math.min(top.x, bottom.x)
  const w = x2 > x1 ? (x2 - x1) : Math.max(top.w, bottom.w)
  return { x, y: y1, w, h: Math.max(0, y2 - y1) }
}

// ── Inspector 定位 ──────────────────────────────────────────────────────────

function updateInspectorPos() {
  const isSpacing = props.highlightPair?.type === 'spacing' && props.highlightPair?.value != null
  if (!isSpacing && (!props.inspectorNode || !imgRef.value || !wrapperRef.value)) {
    inspectorPos.value = {}
    inspectorDragPos.value = null
    return
  }

  if (inspectorDragPos.value) {
    const p = clampInspectorPosition(inspectorDragPos.value.left, inspectorDragPos.value.top)
    inspectorDragPos.value = p
    inspectorPos.value = toInspectorStyle(p.left, p.top)
    return
  }

  const rect  = isSpacing ? props.highlightPair.spaceRect : props.inspectorNode?.rect
  const clip  = zoomClipRef.value
  const layer = zoomLayerRef.value
  if (!rect || !clip || !layer) return

  const clipRect  = clip.getBoundingClientRect()
  const panelRect = panelRef.value.getBoundingClientRect()
  const clipOffsetX = clipRect.left - panelRect.left
  const clipOffsetY = clipRect.top  - panelRect.top

  // 节点在渲染层（已放大）坐标系中的位置，减去滚动偏移即得视口内位置
  const renderW = layer.offsetWidth
  const renderH = layer.offsetHeight
  const nx = rect.x / props.canvasW * renderW
  const ny = rect.y / props.canvasH * renderH
  const nw = rect.w / props.canvasW * renderW
  const nh = rect.h / props.canvasH * renderH

  const visLeft = nx - clip.scrollLeft
  const visTop  = ny - clip.scrollTop

  const nodeBox = {
    left:   clipOffsetX + visLeft,
    top:    clipOffsetY + visTop,
    right:  clipOffsetX + visLeft + nw,
    bottom: clipOffsetY + visTop  + nh,
  }

  const inspectorW = inspectorRef.value?.offsetWidth || 190
  const gap = 8

  // 以 up-stage--report 右边界为越界判断基准（相对于 img-panel）
  const stageEl = panelRef.value?.closest('.up-stage--report')
  let boundRight = panelRef.value?.clientWidth || 0
  if (stageEl) {
    const stageRect = stageEl.getBoundingClientRect()
    boundRight = stageRect.right - panelRect.left
  }

  // 横向：优先红框右侧 8px，放不下则改为左侧 8px
  let left = nodeBox.right + gap
  if (left + inspectorW > boundRight - gap) {
    left = nodeBox.left - inspectorW - gap
  }

  const p = clampInspectorPosition(left, nodeBox.top)
  inspectorPos.value = toInspectorStyle(p.left, p.top)
}


function startInspectorDrag(e) {
  if (!inspectorRef.value) return
  e.preventDefault()
  e.stopPropagation()

  const panelRect = panelRef.value.getBoundingClientRect()
  const current = inspectorRef.value.getBoundingClientRect()
  const left = current.left - panelRect.left
  const top = current.top - panelRect.top

  isDraggingInspector.value = true
  dragStart.value = {
    pointerX: e.clientX,
    pointerY: e.clientY,
    left,
    top,
  }
  inspectorRef.value.setPointerCapture?.(e.pointerId)
}

function onInspectorDrag(e) {
  if (!isDraggingInspector.value || !dragStart.value) return
  const left = dragStart.value.left + e.clientX - dragStart.value.pointerX
  const top = dragStart.value.top + e.clientY - dragStart.value.pointerY
  const p = clampInspectorPosition(left, top)
  inspectorDragPos.value = p
  inspectorPos.value = toInspectorStyle(p.left, p.top)
}

function endInspectorDrag() {
  isDraggingInspector.value = false
  dragStart.value = null
}

function resetInspectorPosition() {
  inspectorDragPos.value = null
  nextTick(updateInspectorPos)
}

function clampInspectorPosition(left, top) {
  const panel = panelRef.value
  const inspector = inspectorRef.value
  if (!panel) return { left: Math.round(left), top: Math.round(top) }

  const panelH = panel.clientHeight || 0
  const inspectorW = inspector?.offsetWidth || 190
  const inspectorH = inspector?.offsetHeight || 220

  // 横向：以 up-stage--report 边界为准，允许 inspector 跨越 img-panel 边缘
  const stageEl = panel.closest('.up-stage--report')
  let minLeft = 4
  let maxLeft = (panel.clientWidth || 0) - inspectorW - 4
  if (stageEl) {
    const stageRect = stageEl.getBoundingClientRect()
    const pRect     = panel.getBoundingClientRect()
    minLeft = Math.round(stageRect.left  - pRect.left) + 8
    maxLeft = Math.round(stageRect.right - pRect.left) - inspectorW - 8
  }

  return {
    left: Math.round(Math.max(minLeft, Math.min(left, maxLeft))),
    top:  Math.round(Math.max(4, Math.min(top, panelH - inspectorH - 4))),
  }
}

function toInspectorStyle(left, top) {
  const panel = panelRef.value
  const inspector = inspectorRef.value
  if (!panel || !inspector) {
    return {
      left: `${left}px`,
      top: `${top}px`,
    }
  }

  const panelH = panel.clientHeight || 0
  const inspectorH = inspector.offsetHeight || 220

  // 检查是否会被底部裁剪，仅在快超出时才限制高度
  const style = { left: `${left}px`, top: `${top}px` }
  const bottomSpace = panelH - top
  if (bottomSpace < inspectorH) {
    style.maxHeight = `${Math.max(40, bottomSpace - 8)}px`
  }
  return style
}

// ── 样式格式化 ──────────────────────────────────────────────────────────────

const hasManualStyle = computed(() => {
  const ms = props.inspectorNode?.manualStyle
  return ms && typeof ms === 'object' && Object.keys(ms).length > 0
})

const displayStyle = computed(() => {
  const s = props.inspectorNode?.style
  if (!s) return []
  const rows = []
  const add = (key, val, color = null, label = null, truncate = false) => rows.push({
    key,
    label: label || key,
    val: String(val),
    color: toCssColor(color),
    diff: diffForStyleKey(key),
    truncate,
  })

  if (s.fontSize      != null) add('fontSize',      s.fontSize, null, '字号')
  if (s.fontWeight    != null) add('fontWeight',    s.fontWeight, null, '字重')
  if (s.fontColor)             add('fontColor',     formatColorVal(s.fontColor), s.fontColor, '颜色')
  if (s.fontFamily)            add('fontFamily',    s.fontFamily, null, '字体', true)
  if (s.textAlign)             add('textAlign',     s.textAlign, null, '对齐')
  if (s.lineHeight    != null) add('lineHeight',    s.lineHeight, null, '行高')
  if (s.letterSpacing != null && s.letterSpacing !== 0) add('letterSpacing', s.letterSpacing, null, '字间距')
  if (s.backgroundColor)       add('backgroundColor', formatColorVal(s.backgroundColor), s.backgroundColor, '填充')
  // 任一侧 opacity ≠ 1 都在两侧详情框显示（对方 ≠ 1 会产生 opacity diff，本侧据此感知）
  if ((s.opacity != null && s.opacity !== 1) || diffForStyleKey('opacity')) {
    add('opacity', s.opacity ?? 1, null, '不透明度')
  }
  if (s.borderRadius) {
    const br = s.borderRadius
    const v  = [br.topLeft, br.topRight, br.bottomRight, br.bottomLeft]
    const uniform = v.every(x => x === v[0])
    add('borderRadius', uniform ? v[0] : v.join('/'), null, '圆角')
  }
  if (s.border?.width != null) add('borderWidth', s.border.width, null, '描边宽度')
  if (s.border?.color)        add('borderColor', formatColorVal(s.border.color), s.border.color, '描边颜色')
  if (s.padding) {
    const p = s.padding
    const uniform = p.top === p.right && p.right === p.bottom && p.bottom === p.left
    add('padding', uniform ? p.top : `${p.top} ${p.right} ${p.bottom} ${p.left}`, null, '内边距')
  }
  if (s.itemSpacing   != null) add('itemSpacing',   s.itemSpacing, null, '间距')
  if (s.shadow) add('shadow', formatColorVal(s.shadow), null, '阴影')
  if (s.blur)   add('blur',   s.blur,   null, '模糊')
  return rows
})

function diffForStyleKey(key) {
  const aliases = STYLE_DIFF_ALIASES[key] || [key]
  return props.styleDiffs.find(d => aliases.includes(d.property)) || null
}


// ── 自定义对比行 ─────────────────────────────────────────────────────────────
const showPendingRow = ref(false)
const pendingKey     = ref('')
const pendingValue   = ref('')
const savedRows      = ref([])   // Array<{ key: string, rawValue: string }>

const extraRowOptions = computed(() => {
  const savedKeys = new Set(savedRows.value.map(r => r.key))
  const baseOptions = props.inspectorNode?.type === 'text' ? TEXT_STYLE_OPTIONS : CONTAINER_STYLE_OPTIONS
  return baseOptions.filter(opt => !savedKeys.has(opt.value))
})

// 保存行展示用：合并所有属性选项（已保存行可能来自任意类型）
const allStyleOptions = computed(() => [...TEXT_STYLE_OPTIONS, ...CONTAINER_STYLE_OPTIONS])

function rowLabel(key) {
  const opt = allStyleOptions.value.find(o => o.value === key)
  return opt?.label || key
}

// 实时校验待确认行
const extraError = computed(() => {
  if (!pendingKey.value || !pendingValue.value.trim()) return ''
  const r = validateOverrideInput(pendingKey.value, pendingValue.value)
  return r.ok ? '' : (r.error ?? '格式有误')
})

// 绿勾可点条件
const canConfirm = computed(() =>
  !!pendingKey.value && !!pendingValue.value.trim() && !extraError.value
)

// 待确认行变化 → emit extra-change（供 Path A 点选对比实时使用）
watch([pendingKey, pendingValue], ([key, val]) => {
  const nodeId = props.inspectorNode?.id
  const valid  = nodeId && key && val.trim() && !extraError.value
  emit('extra-change', valid ? { nodeId, key, value: val.trim() } : null)
})

// 点击确认：保存到 savedRows，通知父组件写入节点树
function confirmExtra() {
  if (!canConfirm.value) return
  const nodeId    = props.inspectorNode?.id
  const key       = pendingKey.value
  const rawValue  = pendingValue.value.trim()
  const parsedVal = parseOverrideValue(key, rawValue)

  // 同 key 已存在则覆盖
  const idx = savedRows.value.findIndex(r => r.key === key)
  if (idx >= 0) savedRows.value.splice(idx, 1, { key, rawValue })
  else          savedRows.value.push({ key, rawValue })

  // 清空待确认面板
  showPendingRow.value = false
  pendingKey.value     = ''
  pendingValue.value   = ''
  emit('extra-change', null)

  emit('save-manual-style', { nodeId, key, parsedValue: parsedVal })
}

function cancelExtra() {
  showPendingRow.value = false
  pendingKey.value     = ''
  pendingValue.value   = ''
  emit('extra-change', null)
}

// 点击删除：移出 savedRows，通知父组件删除节点树中对应字段
function deleteRow(key) {
  savedRows.value = savedRows.value.filter(r => r.key !== key)
  emit('remove-manual-style', { nodeId: props.inspectorNode?.id, key })
}

// 将已解析的 manualStyle 值反向格式化为显示字符串（节点切换时还原已保存行）
function parsedValToDisplay(key, val) {
  if (val == null) return ''
  if (typeof val === 'object') {
    if (key === 'borderRadius') {
      const { topLeft: tl = 0, topRight: tr = 0, bottomRight: br = 0, bottomLeft: bl = 0 } = val
      return tl === tr && tr === br && br === bl ? String(tl) : `${tl}/${tr}/${br}/${bl}`
    }
    if (key === 'padding') {
      const { top = 0, right = 0, bottom = 0, left = 0 } = val
      return `${top}/${right}/${bottom}/${left}`
    }
    return JSON.stringify(val)
  }
  return String(val)
}

const STYLE_DIFF_ALIASES = {
  backgroundColor: ['backgroundColor'],
  borderWidth: ['borderWidth'],
  borderColor: ['borderColor', 'border.color'],
  shadow: ['shadow'],
  fontSize: ['fontSize', 'fontSize.scale'],
  fontWeight: ['fontWeight'],
  fontFamily: ['fontFamily'],
  fontColor: ['fontColor'],
  opacity: ['opacity'],
  padding: ['padding'],
  itemSpacing: ['itemSpacing'],
  borderRadius: ['borderRadius'],
  blur: ['blur'],
}

function formatColorVal(val) {
  return toWebColorDisplay(String(val ?? ''), props.platform)
}

function toCssColor(color) {
  if (!color || typeof color !== 'string') return null
  const val = color.trim()
  if (/^(linear|radial|conic)-gradient\(/i.test(val)) {
    return val.replace(/#([0-9A-Fa-f]{8})\b/g, (_, hex) => {
      const a = parseInt(hex.slice(0, 2), 16) / 255
      const r = parseInt(hex.slice(2, 4), 16)
      const g = parseInt(hex.slice(4, 6), 16)
      const b = parseInt(hex.slice(6, 8), 16)
      return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`
    })
  }
  const h = val.replace('#', '')
  if (/^[0-9a-fA-F]{8}$/.test(h)) {
    const a = parseInt(h.slice(0, 2), 16) / 255
    const r = parseInt(h.slice(2, 4), 16)
    const g = parseInt(h.slice(4, 6), 16)
    const b = parseInt(h.slice(6, 8), 16)
    return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`
  }
  return val
}

// ── 复制 ID ──────────────────────────────────────────────────────────────────

function copyId() {
  const id = props.inspectorNode?.id
  if (!id) return
  navigator.clipboard.writeText(id).catch(() => {})
}

// ── Zoom（Ctrl+滚轮缩放，由父组件触发）────────────────────────────────────────

// normX/normY 是焦点相对于 zoom-clip 视口的归一化坐标（0-1）
// 渲染层等比放大宽高 + 调整滚动，使焦点处内容在缩放前后保持不动
function applyZoom(factor, normX, normY) {
  const clip  = zoomClipRef.value
  const layer = zoomLayerRef.value
  if (!clip || !layer) return

  // 缩放前：焦点在整张渲染图中的归一化位置
  const oldRenderW = layer.offsetWidth  || fitW
  const oldRenderH = layer.offsetHeight || fitH
  const focalGX = oldRenderW ? (clip.scrollLeft + normX * clip.clientWidth)  / oldRenderW : normX
  const focalGY = oldRenderH ? (clip.scrollTop  + normY * clip.clientHeight) / oldRenderH : normY

  zoomScale.value = Math.max(1, Math.min(25, zoomScale.value * factor))
  applyLayout()

  // 缩放后：把同一焦点滚回视口内同样的归一化位置
  const newRenderW = layer.offsetWidth
  const newRenderH = layer.offsetHeight
  clip.scrollLeft = Math.max(0, Math.min(focalGX * newRenderW - normX * clip.clientWidth,  newRenderW - clip.clientWidth))
  clip.scrollTop  = Math.max(0, Math.min(focalGY * newRenderH - normY * clip.clientHeight, newRenderH - clip.clientHeight))

  nextTick(() => { draw(); updateInspectorPos() })
}

function resetZoom() {
  zoomScale.value = 1
  applyLayout()
  const clip = zoomClipRef.value
  if (clip) { clip.scrollLeft = 0; clip.scrollTop = 0 }
  nextTick(() => { draw(); updateInspectorPos() })
}

defineExpose({ applyZoom, resetZoom })
</script>
