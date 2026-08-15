/**
 * 规范名称模糊匹配
 *
 * 【职责】
 * 接收 standardName + sceneName（都可选，都可能是模糊的），
 * 在规则库全量数据中分两阶段匹配：
 *   阶段1：匹配 standard（categoryName / standardName 均参与）
 *   阶段2：匹配 scene（在已确定的 standard 下匹配 sceneName）
 * 最终返回 filePaths 数组，或候选列表让用户缩小范围。
 *
 * 【匹配策略】
 * 每阶段内部：精确匹配（忽略大小写）→ 包含匹配（任一方包含对方）
 *
 * 【返回值分级】（控制 agent 上下文数据量）
 *   matched=true:  { matched, standardId, standardName, sceneName?, filePaths }
 *   matched=false + stage='standard': { matched, stage, message, candidates:[{standardId,standardName,categoryName}] }
 *   matched=false + stage='scene':    { matched, stage, standardId, standardName, message, candidates:[{sceneId,sceneName,sceneCategory}] }
 */

// ── 工具函数 ──

function matchText(source, target, isExact) {
  const s = (source || '').toLowerCase().trim()
  const t = (target || '').toLowerCase().trim()
  if (!s || !t) return false
  return isExact ? s === t : (s.includes(t) || t.includes(s))
}

function collectFilePathsFromScene(scene) {
  return (scene.libraries || []).map(lib => lib.filePath).filter(Boolean)
}

function collectFilePathsFromStandard(standard) {
  const paths = []
  for (const scene of standard.scenes || []) {
    paths.push(...collectFilePathsFromScene(scene))
  }
  return paths
}

// ── 阶段1：匹配 standard ──

function findStandards(specData, name, isExact) {
  const results = []
  for (const category of specData.categories || []) {
    const catMatched = matchText(category.categoryName, name, isExact)
    for (const std of category.standards || []) {
      const stdMatched = catMatched || matchText(std.standardName, name, isExact)
      if (stdMatched) {
        results.push({
          ...std,
          categoryName: category.categoryName,
        })
      }
    }
  }
  return results
}

function deduplicateStandards(standards) {
  const map = new Map()
  for (const std of standards) {
    if (!map.has(std.standardId)) {
      map.set(std.standardId, std)
    }
  }
  return [...map.values()]
}

function extractAllStandards(specData) {
  return deduplicateStandards(
    (specData.categories || []).flatMap(cat =>
      (cat.standards || []).map(std => ({
        standardId: std.standardId,
        standardName: std.standardName,
        categoryName: cat.categoryName,
      }))
    )
  )
}

function toStandardCandidates(standards) {
  return standards.map(std => ({
    standardId: std.standardId,
    standardName: std.standardName,
    categoryName: std.categoryName,
  }))
}

// ── 阶段2：匹配 scene ──

function findScenes(standard, name, isExact) {
  return (standard.scenes || []).filter(scene =>
    matchText(scene.sceneName, name, isExact)
  )
}

function toSceneCandidates(scenes) {
  return scenes.map(scene => ({
    sceneId: scene.sceneId,
    sceneName: scene.sceneName,
    sceneCategory: scene.sceneCategory,
  }))
}

// ── 主函数 ──

/**
 * @param {Object} specData - 规则库全量数据（fetchSpecList 返回值）
 * @param {string} [standardName] - 用户给的规范名/分类名（可选，模糊）
 * @param {string} [sceneName] - 用户给的场景名（可选，模糊）
 * @returns {Object}
 */
