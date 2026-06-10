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
        v-if="isSpacingInspector || (inspectorNode && (displayStyle.length || debugMode))"
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
          <span v-if="debugMode && !isSpacingInspector" class="inspector-badge">{{ inspectorNode?.rawType || inspectorNode?.type }}</span>
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
            <div v-if="debugMode" class="prop-row">
              <span class="prop-key">id</span>
              <span class="prop-val">{{ inspectorNode?.id }}</span>
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
          </template>
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
  hoverHighlightPairs: { type: Array, default: () => [] },
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
const hoveredId    = ref(null)
const inspectorPos = ref({})
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

// ── 聚焦 ────────────────────────────────────────────────────────────────────

function unionRects(rects) {
  const xs = rects.flatMap(r => [r.x, r.x + r.w])
  const ys = rects.flatMap(r => [r.y, r.y + r.h])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

// 将 rect（画布坐标系）平移到 zoom-clip 视口中央，边缘处取最近可行位置
function focusToRect(rect) {
  if (!rect || zoomScale.value <= 1) return
  const clip = zoomClipRef.value
  if (!clip) return
  const clipW = clip.clientWidth
  const clipH = clip.clientHeight
  if (!clipW || !clipH) return

  const N  = zoomScale.value
  // 节点中心在 zoom-clip CSS 像素坐标系（未缩放）中的位置
  const cx = (rect.x + rect.w / 2) / props.canvasW * clipW
  const cy = (rect.y + rect.h / 2) / props.canvasH * clipH

  // 让节点中心出现在视口正中央所需的 transformOrigin
  // 推导：视觉X = cx*N + ox*(1-N) = clipW/2  =>  ox = (cx*N - clipW/2) / (N-1)
  const ox = (cx * N - clipW / 2) / (N - 1)
  const oy = (cy * N - clipH / 2) / (N - 1)

  // 边界约束：origin 超出 [0, clipW/H] 会出现空白边，直接 clamp
  zoomOriginX.value = Math.max(0, Math.min(clipW, ox))
  zoomOriginY.value = Math.max(0, Math.min(clipH, oy))

  nextTick(draw)
}

// ── 绘制 ────────────────────────────────────────────────────────────────────

function draw() {
  const canvas = canvasRef.value
  const img    = imgRef.value
  if (!canvas || !img) return

  const W = img.clientWidth
  const H = img.clientHeight
  if (!W || !H) return

  const dpr  = window.devicePixelRatio || 1
  const s    = Math.min(zoomScale.value, 4)
  const bufW = Math.round(W * dpr * s)
  const bufH = Math.round(H * dpr * s)

  // 只有缓冲区尺寸真正变化时才重建 GPU 纹理，mousemove 时通常不触发
  if (canvas.width !== bufW || canvas.height !== bufH) {
    canvas.width  = bufW
    canvas.height = bufH
  }

  canvas.style.left = '0'
  canvas.style.top  = '0'

  const ctx = canvas.getContext('2d')
  ctx.save()
  ctx.scale(dpr * s, dpr * s)
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

  // hover 实时间距标注（蓝色）
  if (props.hoverHighlightPairs.length && props.canvasW && props.canvasH) {
    for (const mark of props.hoverHighlightPairs) {
      drawHoverSpacingMark(ctx, mark, sx, sy)
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

  const rect = isSpacing ? props.highlightPair.spaceRect : props.inspectorNode?.rect
  const clip = zoomClipRef.value
  if (!rect || !clip) return

  // zoom-clip 无 transform，位置稳定，用它计算节点在 panel 内的坐标
  const clipW = clip.clientWidth
  const clipH = clip.clientHeight
  const clipRect  = clip.getBoundingClientRect()
  const panelRect = panelRef.value.getBoundingClientRect()
  const clipOffsetX = clipRect.left - panelRect.left
  const clipOffsetY = clipRect.top  - panelRect.top

  // 节点在 zoom-clip 布局坐标系中的位置（未缩放）
  const nx = rect.x / props.canvasW * clipW
  const ny = rect.y / props.canvasH * clipH
  const nw = rect.w / props.canvasW * clipW
  const nh = rect.h / props.canvasH * clipH

  // 布局坐标 → 视觉坐标（scale=1 时两者相等）
  const N  = zoomScale.value
  const ox = zoomOriginX.value
  const oy = zoomOriginY.value
  const visLeft   = ox + (nx      - ox) * N
  const visTop    = oy + (ny      - oy) * N
  const visRight  = ox + (nx + nw - ox) * N
  const visBottom = oy + (ny + nh - oy) * N

  const nodeBox = {
    left:   clipOffsetX + visLeft,
    top:    clipOffsetY + visTop,
    right:  clipOffsetX + visRight,
    bottom: clipOffsetY + visBottom,
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
  if (s.fontColor)             add('fontColor',     s.fontColor, s.fontColor, '颜色')
  if (s.fontFamily)            add('fontFamily',    s.fontFamily, null, '字体', true)
  if (s.textAlign)             add('textAlign',     s.textAlign, null, '对齐')
  if (s.lineHeight    != null) add('lineHeight',    s.lineHeight, null, '行高')
  if (s.letterSpacing != null && s.letterSpacing !== 0) add('letterSpacing', s.letterSpacing, null, '字间距')
  if (s.backgroundColor)       add('backgroundColor', s.backgroundColor, s.backgroundColor, '填充')
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
  if (s.border?.color)        add('borderColor', s.border.color, s.border.color, '描边颜色')
  if (s.padding) {
    const p = s.padding
    const uniform = p.top === p.right && p.right === p.bottom && p.bottom === p.left
    add('padding', uniform ? p.top : `${p.top} ${p.right} ${p.bottom} ${p.left}`, null, '内边距')
  }
  if (s.itemSpacing   != null) add('itemSpacing',   s.itemSpacing, null, '间距')
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
