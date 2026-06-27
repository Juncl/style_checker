# 点选与框选交互逻辑

> 描述用户在图片对比面板（`ImagePanel.vue`）上点击节点（点选）、拖拽框选多节点（框选）的完整交互流程，以及事件如何向上传递、状态如何被管理。

---

## 一、整体设计

左侧（开发侧 ArkUI）和右侧（设计侧 Design）各有一个 `ImagePanel` 组件，共享相同的点选/框选实现。两种模式下行为有差异：

| 模式 | 触发条件 | 点选效果 | 框选效果 |
|---|---|---|---|
| **正常模式** | `nodeCanvasMode = 'default'` | 更新全局 `selectedPair`，高亮对应节点对 | 不开启（框选按钮未激活） |
| **Debugger 比对模式** | `nodeCanvasMode = 'select'` | 更新本地 `localArkuiId` / `localDesignId`，清空上次对比结果 | 开启，更新本地 `localArkuiNodeList` / `localDesignNodeList` |

---

## 二、正常模式（default）

### 2.1 点选流程

**坐标转换** — `ImagePanel.vue` → `getCanvasCoords(e)`

```
鼠标客户端坐标（clientX/Y）
  ↓
相对 canvas 元素的偏移比例
  ↓
画布坐标系（px, py）= 比例 × canvasW / canvasH
```

**命中检测** — `hitNodesAt(px, py)`，返回该坐标所有命中节点，排除锁定层。

过滤条件（以下任一不满足则排除）：
- `node.visible !== false`
- `!isHiddenTextNode(node)`（排除视觉遮挡或 OCR 不可见的文本节点）
- `!node.visualOccluded`
- `node.rect` 存在
- `!props.lockedIds.has(node.id)`
- 坐标在节点 rect 范围内

排序规则（小/精确的排在前面）：
1. 类型优先级：文本节点（0） > 容器节点（1） > 其他（2）
2. 同类型时，面积升序（面积小 = 更精确的上层节点）

`findHitNode()` 取数组第一个（最优命中）。

**事件流**：

```
用户单击 canvas
  ↓ onCanvasClick(e)
  ├─ suppressClick=true 时（框选刚结束）→ 清除标志，直接返回
  ├─ e.detail >= 2 时 → 跳过（留给 dblclick 处理）
  ├─ 获取坐标 → findHitNode()
  │  ├─ 命中节点 → stopPropagation + emit('node-click', id)
  │  └─ 未命中 → emit('bg-click')
  ↓
ReportPage.onDevNodeClick(id)
  → emit('arkui-node-click', id)   // 冒泡给 ConsistencyView
  ↓
ConsistencyView.onArkuiNodeClick(id)
  → selectedPair 更新
```

`stopPropagation` 阻止事件冒泡到 wrapper 层，避免触发全局的"清空选择"逻辑。

### 2.2 节点可选性过滤

`ConsistencyView` 在接收到 `node-click` 事件时，通过以下两步过滤保证选中的是有意义的节点。

**isSelectableNode**（`utils/tools.ts`）：

```javascript
function isSelectableNode(node) {
  return !!(node &&
    node.visible !== false &&
    !isHiddenFrameworkTextNode(node) &&   // 排除框架文本节点
    !isOcrHiddenTextNode(node) &&         // 排除 OCR 不可见节点
    !node.visualOccluded &&               // 排除被遮挡节点
    node.rect?.w > 4 &&                   // 最小宽/高 4px
    node.rect?.h > 4)
}
```

**resolveSelectableNode（容器 → 叶子文本优化）**：

若用户点击的是含文本内容的容器节点，则自动替换为其后代中"最深层、面积最小的匹配文本节点"，以选中更精确的叶子节点。选择优先级：路径深度更大优先，相同深度时面积更小优先。若目标本身是文本节点，或无文本内容，则直接返回目标节点。

### 2.3 全局状态更新（ConsistencyView）

```javascript
function onArkuiNodeClick(nodeId) {
  const node = resolveSelectableNode(allArkuiNodes, nodeId)
  if (!isSelectableNode(node)) return
  const pair = pairs.find(p => p.arkui.id === node.id)
  selectedPair = pair
    || { matchDetail: { type: 'unmatched-dev' }, design: null, arkui: node }
  activeDiff = null
}
```

设计侧对称，匹配条件改为 `p.design.id === node.id`，`matchDetail.type` 为 `'unmatched'`。

