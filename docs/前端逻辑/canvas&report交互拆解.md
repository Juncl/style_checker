# 点选与框选交互逻辑

> 描述用户在图片对比面板（`ImagePanel.vue`）上点击节点（点选）、拖拽框选多节点（框选）的完整交互流程，以及事件如何向上传递、状态如何被管理。

---

## 一、整体设计

| 文件 | 相关函数/变量 |
|---|---|
| `ReportPage.vue` | `canvasMode`（Pinia）、`onCircleClick`、`onRectClick`、`clearSelectState`、`selectNodesStore`（Pinia，管理 `{devNodes, designNodes}`）、`devExtraOverride`/`designExtraOverride` |
| `stores/index.ts` | `useSelectNodesStore`（select 模式选中节点的统一存储：点选=单元素数组，框选=多元素数组；`isBatchMode`、`clearAll`） |
| `ImagePanel.vue` | `boxSelectMode`/`editMode` prop、`getCanvasCoords`、`hitNodesAt` |

### Float Bar 模式切换

| 文件 | 行号 | 说明 |
|---|---|---|
| `ReportPage.vue` | 90-123 | Float Bar 模板 |
| `stores/index.ts` | 16-29 | `useCanvasModeStore`（`mode` / `setMode`） |
| `ReportPage.vue` | 400-416 | `onCircleClick`/`onRectClick` 模式切换 |
| `ReportPage.vue` | 418-426 | 折叠按钮 |
| `ImagePanel.vue` | 161-163 | `boxSelectMode`/`editMode` prop 定义 |

底部居中的悬浮工具栏（`.dev-float-bar`，`ReportPage.vue`）提供两个功能按钮和一个折叠按钮，控制画布进入三种工作模式之一：

| 按钮 | 功能 |
|---|---|
| 圆形图标（edit） | 切换 `canvasMode.setMode('edit')`；再次点击回到 default；从 select 切入时自动清空 select 状态 |
| 矩形图标（select） | 切换 `canvasMode.setMode('select')` 并 `emit('dev-switch-change', true)`；再次点击回到 default 并清空选中状态 |
| 上/下箭头 | 折叠/展开 float bar |

三种模式通过 `canvasMode.mode`（`'default' | 'select' | 'edit'`）驱动，影响以下行为：

| 模式 | 点选效果 | 框选效果 | Inspector 面板 |
|---|---|---|---|
| **default** | 事件冒泡到 `ConsistencyView`，更新全局 `selectedPair`，高亮对应节点对 | 不开启 | 有 diff、间距模式或 debugMode 时显示 |
| **edit** | 同 default（事件冒泡，更新全局 `selectedPair`） | 不开启 | **始终显示**，出现铅笔图标按钮可添加人工对比属性 |
| **select** | 事件被 `ReportPage` 截获，写入 `selectNodesStore`（点选=单元素数组，框选=多元素数组），不冒泡；画布仅用本地状态绘制 | Ctrl/Cmd+单击：切换单体命中；拖拽：批量框选 | 显示被选中节点的属性（无 diff 高亮） |

Float bar 通过给两侧 `ImagePanel` 传入 `boxSelectMode`（select 时为 true）和 `editMode`（edit 时为 true）prop 来切换画布行为。select 模式额外通过 `emit('dev-switch-change', bool)` 通知父组件 `ConsistencyView`，以影响"重新对比"按钮的分流路径（`devSwitchActive` 控制走局部对比还是全量重跑）。

### 两侧面板

| 文件 | 行号 | 说明 |
|---|---|---|
| `stores/index.ts` | 147-171 | `useSelectNodesStore`：`devNodes`/`designNodes`、`setDevNodes`/`setDesignNodes`、`clearAll`、`isBatchMode` |
| `ReportPage.vue` | 347-352 | `currentDevNodes`/`currentDesignNodes`/`isBatchMode`（computed 透传 store） |
| `ReportPage.vue` | 428-471 | 点选/框选/空白点击处理函数 |
| `ReportPage.vue` | 394-398 | `clearSelectState` → `selectNodesStore.clearAll()` |

左侧（开发侧 ArkUI）和右侧（设计侧 Design）各有一个 `ImagePanel` 组件。select 模式下，点选和框选选中的节点统一写入 `selectNodesStore`（Pinia store），不再区分来源：

- **点选**：命中节点 → `selectNodesStore.setDevNodes([node])` / `setDesignNodes([node])`（单元素数组）
- **框选**：拖拽 ≥ 4px 开始绘框 → emit `box-select` → `selectNodesStore.setDevNodes(nodes)` / `setDesignNodes(nodes)`（多元素数组）
- **空白点击**：`selectNodesStore.clearDevNodes()` / `clearDesignNodes()`（清空对应侧）
- **退出 select 模式**：`clearSelectState()` → `selectNodesStore.clearAll()`（清空两侧）
- **批量对比**：`selectNodesStore.isBatchMode`（任一侧 ≥ 2 个节点时走 `runBoxCompare`）

---

## 二、default 模式

| 文件 | 相关函数/变量 |
|---|---|
| `ImagePanel.vue` | `getCanvasCoords`、`hitNodesAt`、`findHitNode`、`onCanvasClick`、`onCanvasDblClick`、`onMouseMove`、`onMouseLeave`、`hitTypePriority`、`isHiddenTextNode`、`draw`、`drawNodeRect`、`drawRelationHighlight`、`drawSpacingMark`、`drawHoverSpacingMark` |
| `tools.ts` | `resolveSelectableNode`、`isSelectableNode` |
| `ConsistencyView.vue` | `onDesignNodeClick`、`onArkuiNodeClick` |

### 2.1 点选流程

| 文件 | 行号 | 说明 |
|---|---|---|
| `ImagePanel.vue` | 336-344 | `getCanvasCoords` |
| `ImagePanel.vue` | 347-363 | `hitNodesAt` |
| `ImagePanel.vue` | 365-367 | `findHitNode` |
| `ImagePanel.vue` | 399-434 | `onCanvasClick` |

用户单击 canvas → `getCanvasCoords()` 将客户端坐标转为画布坐标 → `hitNodesAt()` 返回该坐标所有命中节点（排除 `visible=false`、`visualOccluded`、OCR 不可见文本、locked 节点），按类型优先级（文本优先）和面积升序排列 → `findHitNode()` 取首个最优命中。

若命中节点，`stopPropagation` 阻止事件冒泡，`emit('node-click', id)` 向上传递到 `ReportPage`。default 模式下 `ReportPage` 不做截获，直接 `emit('arkui-node-click' | 'design-node-click', id)` 继续冒泡到 `ConsistencyView`，更新全局 `selectedPair`。未命中则 `emit('bg-click')` → `clear-pair`，清空选中态。

### 2.2 命中检测（hitNodesAt）

| 文件 | 行号 | 说明 |
|---|---|---|
| `ImagePanel.vue` | 347-363 | `hitNodesAt` |
| `ImagePanel.vue` | 385-389 | `hitTypePriority` |
| `ImagePanel.vue` | 391-395 | `isHiddenTextNode` |

