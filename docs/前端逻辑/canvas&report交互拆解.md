# 点选与框选交互逻辑

> 描述用户在图片对比面板（`ImagePanel.vue`）上点击节点（点选）、拖拽框选多节点（框选）的完整交互流程，以及事件如何向上传递、状态如何被管理。

---

## 一、整体设计

### Float Bar 模式切换

底部居中的悬浮工具栏（`.dev-float-bar`，`ReportPage.vue`）提供两个功能按钮和一个折叠按钮，控制画布进入三种工作模式之一：

| 按钮 | 功能 |
|---|---|
| 圆形图标（edit） | 切换 `nodeCanvasMode = 'edit'`；再次点击回到 default |
| 矩形图标（select） | 切换 `nodeCanvasMode = 'select'`；再次点击回到 default 并清空选中状态 |
| 上/下箭头 | 折叠/展开 float bar |

三种模式通过 `nodeCanvasMode`（`'default' | 'select' | 'edit'`）驱动，影响以下行为：

| 模式 | 点选效果 | 框选效果 | Inspector 面板 |
|---|---|---|---|
| **default** | 更新全局 `selectedPair`，高亮对应节点对 | 不开启 | 仅在节点有 diff 或间距模式时显示 |
| **select** | 事件被截获，只更新本地选中 id（不向上冒泡） | 开启拖拽框选和 Ctrl/Cmd+单击多选 | 显示被选中节点的属性（无 diff 高亮） |
| **edit** | 同 default（全局 `selectedPair`） | 不开启 | **始终显示**，出现「+」按钮可添加人工对比属性 |

Float bar 通过给两侧 `ImagePanel` 传入不同的 `boxSelectMode` 和 `editMode` prop 来切换画布行为。select 模式额外通过 `emit('dev-switch-change', bool)` 通知父组件 `ConsistencyView`，以影响"重新对比"按钮的分流路径。

### 两侧面板

左侧（开发侧 ArkUI）和右侧（设计侧 Design）各有一个 `ImagePanel` 组件，共享相同的点选/框选实现。select 模式下两侧各有独立的本地选中状态（`localArkuiId` / `localDesignId` 和 `localArkuiNodeList` / `localDesignNodeList`），框选优先于单击，任一侧 ≥ 2 个节点时进入批量对比模式。

---

## 二、正常模式（default）

### 2.1 点选流程

用户单击 canvas → `getCanvasCoords()` 将客户端坐标转为画布坐标 → `hitNodesAt()` 返回该坐标所有命中节点（排除 locked 节点、visible=false 节点、被遮挡节点等），按类型优先级（文本优先）和面积升序排列 → `findHitNode()` 取首个最优命中。

若命中节点，`stopPropagation` 阻止事件冒泡，`emit('node-click', id)` 向上传递到 `ReportPage` → `ConsistencyView`，更新全局 `selectedPair`。未命中则 `emit('bg-click')` → `clear-pair`，清空选中态。

### 2.2 节点可选性过滤

`ConsistencyView` 接收 `node-click` 事件后，先通过 `resolveSelectableNode` 将容器节点优化替换为其后代中最深、面积最小的匹配文本节点，再通过 `isSelectableNode` 校验（visible 正常、未被遮挡、宽高 > 4px、非框架文本节点等）。通过校验后查找该节点所属的匹配对，有则设置 `selectedPair = pair`，无则生成 `unmatched-dev` / `unmatched` 虚对。

### 2.3 双击下钻

双击 canvas → 在同一坐标的命中节点列表中循环选取下一层，用于多节点堆叠时逐层深入。

### 2.4 Hover 联动

`onMouseMove` → `findHitNode()` → `emit('node-hover', id)`。鼠标离开时 emit null。对侧通过 `externalHoveredId` prop 接收联动 hover，以相同样式在对方画布上绘制。cursor 在命中节点时改为 `pointer`。

### 2.5 Canvas 绘制

`draw()` 按顺序绘制，后绘覆盖先绘：锁定节点（红色虚线 + 🔒）→ hover 节点（红色虚线 + 浅红背景）→ 对侧联动 hover → 选中节点（红色实线 + 红色背景）→ Diff 间距标注（橙红色）→ Hover 实时间距标注（蓝色）。

---

## 三、select 模式（选择比对模式）

select 模式下，`ReportPage` 截获 `node-click` 和 `bg-click` 事件，只更新本地状态（`localArkuiId` / `localDesignId`），不再向上冒泡给 `ConsistencyView`。这使得用户可以在不影响全局选中状态的前提下自由选点，用于后续重新对比。

### 3.1 框选