点击空白区域 → `emit('clear-pair')` → `selectedPair = null`。

### 2.4 双击下钻

`onCanvasDblClick(e)` — 在同一坐标的命中节点列表中循环切换，用于多节点堆叠时逐层选中内层节点。

```
双击 canvas
  ↓
hitNodesAt() 取所有命中节点
  ├─ 命中 < 2 → 无操作
  └─ 取当前选中节点在列表中的位置 → 选下一个（循环），emit('node-click', nextId)
```

### 2.5 Hover 联动

`onMouseMove(e)` → `findHitNode()` → `emit('node-hover', id)`

- 鼠标离开 → `emit('node-hover', null)`
- cursor 样式：命中节点时改为 `pointer`
- 对侧通过 `externalHoveredId` prop 接收联动 hover，以相同样式绘制

### 2.6 Canvas 绘制（正常模式相关层）

`draw()` 函数按顺序绘制，后绘覆盖先绘：

| 层级 | 条件 | 样式 |
|---|---|---|
| Debugger 节点轮廓 | `debugPipelineVisible=true` | 红色细框，无填充 |
| Debugger pair 映射 | `debugVisible=true` | 各 pair 独立颜色虚线框 + 编号角标 |
| 锁定节点 | `lockedIds` 中的节点 | 红色虚线（`#E02128`）+ 左上角🔒 |
| Hover 节点 | `hoveredId` | 红色虚线（`[4,3]`）+ 浅红背景 `rgba(224,33,40,0.10)` |
| 外部 Hover 联动 | `externalHoveredId` | 同上（对侧 hover 传入） |
| 选中节点 | `selectedId` | 红色实线 + 红色背景 `rgba(224,33,40,0.20)` |
| Diff 高亮 | `highlightPair` | 间距标注（橙红色箭头）或关联框（橙色） |
| Hover 实时间距 | `hoverHighlightPairs` | 蓝色间距标注 |

---

## 三、select 模式（Debugger 比对模式）

### 3.1 点选 → 本地状态

`nodeCanvasMode = 'select'` 时，`ReportPage` 截获 `node-click` 事件，不再向上冒泡：

```javascript
function onDevNodeClick(id) {
  if (nodeCanvasMode === 'select') localArkuiId = id
  else emit('arkui-node-click', id)
}

function onDevBgClick() {
  if (nodeCanvasMode === 'select') localArkuiId = null
  else emit('clear-pair')
}
```

设计侧对称，变量名换为 `localDesignId`。

### 3.2 框选逻辑

**触发条件**：`props.boxSelectMode === true`（`nodeCanvasMode === 'select'` 时由 `ReportPage` 传入）。

**内部状态**：

| 变量 | 类型 | 说明 |
|---|---|---|
| `boxDrag` | `{startPx, startPy, startCX, startCY}` | 框选起始点（画布坐标 + 客户端坐标） |
| `boxRect` | `{x, y, w, h}` | 当前框矩形（画布坐标系） |
| `boxHitIds` | `Set<string>` | 框内命中的节点 id 集合 |
| `suppressClick` | `boolean` | 拖拽结束后阻止紧随的 click 事件 |

**三阶段流程**：

阶段一：开始拖拽 — `onBoxStart(e)`（mousedown on wrapper）

```
条件：boxSelectMode=true 且 e.button===0（左键）
  ↓
记录 boxDrag（起始坐标）
清空 boxRect、boxHitIds
cursor 改为 crosshair
注册全局 mousemove/mouseup 监听
```

阶段二：拖拽中 — `onBoxMove(e)`（全局 mousemove）

```
检查鼠标是否超出 img-wrapper 边界 → 超出则调 finishBox() 终止
  ↓
计算拖拽偏移 (dx, dy)
  ├─ |dx| < 4 且 |dy| < 4 → 抖动容差，不开始绘框
  └─ 超过 4px → suppressClick = true，开始绘框
       ↓
       boxRect = { x: min, y: min, w: |delta|, h: |delta| }
       命中节点 = props.nodes.filter(n => rectsIntersect(boxRect, n.rect))
       更新 boxHitIds → 重绘 canvas
```

`rectsIntersect` 使用 AABB 碰撞检测。框内命中**不过滤 lockedIds**，被锁定节点也会被选入。

阶段三：结束拖拽 — `finishBox()`（mouseup）

