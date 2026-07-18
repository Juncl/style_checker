/**
 * debugDevPipeline.js — 追踪开发侧(ArkUI)解析流水线每一步的节点数量变化
 *
 * 用途：定位"解析后节点剩余为什么这么少"的问题。对指定 case 重放 ArkUI 解析的
 *       全部步骤（建树 → 硬剪枝 → SCB过滤 → 软剪枝 → 规整 → 遮挡剪枝 → 像素unwrap → 扁平化），
 *       输出每步前后的节点总数、删除数、删除原因/rawType 分布。
 *
 * 用法：
 *   cd server && node scripts/debugDevPipeline.js                  # 默认 hmWatch/case1
 *   node scripts/debugDevPipeline.js hmWatch case1
 *   node scripts/debugDevPipeline.js hmPhone case2
 */
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '../..')

// ── 解析流水线入口与各步骤（export 的部分用真实实现）──────────────────────────
import { buildArkuiTree } from '../src/parsers/arkui/1-buildTree.js'
import { pruneArkuiTree } from '../src/parsers/arkui/2-pruneTree.js'
import { annotateArkuiTree } from '../src/parsers/arkui/3-annotateTree.js'
import { flattenArkuiTree } from '../src/parsers/arkui/4-flattenTree.js'
import { normalizeTree } from '../src/utils/normalizeTree.js'
import { filterSCBSystemLayer } from '../src/utils/filterSCBSystemLayer.js'
import { annotatePixelVisibility } from '../src/utils/imageFeatures.js'

// ── 复制自 2-pruneTree.js（内部函数未 export，为分步统计而原样复制）──────────────
const SELF_SKIP_LAYOUT_TYPES = new Set([
  'jsview', 'stack', 'column', 'row', 'flex',
  'list', 'listitem', 'group', '__common__',
  'gridcol', 'gridrow', 'blank', 'spacer',
])
const TEXT_TYPES_HP = new Set(['Text'])

const pruned = [] // 收集被 hardPrune 删除的节点

function hardPrune(node, canvasW, canvasH) {
  if (!node || !Array.isArray(node.children)) return
  node.children = node.children.filter(child => {
    const reason = hardPruneReason(child, canvasW, canvasH)
    if (reason) {
      child._prunedReason = reason
      const sub = countTree(child) - 1
      let subText = 0, subCont = 0
      ;(function w(n){ if(!n)return; if(n!==child){ if(n.type==='text')subText++; else subCont++; } if(Array.isArray(n.children)) for(const c of n.children) w(c) })(child)
      pruned.push({ reason, name: child.name, rawType: String(child.name || '').toLowerCase(), rect: child.rect, subTree: sub, subText, subCont })
      return false
    }
    return true
  })
  for (const child of node.children) hardPrune(child, canvasW, canvasH)
}

function hardPruneReason(node, canvasW, canvasH) {
  const attrs = node._attrs || {}
  const type = node.name
  const rawType = String(type || '').toLowerCase()
  if (attrs.visibility === 'Visibility.Hidden') return 'visibility-hidden'
  if (hasZeroOpacity(attrs.opacity)) return 'opacity-zero'
  if (rawType === 'leftarrow' || rawType === 'rightarrow') return 'special-component'
  if (!node._rectRaw && !node._spanType && !(node.children && node.children.length > 0)) {
    return 'no-rect'
  }
  if (isOutOfBoundsRect(node.rect, canvasW, canvasH)) return 'out-of-bounds'
  if (node.rect && (!node.rect.w || !node.rect.h || (node.rect.w < 2 && node.rect.h < 2))
      && !(node.children && node.children.length > 0)) return 'zero-size'
  if (TEXT_TYPES_HP.has(type) && String(node.textContent || '').trim().length === 0) {
    return 'empty-text'
  }
  return null
}
function hasZeroOpacity(value) {
  if (value === undefined || value === null || value === '') return false
  const opacity = Number(value)
  return Number.isFinite(opacity) && opacity <= 0
}
function isOutOfBoundsRect(rect, canvasW, canvasH) {
  if (!rect) return false
  if (rect.w <= 0 || rect.h <= 0) return false
  return rect.x > canvasW || rect.y > canvasH || rect.x + rect.w <= 0 || rect.y + rect.h <= 0
}

// ── 复制 softPrune（统计被 unwrap 删除的节点 + 原因分类）────────────────────────
const unwrapped = [] // 软剪枝/规整中删除自身的节点

