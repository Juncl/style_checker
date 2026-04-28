<template>
  <div class="img-panel" ref="panelRef">
    <div class="img-label" ref="labelRef">{{ label }}</div>
    <div class="img-wrapper" ref="wrapperRef">
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

    <Transition name="inspector-fade">
      <div
        v-if="inspectorNode && displayStyle.length"
        ref="inspectorRef"
        class="node-inspector"
        :class="{ dragging: isDraggingInspector }"
        :style="inspectorPos"
      >
        <div
          class="inspector-header"
          title="拖动调整位置，双击回到节点旁"
          @pointerdown="startInspectorDrag"
          @dblclick.stop="resetInspectorPosition"
        >
          <span class="inspector-name">{{ inspectorNode.textContent || inspectorNode.name }}</span>
          <span class="inspector-badge">{{ inspectorNode.type }}</span>
        </div>
        <div class="inspector-body">
          <div
            v-for="item in displayStyle"
            :key="item.key"
            :class="['prop-row', item.diff ? `diff-${item.diff.severity}` : '']"
            :title="item.diff?.description || ''"
          >
            <span class="prop-key">{{ item.key }}</span>
            <span class="prop-val">
              <span v-if="item.color" class="color-dot" :style="{ background: item.color }"></span>
              {{ item.val }}
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  src:          { type: String,  default: '' },
  label:        { type: String,  default: '' },
  highlight:    { type: Object,  default: null },
  canvasW:      { type: Number,  default: 360 },
  canvasH:      { type: Number,  default: 792 },
  nodes:        { type: Array,   default: () => [] },
  selectedId:   { type: String,  default: null },
  inspectorNode:{ type: Object,  default: null },
  styleDiffs:   { type: Array,   default: () => [] },
  lockedIds:    { type: Object,  default: () => new Set() }, // Set<string>，不参与图片点击
})

const emit = defineEmits(['node-click'])

const panelRef     = ref(null)
const labelRef     = ref(null)
const wrapperRef   = ref(null)
const imgRef       = ref(null)
const canvasRef    = ref(null)
const inspectorRef = ref(null)
const hoveredId    = ref(null)
const inspectorPos = ref({})
const isDraggingInspector = ref(false)
const inspectorDragPos = ref(null)
const dragStart = ref(null)

// 本地同步记录当前选中 id，用于双击下钻
// 不能直接用 props.selectedId：dblclick 触发时 Vue 响应式更新尚未完成
const localSelectedId = ref(null)

// 当父组件通过树/diff等外部方式改变 selectedId 时，同步本地状态
watch(() => props.selectedId, id => { localSelectedId.value = id })

let ro = null
onMounted(() => {
  ro = new ResizeObserver(() => { draw(); updateInspectorPos() })
  if (wrapperRef.value) ro.observe(wrapperRef.value)
  window.addEventListener('pointermove', onInspectorDrag)
  window.addEventListener('pointerup', endInspectorDrag)
})
onUnmounted(() => {
  ro?.disconnect()
  window.removeEventListener('pointermove', onInspectorDrag)
  window.removeEventListener('pointerup', endInspectorDrag)
})

function onImgLoad() { nextTick(() => { draw(); updateInspectorPos() }) }