```
移除全局 mousemove/mouseup 监听
  ↓
suppressClick=true 且 boxHitIds 非空
  → emit('box-select', selectedNodes)（传出节点对象数组）
清空 boxDrag、boxRect
boxHitIds 保留（高亮维持，直到下次单击或重新框选）
cursor 恢复默认
```

### 3.3 本地节点列表管理

`ReportPage` 接收框选结果后存入本地状态，计算属性 `currentDevNodes` 决定最终使用哪批节点：

```javascript
// 框选优先 > 单击 > 无
currentDevNodes = localArkuiNodeList.length > 0
  ? localArkuiNodeList
  : (localArkuiId ? [找到的节点] : [])
```

两侧各有一份，任意一侧 `>= 2` 个节点时进入批量对比模式（`isBatchMode`）。

### 3.4 Canvas 绘制（框选 + 对比激活相关层）

框选和对比激活相关层绘制在正常层之上：

| 层级 | 条件 | 样式 |
|---|---|---|
| **框选命中节点** | `boxHitIds` 非空 且 `!compareActive` | 红色实线，**无背景** |
| **框选矩形** | `boxRect` 且 `!compareActive` | 蓝色（`#0067D1`）虚线框 + 极浅蓝填充 |
| **对比激活遮罩** | `compareActive === true` | 选中区高亮：选中区外四周铺 `rgba(255,255,255,0.72)` 白色遮罩；红色边框和框选矩形不绘制 |

**对比激活遮罩逻辑**：

`compareActive` 激活时，`draw()` 优先取 `boxHitIds` 内所有节点的 rect，若无框选则取 `localSelectedId` 对应节点的 rect，计算 `unionRect` 后在其四周各边绘制白色遮罩矩形，使选中区在视觉上高亮突出。

框选矩形在最顶层，保证视觉反馈清晰。hover 在框选拖拽中自动跳过。

---

### 3.5 重新对比触发与临时 diff

**触发路径**：

```
用户点击「重新对比」按钮（ReportPanel）
  ↓ emit('rerun')
ConsistencyView.rerunCheck()
  ├─ devSwitchActive === true（select 模式）→ reportPageRef.runCompare()
  └─ devSwitchActive === false（default 模式）→ 走完整算法重跑流程
```

`devSwitchActive` 由 `ReportPage` 在切换 `nodeCanvasMode` 时通过 `emit('dev-switch-change', bool)` 同步给 `ConsistencyView`。

**`runCompare()` 内部逻辑**（`ReportPage`）：

```
isBatchMode（任一侧 ≥ 2 个节点）
  → runBoxCompare()：弹 ElMessageBox 提示（批量对比接入中）

单节点模式（两侧各 1 个节点）
  → compareNodeStyles(designNode, devNode)   // 前端本地对比
  → 格式转换为 DiffReport 所需结构
  → pendingDiffs.value = diffs
  → emit('temp-diffs', diffs)
```

**临时 diff 数据流**：

```
ReportPage.runCompare()
  pendingDiffs.value = diffs          // 本地驱动 compareActive
  emit('temp-diffs', diffs)
         ↓
  ConsistencyView.tempDiffs = $event
         ↓ :temp-diffs="tempDiffs"
  ReportPanel
         ↓ :diffs="tempDiffs ?? result.diffs"
            :unmatched="tempDiffs ? [] : result.unmatchedDesignNodes"
  DiffReport（临时展示，不覆盖算法结果）
```

`tempDiffs` 为 `null` 时，`DiffReport` 自动回退到全量算法产出的 `result.diffs`。

**对比激活状态管理**：

`compareActive` 是一个 computed，不是独立 ref：

```javascript
const pendingDiffs  = ref(null)
const compareActive = computed(() => pendingDiffs.value !== null)
```

**自动清除机制**：选择发生任何变化时（点选新节点、框选新节点、点击空白），`watch` 自动触发 `clearCompare()`：

```javascript
watch(
  [localArkuiId, localDesignId, localArkuiNodeList, localDesignNodeList],
  () => { pendingDiffs.value = null; emit('temp-diffs', null) }
)
```

---

## 四、节点属性浮层（Inspector）

点选节点后，`ImagePanel` 在节点旁悬浮显示一个属性面板（`.node-inspector`），展示该节点的样式属性（字号、填充、圆角等），以及与对比结果的差异高亮。该浮层在正常模式和 select 模式下均有效。

**显示条件**：`isSpacingInspector || (inspectorNode && (displayStyle.length || debugMode))`