`hitNodesAt()` 逐节点检查 rect 碰撞并过滤以下不可交互节点：
- `visible === false`
- `isHiddenTextNode(n)`：type 为 'text' 且被遮挡（`visualOccluded`）或 OCR 标注不可见
- `visualOccluded` 非文本节点
- 无 rect 或 rect 无宽高
- `props.lockedIds` 包含该 id

过滤后按 `hitTypePriority`（文本 → 容器 → 其他）和面积升序排列。

### 2.3 节点可选性校验

| 文件 | 行号 | 说明 |
|---|---|---|
| `tools.ts` | 219-245 | `resolveSelectableNode` |
| `tools.ts` | 191-199 | `isSelectableNode` |
| `ConsistencyView.vue` | 1219-1243 | `onDesignNodeClick`/`onArkuiNodeClick` |

`ConsistencyView` 接收 `node-click` 事件后，先通过 `resolveSelectableNode` 将容器节点优化替换为其后代中最深、面积最小的匹配文本节点，再通过 `isSelectableNode` 做二次校验（排除 visible=false、frameworkText、ocrHidden、visualOccluded、宽高 ≤ 4px）。通过校验后查找该节点所属的匹配对，有则设置 `selectedPair = pair`，无则生成 `unmatched-dev` / `unmatched` 虚对。

### 2.4 双击下钻

| 文件 | 行号 | 说明 |
|---|---|---|
| `ImagePanel.vue` | 437-448 | `onCanvasDblClick` |

双击 canvas → `hitNodesAt()` 获取同坐标全部命中节点，在列表中循环选取下一层，用于多节点堆叠时逐层深入。

### 2.5 Hover 联动

| 文件 | 行号 | 说明 |
|---|---|---|
| `ImagePanel.vue` | 450-469 | `onMouseMove` |
| `ImagePanel.vue` | 471-478 | `onMouseLeave` |
| `ImagePanel.vue` | 153 | `externalHoveredId` prop |
| `ImagePanel.vue` | 456-461 | `compareActive` 时 hover 过滤 |

`onMouseMove` → `findHitNode()` → `emit('node-hover', id)`。鼠标离开时 emit null。对侧通过 `externalHoveredId` prop 接收联动 hover，以相同样式在对方画布上绘制。cursor 在命中节点时改为 `pointer`。`compareActive=true` 时，白色遮罩覆盖区域（选中范围外）不触发 hover。

### 2.6 Canvas 绘制

| 文件 | 行号 | 说明 |
|---|---|---|
| `ImagePanel.vue` | 629-782 | `draw` 主函数 |
| `ImagePanel.vue` | 784-793 | `drawNodeRect` |
| `ImagePanel.vue` | 795-819 | `drawRelationHighlight` |
| `ImagePanel.vue` | 837-914 | `drawSpacingMark`/`drawSpacingLabel` |
| `ImagePanel.vue` | 916-971 | `drawHoverSpacingMark` |
| `ImagePanel.vue` | 298-309 | `compareActive` watch |
| `ImagePanel.vue` | 767-779 | draw 中白色遮罩渲染 |

`draw()` 按顺序绘制，后绘覆盖先绘：锁定节点（红色虚线 + 锁标）→ hover 节点（红色虚线 + 浅红背景）→ 对侧联动 hover → 选中节点（红色实线 + 红色背景）→ Diff 关联高亮（橙色）→ Diff 间距标注（橙红色 H 形）→ Hover 实时间距标注（蓝色）→ 框选命中高亮 → 框选矩形 → 对比激活白色遮罩。

---

## 三、edit 模式（人工标注模式）

| 文件 | 相关函数/变量 |
|---|---|
| `ImagePanel.vue` | Inspector 模板/定位、`confirmExtra`、`cancelExtra`、`deleteRow`、`extra-change` |
| `overrideValidator.ts` | `validateOverrideInput`、`getInputPlaceholder`、`parseOverrideValue` |
| `ConsistencyView.vue` | `onSaveManualStyle`、`onRemoveManualStyle`、`upsertManualDiff`、`removeManualDiffByMatch`、`applyExtraOverride` |
| `compareNodes.ts` | `generateManualDiff` |
| `ReportPage.vue` | `devExtraOverride`/`designExtraOverride`、`getActiveOverrides` |
| `constants.ts` | `TEXT_STYLE_OPTIONS`、`CONTAINER_STYLE_OPTIONS` |

edit 模式由 float bar 的圆形按钮（edit）触发：点击一次通过 `canvasMode.setMode('edit')` 进入，再次点击回到 `'default'`。从 select 模式切入 edit 时会自动清空 select 状态。edit 模式下 `editMode=true` prop 传入 `ImagePanel`，点选行为与 default 一致（emit 冒泡到 `ConsistencyView`），但 Inspector 面板放宽显示条件、并开放人工标注入口。

### 3.1 Inspector 显示与属性展示

| 文件 | 行号 | 说明 |
|---|---|---|
| `ImagePanel.vue` | 19-130 | Inspector 模板 |
| `ImagePanel.vue` | 200-202 | `isSpacingInspector` computed |
| `ImagePanel.vue` | 1153-1195 | `displayStyle` computed |
| `ImagePanel.vue` | 999-1061 | `updateInspectorPos` |
| `ImagePanel.vue` | 1064-1096 | 拖拽 start/drag/end |
| `ImagePanel.vue` | 1098-1101 | `resetInspectorPosition` |

点选节点后，`ImagePanel` 在节点旁悬浮显示属性面板（`.node-inspector`），展示该节点的样式属性（字号、填充、圆角等），以及与对比结果的差异高亮。Inspector 支持拖拽自由定位，双击 header 复位到节点旁。

**显示条件**（满足任一即可）：
- 间距模式：`highlightPair.type === 'spacing'` 且 value 非 null
- 节点模式：`inspectorNode` 非 null，且 (`displayStyle` 非空 或 `debugMode` 开 或 **`editMode` 开**)

关键：`editMode=true` 时，即使节点无算法 diff、`displayStyle` 为空，Inspector 仍会显示。这是为确保用户始终可访问人工标注功能。

**属性展示**：`displayStyle` 遍历 `inspectorNode.style`，已保存的人工属性（`manualStyle`）也在 Inspector 中以只读行展示。`diff` 标记由 `styleDiffs` prop 驱动。select 模式下 `styleDiffs` 传入空数组，因此差异高亮不显示。

### 3.2 人工标注操作流程

| 文件 | 行号 | 说明 |
|---|---|---|
| `ImagePanel.vue` | 38-51 | 铅笔图标按钮 `.inspector-add-btn` |
| `ImagePanel.vue` | 1204-1207 | `showPendingRow`/`pendingKey`/`pendingValue`/`savedRows` 状态 |
| `ImagePanel.vue` | 1209-1216 | `extraRowOptions`/`allStyleOptions` computed |
| `overrideValidator.ts` | 47-109 | `validateOverrideInput` |
| `overrideValidator.ts` | 158-160 | `getInputPlaceholder` |
| `overrideValidator.ts` | 168-200 | `parseOverrideValue` |
| `ImagePanel.vue` | 1243-1262 | `confirmExtra` |
| `ImagePanel.vue` | 1264-1269 | `cancelExtra` |
| `ImagePanel.vue` | 1272-1275 | `deleteRow` |
| `ImagePanel.vue` | 1236-1240 | `extra-change` watch |

