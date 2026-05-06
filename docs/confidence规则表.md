# Confidence 规则表

> 说明：当前系统里的 `confidence` 不是单一数学公式，而是由不同匹配通道在产出 pair 时按规则打出的档位。

这份表主要整理三档含义、典型来源、触发条件和使用方式，方便后续调权重、改过滤或做 UI 展示时直接对照。

---

## 1. 总体原则

`confidence` 现在只分三档：

- `high`
- `medium`
- `low`

它的作用不是“最终正确性判定”，而是：

- 给最终一对一收口提供优先级
- 给前端展示提供可读提示
- 给低置信兜底留出边界

换句话说，`confidence` 是“证据强弱标签”，不是“是否保留”的唯一依据。

---

## 2. 三档规则总表

| 档位 | 含义 | 典型来源 | 主要触发条件 | 处理优先级 |
|---|---|---|---|---|
| `high` | 强证据，接近锚点级 | `text-content` 的强同文命中 | 同文本 + 位置很近 + 样式很像 + 不是高风险短文本 | 最高 |
| `medium` | 主规则命中，证据较稳 | `text-content`、`dynamic-text-slot`、`text-row-slot`、`region-text-optimal`、`text-role`、`anchor-topology`、`text-position`、`container-iou`、`gradient-iou`、`image-geometry`、`shape-geometry`、`other-geometry` | 通道本身通过阈值，且不是弱救援级别 | 中 |
| `low` | 兜底命中，证据偏弱 | `region-text-global-rescue`、`rescue-iou`、部分 `anchor-topology` / `dynamic-text-slot` / `text-row-slot` 的边缘命中 | 只够“能配上”，但稳定性不强 | 最低 |

---

## 3. `high` 的判断依据

`high` 目前主要出现在文本强锚点里。

### 3.1 触发位置

在 [nodeMatcher.js](/Users/ljc/Documents/workspace/agent/dev-test/style-checker/server/src/matchers/nodeMatcher.js) 的 Pass 1 中，同文本命中后会继续看位置和样式。

### 3.2 当前条件

大致条件是：

- 同文本
- `dist < 0.06`
- `styleScore >= 0.72`
- 不是短数字这类高风险文本

### 3.3 语义含义

这类 pair 不只是“匹配上了”，还具备：

- 可作为强锚点继续推周边节点
- 在最终收口时优先级很高
- 在前端上更适合被当作可信结果展示

### 3.4 典型例子

- 完全同文且位置几乎重合的标题
- 设计和开发都稳定渲染的主文本

---

## 4. `medium` 的判断依据

`medium` 是当前系统的主力档位。

### 4.1 触发位置

典型来源包括：

- `text-content`
- `dynamic-text-slot`
- `text-row-slot`
- `region-text-optimal`
- `text-role`
- `anchor-topology`
- `text-position`
- `container-iou`
- `gradient-iou`
- `image-geometry`
- `shape-geometry`
- `other-geometry`

### 4.2 具体规则

#### `text-content`

同文本命中，但不满足强锚点条件时，通常标为 `medium`。

#### `dynamic-text-slot`

时间、星期等固定槽位匹配，若 `match.score > 0.72`，通常给 `medium`。

#### `text-row-slot`

行内文本槽位匹配，若 `match.score > 0.76`，通常给 `medium`。

#### `region-text-optimal`

区域内最优匹配，若 `match.score > 0.74`，通常给 `medium`。

#### `text-role`

文本角色匹配，满足：

- `best.score >= 0.85`
- 或 `isStrongTitleSlotMatch(...)`

时，给 `medium`。

#### `anchor-topology`

局部拓扑匹配里：

- `best.score > 0.58` 才能进 pair
- `best.score > 0.72` 才会给 `medium`
- 否则多半是 `low`

#### `text-position`

文本位置回退只要 `best.score > 0.35` 就会进入，默认给 `medium`。

#### 几何 / 视觉类

容器、渐变、图标、图片、shape、other 等，只要达到各自阈值，通常给 `medium`。

### 4.3 语义含义

`medium` 表示：

- 这条 pair 不是硬凑出来的
- 但也未必是最强锚点
- 适合参与一对一收口，但会被 `high` 优先压过

---

## 5. `low` 的判断依据

`low` 是兜底档，主要用于保留“有一定合理性，但证据偏弱”的 pair。

### 5.1 触发位置

典型来源：

- `region-text-global-rescue`
- `rescue-iou`
- `anchor-topology` 的边缘命中
- `dynamic-text-slot` / `text-row-slot` 的边缘命中

### 5.2 具体规则

#### `region-text-global-rescue`

全局救援通道，只有在区域内没有更优结果时才会走。

通常：

- `match.score < 0.74` 但又 `>= 0.60`
- 会被标成 `low`

#### `rescue-iou`

纯几何兜底，阈值更低：

- `best.iou > 0.25`
- 固定给 `low`

#### `anchor-topology`

如果 `0.58 < score <= 0.72`，通常是 `low`。

#### `dynamic-text-slot` / `text-row-slot`

若匹配分数过了进入门槛，但不够高置信，通常会被保留为 `low`。

### 5.3 语义含义

`low` 表示：

- 这条 pair 可以先留着
- 但它不应该压过主匹配
- 更适合作为回归分析、UI 展示或弱证据兜底

---

## 6. 决策链路

`confidence` 的作用顺序大致是：

1. 先看能不能进入 pair
2. 再看属于哪条匹配通道
3. 再按通道的分数/阈值打成 `high / medium / low`
4. 最后在 `pairPriority()` 里和 `matchType`、`topologyScore`、`iou`、`visualScore` 一起做全局排序

也就是说：

- `confidence` 决定的是“强弱”
- `matchType` 决定的是“来源”
- 最终保留顺序是两者一起算的

---

## 7. 前端展示建议

前端可以把 `confidence` 看成辅助信息：

- `high`：默认可信
- `medium`：常规结果
- `low`：默认隐藏，按需展开

这也是目前 right-panel 里默认隐藏低置信问题的原因。

---

## 8. 调整时的注意点

如果要改 `confidence` 规则，建议优先看这几个地方：

- [server/src/matchers/nodeMatcher.js](/Users/ljc/Documents/workspace/agent/dev-test/style-checker/server/src/matchers/nodeMatcher.js)
- [server/src/matchers/matchStrategies.js](/Users/ljc/Documents/workspace/agent/dev-test/style-checker/server/src/matchers/matchStrategies.js)
- [server/src/matchers/dynamicTextSlots.js](/Users/ljc/Documents/workspace/agent/dev-test/style-checker/server/src/matchers/dynamicTextSlots.js)

改动时要注意：

- 不要让 `low` 抢掉 `high`
- 不要让救援通道变成主通道
- 不要只改展示，忘了同步最终排序

---

## 9. 一句话总结

`high` 是强锚点，`medium` 是主规则，`low` 是兜底保留。

它们不是“对错等级”，而是“证据强弱等级”。
