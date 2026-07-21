/**
 * listInvisibleNodes.js — 列出 case1-12 在像素标注阶段被判定为不可见的节点
 *
 * 复用解析流水线 step1~step3a，但跳过 step3 的 unwrapInvisible，
 * 在 annotatePixelVisibility 之后立即收集 pixelInvisible=true 的节点。
 *
 * 用法：cd server && node scripts/listInvisibleNodes.js
 */
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '../..')

import { buildArkuiTree } from '../src/parsers/arkui/1-buildTree.js'
import { pruneArkuiTree } from '../src/parsers/arkui/2-pruneTree.js'
import { flattenArkuiTree } from '../src/parsers/arkui/4-flattenTree.js'
import { normalizeTree } from '../src/utils/normalizeTree.js'
import { filterSCBSystemLayer } from '../src/utils/filterSCBSystemLayer.js'
import { annotatePixelVisibility } from '../src/utils/imageFeatures.js'

import { buildDesignTree } from '../src/parsers/design/1-buildTree.js'
import { pruneDesignTree } from '../src/parsers/design/2-pruneTree.js'
import { flattenDesignTree } from '../src/parsers/design/4-flattenTree.js'

// 从 3-annotateTree.js 复制的内部函数（pruneOccludedSiblings + collectNodes）
const INTRINSIC_VISUAL_RAW_TYPES = new Set([
  'image', 'button', 'search', 'searchfield', 'symbolglyph',
  'circle', 'ellipse', 'rect', 'vector', 'boolean_operation',
])
function hasVisualDecoration(n) {
  const s = n.style || {}
  return !!(s.backgroundColor || s.borderRadius || s.border || s.shadow || s.blur)
}
function isIntrinsicVisualNode(n) {
  const rawType = String(n?.rawType || n?.type || n?.name || '').toLowerCase()
  return INTRINSIC_VISUAL_RAW_TYPES.has(rawType) || !!n?.semanticAsset
}
function isRenderableNonTextNode(n) {
  if (n?.type !== 'container') return false
  return hasVisualDecoration(n) || isIntrinsicVisualNode(n)
}
function isOccludingNode(node) {
  if (!node?.visible) return false
  if (node.type === 'text') return false
  if (!isRenderableNonTextNode(node)) return false
  const s = node.style || {}
  const opacity = s.opacity == null ? 1 : s.opacity
  if (opacity < 0.70) return false
  if (s.blendMode != null && s.blendMode !== 0) return false
  return true
}
function isCoveredByRect(rectA, rectB) {
  if (!rectA || !rectB) return false
  return rectB.x <= rectA.x && rectB.y <= rectA.y &&
    rectB.x + rectB.w >= rectA.x + rectA.w && rectB.y + rectB.h >= rectA.y + rectA.h
}
function deepCanOcclude(blocker, targetRect) {
  if (!blocker) return false
  if (isOccludingNode(blocker) && isCoveredByRect(targetRect, blocker.rect)) return true
  for (const child of (blocker.children || [])) {
    if (deepCanOcclude(child, targetRect)) return true
  }
  return false
}
function traverseAndPrune(node, type) {
  if (!node || !Array.isArray(node.children) || node.children.length === 0) return
  for (const child of node.children) traverseAndPrune(child, type)
  node.children = node.children.filter((current, index, arr) => {
    if (!current?.rect || current.rect.w <= 0 || current.rect.h <= 0) return true
    if (type === 'forward') {
      for (let i = 0; i < index; i++) {
        if (deepCanOcclude(arr[i], current.rect)) return false
      }
    } else {
      for (let i = index + 1; i < arr.length; i++) {
        if (deepCanOcclude(arr[i], current.rect)) return false
      }
    }
    return true
  })
}
function pruneOccludedSiblings(root, type = 'reverse') {
  if (!root) return
  traverseAndPrune(root, type)
}
function collectNodes(node, out, skipSelf = false) {
  if (!node) return
  if (!skipSelf) out.push(node)
  if (Array.isArray(node.children)) {
    for (const c of node.children) collectNodes(c, out, false)
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
const CASES = Array.from({ length: 12 }, (_, i) => `case${i + 1}`)

function describe(n) {
  const t = (n.textContent || '').trim()
  const label = t ? `"${t.slice(0, 30)}"` : `[${n.rawType || n.type}]`
  const r = n.rect || {}
  const pv = n.pixelVisibility || {}
  return {
    label,
    rawType: n.rawType || n.type,
    type: n.type,
    rect: r.x != null ? `${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}x${r.h.toFixed(0)}` : 'no-rect',
    ratio: pv.visiblePixelRatio != null ? pv.visiblePixelRatio.toFixed(3) : '-',
    colorDelta: pv.meanColorDelta != null ? pv.meanColorDelta.toFixed(1) : '-',
    lumaDelta: pv.meanLumaDelta != null ? pv.meanLumaDelta.toFixed(1) : '-',
    stroke: pv.textStrokeScore != null ? pv.textStrokeScore.toFixed(3) : '-',
    samples: pv.samples || 0,
    fontColor: n.style?.fontColor || '-',
    fontSize: n.style?.fontSize ?? '-',
    fontWeight: n.style?.fontWeight ?? '-',
  }
}

function collectInvisibleFromSide(side, caseId, caseDir) {
  const isArkui = side === 'arkui'
  const jsonPath = join(caseDir, isArkui ? 'arkui.json' : 'design.json')
  const imgPath = join(caseDir, isArkui ? 'arkui.png' : 'design.png')
  if (!existsSync(jsonPath)) return { error: `缺少 ${jsonPath}` }
  const json = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  const imageBuffer = existsSync(imgPath) ? readFileSync(imgPath) : null

  let root, canvasW, canvasH
  if (isArkui) {
    const built = buildArkuiTree(json)
    canvasW = built.canvasWidthVp
    canvasH = built.canvasHeightVp
    root = built.root
    pruneArkuiTree(root, canvasW, canvasH)
    root = filterSCBSystemLayer(root)
    normalizeTree(root)
    pruneOccludedSiblings(root, 'reverse')
  } else {
    const built = buildDesignTree(json, null, 1)
    canvasW = built.canvasWidth
    canvasH = built.canvasHeight
    root = built.root
    pruneDesignTree(root, canvasW, canvasH)
    normalizeTree(root)
    pruneOccludedSiblings(root, 'forward')
  }

  const nodeList = []
  collectNodes(root, nodeList, true)

  if (!imageBuffer || !canvasW || !canvasH) {
    return { imageMissing: true, totalChecked: 0, invisible: [] }
  }

  annotatePixelVisibility(
    nodeList, imageBuffer,
    { w: canvasW, h: canvasH },
    { source: isArkui ? 'arkui' : 'design' },
  )

  const invisible = nodeList.filter(n => n.pixelInvisible && n.type === 'text').map(describe)
  return {
    imageMissing: false,
    totalChecked: nodeList.filter(n => n.pixelVisibility).length,
    invisible,
  }
}

let totalInvisible = 0
const summary = []

for (const caseId of CASES) {
  const caseDir = join(ROOT, 'case', 'hmPhone', caseId)
  console.log(`\n========== ${caseId} ==========`)

  for (const side of ['arkui', 'design']) {
    const r = collectInvisibleFromSide(side, caseId, caseDir)
    if (r.error) {
      console.log(`  [${side}] ${r.error}`)
      continue
    }
    if (r.imageMissing) {
      console.log(`  [${side}] 无图片，跳过像素标注`)
      continue
    }
    const textInvisible = r.invisible.length
    console.log(`  [${side}] 像素标注 checked=${r.totalChecked}, 文本不可见=${textInvisible}`)
    if (textInvisible) {
      for (const d of r.invisible) {
        console.log(`    - ${d.label.padEnd(36)} rect=${d.rect.padEnd(20)} ratio=${d.ratio} colorΔ=${d.colorDelta} lumaΔ=${d.lumaDelta} stroke=${d.stroke} samples=${d.samples} | fontColor=${d.fontColor} fontSize=${d.fontSize} fontWeight=${d.fontWeight}`)
      }
    }
    totalInvisible += textInvisible
    summary.push({ case: caseId, side, count: textInvisible })
  }
}

console.log(`\n========== 汇总 ==========`)
for (const s of summary) {
  console.log(`  ${s.case.padEnd(8)} [${s.side}] 文本不可见=${s.count}`)
}
console.log(`\n总文本不可见节点数: ${totalInvisible}`)