1. Inspector header 右侧出现铅笔图标按钮（仅 edit 模式显示；最多只允许一行待确认，已存在则按钮 disabled）
2. 点击铅笔图标 → 出现一行：下拉选择属性 + 输入期望值 + "确定"按钮
3. 输入时通过 `validateOverrideInput()` 实时校验格式（如颜色值合法性），格式错误时提示
4. 点击"确定" → 属性以原始值和解析值（`parseOverrideValue`）保存到 `savedRows`，通过 `emit('save-manual-style', { nodeId, key, parsedValue })` 冒泡到 `ConsistencyView`

   **同时**，pending 行的 watch 会实时 `emit('extra-change', { nodeId, key, value })` 给 `ReportPage`。`ReportPage` 将该值写入 `devExtraOverride` / `designExtraOverride` ref，供 select 模式单节点对比和全量重跑时注入人工覆盖。

5. `ConsistencyView.onSaveManualStyle()` 将值写入节点树的 `manualStyle` 字段，并自动生成/更新人工差异卡片（`_isManual=true`）。若该节点处于某匹配对中，通过 `generateManualDiff()` 生成双边 diff；否则生成单侧 diff（另一侧为"—"）
6. 已保存行旁有 × 删除按钮，点击后 `emit('remove-manual-style')` → `ConsistencyView.onRemoveManualStyle()` 重新计算该属性的两侧对比，若仍不一致则更新卡片，若一致则移除卡片

**下拉属性选项**（按节点类型区分）：

| 节点类型 | 可选属性 |
|---|---|
| `type === 'text'` | 字号、字重、颜色、字体、对齐、行高、字间距 |
| `type === 'container'` | 填充、不透明度、圆角、描边宽度、描边颜色、内边距、间距、阴影、模糊 |

**节点切换**：`watch(() => props.inspectorNode?.id)` 触发时自动清空 pending 行、从节点的 `manualStyle` 还原已保存行、emit `extra-change(null)` 清除当前覆盖。

### 3.3 Inspector 与 Diff 列表的实时联动

| 文件 | 行号 | 说明 |
|---|---|---|
| `ConsistencyView.vue` | 1033-1084 | `onSaveManualStyle` |
| `ConsistencyView.vue` | 1086-1112 | `onRemoveManualStyle` |
| `compareNodes.ts` | 361-386 | `generateManualDiff` |
| `ConsistencyView.vue` | 263-284 | `upsertManualDiff` |
| `ConsistencyView.vue` | 286-290 | `removeManualDiffByMatch` |
| `ConsistencyView.vue` | 292-323 | `mergedDiffs` computed |
| `ConsistencyView.vue` | 325-328 | watch `result.value` 清空 `manualDiffs` |

**关键前提**：Inspector 显示的属性条目全部来自节点自身的 `style` 对象（`displayStyle` 遍历 `inspectorNode.style`），diff 报告仅通过 `styleDiffs` prop 提供差异标记，不提供属性值。因此联动的前提是 `selectedPair` 中包含完整节点对象（含 `type`、`style`、`textContent`、`rect` 等），仅有 id 的空壳无法驱动 Inspector。

edit 模式下修改 Inspector 属性后，右侧差异列表实时同步更新，形成"标注 → 出卡 → 联动"的闭环：

**保存 → 生成差异卡片**：`confirmExtra()` 保存后 → `ConsistencyView.onSaveManualStyle()` 写入 `node.manualStyle`，再根据节点是否处于匹配对中走两条路径：

| 场景 | 生成方式 | diff 卡片内容 |
|---|---|---|
| 节点有匹配对 | `generateManualDiff(pair, key, platform)` 检测双侧 `manualStyle[key]` → `upsertManualDiff()` | 仅标注侧显示值，**未标注侧显示"—"**；双侧标注时做真实对比；两侧值相等则生成 `_isResolved=true` 卡片 |
| 节点无匹配对 | 直接构造单侧 diff → `upsertManualDiff()` | 修改侧显示值，对侧显示"—"，对侧 `nodeId` 为 null |

`upsertManualDiff` 以 `(property, designNodeId, arkuiNodeId)` 三元组去重（同组覆盖）。最终 `mergedDiffs` 将 `manualDiffs` 与算法 diff 合并：人工卡片同三元组时覆盖算法卡片，新增时追加。

**差异卡片 → 画布 + Inspector 联动**：点击人工差异卡片时，`onDiffSelect` 查找对应匹配对：
- **有匹配对的节点**：pair 查找命中 → `selectedPair` 获得双侧完整节点 → 两侧画布同时高亮，两侧 Inspector 分别展示对应节点属性
- **无匹配对的节点**：pair 未命中 → 从 `allDesignNodes` / `allArkuiNodes` 查找完整节点对象 → 仅修改侧画布高亮并展示 Inspector

人工卡片与算法卡片遵循完全相同的 §六 双向联动机制，无差别。

**删除 → 移除差异卡片**：`deleteRow()` 后 → `onRemoveManualStyle()` 删除 `manualStyle[key]`，重新调用 `generateManualDiff()` 判断两侧是否仍有差异。若一致则 `removeManualDiffByMatch()` 移除卡片；若仍有差异则更新卡片。

**数据复位**：`watch(() => result.value)` 触发时（加载新 case 或全量重跑完成）自动 `manualDiffs.value = []`，人工标注的 `manualStyle` 保留在节点树中但 diff 列表回归算法结果。

### 3.4 全量重跑中的 manualStyle 传递

| 文件 | 行号 | 说明 |
|---|---|---|
| `ReportPage.vue` | 699-704 | `getActiveOverrides` |
| `ConsistencyView.vue` | 1114-1123 | `applyExtraOverride` |
| `ConsistencyView.vue` | 1174-1217 | `rerunCheck` 中 default/edit 分支 |
| `ReportPage.vue` | 364-365 | `devExtraOverride`/`designExtraOverride` ref |

edit 模式下点击"重新对比"触发 `rerunCheck()`（default/edit 分支，非 select 分支）：
1. 从 `reportPageRef.getActiveOverrides()` 读取 Inspector 中当前 pending 行的覆盖值
2. 通过 `applyExtraOverride()` patch 到 `allDesignNodes` / `allArkuiNodes` 的副本上
3. 节点树上已保存的 `manualStyle` 字段随节点副本一同传入后端 `matchNodes()`
4. 后端匹配算法读取 `manualStyle` 覆盖节点样式后重新计算 diff

因此人工标注参与全量重跑有两条数据通道：已保存的 `manualStyle` 存在于节点树中（持久）、pending 行通过 `getActiveOverrides` 读取（临时）。

---

## 四、select 模式（选择比对模式）

