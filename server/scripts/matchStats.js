import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'

import { parseDesign } from '../src/parsers/design/index.js'
import { parseArkui } from '../src/parsers/arkui/index.js'
import { matchNodes } from '../src/matchers/nodeMatcher.js'
import { compareAll } from '../src/comparators/styleComparator.js'

const casesDir = resolve(process.cwd(), '../case')
const matchDirection = process.argv.includes('--design-first') ||
  process.env.STYLE_CHECKER_MATCH_DIRECTION === 'design'
  ? 'design'
  : 'arkui'

if (!existsSync(casesDir)) {
  console.error(`Case directory not found: ${casesDir}`)
  process.exit(1)
}

const caseIds = readdirSync(casesDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && /^case\d+$/.test(d.name))
  .map(d => d.name)
  .sort((a, b) => Number(a.replace('case', '')) - Number(b.replace('case', '')))

const rows = []

for (const caseId of caseIds) {
  const caseDir = join(casesDir, caseId)
  const designJson = JSON.parse(readFileSync(join(caseDir, 'design.json'), 'utf-8'))
  const arkuiJson = JSON.parse(readFileSync(join(caseDir, 'arkui.json'), 'utf-8'))

  const designImagePath = join(caseDir, 'design.png')
  const arkuiImagePath = join(caseDir, 'arkui.png')
  const designBuffer = existsSync(designImagePath) ? readFileSync(designImagePath) : undefined
  const arkuiBuffer = existsSync(arkuiImagePath) ? readFileSync(arkuiImagePath) : undefined

  const design = await parseDesign(designJson, { imageBuffer: designBuffer })
  const arkui = await parseArkui(arkuiJson, { imageBuffer: arkuiBuffer })

  const visualImages = designBuffer && arkuiBuffer ? {
    designBuffer,
    arkuiBuffer,
    designCanvas: { w: design.canvasWidth, h: design.canvasHeight },
    arkuiCanvas: { w: arkui.canvasWidthVp, h: arkui.canvasHeightVp },
  } : undefined

  const {
    pairs,
    unmatchedDesign,
    unmatchedArkui,
    comparableDesignCount,
    comparableArkuiCount,
    regions,
  } = matchNodes(design.nodes, arkui.nodes, {
    visualImages,
    primarySource: matchDirection,
  })
  const diffs = compareAll(pairs)
  const byType = countBy(pairs, p => p.matchType)
  const lowConfidence = pairs.filter(p => p.confidence === 'low').length
  const designTextNodes = design.nodes.filter(n => n.type === 'text' && String(n.textContent || '').trim())
  const textPairs = pairs.filter(p => p.design.type === 'text' && p.arkui.type === 'text')
  const badTextPairs = pairs.filter(p => p.design.type === 'text' && p.arkui.type !== 'text')

  rows.push({
    caseId,
    design: design.nodes.length,
    arkui: arkui.nodes.length,
    comparableDesign: comparableDesignCount,
    comparableArkui: comparableArkuiCount,
    pairs: pairs.length,
    coverage: comparableDesignCount ? `${(pairs.length / comparableDesignCount * 100).toFixed(1)}%` : '0.0%',
    textPairs: textPairs.length,
    textCoverage: designTextNodes.length ? `${(textPairs.length / designTextNodes.length * 100).toFixed(1)}%` : '0.0%',
    badTextPairs: badTextPairs.length,
    unmatchedDesign: unmatchedDesign.length,
    unmatchedArkui: unmatchedArkui.length,
    lowConfidence,
    designRegions: regions?.design?.length || 0,
    arkuiRegions: regions?.arkui?.length || 0,
    regionPairs: regions?.pairs?.length || 0,
    diffs: diffs.length,
    matchTypes: Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(' '),
  })
}

console.log(`Match direction: ${matchDirection === 'arkui' ? 'arkui-first' : 'design-first'}`)
console.log()
console.table(rows.map(({ matchTypes, ...r }) => r))
console.log('\nMatch type breakdown:')
for (const row of rows) {
  console.log(`${row.caseId}: ${row.matchTypes || '-'}`)
}

function countBy(items, getKey) {
  const result = {}
  for (const item of items) {
    const key = getKey(item)
    result[key] = (result[key] || 0) + 1
  }
  return result
}