function softPrune(node, canvasW, canvasH) {
  if (!node || !Array.isArray(node.children)) return
  let i = 0
  while (i < node.children.length) {
    softPrune(node.children[i], canvasW, canvasH)
    const child = node.children[i]
    if (shouldUnwrap(child, canvasW, canvasH)) {
      const reason = unwrapReason(child, canvasW, canvasH)
      unwrapped.push({ reason, name: child.name, rawType: String(child.name || '').toLowerCase() })
      node.children.splice(i, 1, ...child.children)
      continue
    }
    i++
  }
}
function shouldUnwrap(node, canvasW, canvasH) {
  if (node._spanType) return true
  if (node._blankType) return true
  if (node.rect && (node.rect.w <= 4 || node.rect.h <= 4)) return true
  // too-wide 已移到软剪枝：保子删自身
  if (node.rect && node.rect.w > canvasW * 3) return true
  if (!node._rectRaw && node.name !== 'root') return true
  if (node._frameworkType) {
    if (node.name === 'root') return false
    return !hasBackgroundColor(node)
  }
  const rawType = String(node.name || '').toLowerCase()
  if (SELF_SKIP_LAYOUT_TYPES.has(rawType) && !hasBackgroundColor(node)) return true
  if (node.normRect && node.normRect.w >= 0.999 && node.normRect.h >= 0.999 && !hasBackgroundColor(node)) return true
  return false
}
function unwrapReason(node, canvasW, canvasH) {
  if (node._spanType) return 'span'
  if (node._blankType) return 'blank'
  if (node.rect && (node.rect.w <= 4 || node.rect.h <= 4)) return 'tiny(<=4vp)'
  if (node.rect && node.rect.w > canvasW * 3) return 'too-wide(保子)'
  if (!node._rectRaw && node.name !== 'root') return 'no-rect'
  if (node._frameworkType) return node.name === 'root' ? 'root(keep)' : 'framework-no-bg'
  const rawType = String(node.name || '').toLowerCase()
  if (SELF_SKIP_LAYOUT_TYPES.has(rawType) && !hasBackgroundColor(node)) return 'transparent-layout'
  if (node.normRect && node.normRect.w >= 0.999 && node.normRect.h >= 0.999 && !hasBackgroundColor(node)) return 'fullscreen-wrapper'
  return '?'
}
function hasBackgroundColor(node) {
  return !!(node.style && node.style.backgroundColor)
}

// ── 复制自 3-annotateTree.js 的遮挡剪枝（内部函数，为分步统计而复制）──────────
const INTRINSIC_VISUAL_RAW_TYPES = new Set([
  'image', 'button', 'search', 'searchfield', 'symbolglyph',
  'circle', 'ellipse', 'rect', 'vector', 'boolean_operation',
])
const occludedRemoved = []
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
        if (deepCanOcclude(arr[i], current.rect)) {
          occludedRemoved.push({ name: current.name, rawType: String(current.name||'').toLowerCase() })
          return false
        }
      }
    } else {
      for (let i = index + 1; i < arr.length; i++) {
        if (deepCanOcclude(arr[i], current.rect)) {
          occludedRemoved.push({ name: current.name, rawType: String(current.name||'').toLowerCase() })
          return false
        }
      }
    }
    return true
  })
}
function pruneOccludedSiblings(root, type = 'reverse') {
  if (!root) return
  traverseAndPrune(root, type)
}

