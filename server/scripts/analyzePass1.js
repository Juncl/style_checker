/**
 * Pass 1 文本匹配详细分析脚本
 *
 * 用法：
 *   node scripts/analyzePass1.js <caseId> [hmId] [deId]
 *
 * 示例：
 *   node scripts/analyzePass1.js case2
 *   node scripts/analyzePass1.js case2 5397:t 15:4674
 *   node scripts/analyzePass1.js case7 1959 56:71065
 *
 * 不指定节点 ID 时，输出 Pass 1 可信匹配（≥ 0.9）汇总。
 * 指定节点 ID 时，额外输出该 hm 节点的 Top 5 候选详情。
 *
 * 依赖：server 在 localhost:3012 运行（复用热 Tesseract worker 加速解析）
 */
import { matchAllTextNodes } from '../src/matchers/allTextMatcher.js'

const SERVER = 'http://localhost:3012'

const caseId      = process.argv[2] || 'case2'
const targetHmId  = process.argv[3] || null
const targetDeId  = process.argv[4] || null

async function fetchParsed(caseId) {
  let res
  try {
    res = await fetch(`${SERVER}/api/debug/parse/${caseId}`)
  } catch {
    console.error(`❌ 无法连接 server（${SERVER}），请先启动 server：cd server && npm run dev`)
    process.exit(1)
  }
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}))
    console.error(`❌ 解析失败：${error || res.statusText}`)
    process.exit(1)
  }
  return res.json()
}

async function analyze() {
  const { designNodes, arkuiNodes, canvasWidth, canvasHeight, canvasWidthVp, canvasHeightVp } =
    await fetchParsed(caseId)

  console.log(`Case: ${caseId}`)
  console.log(`Design nodes: ${designNodes.length}, ArkUI nodes: ${arkuiNodes.length}`)

  const result = matchAllTextNodes(
    designNodes,
    arkuiNodes,
    { canvasWidthVp, canvasHeightVp, canvasWidth, canvasHeight }
  )

  // 可信匹配汇总
  console.log(`\n=== Pass 1 可信匹配 (≥ 0.9) 共 ${Object.keys(result.textHmMapPixCredible).length} 对 ===`)
  for (const [hmId, deId] of Object.entries(result.textHmMapPixCredible)) {
    const hmNode = arkuiNodes.find(n => n.id === hmId)
    const deNode = designNodes.find(n => n.id === deId)
    const score  = result.textHmMapPixDetail[hmId]?.maxScore?.toFixed(4) ?? '?'
    console.log(`  hm=${hmId} (${hmNode?.textContent ?? '?'}) → de=${deId} (${deNode?.textContent ?? '?'})  score=${score}`)
  }

  // 指定节点详情
  if (targetHmId) {
    const hmNode = arkuiNodes.find(n => String(n.id) === String(targetHmId))
    if (!hmNode) {
      console.log(`\n找不到 hmNode: ${targetHmId}`)
      console.log('可用 hm 文本节点:', arkuiNodes.filter(n => n.type === 'text').map(n => n.id).join(', '))
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
      const deNode   = designNodes.find(n => n.id === targetDeId)
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
      const node = designNodes.find(n => n.id === item.id)
      console.log(`${idx + 1}. de=${item.id} (${node?.textContent ?? '?'})`, {
        content: item.contentScore.toFixed(4),
        color:   item.colorScore.toFixed(4),
        size:    item.sizeScore.toFixed(4),
        weight:  item.weightScore.toFixed(4),
        place:   item.placeScore.toFixed(4),
        final:   item.finalScore.toFixed(4),
      })
    })
  }
}

analyze().catch(console.error)