| 文件 | 相关函数/变量 |
|---|---|---|
| `ReportPage.vue` | `onDevNodeClick`、`onDesignNodeClickLocal`、`onDevBgClick`、`onDesignBgClick`、`onDevBoxSelect`、`onDesignBoxSelect`、`runCompare`、`runBoxCompare`、`clearCompare`、`clearSelectState`、`selectBranchMode`、`effectiveDevSelectedId` 等 |
| `stores/index.ts` | `useSelectNodesStore`（`devNodes`/`designNodes`、`isBatchMode`、`clearAll`） |
| `ImagePanel.vue` | `onBoxStart`、`onBoxMove`、`onBoxEnd`、`finishBox`、`canHoverInSel`、`rectsIntersect` |
| `ConsistencyView.vue` | `mergeTempToResult` |
| `compareNodes.ts` | `compareNodeStyles` |
| `normalizeSelection.ts` | `normalizeSelection` |

select 模式由 float bar 的矩形按钮（select）触发：点击一次通过 `canvasMode.setMode('select')` 进入，并 `emit('dev-switch-change', true)` 通知父组件；再次点击回到 `'default'` 并清空选中状态。

select 模式下，`ReportPage` 截获 `node-click` 和 `bg-click` 事件，只更新 `selectNodesStore`（不再由局部 ref 管理），不再向上冒泡给 `ConsistencyView`。这使得用户可以在不影响全局选中状态的前提下自由选点，用于后续局部对比。

### 4.1 点选

| 文件 | 行号 | 说明 |
|---|---|---|
| `ReportPage.vue` | 436-443 | `onDevNodeClick` |
| `ReportPage.vue` | 445-452 | `onDesignNodeClickLocal` |
| `ReportPage.vue` | 456-463 | `onDevBgClick` |
| `ReportPage.vue` | 464-471 | `onDesignBgClick` |

select 模式下单击 canvas：
- 命中节点 → `ReportPage.onDevNodeClick(id)` / `onDesignNodeClickLocal(id)` 截获事件，从 `props.allArkuiNodes` / `allDesignNodes` 查找完整节点对象，调用 `selectNodesStore.setDevNodes([node])` / `setDesignNodes([node])`，不 emit 给 `ConsistencyView`
- 未命中 → `ReportPage.onDevBgClick()` / `onDesignBgClick()` 截获，调用 `selectNodesStore.clearDevNodes()` / `clearDesignNodes()`
- 注意：点选和框选均写入同一 `selectNodesStore`，不再存在"框选未清空导致点选被覆盖"的问题

由于不更新全局 `selectedPair`，点选不会触发全量 diff 列表联动和画布红色实线高亮（select 模式下 `boxSelectMode=true`、`selectedId` 和 `inspectorNode` 使用本地状态，画布仅显示框选命中高亮或 click 命中的单节点选中高亮）。

### 4.2 框选

| 文件 | 行号 | 说明 |
|---|---|---|
| `ImagePanel.vue` | 487-501 | `onBoxStart` |
| `ImagePanel.vue` | 503-531 | `onBoxMove` |
| `ImagePanel.vue` | 533-551 | `onBoxEnd`/`finishBox` |
| `ImagePanel.vue` | 370-383 | `canHoverInSel` |
| `ImagePanel.vue` | 482-485 | `rectsIntersect` |
| `ReportPage.vue` | 428-432 | `onDevBoxSelect`/`onDesignBoxSelect` |

select 模式下在 canvas 上按住鼠标左键拖拽：
- **拖拽 < 4px**：视为抖动容差，不触发任何框选行为，松手后按普通单击处理
- **拖拽 ≥ 4px**：开始绘框（蓝色虚线 + 浅蓝半透明填充），实时 AABB 碰撞检测。命中判定通过 `canHoverInSel` 验证（框内至少有一个点可 hover 到该节点），全屏包裹节点（rect 接近 canvas 尺寸）自动排除。同时设置 `suppressClick=true`，阻止松手时的 click 事件
- **松手（结束拖拽）**：`emit('box-select', nodes[])`，框选高亮保持直到下次单击清空。若在框选过程中鼠标移出 `wrapper` 边界，自动结束框选

`boxSelectMode=true`（由 `canvasMode.mode === 'select'` 驱动）时启用鼠标左键拖拽框选，分三个阶段：
1. **开始拖拽**：`onBoxStart` 记录起始坐标和鼠标位置，清空上次框选高亮
2. **拖拽中**：`onBoxMove` 超过 4px 后开始绘框，实时 AABB 碰撞检测
3. **结束拖拽**：`onBoxEnd` → `emit('box-select', nodes[])`，框选高亮保持直到下次单击清空

同时支持 **Ctrl/Cmd+单击**在已有框选集合中增删单节点（通过 `emit('box-select', updatedNodes)` 更新 `selectNodesStore`，不经过 `onDevNodeClick`/`onDesignNodeClickLocal`）。

**注意**：设计侧 locked 节点在 `hitNodesAt` 阶段被过滤，因此 `canHoverInSel` 判定时无法命中，locked 节点**不会被框选选中**。

### 4.3 重新对比

| 文件 | 行号 | 说明 |
|---|---|---|
| `ReportPage.vue` | 473-527 | `runCompare` 单节点模式 |
| `ReportPage.vue` | 529-600 | `runBoxCompare` 批量模式 |
| `compareNodes.ts` | 219-253 | `compareNodeStyles` |
| `normalizeSelection.ts` | 全文件 | `normalizeSelection` |
| `ReportPage.vue` | 343-345 | `devExtraOverride`/`designExtraOverride` ref |
| `ReportPage.vue` | 340-341 | `pendingDiffs` ref / `compareActive` computed |

select 模式下点击"重新对比"按钮 → `ConsistencyView.rerunCheck()` 检测到 `devSwitchActive=true` → 调用 `reportPageRef.runCompare()`，不走全量算法重跑。

`runCompare()` 分两条子路径：

**单节点模式**（两侧各 1 个节点）：
1. 从 `devExtraOverride` / `designExtraOverride` 读取 Inspector 中 pending 行的人工覆盖值
2. 调用 `compareNodeStyles(designNode, devNode, overrides)` 前端本地对比
3. 结果存入 `pendingDiffs`（临时），通过 `emit('temp-diffs', diffs)` 传入父组件 `ConsistencyView`
4. `ConsistencyView` 以 `tempDiffs` 覆盖传给 `ReportPanel`，优先展示临时结果
5. 同时 `compareActive=true`，canvas 在选中区外绘制白色遮罩，突出对比区域

**批量模式**（任一侧 ≥ 2 个节点）：
1. 调用 `normalizeSelection()` 归一化选中节点的 rect
2. 调用后端 `matchNodes(designNodes, devNodes, canvas, platform, 'part')` API 做局部匹配+比对
3. 结果同样通过 `pendingDiffs` / `tempDiffs` 临时展示

### 4.4 状态清理

| 文件 | 行号 | 说明 |
|---|---|---|
| `ReportPage.vue` | 389-392 | `clearCompare` |
| `ReportPage.vue` | 394-398 | `clearSelectState` |

temp 状态不随选择变化自动清除。清除只通过以下方式：

- **点击画布空白区域**：`onDevBgClick()` / `onDesignBgClick()` → `selectNodesStore.clearDevNodes()` / `clearDesignNodes()` +（若 tempPairs 分支）`clearCompare()` + `emit('clear-pair')`
- **退出 select 模式**：`clearSelectState()` → `selectNodesStore.clearAll()` + `clearCompare()`
- **「添加到分析结果」按钮**：`mergeTempToResult()` → 合并 temp-diffs/temp-pairs 到正式结果 → 清除 temp

