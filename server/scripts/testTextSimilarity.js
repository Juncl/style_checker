/**
 * 文本相似度函数验证脚本
 *
 * 用法：
 *   node scripts/testTextSimilarity.js
 *   node scripts/testTextSimilarity.js "字符串1" "字符串2"
 *
 * 不传参时运行内置测试集；传参时单独测试指定字符串对。
 */
import { normalizeText, textSemanticSimilarity } from '../src/utils/textSemantics.js'

function levenshteinSimilarity(s1, s2) {
  if (!s1 || !s2) return 0
  if (s1 === s2) return 1
  const len1 = s1.length
  const len2 = s2.length
  const maxLen = Math.max(len1, len2)
  const dp = Array(len2 + 1).fill(0).map(() => Array(len1 + 1).fill(0))
  for (let i = 0; i <= len1; i++) dp[0][i] = i
  for (let j = 0; j <= len2; j++) dp[j][0] = j
  for (let j = 1; j <= len2; j++) {
    for (let i = 1; i <= len1; i++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
      dp[j][i] = Math.min(dp[j][i - 1] + 1, dp[j - 1][i] + 1, dp[j - 1][i - 1] + cost)
    }
  }
  return 1 - dp[len2][len1] / maxLen
}

function textSimilar(c1, c2, verbose = false) {
  const t1 = normalizeText(c1)
  const t2 = normalizeText(c2)
  if (!t1 || !t2) return 0
  if (t1 === t2) return 1

  const t1n = t1.replace(/\d+/g, '0')
  const t2n = t2.replace(/\d+/g, '0')
  if (t1n === t2n) return 1

  const editScore = levenshteinSimilarity(t1n, t2n)
  const semanticScore = textSemanticSimilarity(c1, c2)

  let prefixSuffixScore = 0
  const lenDiff = Math.abs(t1n.length - t2n.length)
  if (lenDiff <= 3) {
    const hasPrefixMatch = t1n.length >= 2 && t2n.length >= 2 && t1n.substring(0, 2) === t2n.substring(0, 2)
    const hasSuffixMatch = t1n.length >= 2 && t2n.length >= 2 && t1n.slice(-2) === t2n.slice(-2)
    if (hasPrefixMatch || hasSuffixMatch) {
      prefixSuffixScore = 0.7 + (1 - lenDiff / 3) * 0.3
    }
    if (verbose) {
      console.log(`  前2字: "${t1n.substring(0, 2)}" vs "${t2n.substring(0, 2)}" → ${hasPrefixMatch}`)
      console.log(`  后2字: "${t1n.slice(-2)}" vs "${t2n.slice(-2)}" → ${hasSuffixMatch}`)
    }
  }

  let finalScore
  if (prefixSuffixScore > 0) {
    const weightedScore = editScore * 0.5 + semanticScore * 0.25 + prefixSuffixScore * 0.25
    finalScore = Math.max(weightedScore, editScore)
  } else {
    finalScore = Math.max(editScore, semanticScore)
  }

  if (verbose) {
    console.log(`  归一化: "${t1n}" vs "${t2n}"`)
    console.log(`  editScore:        ${editScore.toFixed(4)}`)
    console.log(`  semanticScore:    ${semanticScore.toFixed(4)}`)
    console.log(`  prefixSuffixScore: ${prefixSuffixScore.toFixed(4)}`)
    console.log(`  → finalScore:     ${finalScore.toFixed(4)}`)
  }

  return finalScore
}

// 指定字符串对
if (process.argv[2] && process.argv[3]) {
  const s1 = process.argv[2]
  const s2 = process.argv[3]
  console.log(`\n"${s1}" vs "${s2}"`)
  textSimilar(s1, s2, true)
  process.exit(0)
}

// 内置测试集
const tests = [
  ['会员管理', '会员中心'],
  ['会员中心', '会员中心'],
  ['设置', '设置'],
  ['今日订单', '今日销售'],
  ['￥1,234.56', '¥1234.56'],
  ['2024年3月', '2024年4月'],
  ['立即购买', '立即下单'],
  ['abc', 'xyz'],
]

console.log('=== textSimilar 验证 ===\n')
console.log(`${'字符串1'.padEnd(15)} | ${'字符串2'.padEnd(15)} | score`)
console.log('-'.repeat(45))
for (const [s1, s2] of tests) {
  const score = textSimilar(s1, s2)
  console.log(`${s1.padEnd(15)} | ${s2.padEnd(15)} | ${score.toFixed(4)}`)
}

console.log('\n--- 详细模式 ---')
textSimilar('会员管理', '会员中心', true)
