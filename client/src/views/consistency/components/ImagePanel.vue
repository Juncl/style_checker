<template>
  <div class="img-panel" ref="panelRef">
    <div class="img-wrapper" ref="wrapperRef" @click.self="emit('bg-click')">
      <div class="zoom-clip" ref="zoomClipRef">
        <div class="zoom-layer" ref="zoomLayerRef" :style="zoomStyle">
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
        v-if="highlightPair?.type === 'spacing' && highlightPair?.value != null"
        ref="spacingInspectorRef"
        class="node-inspector"
        :class="{ 'inspector--design': side === 'design' }"
        :style="spacingInspectorPos"
        @click.stop
      >
        <div class="inspector-header">
          <span class="inspector-name">{{ highlightPair.label || '间距' }}</span>
        </div>
        <div class="inspector-body">
          <div class="prop-row diff-weak">
            <span class="prop-key">距离</span>
            <span class="prop-val">{{ highlightPair.value }}</span>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="inspector-fade">
      <div
        v-if="inspectorNode && (displayStyle.length || debugMode)"
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
          <span class="inspector-name">{{ inspectorNode.textContent || inspectorNode.name }}</span>
          <span v-if="debugMode" class="inspector-badge">{{ inspectorNode.rawType || inspectorNode.type }}</span>
        </div>
        <div class="inspector-body">
          <div v-if="debugMode" class="prop-row">
            <span class="prop-key">id</span>
            <span class="prop-val">{{ inspectorNode.id }}</span>
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
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'
import '../../../styles/image-panel.css'

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
  lockedIds:         { type: Object,  default: () => new Set() }, // Set<string>，不参与图片点击
  externalHoveredId: { type: String,  default: null },
  side:              { type: String,  default: 'dev' },   // 'dev' | 'design'
  debugMode:         { type: Boolean, default: false },
  debugPipelineVisible: { type: Boolean, default: false },
  debugVisible: { type: Boolean, default: false },
  debugPairMap:  { type: Object,  default: () => ({}) },
})

const emit = defineEmits(['node-click', 'bg-click', 'node-hover', 'zoom'])

const panelRef     = ref(null)
const labelRef     = ref(null)
const wrapperRef   = ref(null)
const zoomClipRef  = ref(null)
const zoomLayerRef = ref(null)
const imgRef       = ref(null)
const canvasRef    = ref(null)
const inspectorRef = ref(null)
const spacingInspectorRef = ref(null)
const hoveredId    = ref(null)
const inspectorPos = ref({})
const spacingInspectorPos = ref({})
const isDraggingInspector = ref(false)
const inspectorDragPos = ref(null)
const dragStart = ref(null)

const zoomScale   = ref(1)
const zoomOriginX = ref(0)
const zoomOriginY = ref(0)
const zoomStyle = computed(() => ({
  transform: `scale(${zoomScale.value})`,
  transformOrigin: `${zoomOriginX.value}px ${zoomOriginY.value}px`,
}))

// 本地同步记录当前选中 id，用于双击下钻
// 不能直接用 props.selectedId：dblclick 触发时 Vue 响应式更新尚未完成
const localSelectedId = ref(null)

// 当父组件通过树/diff等外部方式改变 selectedId 时，同步本地状态
watch(() => props.selectedId, id => { localSelectedId.value = id })

let ro = null
onMounted(() => {
  ro = new ResizeObserver(() => { updateClipSize(); draw(); updateInspectorPos(); updateSpacingInspectorPos() })
  if (wrapperRef.value) ro.observe(wrapperRef.value)
  window.addEventListener('pointermove', onInspectorDrag)
  window.addEventListener('pointerup', endInspectorDrag)
  canvasRef.value?.addEventListener('wheel', onCanvasWheel, { passive: false })
})
onUnmounted(() => {
  ro?.disconnect()
  window.removeEventListener('pointermove', onInspectorDrag)
  window.removeEventListener('pointerup', endInspectorDrag)
  canvasRef.value?.removeEventListener('wheel', onCanvasWheel)
})