### 4.5 「添加到分析结果」合并逻辑

| 文件 | 行号 | 说明 |
|---|---|---|
| `ConsistencyView.vue` | 1126-1172 | `mergeTempToResult` |

点击按钮触发 `mergeTempToResult()`：

1. **diffs 合并**：以 temp 涉及的任一侧节点 id 为键，删除正式 diff 中对应的全部条目，用 temp 替换
2. **pairs 合并（双向覆盖去交集）**：
   - 先遍历 arkui 侧覆盖：`arkuiMap[id] = pair`
   - 再遍历 design 侧覆盖：`designMap[id] = pair`
   - 取交集：只保留同时出现在两侧且 design-arkui 对应一致的 pair
3. 合并完成后清空 `tempDiffs` / `tempPairs` / `pendingDiffs`，回到 select-select
4. 存储按钮检测到 diffs 中有 `_isManual` 标记后自动解禁

### 4.6 temp-diff 双向联动

| 文件 | 行号 | 说明 |
|---|---|---|
| `ReportPage.vue` | 373-377 | `selectBranchMode` computed |
| `ReportPage.vue` | 382-387 | `effectiveDevSelectedId`/`effectiveDevInspectorNode`/`effectiveDevStyleDiffs` 及 design 侧 |
| `ConsistencyView.vue` | 240-241 | `tempDiffs`/`tempPairs` ref |
| `ConsistencyView.vue` | 243 | `effectivePairs` computed |

select 模式下重新对比后产生 temp 状态（`pendingDiffs` 非 null），此时画布和报告需要与正式 diff 保持一致的联动行为。

#### 核心机制：temp 激活时画布切换为 selectedPair 驱动

通过 `selectBranchMode` computed 判断当前所处分支（`'select-select'` | `'select-tempPairs'`）。tempPairs 分支时：

- **画布 selectedId / inspectorNode / styleDiffs**：不再使用本地状态，改为使用 `selectedPair` 驱动，与 default/edit 模式一致
- **节点点击**：同时写入 `selectNodesStore` + emit 到 `ConsistencyView`（更新 `selectedPair`，驱动 diff 列表高亮和 Inspector 展示）
- **画布空白点击**：清空 `selectNodesStore` + `clearCompare()` + emit `clear-pair`（清除 temp 状态）
- **diff 卡片点击**：`onDiffSelect` 中 `tempPairs` 非空时只在 tempPairs 中查找匹配对 → 更新 `selectedPair` → 画布高亮 + Inspector 显示

#### 数据传递路径

```
ReportPage.runCompare()
  ├─ emit('temp-diffs', diffs)    // diff 列表展示
  └─ emit('temp-pairs', tempPairs) // diff 卡片点击时查找匹配对
         ↓
ConsistencyView
  ├─ tempDiffs → mergedDiffs → DiffReport 展示
  ├─ tempPairs → onDiffSelect 优先查找
  └─ onDiffSelect:
       tempPairs 非空 → 仅在 tempPairs 查找（命中联动，未命中忽略）
       tempPairs 为空 → 走正式 pairs 查找
         ↓
ImagePanel
  └─ effectiveDevSelectedId / effectiveDevInspectorNode / effectiveDevStyleDiffs
      → temp 激活时使用 selectedPair（来自 diff 点击或画布点选的 emit）
```

#### select 模式下的两种分支对比

| 维度 | 分支1：纯 select（无 temp） | 分支2：temp 激活（已重新对比） |
|---|---|---|
| **触发条件** | 进入 select 模式，未点击"重新对比" | 重新对比完成后 `pendingDiffs !== null` |
| **canvas 驱动源** | `selectNodesStore`（`devNodes[0]?.id` / `designNodes[0]?.id`） | `selectedPair`（同 default/edit） |
| **节点点击** | 写入 `selectNodesStore`，不冒泡 | 写入 `selectNodesStore` + emit 到 ConsistencyView → 更新 `selectedPair` |
| **画布红色高亮** | `selectNodesStore` 对应节点 | `selectedPair` 对应节点 |
| **Inspector 显示** | 本地节点属性，无 diff 高亮 | `selectedPair` 节点属性 + diff 高亮 |
| **Inspector 覆盖** | 不支持（无 `editMode`，无铅笔图标按钮） | 不支持（无 `editMode`） |
| **画布空白点击** | 清空 `selectNodesStore` 对应侧 | 清空 `selectNodesStore` 对应侧 + `clearCompare()` + `emit('clear-pair')`（清除 temp） |
| **框选** | 正常拖拽框选 | 正常拖拽框选 |
| **diff 卡片点击** | —（无 tempDiffs） | 在 `tempPairs` 中查找 → `selectedPair` → 画布高亮 + Inspector |
| **画布 → diff 列表** | 不联动（事件截获） | 联动（emit 冒泡 → `activePairForDiff`） |
| **diff 列表 → 画布** | — | 联动（tempPairs → selectedPair → canvas） |

---

## 五、整体状态流转图

| 文件 | 相关函数/变量 |
|---|---|
| `ImagePanel.vue` | `onCanvasClick`、`onCanvasDblClick`、`onBoxEnd`、`onMouseMove`、`extra-change`、`confirmExtra`、`deleteRow`、`draw` |
| `ReportPage.vue` | `onDevNodeClick`、`clearCompare`、`clearSelectState`、各种 emit 转发与截获 |
| `ConsistencyView.vue` | `onArkuiNodeClick`、`onDiffSelect`、`onSaveManualStyle`、`onRemoveManualStyle`、`rerunCheck`、`selectedPair` |
| `ReportPanel.vue` | `DiffReport` 传 `mergedDiffs` |
| `DiffReport.vue` | `filteredDiffs`、`selectItem` |