`boxSelectMode=true` 时启用鼠标左键拖拽框选，分三个阶段：
1. **开始拖拽**：记录起始坐标，清空已有框选状态
2. **拖拽中**：超过 4px 抖动容差后开始绘框（蓝色虚线），实时检测 AABB 碰撞，收集框内命中节点，**不过滤 lockedIds**
3. **结束拖拽**：`emit('box-select', nodes[])`，框选高亮保持直到下次单击清空

同时支持 Ctrl/Cmd+单击在已有框选集合中增删单节点。

### 3.2 重新对比

select 模式下点击"重新对比"按钮 → `ConsistencyView.rerunCheck()` 检测到 `devSwitchActive=true` → 调用 `reportPageRef.runCompare()`，不走全量算法重跑。

`runCompare()` 分两条子路径：
- **单节点模式**（两侧各 1 个节点）：调用 `compareNodeStyles()` 前端本地对比，结果存入 `pendingDiffs`（临时），通过 `tempDiffs` 传入 `DiffReport` 覆盖展示，不更新全局 `result.diffs`。同时触发 `compareActive=true`，canvas 绘制白色遮罩高亮选中区域。
- **批量模式**（任一侧 ≥ 2 个节点）：调用 `normalizeSelection()` + `matchNodes()` 后端 API 批量对比。

选择发生任何变化（点选新节点、框选、点击空白），`watch` 自动清空 `pendingDiffs` 和 `tempDiffs`，DiffReport 回退到全量算法结果。

---

## 四、节点属性浮层（Inspector）

点选节点后，`ImagePanel` 在节点旁悬浮显示一个属性面板（`.node-inspector`），展示该节点的样式属性（字号、填充、圆角等），以及与对比结果的差异高亮。

**显示条件**：
- 间距模式：`highlightPair.type === 'spacing'` 时显示间距值
- 节点模式：`inspectorNode` 非 null 且有可展示属性时显示
- **edit 模式下额外放宽**：即使无 diff 也显示（条件中加入 `editMode`），确保用户始终可以访问人工标注功能

**属性展示**：`displayStyle` 遍历 `inspectorNode.style`，将有值字段转为属性行列表，`diff` 字段标记该属性是否存在差异（来自 `styleDiffs` prop）。select 模式下 `styleDiffs` 传入空数组，因此不显示差异高亮。

### 4.1 edit 模式下的人工标注

edit 模式的核心功能：允许用户为任意节点添加人工自定义对比属性，修正算法漏检或错误判断。

**操作流程**：
1. Inspector header 右侧出现「+」按钮（最多只允许一行待确认，已存在则按钮变灰）
2. 点击「+」→ 出现一行：下拉选择属性 + 输入期望值 + 绿勾确认按钮
3. 输入时实时校验格式（如颜色值合法性），格式错误时提示
4. 点击绿勾 → 属性保存到 `savedRows`，通过 `emit('save-manual-style')` 冒泡到 `ConsistencyView`
5. `ConsistencyView.onSaveManualStyle()` 将值写入节点树的 `manualStyle` 字段，并自动生成/更新人工差异项（`_isManual=true`）。若该节点处于某匹配对中，生成双边 diff；否则生成单侧 diff（另一侧为"—"）
6. 已保存行旁有 × 删除按钮，点击后从 `manualStyle` 和 diffs 中同步移除

**下拉属性选项**（按节点类型区分）：

| 节点类型 | 可选属性 |
|---|---|
| `type === 'text'` | 字号、字重、颜色、字体、对齐、行高、字间距 |
| `type === 'container'` | 填充、不透明度、圆角、描边宽度、描边颜色、内边距、间距、阴影、模糊 |

**节点切换**：切换到不同节点时，pending 行自动清空，已保存行从目标节点的 `manualStyle` 还原显示。

**全量重跑影响**：edit 模式下保存的 `manualStyle` 值会在下次 `rerunCheck()` 全量重跑时通过 `getActiveOverrides()` 读取，patch 到节点副本后传入后端 `matchNodes()`，使人工标注参与全局匹配算法。

### 4.2 Inspector 与 Diff 列表的实时联动

**关键前提**：Inspector 显示的属性条目全部来自节点自身的 `style` 对象（`displayStyle` 遍历 `inspectorNode.style`），diff 报告仅通过 `styleDiffs` prop 提供差异标记（哪些属性有高亮），不提供属性值。因此联动的前提是 `selectedPair` 中包含完整节点对象（含 `type`、`style`、`textContent`、`rect` 等），仅有 id 的空壳无法驱动 Inspector。

edit 模式下修改 Inspector 属性后，右侧差异列表会实时同步更新，形成"标注 → 出卡 → 联动"的闭环：