function onImgLoad() { nextTick(() => { updateClipSize(); draw(); updateInspectorPos() }) }

function updateClipSize() {
  const wrapper = wrapperRef.value
  const img     = imgRef.value
  const clip    = zoomClipRef.value
  if (!wrapper || !img || !clip) return
  const nW = img.naturalWidth
  const nH = img.naturalHeight
  if (!nW || !nH) return
  const wW = wrapper.clientWidth
  const wH = wrapper.clientHeight
  const ratio = nW / nH
  let clipW, clipH
  if (ratio > wW / wH) {
    clipW = wW; clipH = wW / ratio
  } else {
    clipH = wH; clipW = wH * ratio
  }
  clip.style.width  = clipW + 'px'
  clip.style.height = clipH + 'px'
  clip.style.left   = ((wW - clipW) / 2) + 'px'
  clip.style.top    = ((wH - clipH) / 2) + 'px'
}

watch(() => props.highlight,     () => nextTick(draw))
watch(() => props.highlightPair, () => nextTick(() => { draw(); updateSpacingInspectorPos() }))
watch(() => props.selectedId,    () => nextTick(draw))
watch(() => [props.canvasW, props.canvasH], () => nextTick(draw))
watch(() => props.debugPipelineVisible,  () => nextTick(draw))
watch(() => props.debugVisible,          () => nextTick(draw))
watch(() => props.externalHoveredId,     () => nextTick(draw))
watch(() => props.debugPairMap,  () => nextTick(draw), { deep: true })
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
      !isHiddenTextNode(n) &&
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
  if (e.detail >= 2) return  // 双击序列中的第二次 click，交给 dblclick 处理
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
  const coords = getCanvasCoords(e)
  if (!coords) return
  const hit = findHitNode(coords.px, coords.py)
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

function onCanvasWheel(e) {
  if (!e.ctrlKey) return
  e.preventDefault()
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
  const clip = zoomClipRef.value
  if (!clip) return
  const rect = clip.getBoundingClientRect()
  const normX = (e.clientX - rect.left) / rect.width
  const normY = (e.clientY - rect.top) / rect.height
  applyZoom(factor, normX, normY)
  emit('zoom', { factor, normX, normY })
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

  canvas.style.left = '0'
  canvas.style.top  = '0'

  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, W, H)

  const sx = W / props.canvasW
  const sy = H / props.canvasH

  // Debugger 节点轮廓：显示进入匹配阶段的全部节点
  if (props.debugPipelineVisible) {
    for (const n of props.nodes) {
      if (n.visible === false || !n.rect) continue
      drawNodeRect(ctx, n.rect, sx, sy, 'rgba(255,0,0,0)', '#ff0000', 1, [])
    }
  }

  // Debugger 映射框（同一 pair 的设计侧 / 开发侧使用同一颜色）
  if (props.debugVisible && props.debugPairMap && Object.keys(props.debugPairMap).length) {
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

  // 锁定节点（红色虚线，仅轮廓）— 红色对齐设计稿 color-error #E02128
  for (const n of props.nodes) {
    if (n.visible === false || n.visualOccluded || !n.rect) continue
    if (!props.lockedIds.has(n.id)) continue
    drawNodeRect(ctx, n.rect, sx, sy, 'rgba(224,33,40,0.06)', '#E02128', 1, [3, 3])
    // 左上角小锁标
    const lx = n.rect.x * sx, ly = n.rect.y * sy
    ctx.fillStyle = 'rgba(224,33,40,0.75)'
    ctx.fillRect(lx, ly, 14, 14)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 10px sans-serif'
    ctx.fillText('🔒', lx + 1, ly + 11)
  }

  // 悬停节点（红色虚线 + 浅红背景，排除锁定层）
  if (hoveredId.value && hoveredId.value !== props.selectedId && !props.lockedIds.has(hoveredId.value)) {
    const n = props.nodes.find(n => n.id === hoveredId.value)
    if (n) drawNodeRect(ctx, n.rect, sx, sy, 'rgba(224,33,40,0.10)', '#E02128', 1, [4, 3])
  }
  // 对方画布联动的映射 hover（同色虚线框）
  if (props.externalHoveredId && props.externalHoveredId !== props.selectedId && props.externalHoveredId !== hoveredId.value) {
    const n = props.nodes.find(n => n.id === props.externalHoveredId)
    if (n) drawNodeRect(ctx, n.rect, sx, sy, 'rgba(224,33,40,0.10)', '#E02128', 1, [4, 3])
  }

  // 选中节点（红色实线 + 红色背景，对齐设计稿差异标注 #E02128）
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
  const clip = zoomClipRef.value
  if (!clip) return

  // zoom-clip 无 transform，位置稳定，用它计算节点在 panel 内的坐标
  const clipW = clip.clientWidth
  const clipH = clip.clientHeight
  const clipRect  = clip.getBoundingClientRect()
  const panelRect = panelRef.value.getBoundingClientRect()
  const clipOffsetX = clipRect.left - panelRect.left
  const clipOffsetY = clipRect.top  - panelRect.top

  const nx = rect.x / props.canvasW * clipW
  const ny = rect.y / props.canvasH * clipH
  const nw = rect.w / props.canvasW * clipW
  const nh = rect.h / props.canvasH * clipH

  const inspectorW = inspectorRef.value?.offsetWidth || 190
  const inspectorH = inspectorRef.value?.offsetHeight || 220
  const nodeBox = {
    left: clipOffsetX + nx,
    top: clipOffsetY + ny,
    right: clipOffsetX + nx + nw,
    bottom: clipOffsetY + ny + nh,
  }

  const gap = 8
  const candidates = [
    { left: nodeBox.right + gap, top: nodeBox.top },
    { left: nodeBox.left - inspectorW - gap, top: nodeBox.top },
    { left: nodeBox.left + (nw - inspectorW) / 2, top: nodeBox.bottom + gap },
    { left: nodeBox.left + (nw - inspectorW) / 2, top: nodeBox.top - inspectorH - gap },
  ].map(pos => clampInspectorPosition(pos.left, pos.top))

  const p = chooseInspectorPosition(candidates, nodeBox, inspectorW, inspectorH)
  inspectorPos.value = toInspectorStyle(p.left, p.top)
}