```
用户交互（鼠标事件）
         ↓
  ImagePanel（canvas 绘制层）
         ├─ 单击 → emit('node-click', id)
         ├─ 双击 → 下钻循环，emit('node-click', nextId)
         ├─ 拖拽 → emit('box-select', nodes[])
         ├─ Hover → emit('node-hover', id | null)
         ├─ 空白点击 → emit('bg-click')
         ├─ edit 模式 pending 行变化 → emit('extra-change')
         └─ edit 模式铅笔图标→确认/删除 → emit('save-manual-style' / 'remove-manual-style')
         ↓
  ReportPage（两侧面板协调 + float bar 模式开关）
         ├─ default 模式
         │  ├─ 点选 → emit('arkui-node-click' | 'design-node-click', id)
         │  └─ 空白 → emit('clear-pair')
         ├─ select 模式
         │  ├─ 点选 → 截获，写入 selectNodesStore（devNodes/designNodes）
         │  ├─ 框选 → 写入 selectNodesStore（devNodes/designNodes）
         │  ├─ 空白 → 清空 selectNodesStore 对应侧
         │  └─ 退出 select → clearSelectState() → selectNodesStore.clearAll()
         └─ edit 模式
            ├─ 点选 → 同 default，emit 冒泡
            ├─ extra-change → 写入 devExtraOverride / designExtraOverride
            └─ save-manual-style / remove-manual-style → 冒泡到 ConsistencyView
         ↓（default/edit 模式继续传递）
  ConsistencyView（全局状态管理）
         ├─ onArkuiNodeClick / onDesignNodeClick
         │  └─ resolveSelectableNode + isSelectableNode 过滤
         │     → selectedPair = pair | unmatched
         ├─ onDiffSelect(diff) → activeDiff + selectedPair
         ├─ clear-pair → selectedPair = null
         ├─ Hover → hoveredArkuiNodeId / hoveredDesignNodeId
         ├─ temp-diffs → 中转给 ReportPanel
         ├─ save-manual-style → 写入 manualStyle + 生成人工 diff
         ├─ remove-manual-style → 移除 manualStyle + 删除人工 diff
         └─ rerun
              ├─ select 模式 → reportPageRef.runCompare()（局部对比）
              └─ default/edit 模式 → 全量重跑（含 manualStyle 覆盖）
         ↓
  ImagePanel 接收 props 重新绘制
         ├─ selectedId → 红色实线高亮
         ├─ compareActive → 白色遮罩高亮选中区
         ├─ externalHoveredId → 对侧 hover 联动高亮
         └─ highlightPair / hoverHighlightPairs → 间距/关联标注

  ReportPanel（右侧差异面板）
         └─ DiffReport :diffs="mergedDiffs"
              ├─ tempDiffs 非 null → 展示临时对比结果（含 tempDiffAction 按钮）
              └─ tempDiffs 为 null → 回退全量算法结果
```

---

# 六、Canvas 与 Report 双向联动

> 描述右侧 `ReportPanel`（差异列表）与左侧 `ImagePanel`（画布）之间的完整双向联动机制。

| 文件 | 相关函数/变量 |
|---|---|
| `ConsistencyView.vue` | `activePairForDiff`、`hoverPairForDiff`、`hoveredDiffPair`、`onDiffSelect`、`computeSpacingMarks`、`onArkuiHover`、`onDesignHover` |
| `DiffReport.vue` | `isDiffMatchPair`、`activeDiffKeys`、`hoverDiffKeys`、`selectItem`、scroll-to-first、`matchMode` |
| `ReportPage.vue` | `buildSpacingMark` |
| `ImagePanel.vue` | `drawHoverSpacingMark`、`externalHoveredId` watch |
| `NodeTree.vue` | emit `select`/`toggle-lock` |

---

## 6.1 Canvas → Report：节点选中驱动差异列表高亮

| 文件 | 行号 | 说明 |
|---|---|---|
| `ConsistencyView.vue` | 384-390 | `activePairForDiff` computed |
| `DiffReport.vue` | 290-296 | `isDiffMatchPair` |
| `DiffReport.vue` | 298-305 | `activeDiffKeys` computed |
| `DiffReport.vue` | 318-340 | watch `activePair` → scroll-to-first |
| `DiffReport.vue` | 76 | 模板 `active-from-node` class |

用户点选画布节点 → `selectedPair` 更新 → `activePairForDiff` 计算 → 传入 `DiffReport`，遍历差异列表匹配 `arkuiNodeId` 或 `designNodeId` 任一命中的 diff，添加"active-from-node"高亮样式。同时自动滚动到第一个关联差异卡片（若由右侧卡片自身点击触发则跳过滚动，防抖动）。`spacing.` 类 diff 不参与节点匹配。

## 6.2 Canvas → Report：Hover 驱动差异列表弱高亮

| 文件 | 行号 | 说明 |
|---|---|---|
| `ConsistencyView.vue` | 392-398 | `hoverPairForDiff` computed |
| `DiffReport.vue` | 307-314 | `hoverDiffKeys` computed |
| `DiffReport.vue` | 78 | 模板 `hover-from-node` class |
| `ConsistencyView.vue` | 400-412 | `hoveredDiffPair` 覆盖逻辑 |

用户 hover 画布节点 → `hoverPairForDiff` 计算 → 传入 `DiffReport`，命中的 diff 添加"hover-from-node"弱高亮（优先级低于 active-from-node）。若同时有 `hoveredDiffPair`（来自 Report 侧 hover），后者优先级更高。

## 6.3 Report → Canvas：点击差异卡片驱动画布高亮

| 文件 | 行号 | 说明 |
|---|---|---|
| `DiffReport.vue` | 369-378 | `selectItem` |
| `ConsistencyView.vue` | 1619-1645 | `onDiffSelect` |
| `ConsistencyView.vue` | 1623 | spacing diff 特殊处理 |
| `ReportPage.vue` | 636-672 | `buildSpacingMark` |

用户点击差异卡片 → `activeDiff` 更新 + `selectedPair` 更新 → canvas 绘制节点红色实线高亮。间距类 diff 特殊处理：不更新 `selectedPair`，而是通过 `buildSpacingMark` 计算 `spaceRect`，在画布上绘制 H 形橙红色间距标注。再次点击取消选中。

## 6.4 Report → Canvas：Hover 差异卡片驱动画布联动 Hover

| 文件 | 行号 | 说明 |
|---|---|---|
| `ConsistencyView.vue` | 382 | `hoveredDiffPair` ref |
| `ConsistencyView.vue` | 164 | 模板 `@diff-hover` 绑定 |
| `DiffReport.vue` | 81 | spacing diff 不触发 hover |
| `ImagePanel.vue` | 153 | `externalHoveredId` prop |
| `ImagePanel.vue` | 297 | watch `externalHoveredId` |

鼠标悬浮差异卡片（非 spacing diff）→ `hoveredDiffPair` 更新 → 两侧画布通过 `externalHoveredId` 同时绘制对应节点的 hover 样式。鼠标离开卡片时联动消失。

## 6.5 对侧联动 Hover（Cross-side Hover）

| 文件 | 行号 | 说明 |
|---|---|---|
| `ConsistencyView.vue` | 400-412 | `hoveredDesignCrossId`/`hoveredArkuiCrossId` computed |
| `ConsistencyView.vue` | 414-421 | `onArkuiHover`/`onDesignHover` |
| `ConsistencyView.vue` | 106-109 | 模板绑定 |

用户 hover 一侧画布节点 → 系统根据匹配对查找对侧对应节点 id → 通过 `externalHoveredId` 传入对侧 `ImagePanel`，实现对侧联动高亮。两侧 hover 互斥，同一时刻只有一侧驱动。

## 6.6 Hover 实时间距标注

| 文件 | 行号 | 说明 |
|---|---|---|
| `ConsistencyView.vue` | 436-496 | `computeSpacingMarks` |
| `ConsistencyView.vue` | 498-506 | `hoverArkuiSpacingMarks` computed |
| `ConsistencyView.vue` | 509-518 | `hoverDesignSpacingMarks` computed |
| `ImagePanel.vue` | 916-971 | `drawHoverSpacingMark` |

当 `selectedPair` 非空时，hover 同侧另一个节点，系统实时计算两节点间距并绘制蓝色标注。`computeSpacingMarks` 根据 rect 的包含/相邻关系计算四向间距，以设计侧 `size`（原始 dp）或开发侧 `rect`（vp）标注数值。

## 6.7 调试模式节点树 → Canvas

