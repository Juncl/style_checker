# summary.md 报告格式说明

## 文件位置

`test/matchNewTemp/summary.md`（基线）或 `test/matchNewTemp-<时间>/summary.md`（快照）

## 结构总览

```
# 全量 Case 匹配结果汇总（case1~15）

> 生成时间：yyyy-MM-dd HH:mm:ss

> 快照目录：<目录名>  |  对比基线：<基线名>

### ① 汇总表格

逐 case 列表 + 合计行 + 指标情况行 + 总量变化文字描述

### ② 出错最多的 Pass

#### 配错分布（按 matchType）
#### 多余对分布（按 matchType）

### ③ 正确匹配的 Pass 分布（按 Pass 执行顺序）

两表：分布表 + 贡献占比表 + 结论文字

### ④ 优化建议

### ⑤ 问题明细

逐 case 列出配错/缺失/多余对
```

## ① 汇总表格

### 表头

```
| case | Pairs总数 | 验证集总数 | 正确数 | 配错数 | 缺失数 | 多余数 | 准确率 | 召回率 | Δ准确率 | Δ召回率 |
```

- Δ列格式：百分比（`+1.67%`），delta=0 填 `0`，无基线的 case 填 `新增`
- 合计行：所有 case 数值汇总，准确率/召回率为总额的比值，Δ 列填 `—`
- 指标情况行：准确率/召回率与合计行一致（重复是为了突出），Δ 值为有基线 case 的平均 delta
- 指标情况行下另起一行普通文字：`正确数 +N，配错数 +N，缺失数 +N，多余数 +N`

## ② 出错最多的 Pass

统计配错和多余按 matchType 分组。

### 配错分布表

```
| matchType | 配错次数 | 涉及 case |
```

### 多余对分布表

```
| matchType | 多余次数 | 涉及 case |
```

## ③ 正确匹配的 Pass 分布

**必须按 Pass 执行顺序排列**，而非按数量排序。顺序与 `nodeMatcher.js` 一致：

```
text-锚点 → text-数字槽 → text-时间槽 → text-同行 → text-长文 → text-角色
→ text-con-列表 → text-con-包含 → text-con-方向x → text-con-方向y
→ text-区域优选 → text-区域兜底 → text-位置 → con-交叠 → con-视觉 → con-夹持
→ text-con-兜底
```

### 第一表：分布表

```
| Pass | matchType | 正确数 | 总对数 | 准确率 | 配错数 | 多余数 | 涉及case数 |
```

- 准确率为 `正确数/总对数`
- 正确数为 0 的 Pass 用 **加粗** 标记

### 第二表：贡献占比表

```
| Pass | matchType | 占正确对比例 | 占配错对比例 | 占多余对比例 |
```

### 结论文字

- 列出完全无效 Pass（正确数=0），用 `> ⚠️` 引用块
- 列出贡献最高的前 3 Pass 及其占比之和
- 对完全无效 Pass 给出处理建议

## ④ 优化建议

编号列表（1. / 2. / 3. ...），每条格式：
```
1. **[问题描述]**：[根因分析] → [建议改进方向]
2. ...
```

## ⑤ 问题明细

只列出配错/缺失/多余三类问题对，每个 case 一个子块。

### 配错表
```
**配错（N对）**
| arkuiId | 实际 designId | 期望 designId | matchType |
```

### 缺失表
```
**缺失（N对）**
| arkuiId | 期望 designId |
```

### 多余表
```
**多余（N对）**
| arkuiId | 实际 designId | matchType |
```

- 某类数量为 0 时整块省略
- 正确 case（如 case6/case10）所有问题为 0，整块省略

## 数据来源

- 每 case 的 pairs 来自 `test/matchNewTemp/hmPhone/caseN.json`
- 验证集来自 `matchTest/matchCase/caseN/matchValidation.json`
- 基线数据来自 `test/<COMPARE_BASE>/hmPhone/caseN.json`