**保存 → 生成差异卡片**：`confirmExtra()` 保存人工属性后，`ConsistencyView.onSaveManualStyle()` 写入 `node.manualStyle`，然后根据节点是否处于匹配对中走两条路径：

| 场景 | 生成方式 | diff 卡片内容 |
|---|---|---|
| 节点有匹配对 | `generateManualDiff(pair, key)` 检测双侧 `manualStyle[key]` | 仅人工标注侧显示实际值，**未标注侧显示"—"**；双侧均有人工标注时做真实对比 |
| 节点无匹配对 | 直接构造单侧 diff | 修改侧显示值，对侧显示"—"，对侧 `nodeId` 为 null |

卡片通过 `upsertManualDiff` 去重（同属性+同节点合并），最终经 `mergedDiffs` 与算法 diff 合并（人工同键覆盖、新键追加），传入 `DiffReport` 实时展示。

**差异卡片 → 画布 + Inspector 联动**：点击人工差异卡片时，`onDiffSelect` 查找对应匹配对：

- **有匹配对的节点**：pair 查找命中 → `selectedPair` 获得双侧完整节点 → 两侧画布同时高亮，两侧 Inspector 分别展示对应节点属性。即使人工属性只改了单侧，**对侧节点也会联动出现**。
- **无匹配对的节点**：pair 查找未命中 → 从 `allDesignNodes` / `allArkuiNodes` 中查找完整节点对象 → 仅修改侧画布高亮并展示 Inspector，对侧无联动。

人工卡片与算法卡片遵循完全相同的 §六 双向联动机制，无差别。

**删除 → 移除差异卡片**：`deleteRow()` 删除人工属性后，`onRemoveManualStyle()` 重新计算该属性的两侧对比结果。若值仍不一致则更新卡片，若一致则从 `manualDiffs` 中移除，卡片随之消失。

**数据复位**：加载新 case 或全量重跑完成后，`watch(() => result.value)` 自动清空 `manualDiffs`，人工标注的 `manualStyle` 保留在节点树中但 diff 列表回归算法结果。再次全量重跑时，`manualStyle` 通过 `getActiveOverrides()` 注入匹配流程，算法重新评估后会产出新的 diff，不再依赖人工 diff 兜底。

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
         ├─ 空白点击 → emit('bg-click')
         └─ edit 模式「+」→ emit('save-manual-style' / 'remove-manual-style')
         ↓
  ReportPage（两侧面板协调 + float bar 模式开关）
         ├─ default 模式
         │  ├─ 点选 → emit('arkui-node-click' | 'design-node-click', id)
         │  └─ 空白 → emit('clear-pair')
         ├─ select 模式
         │  ├─ 点选 → 截获，写入 localArkuiId / localDesignId
         │  ├─ 框选 → 写入 localArkuiNodeList / localDesignNodeList
         │  ├─ 空白 → 清空本地 id（watch 自动清 pendingDiffs）
         │  └─ 任一选择变化 → watch → clearCompare()
         └─ edit 模式
            ├─ 点选 → 同 default，emit 冒泡
            ├─ Inspector「+」→ devExtraOverride / designExtraOverride
            └─ save-manual-style → 冒泡到 ConsistencyView
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
         └─ DiffReport :diffs="tempDiffs ?? result.diffs"
              ├─ tempDiffs 非 null → 展示临时对比结果
              └─ tempDiffs 为 null → 回退全量算法结果