| 文件 | 行号 | 说明 |
|---|---|---|
| `NodeTree.vue` | 121 | emit `select`/`toggle-lock` |
| `ConsistencyView.vue` | — | `onToggleLock` → `lockedNodeIds` |
| `ImagePanel.vue` | 693 | 锁定节点红色虚线+锁标绘制 |
| `ImagePanel.vue` | 354 | `hitNodesAt` 中 `lockedIds` 过滤 |

`ReportPanel` 的「节点树」Tab 中点击节点 → `selectedPair` 更新 → canvas 高亮。设计侧节点支持「锁定」（红色虚线 + 🔒），锁定节点不参与点击命中。

## 6.8 精准/模糊 Tab 对联动的影响

| 文件 | 行号 | 说明 |
|---|---|---|
| `DiffReport.vue` | 211 | `matchMode` ref |
| `DiffReport.vue` | 241-249 | `visibleDiffs` computed |
| `DiffReport.vue` | 263-286 | `filteredDiffs` computed |
| `DiffReport.vue` | 342-349 | watch `matchMode` → 清空选中+更新滑块 |

DiffReport 的「精准检查 / 模糊比对」Tab 仅控制可见 diff 集合，切换后 `activeDiff` 清空但 `selectedPair` 保持，联动高亮随新集合自动刷新。

---

# 七、重新对比完整流程

> 描述"重新对比"按钮的触发条件、两条执行路径、存档时序，以及与画布/差异列表的状态联动。

| 文件 | 相关函数/变量 |
|---|---|
| `ConsistencyView.vue` | `rerunCheck`、`submitRerunVersion`、`onSave`、`loadHistoryVersion`、`preprocessVersion`、`nodeManualAttr`、`canRerun` |
| `ReportPage.vue` | `runCompare`、`runBoxCompare` |
| `ReportPanel.vue` | `handleRerun`、`handleSave` |
| `tools.ts` | `buildProblems` |

---

## 7.1 触发入口

| 文件 | 行号 | 说明 |
|---|---|---|
| `ReportPanel.vue` | 19-24 | rerun 按钮模板 |
| `ReportPanel.vue` | 170-173 | `handleRerun` |
| `ConsistencyView.vue` | 423-427 | `canRerun` computed |

`ReportPanel` 右上角"重新对比"按钮 → `emit('rerun')` → `ConsistencyView.rerunCheck()`。按钮可用性由 `canRerun` computed 控制（两侧重上传状态就绪且非 loading 态）。

## 7.2 路径 A：局部对比（select 模式）

| 文件 | 行号 | 说明 |
|---|---|---|
| `ConsistencyView.vue` | 1174-1177 | `rerunCheck` 中 select 分支 |
| `ReportPage.vue` | 503-559 | `runCompare` |
| `ReportPage.vue` | 561-604 | `runBoxCompare` |
| `compareNodes.ts` | 219-253 | `compareNodeStyles` |

仅在 `devSwitchActive=true` 时生效，不调用后端接口、不存档。`reportPageRef.runCompare()` 分为两条子路径：单节点模式走 `compareNodeStyles()` 前端本地对比，结果通过 `tempDiffs` 临时展示；批量模式走 `matchNodes()` API。选择变化自动清空临时结果。

## 7.3 路径 B：全量重跑（default / edit 模式）

| 文件 | 行号 | 说明 |
|---|---|---|
| `ConsistencyView.vue` | 1178-1217 | `rerunCheck` 中 default/edit 分支 |
| `ReportPage.vue` | 699-704 | `getActiveOverrides` |
| `ConsistencyView.vue` | 1114-1123 | `applyExtraOverride` |

仅在 `devSwitchActive=false` 时生效。流程：清空高亮状态 → 读取 Inspector 中 pending 行的覆盖值（`getActiveOverrides()`）→ patch 到节点副本 → 节点树上已保存的 `manualStyle` 随副本一同传入后端 `matchNodes()` → 更新 `result.diffs/pairs/stats` → 存档（`submitRerunVersion`）→ 更新版本列表和 URL 参数。

## 7.4 存档流程

| 文件 | 行号 | 说明 |
|---|---|---|
| `ConsistencyView.vue` | 923-970 | `submitRerunVersion` |
| `tools.ts` | 69-92 | `buildProblems` |

全量重跑成功后自动存档：序列化 diffs/pairs → 调用 mock API 追加新版本（不覆盖旧版本）→ 更新版本列表 → 注入 `_problemId` → 更新 URL 参数。存档失败静默处理。

## 7.5 人工标注的独立存储与消费

| 文件 | 行号 | 说明 |
|---|---|---|
| `ConsistencyView.vue` | 973-1018 | `onSave` |
| `ConsistencyView.vue` | 247-261 | `nodeManualAttr` computed |
| `ConsistencyView.vue` | 344-367 | `preprocessVersion` |
| `ConsistencyView.vue` | 1311-1415 | `loadHistoryVersion` |

edit 模式下用户对节点新增的人工属性（`manualStyle`），通过 ReportPanel 的「存储」按钮独立存档，无需重跑算法。存储后的数据在历史版本加载时自动回显到节点 Inspector 中。

### 7.5.1 存储按钮出现条件

| 文件 | 行号 | 说明 |
|---|---|---|
| `ConsistencyView.vue` | 162 | 模板 `:has-manual-edits="manualDiffs.length > 0"` |
| `ReportPanel.vue` | 132 | `hasManualEdits` prop |
| `ConsistencyView.vue` | 325-328 | watch `result.value` 清空 `manualDiffs` |

```
hasManualEdits = manualDiffs.length > 0
```

- 用户在 edit 模式下新增人工属性并点"确定"确认 → `onSaveManualStyle()` 写入 `node.manualStyle` 并调用 `upsertManualDiff()` 生成人工差异卡片 → `manualDiffs` 长度 > 0 → 存储按钮显示
- 点击存储成功后 `manualDiffs.value = []` → 按钮自动隐藏
- 刷新页面或加载历史版本后 `manualDiffs` 被 `watch(() => result.value)` 清空 → 按钮隐藏，直到用户再次新增人工标注

### 7.5.2 存储数据流

| 文件 | 行号 | 说明 |
|---|---|---|
| `ConsistencyView.vue` | 973-1018 | `onSave` |
| `tools.ts` | 69-92 | `buildProblems` |
| `ConsistencyView.vue` | 247-261 | `nodeManualAttr` computed |

```
ReportPanel handleSave() → emit('save')
  → ConsistencyView.onSave()
    → nodeManualAttr (computed) 从节点树收集 manualStyle
        结构: { dev: { nodeId: { key: val } }, design: { nodeId: { key: val } } }
    → buildProblems(result, { diffs: mergedDiffs, nodeManualAttr })
      → nodeMatchs = JSON.stringify({
          matchedPairIds: [[arkuiId, designId], ...],
          nodeManualAttr: { dev: {...}, design: {...} }
        })
      → problems = mergedDiffs 序列化（含人工 diff 卡片）
    → addConsistencyCheckPage({ id: pageId, problems, nodeMatchs, ... })
      → 追加新版本到后端
    → 刷新版本列表 + 更新 URL versionId
    → manualDiffs.value = []（隐藏存储按钮）
```

