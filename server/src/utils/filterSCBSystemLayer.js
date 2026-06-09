/**
 * ArkUI 步骤 2a.5：过滤 SCB 系统覆盖图层
 *
 * 在 hardPrune 之后、softPrune 之前执行。
 *
 * 背景：case13 等场景中，__Common__ 节点下挂载大量 SCB 系统覆盖图层
 * （SCBSystemScene / SCBKeyboardPanel / SCBScenePanel 等），它们全屏覆盖、Z 序堆叠，
 * 只有少数包含真实应用内容的节点需要保留。
 *
 * 策略：
 *   1. 查找 viewTag === "SCBSystemScene" 的节点所在层级
 *   2. 对每个兄弟子树做 dfsCheck：含系统控件(SCBGestureBack 等) → 过滤；纯同框无尺寸差异 → 过滤
 *   3. 后项杀前项：被后项完全包含的前项删除
 *   4. 同理处理 CardStackViewItem 层级
 *
 * @param {object} root UnifiedNode 树根（就地修改）
 */

const SYSTEM_WIDGET_TAGS = new Set([
  'SCBGestureBack',       // 手势-侧滑返回控件
  'SCBStatusBarBuilder',  // 顶部状态栏控件
  'SCBGestureNavBar',     // 手势-手机底部的导航控件
  'SCBKeyboardPanel',     // 输入法控件（无子节点）
])

export function filterSCBSystemLayer(root) {
  if (!root) return root

  // 寻找 viewTag 为某些值的层
  const findSomelay = (node, key) => {
    if (!node || !node.children) return null

    // 深度优先查找第一个 SCBSystemScene 节点，返回其兄弟层
    for (const child of node.children) {
      // 遍历当前节点的所有子节点
      if (child._viewTag === key) {
        // 如果找到该节点
        return { layer: node.children, layPar: node } // 返回该层的所有兄弟节点（包括自己）
      }
    }

    for (const child of node.children) {
      // 如果当前层没找到，继续在子节点中递归查找
      const result = findSomelay(child, key) // 递归查找
      if (result) return result // 如果找到了，返回结果
    }
    return null // 所有分支都没找到，返回 null
  }

  // 子树判空逻辑
  const dfsCheck = (root) => {
    if (!root) return false

    let allViewTagValid = true
    let hasDifferentDimensions = false

    function dfs(node, parent) {
      if (!node) return

      if (SYSTEM_WIDGET_TAGS.has(node._viewTag)) {
        allViewTagValid = false
      }

      if (parent) {
        if (
          node.rect.x !== parent.rect.x ||
          node.rect.y !== parent.rect.y ||
          node.rect.w !== parent.rect.w ||
          node.rect.h !== parent.rect.h
        ) {
          hasDifferentDimensions = true
        }
      }

      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          dfs(child, node)
        }
      }
    }
    dfs(root, null)

    return allViewTagValid && hasDifferentDimensions
  }

  // 覆盖消除前项
  const filterContainedNodes = (nodes) => {
    const isContained = (a, b) => {
      return b.rect.x <= a.rect.x && b.rect.y <= a.rect.y && b.rect.x + b.rect.w >= a.rect.x + a.rect.w && b.rect.y + b.rect.h >= a.rect.y + a.rect.h
    }
    return nodes.filter((node, index) => {
      for (let j = index + 1; j < nodes.length; j++) {
        if (isContained(node, nodes[j])) return false
      }
      return true
    })
  }

  // 主逻辑 -- 获取 SCBSystemScene 及其邻居层，然后过滤
  const SCBresult = findSomelay(root, 'SCBSystemScene')
  if (SCBresult) {
    const sceneLay = SCBresult.layer
    const neededSceneLay = []
    for (const subTree of sceneLay) {
      // 子树判空 - 消除子树
      const isRequired = dfsCheck(subTree)
      if (isRequired) neededSceneLay.push(subTree)
    }
    // 后项杀前项 - 一层
    root.children = filterContainedNodes(neededSceneLay)
  }

  // 过滤覆盖场景
  const cardResult = findSomelay(root, 'CardStackViewItem')
  if (cardResult) {
    const cardLay = cardResult.layer
    // 后项杀前项 - 一层
    cardResult.layPar.children = filterContainedNodes(cardLay)
  }

  return root
}