- 间距模式（`isSpacingInspector`）：由 `highlightPair.type === 'spacing'` 触发，显示间距值
- 节点模式：`inspectorNode` 非 null 且有可展示的属性

**属性展示（`displayStyle` computed）**：

`displayStyle` 遍历 `inspectorNode.style`，将有值的字段转换为 `{ key, label, val, color, diff }` 行列表，`diff` 字段标记该属性是否存在差异（来自 `styleDiffs` prop）。

**自定义对比行**：

inspector-header 右侧有一个 `+` 按钮，点击后在属性列表末尾追加一行，左边是下拉，右边是用户输入框。**最多只允许存在一行**，已追加后 `+` 按钮变灰不可再点。

下拉选项根据节点类型动态变化（常量定义在 `utils/constants.ts`）：

| 节点类型 | 可选属性 |
|---|---|
| `type === 'text'` | 字号、字重、颜色、字体、对齐、行高、字间距 |
| `type === 'container'` | 填充、不透明度、圆角、描边宽度、描边颜色、内边距、间距、阴影、模糊 |

**状态管理**：

```javascript
const showExtraRow  = ref(false)  // 是否显示自定义行
const extraRowKey   = ref('')     // 下拉选中的属性 key
const extraRowValue = ref('')     // 用户填入的期望值
```

切换到不同节点时（watch `inspectorNode?.id`），三个状态自动重置，自定义行消失。

`+` 按钮加了 `@pointerdown.stop`，阻止触发 inspector-header 上的拖拽逻辑。

---

## 五、整体状态流转图

```
用户交互（鼠标事件）
         ↓
  ImagePanel（canvas 绘制层）
         ├─ 单击 → emit('node-click', id)
         ├─ 双击 → 下钻循环，emit('node-click', nextId)
         ├─ 拖拽 → emit('box-select', nodes[])
         ├─ Hover → emit('node-hover', id | null)
         └─ 空白点击 → emit('bg-click')
         ↓
  ReportPage（两侧面板协调）
         ├─ nodeCanvasMode = 'default'（正常模式）
         │  ├─ 点选 → emit('arkui-node-click' | 'design-node-click', id)
         │  └─ 空白 → emit('clear-pair')
         └─ nodeCanvasMode = 'select'（Debugger 比对模式）
            ├─ 点选 → localArkuiId / localDesignId
            ├─ 框选 → localArkuiNodeList / localDesignNodeList
            ├─ 空白 → 清空本地 id（watch 自动清 pendingDiffs）
            └─ 任一选择变化 → watch → clearCompare()（pendingDiffs=null, emit temp-diffs null）
         ↓（正常模式继续传递）
  ConsistencyView（全局状态管理）
         ├─ onArkuiNodeClick(id)
         │  └─ resolveSelectableNode + isSelectableNode 过滤
         │     → selectedPair = pair | unmatched-dev
         ├─ onDesignNodeClick(id)
         │  └─ 同上，→ selectedPair = pair | unmatched
         ├─ onDiffSelect(diff) → activeDiff + selectedPair
         ├─ clear-pair → selectedPair = null
         ├─ Hover → hoveredArkuiNodeId / hoveredDesignNodeId
         ├─ temp-diffs → tempDiffs（中转给 ReportPanel）
         └─ rerun（select 模式）→ reportPageRef.runCompare()
         ↓
  ImagePanel 接收 props 重新绘制
         ├─ selectedId → 红色实线高亮
         ├─ compareActive → 白色遮罩高亮选中区（节点边框隐藏）
         ├─ externalHoveredId → 对侧 hover 联动高亮
         └─ highlightPair / hoverHighlightPairs → 间距/关联标注

  ReportPanel（右侧差异面板）
         └─ DiffReport :diffs="tempDiffs ?? result.diffs"
              ├─ tempDiffs 非 null → 展示临时对比结果
              └─ tempDiffs 为 null → 回退全量算法结果
```

---

# 七、Canvas 与 Report 双向联动

> 描述右侧 `ReportPanel`（差异列表）与左侧 `ImagePanel`（画布）之间的完整双向联动机制。

---

## 7.1 Canvas → Report：节点选中驱动差异列表高亮

**触发路径**：