```

---

# 六、Canvas 与 Report 双向联动

> 描述右侧 `ReportPanel`（差异列表）与左侧 `ImagePanel`（画布）之间的完整双向联动机制。

---

## 6.1 Canvas → Report：节点选中驱动差异列表高亮

用户点选画布节点 → `selectedPair` 更新 → `activePairForDiff` 计算 → 传入 `DiffReport`，遍历差异列表匹配 `arkuiNodeId` 或 `designNodeId` 任一命中的 diff，添加"active-from-node"高亮样式。同时自动滚动到第一个关联差异卡片（若由右侧卡片自身点击触发则跳过滚动，防抖动）。`spacing.` 类 diff 不参与节点匹配。

## 6.2 Canvas → Report：Hover 驱动差异列表弱高亮

用户 hover 画布节点 → `hoverPairForDiff` 计算 → 传入 `DiffReport`，命中的 diff 添加"hover-from-node"弱高亮（优先级低于 active-from-node）。若同时有 `hoveredDiffPair`（来自 Report 侧 hover），后者优先级更高。

## 6.3 Report → Canvas：点击差异卡片驱动画布高亮

用户点击差异卡片 → `activeDiff` 更新 + `selectedPair` 更新 → canvas 绘制节点红色实线高亮。间距类 diff 特殊处理：不更新 `selectedPair`，而是通过 `buildSpacingMark` 计算 `spaceRect`，在画布上绘制 H 形橙红色间距标注。再次点击取消选中。

## 6.4 Report → Canvas：Hover 差异卡片驱动画布联动 Hover

鼠标悬浮差异卡片（非 spacing diff）→ `hoveredDiffPair` 更新 → 两侧画布通过 `externalHoveredId` 同时绘制对应节点的 hover 样式。鼠标离开卡片时联动消失。

## 6.5 对侧联动 Hover（Cross-side Hover）

用户 hover 一侧画布节点 → 系统根据匹配对查找对侧对应节点 id → 通过 `externalHoveredId` 传入对侧 `ImagePanel`，实现对侧联动高亮。两侧 hover 互斥，同一时刻只有一侧驱动。

## 6.6 Hover 实时间距标注

当 `selectedPair` 非空时，hover 同侧另一个节点，系统实时计算两节点间距并绘制蓝色标注。`computeSpacingMarks` 根据 rect 的包含/相邻关系计算四向间距，以设计侧 `size`（原始 dp）或开发侧 `rect`（vp）标注数值。

## 6.7 调试模式节点树 → Canvas

`ReportPanel` 的「节点树」Tab 中点击节点 → `selectedPair` 更新 → canvas 高亮。设计侧节点支持「锁定」（红色虚线 + 🔒），锁定节点不参与点击命中。

## 6.8 精准/模糊 Tab 对联动的影响

DiffReport 的「精准检查 / 模糊比对」Tab 仅控制可见 diff 集合，切换后 `activeDiff` 清空但 `selectedPair` 保持，联动高亮随新集合自动刷新。

---

# 七、重新对比完整流程

> 描述"重新对比"按钮的触发条件、两条执行路径、存档时序，以及与画布/差异列表的状态联动。

---

## 7.1 触发入口

`ReportPanel` 右上角"重新对比"按钮 → `emit('rerun')` → `ConsistencyView.rerunCheck()`。按钮可用性由 `canRerun` computed 控制（两侧重上传状态就绪且非 loading 态）。

## 7.2 路径 A：局部对比（select 模式）

仅在 `devSwitchActive=true` 时生效，不调用后端接口、不存档。`reportPageRef.runCompare()` 分为两条子路径：单节点模式走 `compareNodeStyles()` 前端本地对比，结果通过 `tempDiffs` 临时展示；批量模式走 `matchNodes()` API。选择变化自动清空临时结果。

## 7.3 路径 B：全量重跑（default / edit 模式）

仅在 `devSwitchActive=false` 时生效。流程：清空高亮状态 → 调用 `matchNodes()` 后端接口 → 更新 `result.diffs/pairs/stats` → 存档（`submitRerunVersion`）→ 更新版本列表和 URL 参数。edit 模式下保存的 `manualStyle` 在重跑前通过 `getActiveOverrides()` 注入节点副本，使人工标注参与匹配。

## 7.4 存档流程

全量重跑成功后自动存档：序列化 diffs/pairs → 调用 mock API 追加新版本（不覆盖旧版本）→ 更新版本列表 → 注入 `_problemId` → 更新 URL 参数。存档失败静默处理。

---

## 八、关键文件索引

| 文件 | 核心职责 |
|---|---|
| `components/ImagePanel.vue` | canvas 绘制、点选框选事件、坐标转换、命中检测、对比激活遮罩、edit 模式人工属性编辑 UI |
| `components/ReportPage.vue` | 两侧面板协调、float bar 模式开关、本地选择状态、`runCompare`、`pendingDiffs`、人工覆盖传递 |
| `ConsistencyView.vue` | 全局 `selectedPair` / `activeDiff`，事件路由，`tempDiffs` 中转，`rerunCheck` 分流，人工 `manualStyle` 写入与 diff 生成 |
| `components/ReportPanel.vue` | 右侧差异面板，`tempDiffs ?? result.diffs` 切换展示 |
| `components/DiffReport.vue` | 差异列表点选，emit `diff-select` 触发 `activeDiff` 联动 |
| `utils/tools.ts` | `isSelectableNode`、`resolveSelectableNode`、`isHiddenTextNode` |
| `utils/constants.ts` | `TEXT_STYLE_OPTIONS` / `CONTAINER_STYLE_OPTIONS`（edit 模式人工属性选项） |
| `match/compareNodes.ts` | 前端本地节点样式对比，select 模式单节点对比调用入口 |
| `match/overrideValidator.ts` | 人工覆盖值校验与解析（edit 模式 Inspector 输入校验） |
