# 旧数据兼容：problems 字段转换说明

## 背景

内网后台存量历史版本的 `problems` 字段使用旧格式，与当前算法输出的新格式结构完全不同。前端在加载历史版本时，需要自动识别并将旧格式转换为新格式，兼容逻辑集中在 `client/src/views/utils/tools.ts` 的 `adaptLegacyProblem` 函数中。

---

## 识别方式

```
JSON.parse(p.data) 含有 hmNodeStyle 字段 → 旧格式
JSON.parse(p.data) 含有 property 字段   → 新格式（直接透传）
```

---

## 旧格式结构（每条 problem 外层）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 样式差异：`"{arkuiNodeId}-{property}"`；间距差异：`"{anchorId}-{nodeId}-{x\|y}"` |
| `key` | `"text"` \| `"nottext"` \| null | 节点类型标识；间距差异时为 null |
| `idDe` | string \| null | 样式差异时为 null；间距差异时为设计侧 spaceId |
| `desc` | string \| null | 同 `key`（仅作类型标识用，不是描述文本） |
| `type` | string | 样式差异：属性名（如 `fontWeight`）；间距差异：固定为 `"space"` |
| `data` | string | JSON.stringify 后的对象，见下方 |
| `isNotProblem` | `0` \| `1` \| null | `1` = 已被标记为非问题 |

---

## 旧格式 data 内部结构

### 样式差异

```json
{
  "hmNodeStyle": {
    "id": 2582,
    "type": "text",
    "content": "锻炼",
    "fontWeight": 400,
    "fontColor": "#99000000",
    "opacity": 1,
    "finalScore": 0.989869,
    "matchSource": "creText",
    "size": { "w": 71, "h": 35 }
  },
  "deNodeStyle": {
    "id": "371:657",
    "type": "text",
    "content": "锻炼",
    "fontWeight": 500,
    "fontColor": "#99000000",
    "opacity": 1,
    "finalScore": 0.989869,
    "matchSource": "creText",
    "size": { "w": 299.76, "h": 36.56 }
  }
}
```

> **色值格式**：旧数据色值为纯 ARGB hex，如 `#E5000000`（前两位为 alpha），前端 ColorDot 组件已支持此格式。

### 间距差异

```json
{
  "hmNodeStyle": {
    "id": "44-65-x",
    "type": "space",
    "space": {
      "spaceId": "44-65-x",
      "nodeId": 65,
      "hmNodeRect": { "x": 129, "y": 2676, "w": 71, "h": 35 },
      "hmAnotherNodeRect": { "x": 0, "y": 2552, "w": 1316, "h": 280 },
      "nodeLeftId": 44,
      "mapNodeId": "371:647",
      "mapLeftNodeId": "290:77777",
      "rel": "c",
      "distance": 37,
      "spaceMapId": "290:77777-371:647-x",
      "diffDistance": 33
    }
  },
  "deNodeStyle": {
    "id": "290:77777-371:647-x",
    "type": "space",
    "space": {
      "spaceId": "290:77777-371:647-x",
      "nodeId": "371:647",
      "nodeLeftId": "290:77777",
      "mapNodeId": 65,
      "mapLeftNodeId": 44,
      "rel": "c",
      "distance": 4,
      "spaceMapId": "44-65-x",
      "diffDistance": 33
    }
  }
}
```

> **方向字段**：水平间距用 `nodeLeftId` / `mapLeftNodeId`；垂直间距用 `nodeTopId` / `mapTopNodeId`。

---

## 字段映射：旧格式 → 新格式 diff 对象

### 样式差异字段映射

| 新格式字段 | 来源 | 说明 |
|---|---|---|
| `property` | 外层 `type` | 直接复用 |
| `arkuiValue` | `hmNodeStyle[property]` | 如 `hmNodeStyle.fontWeight`；旧格式色值为 ARGB，前端可直接渲染 |
| `designValue` | `deNodeStyle[property]` | 如 `deNodeStyle.fontWeight` |
| `confidence` | `hmNodeStyle.finalScore` | `≥0.8→high`，`≥0.6→medium`，`<0.6→low` |
| `severity` | 由 `confidence` 推导 | `low→warning`，其余→`error` |
| `nodeType` | 外层 `key` | `"text"→"text"`，`"nottext"→"container"` |
| `textContent` | `hmNodeStyle.content` | 文本节点的内容 |
| `matchType` | `hmNodeStyle.matchSource` | 旧值如 `creText/section/blindMatch` |
| `arkuiNodeId` | `String(hmNodeStyle.id)` | 强制转 string |
| `designNodeId` | `String(deNodeStyle.id)` | 强制转 string |
| `description` | — | **固定空字符串**（旧数据无描述） |
| `designName` | — | **固定 null**（旧数据无节点名） |
| `arkuiName` | — | **固定 null** |
| `iou` | — | **固定 null**（旧数据无此字段） |
| `topologyScore` | — | **固定 null** |
| `regionScore` | — | **固定 null** |
| `designRect` | — | **固定 null**（画布高亮通过节点 id 定位，不依赖 rect） |
| `arkuiRect` | — | **固定 null** |

