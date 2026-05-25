/**
 * Pass 1 文本匹配详细分析脚本
 *
 * 用法：
 *   node scripts/analyzePass1.js <caseId> [hmId] [deId]
 *
 * 示例：
 *   node scripts/analyzePass1.js case2
 *   node scripts/analyzePass1.js case2 5397:t 15:4674
 *   node scripts/analyzePass1.js case7 1846 56:69730
 *
 * 不指定节点 ID 时，输出 Pass 1 可信匹配（≥ 0.9）汇总。
 * 指定节点 ID 时，额外输出该 hm 节点的 Top 5 候选详情。
 */
import fs from 'fs'
import path from 'path'
import { parseArkui } from '../src/parsers/arkui/index.js'
import { parseDesign } from '../src/parsers/design/index.js'
import { matchAllTextNodes } from '../src/matchers/allTextMatcher.js'

const caseId = process.argv[2] || 'case2'
const targetHmId = process.argv[3] || null
const targetDeId = process.argv[4] || null

const casePath = path.resolve(process.cwd(), '..', 'case', caseId)

const designJson = JSON.parse(fs.readFileSync(path.join(casePath, 'design.json'), 'utf-8'))
const arkuiJson = JSON.parse(fs.readFileSync(path.join(casePath, 'arkui.json'), 'utf-8'))

async function analyze() {
  const designBuffer = fs.readFileSync(path.join(casePath, 'design.png'))
  const arkuiBuffer = fs.readFileSync(path.join(casePath, 'arkui.png'))

  const designResult = await parseDesign(designJson, { imageBuffer: designBuffer })
  const arkuiResult = await parseArkui(arkuiJson, { imageBuffer: arkuiBuffer })

  console.log(`Case: ${caseId}`)
  console.log(`Design nodes: ${designResult.nodes.length}, ArkUI nodes: ${arkuiResult.nodes.length}`)

  const result = matchAllTextNodes(
    designResult.nodes,
    arkuiResult.nodes,
    {
      canvasWidthVp: arkuiResult.canvasWidthVp,
      canvasHeightVp: arkuiResult.canvasHeightVp,
      canvasWidth: designResult.canvasWidth,
      canvasHeight: designResult.canvasHeight,
    }
  )

  // 可信匹配汇总
  console.log(`\n=== Pass 1 可信匹配 (≥ 0.9) 共 ${Object.keys(result.textHmMapPixCredible).length} 对 ===`)
  for (const [hmId, deId] of Object.entries(result.textHmMapPixCredible)) {
    const hmNode = arkuiResult.nodes.find(n => n.id === hmId)
    const deNode = designResult.nodes.find(n => n.id === deId)
    const score = result.textHmMapPixDetail[hmId]?.maxScore?.toFixed(4) ?? '?'
    console.log(`  hm=${hmId} (${hmNode?.textContent ?? '?'}) → de=${deId} (${deNode?.textContent ?? '?'})  score=${score}`)
  }

  // 指定节点详情
  if (targetHmId) {
    const hmNode = arkuiResult.nodes.find(n => n.id === targetHmId)
    if (!hmNode) {
      console.log(`\n找不到 hmNode: ${targetHmId}`)
      console.log('可用 hm 文本节点:', arkuiResult.nodes.filter(n => n.type === 'text').map(n => n.id).join(', '))
      return
    }

    const detail = result.textHmMapPixDetail[hmNode.id]
    if (!detail) {
      console.log(`\nhmNode ${targetHmId} 无比对详情`)
      return
    }

    console.log(`\n=== hmNode ${targetHmId} 详情 ===`)
    console.log(`content: "${hmNode.textContent}", rect: ${JSON.stringify(hmNode.rect)}`)

    if (targetDeId) {
      const deNode = designResult.nodes.find(n => n.id === targetDeId)
      const deDetail = detail.compareDeIdS[targetDeId]
      if (deDetail) {
        console.log(`\n与 de=${targetDeId} (${deNode?.textContent}) 的各维度分数:`)
        console.log(`  contentScore: ${deDetail.contentScore}`)
        console.log(`  colorScore:   ${deDetail.colorScore}`)
        console.log(`  sizeScore:    ${deDetail.sizeScore}`)
        console.log(`  weightScore:  ${deDetail.weightScore}`)
        console.log(`  placeScore:   ${deDetail.placeScore}`)
        console.log(`  finalScore:   ${deDetail.finalScore}`)
      } else {
        console.log(`\n找不到 deNode ${targetDeId} 的比对详情`)
      }
    }

    console.log('\nTop 5 候选:')
    const sorted = Object.entries(detail.compareDeIdS)
      .map(([id, d]) => ({ id, ...d }))
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, 5)

    sorted.forEach((item, idx) => {
      const node = designResult.nodes.find(n => n.id === item.id)
      console.log(`${idx + 1}. de=${item.id} (${node?.textContent ?? '?'})`, {
        content: item.contentScore.toFixed(4),
        color: item.colorScore.toFixed(4),
        size: item.sizeScore.toFixed(4),
        weight: item.weightScore.toFixed(4),
        place: item.placeScore.toFixed(4),
        final: item.finalScore.toFixed(4),
      })
    })
  }
}

analyze().catch(console.error)