// ── 统计工具 ───────────────────────────────────────────────────────────────────
function countTree(root) {
  let n = 0
  function walk(node) {
    if (!node) return
    n++
    if (Array.isArray(node.children)) for (const c of node.children) walk(c)
  }
  walk(root)
  return n
}
function distTree(root) {
  let text = 0, container = 0
  const raw = new Map()
  function walk(node) {
    if (!node) return
    if (node.type === 'text') text++
    else container++
    const r = String(node.name || node.rawType || node.type || '').toLowerCase()
    raw.set(r, (raw.get(r) || 0) + 1)
    if (Array.isArray(node.children)) for (const c of node.children) walk(c)
  }
  walk(root)
  return { text, container, raw }
}
function tally(arr, key) {
  const m = new Map()
  for (const x of arr) {
    const k = x[key]
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
function printDist(label, root) {
  const d = distTree(root)
  const top = [...d.raw.entries()].slice(0, 8).map(([k, v]) => `${k}=${v}`).join('  ')
  console.log(`    ${label}: text=${d.text} container=${d.container} | rawType Top: ${top}`)
}

// ── 主流程 ─────────────────────────────────────────────────────────────────────
const platform = process.argv[2] || 'hmWatch'
const caseId = process.argv[3] || 'case1'
const caseDir = join(ROOT, 'case', platform, caseId)
const jsonPath = join(caseDir, 'arkui.json')
const imgPath = join(caseDir, 'arkui.png')

if (!existsSync(jsonPath)) {
  console.error(`找不到 ${jsonPath}`)
  process.exit(1)
}
const arkuiJson = JSON.parse(readFileSync(jsonPath, 'utf-8'))
const imageBuffer = existsSync(imgPath) ? readFileSync(imgPath) : null

console.log(`\n===== ${platform}/${caseId} 开发侧(ArkUI) 解析流水线节点追踪 =====`)
console.log(`图片: ${imageBuffer ? '有' : '无 arkui.png'}\n`)

// step 1
const built = buildArkuiTree(arkuiJson)
const canvasWidthVp = built.canvasWidthVp
const canvasHeightVp = built.canvasHeightVp
const resolution = built.resolution
let root = built.root
console.log(`画布: ${canvasWidthVp.toFixed(1)} x ${canvasHeightVp.toFixed(1)} vp  (resolution=${resolution})`)
let prev = countTree(root)
console.log(`\n[step1 buildTree]          节点总数(含root) = ${prev}`)
printDist('建树后', root)

// step 2a 硬剪枝
hardPrune(root, canvasWidthVp, canvasHeightVp)
let now = countTree(root)
console.log(`\n[step2a hardPrune]         ${prev} -> ${now}  (删除 ${prev - now})`)
console.log(`    删除原因分布: ${tally(pruned, 'reason').map(([k,v])=>`${k}=${v}`).join('  ')}`)
console.log(`    被命中的父节点(按子树规模降序):`)
for (const p of [...pruned].sort((a,b)=>b.subTree-a.subTree)) {
  const r = p.rect ? `${p.rect.x.toFixed(0)},${p.rect.y.toFixed(0)} ${p.rect.w.toFixed(0)}x${p.rect.h.toFixed(0)}` : 'no-rect'
  console.log(`      [${p.reason}] ${String(p.name||'').padEnd(16)} rect=${r.padEnd(20)} 子树=${p.subTree+1}(其中text=${p.subText} container=${p.subCont})`)
}
printDist('硬剪枝后', root)
prev = now

// step 2a.5 SCB 过滤
root = filterSCBSystemLayer(root)
now = countTree(root)
console.log(`\n[step2a.5 filterSCB]      ${prev} -> ${now}  (删除 ${prev - now})`)
prev = now

// step 2b 软剪枝
unwrapped.length = 0
softPrune(root, canvasWidthVp, canvasHeightVp)
now = countTree(root)
console.log(`\n[step2b softPrune]         ${prev} -> ${now}  (删除 ${prev - now})`)
console.log(`    unwrap 原因分布: ${tally(unwrapped, 'reason').map(([k,v])=>`${k}=${v}`).join('  ')}`)
console.log(`    被删 rawType Top: ${tally(unwrapped, 'rawType').slice(0,8).map(([k,v])=>`${k}=${v}`).join('  ')}`)
printDist('软剪枝后', root)
prev = now

// step 2.5 规整
unwrapped.length = 0
normalizeTree(root)
now = countTree(root)
console.log(`\n[step2.5 normalizeTree]    ${prev} -> ${now}  (删除 ${prev - now})`)
prev = now

// step 3a 遮挡剪枝（后项杀前项）
occludedRemoved.length = 0
pruneOccludedSiblings(root)
now = countTree(root)
console.log(`\n[step3a pruneOccluded]    ${prev} -> ${now}  (删除 ${prev - now})`)
if (occludedRemoved.length) {
  console.log(`    被删 rawType Top: ${tally(occludedRemoved, 'rawType').slice(0,8).map(([k,v])=>`${k}=${v}`).join('  ')}`)
}
prev = now

// step 3 像素标注 + unwrapInvisible（调用真实 annotateArkuiTree，此时它内部遮挡剪枝已无效果）
const beforeAnnotate = countTree(root)
// 先做像素标注（annotateArkuiTree 内部会再做，这里只为前置打印；实际走整体）
const { stats } = await annotateArkuiTree(root, { imageBuffer, canvasWidthVp, canvasHeightVp })
now = countTree(root)
console.log(`\n[step3b annotate+unwrap]  ${beforeAnnotate} -> ${now}  (删除 ${beforeAnnotate - now})`)
console.log(`    像素标注: checked=${stats.pixelChecked} hidden=${stats.pixelHidden}`)
printDist('标注后', root)
prev = now

// step 4 扁平化
const flatRaw = flattenArkuiTree(root, canvasWidthVp, canvasHeightVp)
// flattenArkuiTree 内部已做 dedupSameRect + dedupRoot + (parseArkui 再 filter w>2&&h>2)
// 这里再复刻 parseArkui 的最后 filter
const flatFinal = flatRaw.filter(n => n.rect.w > 2 && n.rect.h > 2)
console.log(`\n[step4 flatten]           树总数 ${prev} -> 扁平 ${flatRaw.length} -> 过滤(>2px) ${flatFinal.length}`)
console.log(`    (扁平含 root去重/dedupSameRect)`)
printDist('扁平后', { children: flatFinal })

// 对比：直接调用 parseArkui 看最终节点数
const { parseArkui } = await import('../src/parsers/arkui/index.js')
const real = await parseArkui(arkuiJson, { imageBuffer })
console.log(`\n[对照 parseArkui() 真实入口] 最终节点数 = ${real.nodes.length}`)

// 列出最终保留节点
console.log(`\n── 最终保留的 ${flatFinal.length} 个节点 ──`)
const sorted = [...flatFinal].sort((a, b) => (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x))
for (const n of sorted) {
  const t = (n.textContent || '').trim()
  const label = t ? JSON.stringify(t.slice(0, 24)) : `[${n.rawType || n.type}]`
  const r = n.rect
  console.log(`  ${label.padEnd(30)} ${String(n.rawType||'').padEnd(12)} ${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}x${r.h.toFixed(0)}`)
}