watch(() => props.highlight,     () => nextTick(draw))
watch(() => props.selectedId,    () => nextTick(draw))
watch(() => [props.canvasW, props.canvasH], () => nextTick(draw))
watch(() => props.inspectorNode?.id, () => {
  inspectorDragPos.value = null
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
      !n.visualOccluded &&
      n.rect &&
      !props.lockedIds.has(n.id) &&
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

function hitTypePriority(node) {
  if (node.type === 'text') return 0
  if (node.type === 'image' || node.type === 'shape') return 1
  if (node.type === 'other') return 2
  return 3
}

// ── 交互事件 ────────────────────────────────────────────────────────────────

function onCanvasClick(e) {
  if (e.detail >= 2) return  // 双击序列中的第二次 click，交给 dblclick 处理
  const coords = getCanvasCoords(e)
  if (!coords) return
  const hit = findHitNode(coords.px, coords.py)
  if (hit) {
    localSelectedId.value = hit.id   // 同步更新本地状态，dblclick 可立即读到
    emit('node-click', hit.id)
  }
}

/** 双击下钻：在当前坐标的所有命中节点中循环选取下一层 */
function onCanvasDblClick(e) {
  const coords = getCanvasCoords(e)
  if (!coords) return
  const hits = hitNodesAt(coords.px, coords.py)
  if (hits.length < 2) return
  // 用本地状态查找当前位置，避免依赖尚未更新的 props
  const curIdx = hits.findIndex(n => n.id === localSelectedId.value)
  const nextIdx = curIdx >= 0 ? (curIdx + 1) % hits.length : 1
  const next = hits[nextIdx]
  localSelectedId.value = next.id
  emit('node-click', next.id)
}

function onMouseMove(e) {
  const coords = getCanvasCoords(e)
  if (!coords) return
  const hit = findHitNode(coords.px, coords.py)
  const newId = hit?.id ?? null
  if (newId !== hoveredId.value) {
    hoveredId.value = newId
    if (canvasRef.value) canvasRef.value.style.cursor = newId ? 'pointer' : 'default'
    draw()
  }
}

function onMouseLeave() {
  if (hoveredId.value !== null) {
    hoveredId.value = null
    if (canvasRef.value) canvasRef.value.style.cursor = 'default'
    draw()
  }
}

// ── 绘制 ────────────────────────────────────────────────────────────────────

function draw() {
  const canvas = canvasRef.value
  const img    = imgRef.value
  if (!canvas || !img) return

  const W = img.clientWidth
  const H = img.clientHeight
  if (!W || !H) return

  canvas.width  = W
  canvas.height = H

  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, W, H)

  const sx = W / props.canvasW
  const sy = H / props.canvasH

  // 锁定节点（红色虚线，仅轮廓）
  for (const n of props.nodes) {
    if (n.visible === false || n.visualOccluded || !n.rect) continue
    if (!props.lockedIds.has(n.id)) continue
    drawNodeRect(ctx, n.rect, sx, sy, 'rgba(245,108,108,0.06)', '#f56c6c', 1, [3, 3])
    // 左上角小锁标
    const lx = n.rect.x * sx, ly = n.rect.y * sy
    ctx.fillStyle = 'rgba(245,108,108,0.75)'
    ctx.fillRect(lx, ly, 14, 14)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 10px sans-serif'
    ctx.fillText('🔒', lx + 1, ly + 11)
  }

  // 悬停节点（蓝色虚线，排除锁定层）
  if (hoveredId.value && hoveredId.value !== props.selectedId && !props.lockedIds.has(hoveredId.value)) {
    const n = props.nodes.find(n => n.id === hoveredId.value)
    if (n) drawNodeRect(ctx, n.rect, sx, sy, 'rgba(64,158,255,0.10)', '#409eff', 1.5, [4, 3])
  }

  // 选中节点（蓝色实线）
  if (props.selectedId) {
    const n = props.nodes.find(n => n.id === props.selectedId)
    if (n) drawNodeRect(ctx, n.rect, sx, sy, 'rgba(64,158,255,0.18)', '#409eff', 2, [])
  }

  // diff 高亮（橙色）
  const hr = props.highlight
  if (hr && props.canvasW && props.canvasH) {
    drawNodeRect(ctx, hr, sx, sy, 'rgba(255,80,0,0.15)', '#ff5000', 2, [])
    const hx = hr.x * sx, hy = hr.y * sy
    ctx.fillStyle = '#ff5000'
    ctx.fillRect(hx, hy - 18, Math.min(hr.w * sx, 80), 18)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 11px sans-serif'
    ctx.fillText('◉', hx + 4, hy - 5)
  }
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

// ── Inspector 定位 ──────────────────────────────────────────────────────────

function updateInspectorPos() {
  if (!props.inspectorNode || !imgRef.value || !wrapperRef.value) {
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

  const { rect } = props.inspectorNode
  const img      = imgRef.value
  const imgW     = img.clientWidth
  const imgH     = img.clientHeight
  const wrapTop  = wrapperRef.value.offsetTop   // 相对于 .img-panel
  const wrapLeft = wrapperRef.value.offsetLeft

  const nx = rect.x / props.canvasW * imgW
  const ny = rect.y / props.canvasH * imgH
  const nw = rect.w / props.canvasW * imgW
  const nh = rect.h / props.canvasH * imgH

  const inspectorW = inspectorRef.value?.offsetWidth || 190
  const inspectorH = inspectorRef.value?.offsetHeight || 220
  const nodeBox = {
    left: wrapLeft + nx,
    top: wrapTop + ny,
    right: wrapLeft + nx + nw,
    bottom: wrapTop + ny + nh,
  }

  const gap = 8
  const candidates = [
    { left: nodeBox.right + gap, top: nodeBox.top + (nh - inspectorH) / 2 },
    { left: nodeBox.left - inspectorW - gap, top: nodeBox.top + (nh - inspectorH) / 2 },
    { left: nodeBox.left + (nw - inspectorW) / 2, top: nodeBox.bottom + gap },
    { left: nodeBox.left + (nw - inspectorW) / 2, top: nodeBox.top - inspectorH - gap },
  ].map(pos => clampInspectorPosition(pos.left, pos.top))

  const p = chooseInspectorPosition(candidates, nodeBox, inspectorW, inspectorH)
  inspectorPos.value = toInspectorStyle(p.left, p.top)
}

function chooseInspectorPosition(candidates, nodeBox, inspectorW, inspectorH) {
  let best = candidates[0]
  let bestOverlap = Infinity
  for (const pos of candidates) {
    const box = {
      left: pos.left,
      top: pos.top,
      right: pos.left + inspectorW,
      bottom: pos.top + inspectorH,
    }
    const overlap = intersectionArea(box, nodeBox)
    if (overlap === 0) return pos
    if (overlap < bestOverlap) {
      best = pos
      bestOverlap = overlap
    }
  }
  return best
}

function intersectionArea(a, b) {
  const x1 = Math.max(a.left, b.left)
  const y1 = Math.max(a.top, b.top)
  const x2 = Math.min(a.right, b.right)
  const y2 = Math.min(a.bottom, b.bottom)
  return x2 > x1 && y2 > y1 ? (x2 - x1) * (y2 - y1) : 0
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

  const panelW = panel.clientWidth || 0
  const panelH = panel.clientHeight || 0
  const inspectorW = inspector?.offsetWidth || 190
  const inspectorH = inspector?.offsetHeight || 220

  return {
    left: Math.round(Math.max(4, Math.min(left, panelW - inspectorW - 4))),
    top: Math.round(Math.max(4, Math.min(top, panelH - inspectorH - 4))),
  }
}

function toInspectorStyle(left, top) {
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: '190px',
  }
}

// ── 样式格式化 ──────────────────────────────────────────────────────────────

const displayStyle = computed(() => {
  const s = props.inspectorNode?.style
  if (!s) return []
  const rows = []
  const add = (key, val, color = null) => rows.push({
    key,
    val: String(val),
    color: toCssColor(color),
    diff: diffForStyleKey(key),
  })

  if (s.fontSize      != null) add('fontSize',      `${s.fontSize}vp`)
  if (s.fontWeight    != null) add('fontWeight',    s.fontWeight)
  if (s.fontColor)             add('fontColor',     s.fontColor, s.fontColor)
  if (s.fontFamily)            add('fontFamily',    s.fontFamily)
  if (s.textAlign)             add('textAlign',     s.textAlign)
  if (s.lineHeight    != null) add('lineHeight',    `${s.lineHeight}vp`)
  if (s.letterSpacing != null) add('letterSpacing', `${s.letterSpacing}px`)
  if (s.backgroundColor)       add('background',    s.backgroundColor, s.backgroundColor)
  if (s.opacity != null && s.opacity !== 1) add('opacity', s.opacity)
  if (s.borderRadius) {
    const br = s.borderRadius
    const v  = [br.topLeft, br.topRight, br.bottomRight, br.bottomLeft]
    const uniform = v.every(x => x === v[0])
    add('borderRadius', uniform ? `${v[0]}vp` : v.join('/') + 'vp')
  }
  if (s.border)       add('border',        `${s.border.width}vp ${s.border.color}`, s.border.color)
  if (s.padding) {
    const p = s.padding
    const uniform = p.top === p.right && p.right === p.bottom && p.bottom === p.left
    add('padding', uniform ? `${p.top}vp` : `${p.top} ${p.right} ${p.bottom} ${p.left}vp`)
  }
  if (s.itemSpacing   != null) add('itemSpacing',   `${s.itemSpacing}vp`)
  if (s.shadow)                add('shadow',        `blur:${s.shadow.radius} x:${s.shadow.offsetX} y:${s.shadow.offsetY}`)
  if (s.backdropBlur  != null) add('backdropBlur',  `${s.backdropBlur}`)
  if (s.gradient) {
    const stops = (s.gradient.stops || []).map(st => st.color).join(' → ')
    add('gradient', `${s.gradient.type}(${stops})`)
  }
  return rows
})

function diffForStyleKey(key) {
  const aliases = STYLE_DIFF_ALIASES[key] || [key]
  return props.styleDiffs.find(d => aliases.includes(d.property)) || null
}

const STYLE_DIFF_ALIASES = {
  background: ['backgroundColor'],
  border: ['border', 'border.color'],
  shadow: ['shadow', 'shadow.color'],
  fontSize: ['fontSize', 'fontSize.scale'],
}

function toCssColor(color) {
  if (!color || typeof color !== 'string') return null
  const h = color.trim().replace('#', '')
  if (/^[0-9a-fA-F]{8}$/.test(h)) {
    const a = parseInt(h.slice(0, 2), 16) / 255
    const r = parseInt(h.slice(2, 4), 16)
    const g = parseInt(h.slice(4, 6), 16)
    const b = parseInt(h.slice(6, 8), 16)
    return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`
  }
  return color
}
</script>

<style scoped>
.img-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  position: relative;   /* inspector 定位基准 */
  overflow: visible;
}

.img-label {
  font-size: 12px;
  font-weight: 600;
  color: #4d4d4d;
}

.img-wrapper {
  position: relative;
  width: 100%;
  line-height: 0;
  border-radius: 8px;
  overflow: visible;
  border: 1px solid #e5e5e5;
  background: #fff;
}

.img-wrapper img {
  display: block;
  width: 100%;
  height: auto;
  object-fit: contain;
}

.overlay-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* ── 浮动样式面板 ── */
.node-inspector {
  position: absolute;
  z-index: 20;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.10);
  overflow: hidden;
  max-height: 260px;
  display: flex;
  flex-direction: column;
  backdrop-filter: blur(4px);
  user-select: none;
}

.node-inspector.dragging {
  opacity: 0.92;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.18);
}

.inspector-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 10px 5px;
  border-bottom: 1px solid #f0f0f0;
  background: #fafafa;
  flex-shrink: 0;
  cursor: grab;
  touch-action: none;
}

.node-inspector.dragging .inspector-header { cursor: grabbing; }

.inspector-name {
  font-size: 11px;
  font-weight: 700;
  color: #1f1f1f;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 110px;
}

.inspector-badge {
  font-size: 10px;
  color: #fff;
  background: #cf0a2c;
  border-radius: 3px;
  padding: 1px 4px;
  flex-shrink: 0;
}

.inspector-body {
  overflow-y: auto;
  padding: 4px 0;
}

.prop-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  font-size: 11px;
  line-height: 1.6;
  border-left: 3px solid transparent;
}

.prop-row:hover { background: #fafafa; }
.prop-row.diff-error {
  background: #fff1f3;
  border-left-color: #cf0a2c;
}
.prop-row.diff-error .prop-key,
.prop-row.diff-error .prop-val {
  color: #cf0a2c;
}

.prop-row.diff-warning {
  background: #fff8e8;
  border-left-color: #b7791f;
}

.prop-row.diff-warning .prop-key,
.prop-row.diff-warning .prop-val {
  color: #9a5b00;
}

.prop-row.diff-info {
  background: #f5f5f5;
  border-left-color: #8a8a8a;
}

.prop-row.diff-info .prop-key,
.prop-row.diff-info .prop-val {
  color: #595959;
}

.prop-key {
  color: #8a8a8a;
  flex-shrink: 0;
  width: 82px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.prop-val {
  color: #1f1f1f;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 10.5px;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.color-dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 1px solid rgba(0,0,0,0.12);
  flex-shrink: 0;
  display: inline-block;
}

/* 进入/离开动画 */
.inspector-fade-enter-active,
.inspector-fade-leave-active { transition: opacity .18s, transform .18s; }
.inspector-fade-enter-from,
.inspector-fade-leave-to    { opacity: 0; transform: scale(0.95); }
</style>