关键点：
- `nodeManualAttr` 内嵌在 `nodeMatchs` JSON 字符串中，与 `matchedPairIds` 同级
- `problems` 使用 `mergedDiffs`（算法 diff + 人工 diff 合并），而非纯算法 diff
- 与"重新对比"的区别：存储不调用后端算法、不重跑匹配，仅序列化当前前端状态

### 7.5.3 消费端回显

| 文件 | 行号 | 说明 |
|---|---|---|
| `ConsistencyView.vue` | 1311-1415 | `loadHistoryVersion` |
| `ConsistencyView.vue` | 344-367 | `preprocessVersion` |
| `ConsistencyView.vue` | 1386-1394 | 回写 `manualStyle` |

版本加载时自动还原人工标注到节点：

```
历史版本加载 (onHistoryView / URL 参数加载)
  → loadHistoryVersion(rawVersion, deviceType)
    → preprocessVersion(v)
      → 解析 v.nodeMatchs → 提取 matchedPairIds + nodeManualAttr
      → 挂到 v._matchedPairIds 和 v._nodeManualAttr
    → parseDevUpload / parseDesignUpload → 生成 _allArkui / _allDesign 节点数组
    → 回写人工标注:
        for (const n of _allArkui) {
          if (dev[n.id]) n.manualStyle = { ...dev[n.id] }
        }
        for (const n of _allDesign) {
          if (design[n.id]) n.manualStyle = { ...design[n.id] }
        }
    → result.value = { allArkuiNodes: _allArkui, allDesignNodes: _allDesign, ... }
      → nodeManualAttr (computed) 自动反映已还原的 manualStyle
      → Inspector 展示已保存的人工属性
```

关键点：
- 回写发生在 `result.value` 赋值之前，确保节点进入响应式系统时已携带 `manualStyle`
- 旧版本（无 `nodeManualAttr` 字段）不受影响，`_nodeManualAttr` 为 `null`，回写逻辑跳过
- 加载后 `manualDiffs` 被 `watch(() => result.value)` 清空，存储按钮隐藏，但节点 Inspector 中仍显示已保存的人工属性行

---

## 八、关键文件索引

| 文件 | 核心职责 | 关键行/函数 |
|---|---|---|
| `components/ImagePanel.vue` | canvas 绘制、点选框选事件、坐标转换、命中检测、对比激活遮罩、edit 模式人工属性编辑 UI | `getCanvasCoords:L336-344`, `hitNodesAt:L347-363`, `findHitNode:L365-367`, `isHiddenTextNode:L391-395`, `onCanvasClick:L399-434`, `onCanvasDblClick:L437-448`, `onMouseMove:L450-469`, `onBoxStart:L487-501`, `onBoxMove:L503-531`, `onBoxEnd:L533-535`, `draw:L629-782`, `confirmExtra:L1243-1262` |
| `components/ReportPage.vue` | 两侧面板协调、float bar 模式开关、select 模式状态管理、`runCompare`、`pendingDiffs`、人工覆盖传递 | `canvasMode:L328`, `selectNodesStore:L333`, `currentDevNodes:L348`, `clearCompare:L389-392`, `clearSelectState:L394-398`, `onDevBoxSelect:L428-429`, `onDevNodeClick:L436-443`, `onDevBgClick:L456-463`, `runCompare:L473-527`, `runBoxCompare:L529-600`, `selectBranchMode:L373-377`, `effectiveDevSelectedId:L382-387`, `getActiveOverrides:L681-686` |
| `ConsistencyView.vue` | 全局 `selectedPair` / `activeDiff`，事件路由，`tempDiffs` 中转，`rerunCheck` 分流，人工 `manualStyle` 写入与 diff 生成，`nodeManualAttr` computed 收集与存储/回显 | `selectedPair:L230`, `activeDiff:L229`, `tempDiffs:L240`, `tempPairs:L241`, `devSwitchActive:L239`, `rerunCheck:L1174-1217`, `onSaveManualStyle:L1033-1084`, `onRemoveManualStyle:L1086-1112`, `upsertManualDiff:L263-284`, `mergedDiffs:L292-323`, `nodeManualAttr:L247-261`, `onSave:L973-1018`, `buildProblems:L984`, `mergeTempToResult:L1126-1172`, `onDiffSelect:L1619-1645`, `activePairForDiff:L384-390`, `hoverPairForDiff:L392-398`, `computeSpacingMarks:L436-496`, `loadHistoryVersion:L1311-1415`, `preprocessVersion:L344-367`, `canRerun:L423-427`, `applyExtraOverride:L1114-1123`, `onDesignNodeClick:L1219-1230`, `onArkuiNodeClick:L1232-1243` |
| `components/ReportPanel.vue` | 右侧差异面板，`mergedDiffs` 展示，「存储」按钮状态控制与 emit，「重新对比」按钮 | rerun 按钮:`L19-24`, save 按钮:`L6-14`, `DiffReport` 使用:`L47-58`, `hasManualEdits` prop:`L132`, `canRerun` prop:`L124` |
| `components/DiffReport.vue` | 差异列表点选、hover、精准/模糊 Tab 切换、高亮联动、滚动定位 | Props:`L187-195`, Emits:`L196`, `filteredDiffs:L263-286`, `selectItem:L369-378`, `isDiffMatchPair:L290-296`, `activeDiffKeys:L298-305`, `hoverDiffKeys:L307-314`, `matchMode:L211`, watch activePair→scroll:`L318-340` |
| `components/NodeTree.vue` | 节点树展示、节点选中与锁定 | emit `select` / `toggle-lock`:`L121` |
| `views/utils/tools.ts` | `isSelectableNode`、`resolveSelectableNode`、`buildProblems`、`isInteractiveImageNode` 等工具函数 | `isSelectableNode:L191-199`, `resolveSelectableNode:L219-245`, `buildProblems:L69-92`, `isHiddenFrameworkTextNode:L166-168`, `isOcrHiddenTextNode:L171-175` |
| `views/utils/constants.ts` | `TEXT_STYLE_OPTIONS` / `CONTAINER_STYLE_OPTIONS`（edit 模式人工属性选项） | `TEXT_STYLE_OPTIONS:L26-35`, `CONTAINER_STYLE_OPTIONS:L37-46` |
| `match/compareNodes.ts` | 前端本地节点样式对比（`compareNodeStyles`）、人工 diff 生成（`generateManualDiff`） | `compareNodeStyles:L219-253`, `generateManualDiff:L361-386` |
| `match/overrideValidator.ts` | 人工覆盖值校验与解析（edit 模式 Inspector 输入校验） | `validateOverrideInput:L47-109`, `getInputPlaceholder:L158-160`, `parseOverrideValue:L168-200` |
| `match/normalizeSelection.ts` | select 模式批量框选时归一化选中节点的 rect | 全文件 |

> **注意**：`isHiddenTextNode` 定义在 `ImagePanel.vue:391-395`，而非 `tools.ts`。`tools.ts` 中相关函数为 `isHiddenFrameworkTextNode`（`:166-168`）和 `isOcrHiddenTextNode`（`:171-175`）。