```
用户点选画布节点
  ↓ onArkuiNodeClick / onDesignNodeClick
ConsistencyView → selectedPair 更新
  ↓ activePairForDiff（computed）
  { designNodeId, arkuiNodeId }
  ↓ :active-pair="activePairForDiff"
DiffReport.activeDiffKeys（computed）
  遍历 filteredDiffs，isDiffMatchPair(d, activePair)
  → 命中的 diff 加入 activeDiffKeys Set
  ↓
差异卡片添加 class "active-from-node"（蓝色背景 + 蓝色边框）
```

**自动滚动**：`watch(props.activePair)` 在 activePair 变化时，找到第一个命中差异卡片，调用 `listEl.scrollTo({ behavior: 'smooth' })` 将其滚入视口。若是由右侧卡片点击自身触发的 `activePair` 变化，`_skipScrollOnce = true` 跳过本次滚动，防止抖动。

`isDiffMatchPair` 匹配逻辑：`spacing.` 类 diff 不参与匹配（间距差异不绑定具体节点对）；其余 diff 只要 `arkuiNodeId` 或 `designNodeId` 任一与 `activePair` 一侧命中即视为关联。

---

## 7.2 Canvas → Report：Hover 驱动差异列表弱高亮

**触发路径**：

```
用户 hover 画布节点
  ↓ emit('node-hover', id)（ImagePanel）
ReportPage → emit('arkui-hover' / 'design-hover', id)
ConsistencyView → hoveredArkuiNodeId / hoveredDesignNodeId 更新
  ↓ hoverPairForDiff（computed）
  { arkuiNodeId, designNodeId }
  ↓ :hover-pair="hoverPairForDiff"
DiffReport.hoverDiffKeys（computed）
  遍历 filteredDiffs，命中的 diff 加入 hoverDiffKeys
  ↓
差异卡片添加 class "hover-from-node"（浅灰背景，优先级低于 active-from-node）
```

`hoverPairForDiff` 只在没有 `hoveredDiffPair`（来自 Report 侧 hover，见 7.4）时生效；两者同时存在时，`hoveredDiffPair` 具有更高语义优先级。

---

## 7.3 Report → Canvas：点击差异卡片驱动画布高亮

**触发路径**：

```
用户点击 DiffReport 差异卡片
  ↓ selectItem(d, idx) → emit('select', d)
ReportPanel → emit('diff-select', $event)
ConsistencyView.onDiffSelect(diff)
  ├─ activeDiff = diff
  └─ 非 spacing diff → selectedPair = result.pairs.find(...)
         ↓ :selected-id → ImagePanel
  → 画布绘制节点红色实线高亮
```

**间距 diff 专属路径**（`diff.property` 以 `spacing.` 开头）：

```
activeDiff = diff（selectedPair 不更新）
  ↓ :active-diff="activeDiff"（传入 ReportPage）
ReportPage.designSpacingMark（computed）← buildSpacingMark(activeDiff, 'design', designNodes)
ReportPage.arkuiSpacingMark（computed） ← buildSpacingMark(activeDiff, 'arkui',  arkuiNodes)
  ↓ :highlight-pair="arkuiSpacingMark / designSpacingMark"（传入各侧 ImagePanel）
  → 画布绘制橙红色 H 形间距标注（spaceRect + rects + 箭头）
```

`buildSpacingMark` 从 diff 的 `selfId/anchorId`、`relationAxis`、`relationKind` 推算 `spaceRect`（间距区域矩形），驱动画布在两个参照节点之间绘制带数值标注的间距可视化。

取消选中（再次点击同一卡片）→ `selectedIdx = -1`，`emit('select', null)` → `activeDiff = null`，`selectedPair = null` → 画布高亮清除。

---

## 7.4 Report → Canvas：Hover 差异卡片驱动画布联动 Hover

**触发路径**：

```
用户鼠标悬浮 DiffReport 差异卡片（非 spacing diff）
  ↓ @mouseenter → emit('diff-hover', { arkuiNodeId, designNodeId })
ReportPanel → emit('diff-hover', $event)
ConsistencyView → hoveredDiffPair = $event
  ↓ hoveredDesignCrossId / hoveredArkuiCrossId（computed）
  优先取 hoveredDiffPair.designNodeId / .arkuiNodeId
  ↓ :external-hovered-id（传入各侧 ImagePanel）
  → 两侧画布同时绘制对应节点 hover 样式（红色虚线 + 浅红背景）
鼠标离开卡片 → emit('diff-hover', null) → hoveredDiffPair = null → 联动消失
```

`spacing.` 类 diff 的卡片不注册 `@mouseenter`，不触发此联动。

---

## 7.5 对侧联动 Hover（Cross-side Hover）