export function resolveSpec(specData, standardName, sceneName) {
  const hasStd = standardName && standardName.trim()
  const hasScene = sceneName && sceneName.trim()

  // 都没传 → 返回全量 standards 列表
  if (!hasStd && !hasScene) {
    return {
      matched: false,
      stage: 'standard',
      message: '请从以下规范列表中选择一个，然后重新调用本工具传入 standardName：',
      candidates: extractAllStandards(specData),
    }
  }

  // ── 阶段1：匹配 standard ──
  let matchedStandard = null

  if (hasStd) {
    const name = standardName.trim()
    const exact = deduplicateStandards(findStandards(specData, name, true))
    if (exact.length === 1) {
      matchedStandard = exact[0]
    } else if (exact.length > 1) {
      return {
        matched: false,
        stage: 'standard',
        message: '精确匹配到多个规范，请从中选择一个，重新调用本工具传入完整 standardName：',
        candidates: toStandardCandidates(exact),
      }
    }

    if (!matchedStandard) {
      const fuzzy = deduplicateStandards(findStandards(specData, name, false))
      if (fuzzy.length === 1) {
        matchedStandard = fuzzy[0]
      } else if (fuzzy.length > 1) {
        return {
          matched: false,
          stage: 'standard',
          message: '找到多个匹配的规范，请从中选择一个，重新调用本工具传入完整 standardName：',
          candidates: toStandardCandidates(fuzzy),
        }
      }
    }

    if (!matchedStandard) {
      return {
        matched: false,
        stage: 'standard',
        message: `未找到与"${standardName}"匹配的规范，请从以下列表中选择：`,
        candidates: extractAllStandards(specData),
      }
    }
  }

  // ── 阶段2：匹配 scene ──
  // 没有 matchedStandard（只传了 sceneName）→ 从全量数据中找含该 scene 的 standard
  if (!matchedStandard) {
    const sceneNameStr = sceneName.trim()
    const standardsWithScene = []
    for (const cat of specData.categories || []) {
      for (const std of cat.standards || []) {
        const exactScenes = (std.scenes || []).filter(s =>
          matchText(s.sceneName, sceneNameStr, true)
        )
        if (exactScenes.length > 0) {
          standardsWithScene.push({ std, scenes: exactScenes })
        }
      }
    }
    if (standardsWithScene.length === 0) {
      for (const cat of specData.categories || []) {
        for (const std of cat.standards || []) {
          const fuzzyScenes = (std.scenes || []).filter(s =>
            matchText(s.sceneName, sceneNameStr, false)
          )
          if (fuzzyScenes.length > 0) {
            standardsWithScene.push({ std, scenes: fuzzyScenes })
          }
        }
      }
    }
    if (standardsWithScene.length === 0) {
      return {
        matched: false,
        stage: 'standard',
        message: `未找到包含场景"${sceneName}"的规范，请从以下列表中选择：`,
        candidates: extractAllStandards(specData),
      }
    }
    if (standardsWithScene.length === 1) {
      matchedStandard = { ...standardsWithScene[0].std, categoryName: '' }
      const matchedScenes = standardsWithScene[0].scenes
      return {
        matched: false,
        stage: 'scene',
        standardId: matchedStandard.standardId,
        standardName: matchedStandard.standardName,
        message: `场景"${sceneName}"匹配到规范"${matchedStandard.standardName}"，请确认后用 standardName + sceneName 重新调用：`,
        candidates: toSceneCandidates(matchedScenes),
      }
    }
    return {
      matched: false,
      stage: 'standard',
      message: `场景"${sceneName}"出现在多个规范中，请先选择一个规范：`,
      candidates: standardsWithScene.map(({ std }) => ({
        standardId: std.standardId,
        standardName: std.standardName,
      })),
    }
  }

  // 有 matchedStandard，检查 scene
  const scenes = matchedStandard.scenes || []

  if (!hasScene) {
    if (scenes.length === 1) {
      return {
        matched: false,
        stage: 'scene',
        standardId: matchedStandard.standardId,
        standardName: matchedStandard.standardName,
        message: `规范"${matchedStandard.standardName}"包含以下场景，请确认后用 standardName + sceneName 重新调用：`,
        candidates: toSceneCandidates(scenes),
      }
    }
    if (scenes.length > 1) {
      return {
        matched: false,
        stage: 'scene',
        standardId: matchedStandard.standardId,
        standardName: matchedStandard.standardName,
        message: `规范"${matchedStandard.standardName}"包含多个场景，请选择一个场景，重新调用本工具传入 standardName + sceneName：`,
        candidates: toSceneCandidates(scenes),
      }
    }
    return {
      matched: true,
      standardId: matchedStandard.standardId,
      standardName: matchedStandard.standardName,
      filePaths: collectFilePathsFromStandard(matchedStandard),
    }
  }

  const sceneNameStr = sceneName.trim()
  let matchedScenes = findScenes(matchedStandard, sceneNameStr, true)
  if (matchedScenes.length === 0) {
    matchedScenes = findScenes(matchedStandard, sceneNameStr, false)
  }

  if (matchedScenes.length === 1) {
    return {
      matched: true,
      standardId: matchedStandard.standardId,
      standardName: matchedStandard.standardName,
      sceneName: matchedScenes[0].sceneName,
      filePaths: collectFilePathsFromScene(matchedScenes[0]),
    }
  }
  if (matchedScenes.length > 1) {
    return {
      matched: false,
      stage: 'scene',
      standardId: matchedStandard.standardId,
      standardName: matchedStandard.standardName,
      message: `在规范"${matchedStandard.standardName}"下匹配到多个场景，请选择一个：`,
      candidates: toSceneCandidates(matchedScenes),
    }
  }

  return {
    matched: false,
    stage: 'scene',
    standardId: matchedStandard.standardId,
    standardName: matchedStandard.standardName,
    message: `在规范"${matchedStandard.standardName}"下未找到与"${sceneName}"匹配的场景，请从以下场景中选择：`,
    candidates: toSceneCandidates(scenes),
  }
}