**旧格式有但完全不使用的字段**：

| 字段 | 说明 |
|---|---|
| `hmNodeStyle.type` | 节点的具体 rawType（text/tabbar/swiper 等），转换时不读 |
| `deNodeStyle.type` | 同上 |
| `hmNodeStyle.opacity` | 非 opacity 差异时不需要 |
| `hmNodeStyle.size` | 仅含 w/h，画布高亮通过 id 定位，不用 |
| `deNodeStyle.size` | 同上 |
| 外层 `idDe` | 样式差异时固定 null，转换时不读 |
| 外层 `desc` | 仅作类型标识，已由外层 `key` 替代 |

---

### 间距差异字段映射

| 新格式字段 | 来源 | 说明 |
|---|---|---|
| `property` | 外层 `id` 末尾 | `-x → "spacing.left"`，`-y → "spacing.top"` |
| `confidence` | — | **固定 `"low"`**（旧格式间距差异均为低置信） |
| `severity` | — | **固定 `"warning"`** |
| `arkuiValue` | `hmNodeStyle.space.distance` | 开发侧间距值，转为 string |
| `designValue` | `deNodeStyle.space.distance` | 设计侧间距值，转为 string |
| `spaceId` | `hmNodeStyle.space.spaceId` | 开发侧间距关系唯一 ID |
| `designSpaceId` | `deNodeStyle.space.spaceId` | 设计侧间距关系唯一 ID |
| `arkuiNodeId` | `String(hmNodeStyle.space.nodeId)` | 当前开发节点 ID |
| `designNodeId` | `String(hmNodeStyle.space.mapNodeId)` | 当前设计节点 ID |
| `relatedArkuiNodeId` | `hmNodeStyle.space.nodeLeftId ?? nodeTopId` | 锚点开发节点 ID |
| `relatedDesignNodeId` | `hmNodeStyle.space.mapLeftNodeId ?? mapTopNodeId` | 锚点设计节点 ID |
| `relationKind` | `hmNodeStyle.space.rel` | `"c" → "parent-child"`，其余 → `"sibling"` |
| `relationAxis` | 外层 `id` 末尾 | `-x → "horizontal"`，`-y → "vertical"` |
| `description` | — | **固定空字符串** |

**旧格式有但完全不使用的字段**：

| 字段 | 说明 |
|---|---|
| `hmNodeStyle.space.hmNodeRect` | 节点坐标，画布高亮通过 id 定位，不用 |
| `hmNodeStyle.space.hmAnotherNodeRect` | 锚点坐标，同上 |
| `deNodeStyle.space.deNodeRect` / `deNode` | 同上 |
| `deNodeStyle.space.deAnotherNodeRect` | 同上 |
| `hmNodeStyle.space.spaceRect` | 间距区域 rect，不用 |
| `hmNodeStyle.space.diffDistance` | 差值（可从 arkuiValue - designValue 计算，不读此字段） |
| 外层 `idDe` | designSpaceId 已从 `deNodeStyle.space.spaceId` 读取 |

---

## isNotProblem 字段的处理

旧格式外层有 `isNotProblem` 字段（新格式无此字段）：

- `isNotProblem === 1` → 转换后在 diff 对象中写入 `_isNotProblem: true`
- `DiffReport.vue` 在 `watch(() => props.diffs)` 时扫描含 `_isNotProblem: true` 的条目，自动将其 `foldKey` 写入 `notIssueKeys`，界面上显示"非问题"标签

---

## 旧格式无、新格式也不会生成的特殊项

新格式 problems 末尾会追加一条 `id: "matchedPairIds"` 的特殊记录，用于历史版本重建匹配对。旧数据没有此记录，加载时 `preprocessVersion` 中 `findIndex(p => p.id === 'matchedPairIds')` 找不到，会走旧版兼容路径（从 diffs 中反推有差异的节点对），行为正常。

---

## 代码位置

| 职责 | 文件 | 说明 |
|---|---|---|
| 转换函数 | `client/src/views/utils/tools.ts` → `adaptLegacyProblem()` | 识别并转换旧格式 |
| 调用点 | `client/src/views/consistency/ConsistencyView.vue` 第 935 行 | 加载历史版本 problems 时调用 |
| 非问题初始化 | `client/src/views/consistency/components/DiffReport.vue` → `watch(() => props.diffs)` | 扫描 `_isNotProblem` 初始化标签 |