当用户 hover **画布节点**（而非 diff 卡片）时，系统自动在**对侧**画布上高亮对应匹配节点：

```
hover 开发侧节点 id A
  ↓ hoveredArkuiNodeId = A
ConsistencyView.hoveredDesignCrossId（computed）
  若 hoveredDiffPair 无值：pairs.find(p => p.arkui.id === A)?.design.id
  ↓ :external-hovered-id="hoveredDesignCrossId"（传入设计侧 ImagePanel）
  → 设计侧画布绘制对应节点联动 hover 样式
```

设计侧 hover → 反向查 `hoveredArkuiCrossId` → 开发侧画布联动，逻辑对称。

`hoveredArkuiNodeId` 和 `hoveredDesignNodeId` 互斥（任一侧赋值时另一侧清零），确保同一时刻只有一侧 hover 驱动对侧联动。

---

## 7.6 Hover 实时间距标注

当 `selectedPair` 非空（画布已选中一个节点对）时，hover **同侧**另一个节点，系统实时计算两节点之间的间距并绘制蓝色标注：

**计算位置**：`ConsistencyView.hoverArkuiSpacingMarks / hoverDesignSpacingMarks`（computed）

```javascript
// 以开发侧为例
const selNode   = selectedPair.arkui                   // 已选中节点
const hoverId   = hoveredArkuiNodeId || hoveredArkuiCrossId  // hover 节点（含对侧联动）
const hoverNode = result.pairs.find(p => p.arkui.id === hoverId)?.arkui
               ?? allArkuiNodes.find(n => n.id === hoverId)
return computeSpacingMarks(selNode.rect, hoverNode.rect, null, null)
```

`computeSpacingMarks` 根据两个 rect 的包含/相邻关系计算间距区域：
- **包含关系**：计算上/下/左/右四向 padding，每个方向单独一条标注
- **水平相邻**：绘制两节点之间的横向间距
- **垂直相邻**：绘制两节点之间的纵向间距
- **重叠**（既不包含也非相邻）：不绘制

标注数值：设计侧用 `size`（原始 dp）显示，开发侧用 `rect`（vp）显示，保证单位与各侧坐标系一致。

传入 ImagePanel `:hover-highlight-pairs`，canvas 以**蓝色**绘制，区别于激活 diff 的橙红色间距标注。

---

## 7.7 调试模式节点树 → Canvas

`ReportPanel` 在 `debugMode` 下提供「节点树」Tab，展示 `NodeTree` 组件：

```
用户在 NodeTree 点击节点
  ↓ emit('select', nodeId)
ReportPanel → emit('design-node-click' / 'arkui-node-click', nodeId)
ConsistencyView.onDesignNodeClick / onArkuiNodeClick
  → selectedPair 更新
  → canvas 绘制节点红色实线高亮
```

设计侧节点支持「锁定」操作（`@toggle-lock` → `onToggleLock`）：锁定的节点在 canvas 上以红色虚线 + 🔒 图标标注，不参与点击命中（`lockedIds` 过滤）。

---

## 7.8 精准/模糊 Tab 切换对联动的影响

DiffReport 内部的「精准检查 / 模糊比对」Tab 仅控制 **可见 diff 集合**（`visibleDiffs` computed）：
- 精准：只展示 `confidence=high/medium` 的 diff
- 模糊：只展示 `confidence=low` 的 diff

Tab 切换后 `selectedIdx` 重置，`emit('select', null)` → `activeDiff = null`，但不清空 `selectedPair`（画布上的节点高亮保持）。`activeDiffKeys` / `hoverDiffKeys` 重新在新的 `filteredDiffs` 上计算，因此列表联动高亮也会随 Tab 切换自动刷新。

---

## 7.9 完整双向联动状态图

```
Canvas（ImagePanel）                        Report（ReportPanel / DiffReport）
─────────────────────────────────────────   ────────────────────────────────────────
点选节点 → selectedPair                 →  activePairForDiff → active-from-node 高亮
                                             + 自动滚动到第一个关联差异卡片
hover 节点 → hoveredArkuiNodeId         →  hoverPairForDiff  → hover-from-node 弱高亮
                                             ↕
对侧 externalHoveredId 联动 hover        ←  hoveredDiffPair（diff 卡片 hover 时）

                                         ←  点击差异卡片 → activeDiff + selectedPair
                                                → 节点红色选中高亮（非 spacing）
                                                → H 形橙红间距标注（spacing diff）
                                         ←  hover 差异卡片 → hoveredDiffPair
                                                → 两侧画布联动 hover 样式

hover 节点（selectedPair 存在）           →  （画布内）hoverSpacingMarks 蓝色实时间距标注

调试模式 NodeTree 点击                   →  selectedPair → 画布选中高亮
调试模式 NodeTree 锁定                   →  lockedIds → canvas 红色虚线 + 🔒
```

