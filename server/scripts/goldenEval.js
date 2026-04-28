import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'

import { parseDesign } from '../src/parsers/designParser.js'
import { parseArkui } from '../src/parsers/arkuiParser.js'
import { matchNodes } from '../src/matchers/nodeMatcher.js'
import { annotatePixelVisibility } from '../src/utils/imageFeatures.js'

const casesDir = resolve(process.cwd(), '../case')
const goldenPath = resolve(process.cwd(), '../case/golden-pairs.json')
const matchDirection = process.argv.includes('--design-first') ? 'design' : 'arkui'

if (!existsSync(goldenPath)) {
  console.error(`Golden pair file not found: ${goldenPath}`)
  process.exit(1)
}

const golden = JSON.parse(readFileSync(goldenPath, 'utf-8'))
const caseIds = Object.keys(golden.cases || {}).length
  ? Object.keys(golden.cases)
  : readdirSync(casesDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^case\d+$/.test(d.name))
    .map(d => d.name)

const rows = []
const failures = []

for (const caseId of caseIds.sort((a, b) => Number(a.replace('case', '')) - Number(b.replace('case', '')))) {
  const caseDir = join(casesDir, caseId)
  const caseGolden = golden.cases?.[caseId] || {}
  const design = parseDesign(JSON.parse(readFileSync(join(caseDir, 'design.json'), 'utf-8')))
  const arkui = parseArkui(JSON.parse(readFileSync(join(caseDir, 'arkui.json'), 'utf-8')))
  annotatePixelVisibility(arkui.nodes, readFileSync(join(caseDir, 'arkui.png')), {
    w: arkui.canvasWidthVp,
    h: arkui.canvasHeightVp,
  }, { source: 'arkui' })

  const result = matchNodes(design.nodes, arkui.nodes, {
    primarySource: matchDirection,
    visualImages: {
      designBuffer: readFileSync(join(caseDir, 'design.png')),
      arkuiBuffer: readFileSync(join(caseDir, 'arkui.png')),
      designCanvas: { w: design.canvasWidth, h: design.canvasHeight },
      arkuiCanvas: { w: arkui.canvasWidthVp, h: arkui.canvasHeightVp },
    },
  })
  const pairKeys = new Set(result.pairs.map(pairKey))
  const designToPair = new Map(result.pairs.map(p => [p.design.id, p]))
  const arkuiToPair = new Map(result.pairs.map(p => [p.arkui.id, p]))
  const expected = caseGolden.expected || []
  const forbidden = caseGolden.forbidden || []

  const missing = []
  const wrong = []
  for (const item of expected) {
    const key = expectedKey(item)
    if (pairKeys.has(key)) continue
    const byDesign = designToPair.get(item.designId)
    const byArkui = arkuiToPair.get(item.arkuiId)
    const detail = {
      caseId,
      designId: item.designId,
      arkuiId: item.arkuiId,
      designText: item.designText,
      arkuiText: item.arkuiText,
      actual: byDesign ? pairLabel(byDesign) : byArkui ? pairLabel(byArkui) : null,
    }
    if (byDesign || byArkui) wrong.push(detail)
    else missing.push(detail)
  }

  const forbiddenHit = forbidden
    .filter(item => pairKeys.has(expectedKey(item)))
    .map(item => ({ caseId, ...item }))

  failures.push(...missing.map(f => ({ type: 'missing', ...f })))
  failures.push(...wrong.map(f => ({ type: 'wrong', ...f })))
  failures.push(...forbiddenHit.map(f => ({ type: 'forbidden', ...f })))

  const foundExpected = expected.length - missing.length - wrong.length
  const precisionDenominator = foundExpected + wrong.length + forbiddenHit.length
  rows.push({
    caseId,
    pairs: result.pairs.length,
    expected: expected.length,
    foundExpected,
    missing: missing.length,
    wrong: wrong.length,
    forbiddenHit: forbiddenHit.length,
    goldenRecall: expected.length ? percent(foundExpected / expected.length) : 'n/a',
    goldenPrecision: precisionDenominator ? percent(foundExpected / precisionDenominator) : 'n/a',
  })
}

console.log(`Golden pair regression (${matchDirection === 'arkui' ? 'arkui-first' : 'design-first'})\n`)
console.table(rows)

if (failures.length) {
  console.log('\nFailures:')
  for (const failure of failures) {
    console.log(JSON.stringify(failure))
  }
  process.exitCode = 1
}

function pairKey(pair) {
  return `${pair.design.id}::${pair.arkui.id}`
}

function expectedKey(item) {
  return `${item.designId}::${item.arkuiId}`
}

function pairLabel(pair) {
  return {
    designId: pair.design.id,
    arkuiId: pair.arkui.id,
    designText: pair.design.textContent || null,
    arkuiText: pair.arkui.textContent || null,
    matchType: pair.matchType,
  }
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`
}