function chooseInspectorPosition(candidates, nodeBox, inspectorW, inspectorH) {
  let best = candidates[0]
  let bestOverlap = Infinity
  for (let i = 0; i < candidates.length; i++) {
    const pos = candidates[i]
    const box = {
      left: pos.left,
      top: pos.top,
      right: pos.left + inspectorW,
      bottom: pos.top + inspectorH,
    }
    const overlap = intersectionArea(box, nodeBox)
    // 优先不重叠的位置，且偏好第一个候选（右侧）
    if (overlap === 0) return pos
    // 如果有多个同样重叠量的位置，优先右侧
    if (overlap < bestOverlap || (overlap === bestOverlap && i === 0)) {
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

function updateSpacingInspectorPos() {
  const hp = props.highlightPair
  if (!hp || hp.type !== 'spacing' || hp.value == null) {
    spacingInspectorPos.value = {}
    return
  }
  const sr = hp.spaceRect
  if (!sr || !imgRef.value || !wrapperRef.value) {
    spacingInspectorPos.value = {}
    return
  }

  const clip = zoomClipRef.value
  if (!clip) return
  const clipW = clip.clientWidth
  const clipH = clip.clientHeight
  const clipRect  = clip.getBoundingClientRect()
  const panelRect = panelRef.value.getBoundingClientRect()
  const clipOffsetX = clipRect.left - panelRect.left
  const clipOffsetY = clipRect.top  - panelRect.top

  const nx = clipOffsetX + sr.x / props.canvasW * clipW
  const ny = clipOffsetY + sr.y / props.canvasH * clipH
  const nw = sr.w / props.canvasW * clipW
  const nh = sr.h / props.canvasH * clipH

  const inspW = spacingInspectorRef.value?.offsetWidth || 120
  const inspH = spacingInspectorRef.value?.offsetHeight || 50
  const nodeBox = { left: nx, top: ny, right: nx + nw, bottom: ny + nh }
  const gap = 8

  const candidates = [
    { left: nodeBox.right + gap, top: nodeBox.top },
    { left: nodeBox.left - inspW - gap, top: nodeBox.top },
    { left: nodeBox.left + (nw - inspW) / 2, top: nodeBox.bottom + gap },
    { left: nodeBox.left + (nw - inspW) / 2, top: nodeBox.top - inspH - gap },
  ].map(pos => clampInspectorPosition(pos.left, pos.top))

  const p = chooseInspectorPosition(candidates, nodeBox, inspW, inspH)
  spacingInspectorPos.value = toInspectorStyle(p.left, p.top)
}

// ── 样式格式化 ──────────────────────────────────────────────────────────────

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

  if (s.fontSize      != null) add('fontSize',      `${s.fontSize}vp`, null, '字号')
  if (s.fontWeight    != null) add('fontWeight',    s.fontWeight, null, '字重')
  if (s.fontColor)             add('fontColor',     s.fontColor, s.fontColor, '颜色')
  if (s.fontFamily)            add('fontFamily',    s.fontFamily, null, '字体', true)
  if (s.textAlign)             add('textAlign',     s.textAlign, null, '对齐')
  if (s.lineHeight    != null) add('lineHeight',    `${s.lineHeight}vp`, null, '行高')
  if (s.letterSpacing != null) add('letterSpacing', `${s.letterSpacing}px`, null, '字间距')
  if (s.backgroundColor)       add('backgroundColor', s.backgroundColor, s.backgroundColor, '填充')
  // 任一侧 opacity ≠ 1 都在两侧详情框显示（对方 ≠ 1 会产生 opacity diff，本侧据此感知）
  if ((s.opacity != null && s.opacity !== 1) || diffForStyleKey('opacity')) {
    add('opacity', s.opacity ?? 1, null, '不透明度')
  }
  if (s.borderRadius) {
    const br = s.borderRadius
    const v  = [br.topLeft, br.topRight, br.bottomRight, br.bottomLeft]
    const uniform = v.every(x => x === v[0])
    add('borderRadius', uniform ? `${v[0]}vp` : v.join('/') + 'vp', null, '圆角')
  }
  if (s.border?.width != null) add('borderWidth', `${s.border.width}vp`, null, '描边宽度')
  if (s.border?.color)        add('borderColor', s.border.color, s.border.color, '描边颜色')
  if (s.padding) {
    const p = s.padding
    const uniform = p.top === p.right && p.right === p.bottom && p.bottom === p.left
    add('padding', uniform ? `${p.top}vp` : `${p.top} ${p.right} ${p.bottom} ${p.left}vp`, null, '内边距')
  }
  if (s.itemSpacing   != null) add('itemSpacing',   `${s.itemSpacing}vp`, null, '间距')
  if (s.shadow) add('shadow', s.shadow, null, '阴影')
  if (s.blur)   add('blur',   s.blur,   null, '模糊')
  return rows
})

function diffForStyleKey(key) {
  const aliases = STYLE_DIFF_ALIASES[key] || [key]
  return props.styleDiffs.find(d => aliases.includes(d.property)) || null
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

// ── Zoom（Ctrl+滚轮缩放，由父组件触发）────────────────────────────────────────

// normX/normY 是鼠标相对于 zoom-clip 的归一化坐标（0-1）
// transform-origin 跟随鼠标，只用 scale()，不平移
function applyZoom(factor, normX, normY) {
  const clip = zoomClipRef.value
  if (!clip) return
  zoomOriginX.value = normX * clip.clientWidth
  zoomOriginY.value = normY * clip.clientHeight
  zoomScale.value   = Math.max(1, Math.min(100, zoomScale.value * factor))
  nextTick(draw)
}

function resetZoom() {
  zoomScale.value   = 1
  zoomOriginX.value = 0
  zoomOriginY.value = 0
  nextTick(draw)
}

defineExpose({ applyZoom, resetZoom })
</script>