---

# 八、重新对比完整流程

> 描述"重新对比"按钮的触发条件、两条执行路径（局部对比 / 全量重跑）、存档时序，以及与画布/差异列表的状态联动。

---

## 8.1 触发入口与可用性控制

**唯一入口**：`ReportPanel` 右上角"重新对比"按钮

```javascript
// ReportPanel.vue
function handleRerun() {
  showHistoryPanel.value = false   // 历史面板若打开则关闭
  emit('rerun')
}
```

```
ReportPanel → emit('rerun')
  ↓
ConsistencyView @rerun="rerunCheck"
```

**`canRerun` 可用性 computed**（`ConsistencyView`）：

```javascript
const canRerun = computed(() => {
  const devOk    = !devReuploading.value    || !!devPreview.value
  const designOk = !designReuploading.value || !!designPreview.value
  return devOk && designOk && !rerunLoading.value
})
```

| 情形 | canRerun |
|---|---|
| 正常报告模式（两侧均未标记重上传） | ✅ true |
| 重上传中但新文件已解析完毕（`devPreview` 非空） | ✅ true |
| 重上传中且新文件尚未解析完（`devPreview` 为 null） | ❌ false |
| 正在执行重新对比（`rerunLoading=true`） | ❌ false |

---

## 8.2 分流：两条路径

`rerunCheck()` 首先通过 `devSwitchActive` 区分走哪条路径：

```javascript
async function rerunCheck() {
  if (devSwitchActive.value) {
    // 路径 A：Debugger 比对模式 → 局部对比
    reportPageRef.value?.runCompare()
    return
  }
  // 路径 B：正常模式 → 全量重跑
  ...
}
```

`devSwitchActive` 由 `ReportPage` 的 select 模式开关控制（`emit('dev-switch-change', bool)`），在 `ConsistencyView` 中同步存储。

---

## 8.3 路径 A：局部对比（select 模式）

仅在 `devSwitchActive=true` 时生效，执行前端本地对比，**不调用后端接口、不存档**。

**调用入口**：`reportPageRef.value.runCompare()`（通过 `defineExpose` 暴露）

**`runCompare()` 内部逻辑**（`ReportPage.vue`）：

```
isBatchMode（任一侧 ≥ 2 个节点）
  → runBoxCompare()：弹 ElMessageBox 提示（功能接入中）

单节点模式（两侧各 1 个节点）
  devNode    = currentDevNodes[0]     // 框选优先，否则取单击节点
  designNode = currentDesignNodes[0]
  ↓
  compareNodeStyles(designNode, devNode)  // 前端本地样式对比
  ↓
  diffs 格式化（补 designNodeId / arkuiNodeId / confidence='high'）
  ↓
  pendingDiffs.value = diffs        // → compareActive=true → canvas 遮罩激活
  emit('temp-diffs', diffs)
         ↓
  ConsistencyView.tempDiffs = diffs
         ↓ :temp-diffs="tempDiffs"
  ReportPanel → DiffReport :diffs="tempDiffs ?? result.diffs"
```

对比结果为**临时展示**：不覆盖算法产出的 `result.diffs`，`tempDiffs` 为 null 时自动回退。

**自动清除时机**：任何选择变化（点选、框选、点击空白）触发 `watch([localArkuiId, localDesignId, ...]) → clearCompare()`，`pendingDiffs = null`，`tempDiffs` 随之变 null。

---

## 8.4 路径 B：全量重跑（default 模式）

仅在 `devSwitchActive=false` 时生效，调用后端 `matchNodes` 接口重新执行节点匹配与样式比对。

**执行步骤**：

```
① 前置重置（清空当前高亮状态）
   activeDiff = null
   selectedPair = null
   lockedNodeIds = new Set()
   rerunLoading = true    → 触发 ReportPanel 上 loading 遮罩

② 调用后端接口
   matchNodes(
     result.allDesignNodes,   // 已解析的设计节点（若设计侧重上传则来自 devPreview）
     result.allArkuiNodes,    // 已解析的开发节点（若开发侧重上传则来自 devPreview）
     result.canvas,
     currentPlatform,
   )

③ 成功后更新 result（局部替换，保留 canvas/allNodes）
   result.value = {
     ...result.value,
     diffs:                matchResult.diffs,
     pairs:                matchResult.pairs,
     unmatchedDesignNodes: matchResult.unmatchedDesignNodes,
     unmatchedArkuiNodes:  matchResult.unmatchedArkuiNodes,
     stats:                matchResult.stats,
   }

④ 重置重上传标记
   devReuploading = false
   designReuploading = false

⑤ 存档（submitRerunVersion）
   见 8.5

⑥ 收尾
   rerunLoading = false    → loading 遮罩消失
   ElMessage.success('重新对比完成')
```

**与重上传结合**：若 `devReuploading=true` 且用户已上传新文件（`devPreview` 非空），后端会用新解析的节点重跑；若未上传新文件，则用 `result.allArkuiNodes` 原有数据重跑（相当于重新跑匹配算法，不换数据）。

---

## 8.5 存档流程（submitRerunVersion）

全量重跑成功后自动调用，将新结果写入 mock 数据库，不需要用户手动操作。

```
① 读取当前 uploadFiles（arkuiImage/designImage/arkuiJson/designJson）
   → fileToBase64 / fileToText（并行）

② 序列化 diffs 和 pairs
   buildProblems(result.value)
   → problems（diff 列表 JSON 序列化）
   → nodeMatchs（matchedPairIds JSON 序列化）

③ 调用 addConsistencyCheckPage()（追加新版本，不覆盖旧版本）
   入参：pageId / versionName（当前时间）/ 图片 base64 / JSON 文本 / problems / nodeMatchs

④ 更新版本列表
   getResultsByPageId(pageId) → pageVersionList = list
   workingVersionId = list[0].id

⑤ 注入 _problemId
   result.diffs 中尚无 _problemId 的项补写 `${arkuiNodeId}-${property}`
   （确保后续「非问题」标记操作能取到稳定 id）

⑥ 更新 URL 参数
   setUrlParams({ deliverableId, pageId, versionId })
```

存档失败只打 console.error，不影响页面展示（静默失败）。

---

## 8.6 状态变化总览

```
用户点击「重新对比」
  ↓
canRerun 检查（devPreview 就绪 且 非 loading）
  ↓
devSwitchActive?
  ├─ true（select 模式）
  │   ↓
  │   runCompare()
  │     ├─ 两侧各 1 个节点 → compareNodeStyles → pendingDiffs → tempDiffs
  │     │   → DiffReport 展示临时结果 + canvas 对比激活遮罩
  │     └─ 任一侧 > 1 个节点 → 弹提示（批量对比功能接入中）
  │
  └─ false（default 模式）
      ↓
      activeDiff/selectedPair/lockedNodeIds 清空 → canvas 高亮全清
      rerunLoading=true → ReportPanel loading 遮罩
      ↓
      matchNodes(...) → 后端重新匹配
      ↓ 成功
      result.diffs/pairs/stats 更新
        → DiffReport 刷新差异列表（全量）
        → canvas 选中态已清空，等待用户重新点选
      devReuploading/designReuploading = false → 画布恢复正常模式
      submitRerunVersion() → 存档 + 更新版本列表 + URL 参数
      rerunLoading=false → loading 遮罩消失
      ElMessage.success
```

---

## 六、关键文件索引

| 文件 | 核心职责 |
|---|---|
| `components/ImagePanel.vue` | canvas 绘制、点选框选事件、坐标转换、命中检测、对比激活遮罩 |
| `components/ReportPage.vue` | 两侧面板协调、模式开关、本地选择状态、`runCompare`、`pendingDiffs` |
| `ConsistencyView.vue` | 全局 `selectedPair` / `activeDiff`，事件路由，`tempDiffs` 中转，`rerunCheck` 分流 |
| `components/ReportPanel.vue` | 右侧差异面板，`tempDiffs ?? result.diffs` 切换展示 |
| `utils/tools.ts` | `isSelectableNode`、`resolveSelectableNode`、`isHiddenTextNode` |
| `components/DiffReport.vue` | 差异列表点选，emit `diff-select` 触发 `activeDiff` 联动 |
| `match/compareNodes.ts` | 前端本地节点样式对比，`runCompare` 单节点模式调用入口 |
