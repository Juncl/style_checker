# 全量 Case 匹配结果汇总（case1~15）

> 生成时间：2026-06-15 17:12:40

> 快照目录：matchNewTemp-06-15-17-12  |  对比基线：matchNewTemp


### ① 汇总表格

| case | Pairs总数 | 验证集总数 | 正确数 | 配错数 | 缺失数 | 多余数 | 准确率 | 召回率 | Δ准确率 | Δ召回率 |
|---|---|---|---|---|---|---|---|---|---|---|
| case1 | 30 | 30 | 23 | 3 | 4 | 4 | 76.67% | 76.67% | 0 | 0 |
| case2 | 59 | 60 | 54 | 0 | 6 | 5 | 91.53% | 90.00% | 0 | 0 |
| case3 | 25 | 26 | 23 | 0 | 3 | 2 | 92.00% | 88.46% | 0 | 0 |
| case4 | 51 | 48 | 45 | 1 | 2 | 5 | 88.24% | 93.75% | 0 | 0 |
| case5 | 25 | 24 | 21 | 2 | 1 | 2 | 84.00% | 87.50% | 0 | 0 |
| case6 | 24 | 24 | 24 | 0 | 0 | 0 | 100.00% | 100.00% | 0 | 0 |
| case7 | 55 | 63 | 49 | 4 | 10 | 2 | 89.09% | 77.78% | 0 | 0 |
| case8 | 31 | 32 | 28 | 0 | 4 | 3 | 90.32% | 87.50% | 0 | 0 |
| case9 | 30 | 29 | 26 | 2 | 1 | 2 | 86.67% | 89.66% | 0 | 0 |
| case10 | 31 | 31 | 31 | 0 | 0 | 0 | 100.00% | 100.00% | 0 | 0 |
| case11 | 39 | 40 | 38 | 0 | 2 | 1 | 97.44% | 95.00% | 0 | 0 |
| case12 | 65 | 55 | 50 | 2 | 3 | 13 | 76.92% | 90.91% | 0 | 0 |
| case13 | 43 | 42 | 41 | 0 | 1 | 2 | 95.35% | 97.62% | 0 | 0 |
| case14 | 38 | 34 | 21 | 6 | 7 | 11 | 55.26% | 61.76% | 0 | 0 |
| case15 | 43 | 41 | 41 | 0 | 0 | 2 | 95.35% | 100.00% | 0 | 0 |
| **合计** | **589** | **579** | **515** | **20** | **64** | **54** | **87.44%** | **88.95%** | — | — |

### ② 出错最多的 Pass

#### 配错分布（按 matchType）

| matchType | 配错次数 | 涉及 case |
|---|---|---|
| anchor-topology-方向 | 10 | case1, case14, case4, case5, case7, case9 |
| text-content | 6 | case1, case14, case7 |
| region-text-optimal | 2 | case12, case14 |
| text-role | 1 | case9 |
| container-iou | 1 | case12 |

#### 多余对分布（按 matchType）

| matchType | 多余次数 | 涉及 case |
|---|---|---|
| anchor-topology-方向 | 40 | case1, case12, case13, case14, case15, case2, case3, case4, case5, case7, case8, case9 |
| spatial-bracket | 4 | case11, case12, case2 |
| anchor-topology-自由 | 3 | case1, case12, case4 |
| text-row-slot | 2 | case4 |
| long-text-fallback | 1 | case15 |
| region-text-optimal | 1 | case14 |
| text-position | 1 | case3 |
| container-iou | 1 | case8 |
| rescue-iou | 1 | case5 |

### ③ 正确匹配的 Pass 分布（按 Pass 执行顺序）

| Pass | matchType | 正确数 | 总对数 | 配错数 | 多余数 | 涉及case数 | 准确率 |
|---|---|---|---|---|---|---|---|
| Pass 1 | text-content | 209 | 215 | 6 | 0 | 15 | 97.21% |
| Pass 2 | dynamic-text-slot | 4 | 4 | 0 | 0 | 1 | 100.00% |
| Pass 2 | dynamic-number-slot | 2 | 2 | 0 | 0 | 2 | 100.00% |
| Pass 2 | text-row-slot | 4 | 6 | 0 | 2 | 3 | 66.67% |
| Pass 2d | long-text-fallback | 1 | 2 | 0 | 1 | 2 | 50.00% |
| Pass 2.5 | text-role | 10 | 11 | 1 | 0 | 4 | 90.91% |
| Pass 3.5 | list-index | 3 | 3 | 0 | 0 | 1 | 100.00% |
| Pass 3.1.1 | anchor-topology-包含 | 54 | 54 | 0 | 0 | 14 | 100.00% |
| Pass 3.1.2 | anchor-topology-方向 | 214 | 264 | 10 | 40 | 15 | 81.06% |
| Pass 3.2 | anchor-topology-自由 | 2 | 5 | 0 | 3 | 5 | 40.00% |
| Pass 4 | region-text-optimal | 3 | 6 | 2 | 1 | 4 | 50.00% |
| Pass 4 | region-text-global-rescue | 1 | 1 | 0 | 0 | 1 | 100.00% |
| Pass 5 | text-position | **0** | 1 | 0 | 1 | 1 | 0.00% |
| Pass 5.3 | container-iou | 6 | 8 | 1 | 1 | 7 | 75.00% |
| Pass 6 | container-geometry | 1 | 1 | 0 | 0 | 1 | 100.00% |
| Pass 6.5 | spatial-bracket | 1 | 5 | 0 | 4 | 4 | 20.00% |
| Pass 7 | rescue-iou | **0** | 1 | 0 | 1 | 1 | 0.00% |
| **合计** | | **515** | **589** | **20** | **54** | | **87.44%** |

> ⚠️ **完全无效 Pass（正确数为 0）**：`text-position`（Pass 5，多余1对）、`rescue-iou`（Pass 7，多余1对），建议检查阈值或逻辑是否过于严格 / 实际场景未覆盖。

**各 Pass 贡献占比：**

| Pass | matchType | 占正确对比例 | 占配错对比例 | 占多余对比例 |
|---|---|---|---|---|
| Pass 1 | text-content | 40.58% | 30.00% | 0.00% |
| Pass 2 | dynamic-text-slot | 0.78% | 0.00% | 0.00% |
| Pass 2 | dynamic-number-slot | 0.39% | 0.00% | 0.00% |
| Pass 2 | text-row-slot | 0.78% | 0.00% | 3.70% |
| Pass 2d | long-text-fallback | 0.19% | 0.00% | 1.85% |
| Pass 2.5 | text-role | 1.94% | 5.00% | 0.00% |
| Pass 3.5 | list-index | 0.58% | 0.00% | 0.00% |
| Pass 3.1.1 | anchor-topology-包含 | 10.49% | 0.00% | 0.00% |
| Pass 3.1.2 | anchor-topology-方向 | 41.55% | 50.00% | 74.07% |
| Pass 3.2 | anchor-topology-自由 | 0.39% | 0.00% | 5.56% |
| Pass 4 | region-text-optimal | 0.58% | 10.00% | 1.85% |
| Pass 4 | region-text-global-rescue | 0.19% | 0.00% | 0.00% |
| Pass 5 | text-position | 0.00% | 0.00% | 1.85% |
| Pass 5.3 | container-iou | 1.17% | 5.00% | 1.85% |
| Pass 6 | container-geometry | 0.19% | 0.00% | 0.00% |
| Pass 6.5 | spatial-bracket | 0.19% | 0.00% | 7.41% |
| Pass 7 | rescue-iou | 0.00% | 0.00% | 1.85% |

前三 Pass（Pass 3.1.2 `anchor-topology-方向`、Pass 1 `text-content`、Pass 3.1.1 `anchor-topology-包含`）贡献了 **92.62%** 的正确匹配，是匹配算法核心支柱。`text-position`、`rescue-iou` 两个兜底 Pass 完全无效，建议评审是否保留或重构。

### ④ 优化建议

1. **case7 缺失 10 个节点**：缺失较多，建议检查开发侧解析流程或该 case 特有结构是否被正确处理。 → 建议对比设计侧与开发侧节点列表，确认缺失节点是否在解析阶段被过滤。
2. **case14 准确率偏低（55.26%）**：多余对多达 11 个，产生大量假阳性。 → 建议收紧 Pass 3/Pass 4 的匹配阈值。
3. **anchor-topology-方向 产生大量多余配对（40 对）**：该 Pass 贡献了最多多余对，匹配条件过于宽松。 → 建议优化阈值或引入后置过滤。
4. **text-position / rescue-iou 完全无效**：正确数为 0，仅贡献多余对。 → 建议评估是否删除这两个 Pass，或检查其实现逻辑是否被前置 Pass 完全覆盖。

### ⑤ 问题明细

#### case1

**配错（3对）**
| arkuiId | 实际 designId | 期望 designId | matchType |
|---|---|---|---|
| 2054 | 14:2217 | 60:50 | anchor-topology-方向 |
| 1868 | 14:2264 | 14:2262 | text-content |
| 1870 | 14:2266 | 14:2264 | anchor-topology-方向 |

**缺失（4对）**
| arkuiId | 期望 designId |
|---|---|
| 1719 | 60:316 |
| 1726 | 60:324 |
| 1727 | 60:325 |
| 1792 | 14:2238 |

**多余（4对）**
| arkuiId | 实际 designId | matchType |
|---|---|---|
| 1788 | 14:2238 | anchor-topology-方向 |
| 1964 | 14:2257 | anchor-topology-方向 |
| 1878 | 14:2262 | anchor-topology-自由 |
| 1723 | 60:324 | anchor-topology-方向 |

#### case2

**缺失（6对）**
| arkuiId | 期望 designId |
|---|---|
| 1697 | 15:4506 |
| 1714 | 15:4492 |
| 5456 | 15:4303 |
| 5540 | 15:4305 |
| 5578 | 15:3873 |
| 5730 | 15:4706 |

**多余（5对）**
| arkuiId | 实际 designId | matchType |
|---|---|---|
| 5604 | 15:3873 | anchor-topology-方向 |
| 1731 | 15:4492 | anchor-topology-方向 |
| 5869 | 15:4506 | anchor-topology-方向 |
| 5868 | 15:4598 | spatial-bracket |
| 5871 | 15:4604 | anchor-topology-方向 |

#### case3

**缺失（3对）**
| arkuiId | 期望 designId |
|---|---|
| 1370 | 306:74968 |
| 1372 | 306:74986 |
| 1380 | 306:75001 |

**多余（2对）**
| arkuiId | 实际 designId | matchType |
|---|---|---|
| 662 | 306:74874 | anchor-topology-方向 |
| 1230 | 312:54 | text-position |

#### case4

**配错（1对）**
| arkuiId | 实际 designId | 期望 designId | matchType |
|---|---|---|---|
| 489 | 17:23530 | 17:23542 | anchor-topology-方向 |

**缺失（2对）**
| arkuiId | 期望 designId |
|---|---|
| 117 | 17:24807 |
| 325 | 17:24290 |

**多余（5对）**
| arkuiId | 实际 designId | matchType |
|---|---|---|
| 262 | 17:22193 | anchor-topology-方向 |
| 335 | 17:23518 | text-row-slot |
| 326 | 17:24290 | text-row-slot |
| 437 | 17:24654 | anchor-topology-方向 |
| 116 | 17:24807 | anchor-topology-自由 |

#### case5

**配错（2对）**
| arkuiId | 实际 designId | 期望 designId | matchType |
|---|---|---|---|
| 2659 | 51:26564 | 51:26281 | anchor-topology-方向 |
| 2950 | 51:27038 | 51:26628 | anchor-topology-方向 |

**缺失（1对）**
| arkuiId | 期望 designId |
|---|---|
| 2974 | 51:26297 |

**多余（2对）**
| arkuiId | 实际 designId | matchType |
|---|---|---|
| 2816 | 51:26496 | anchor-topology-方向 |
| 467 | 51:26596 | rescue-iou |

#### case7

**配错（4对）**
| arkuiId | 实际 designId | 期望 designId | matchType |
|---|---|---|---|
| 2333 | 56:69678 | 56:69700 | anchor-topology-方向 |
| 2263 | 56:69700 | 56:69803 | text-content |
| 2242 | 56:71140 | 56:71149 | text-content |
| 2323 | 56:71143 | 56:69678 | anchor-topology-方向 |

**缺失（10对）**
| arkuiId | 期望 designId |
|---|---|
| 1802 | 56:69836 |
| 2253 | 56:69781 |
| 2258 | 56:69792 |
| 2268 | 56:69548 |
| 2273 | 56:69528 |
| 2283 | 56:69519 |
| 2288 | 56:69577 |
| 2293 | 56:69588 |
| 2303 | 56:69640 |
| 2318 | 56:69669 |

**多余（2对）**
| arkuiId | 实际 designId | matchType |
|---|---|---|
| 1953 | 56:71066 | anchor-topology-方向 |
| 2236 | 56:71109 | anchor-topology-方向 |

#### case8

**缺失（4对）**
| arkuiId | 期望 designId |
|---|---|
| 2699 | 56:76254 |
| 2704 | 56:76255 |
| 2878 | 56:76153 |
| 2911 | 56:76167 |

**多余（3对）**
| arkuiId | 实际 designId | matchType |
|---|---|---|
| 2642 | 56:76082 | container-iou |
| 2914 | 56:76153 | anchor-topology-方向 |
| 3062 | 56:76243 | anchor-topology-方向 |

#### case9

**配错（2对）**
| arkuiId | 实际 designId | 期望 designId | matchType |
|---|---|---|---|
| 413 | 56:86906 | 56:86903 | anchor-topology-方向 |
| 391 | 56:86935 | 56:86934 | text-role |

**缺失（1对）**
| arkuiId | 期望 designId |
|---|---|
| 388 | 56:86935 |

**多余（2对）**
| arkuiId | 实际 designId | matchType |
|---|---|---|
| 405 | 56:86855 | anchor-topology-方向 |
| 431 | 56:86894 | anchor-topology-方向 |

#### case11

**缺失（2对）**
| arkuiId | 期望 designId |
|---|---|
| 1327 | 60:70019 |
| 1418 | 60:69310 |

**多余（1对）**
| arkuiId | 实际 designId | matchType |
|---|---|---|
| 1456 | 60:69291 | spatial-bracket |

#### case12

**配错（2对）**
| arkuiId | 实际 designId | 期望 designId | matchType |
|---|---|---|---|
| 1639 | 72:64227 | 72:65527 | region-text-optimal |
| 481 | 72:66892 | 72:64139 | container-iou |

**缺失（3对）**
| arkuiId | 期望 designId |
|---|---|
| 337 | 72:67239 |
| 795 | 72:65536 |
| 1837 | 72:67211 |

**多余（13对）**
| arkuiId | 实际 designId | matchType |
|---|---|---|
| 540 | 72:64095 | anchor-topology-方向 |
| 982 | 72:64217 | anchor-topology-方向 |
| 979 | 72:64218 | anchor-topology-方向 |
| 987 | 72:64219 | anchor-topology-方向 |
| 992 | 72:64220 | anchor-topology-方向 |
| 984 | 72:64222 | anchor-topology-方向 |
| 989 | 72:64223 | anchor-topology-方向 |
| 977 | 72:64224 | anchor-topology-方向 |
| 899 | 72:64272 | spatial-bracket |
| 896 | 72:64273 | spatial-bracket |
| 834 | 72:65533 | anchor-topology-方向 |
| 924 | 72:67211 | anchor-topology-方向 |
| 336 | 72:67239 | anchor-topology-自由 |

#### case13

**缺失（1对）**
| arkuiId | 期望 designId |
|---|---|
| 71996 | 2:9599 |

**多余（2对）**
| arkuiId | 实际 designId | matchType |
|---|---|---|
| 71694 | 2:9355 | anchor-topology-方向 |
| 71988 | 2:9618 | anchor-topology-方向 |

#### case14

**配错（6对）**
| arkuiId | 实际 designId | 期望 designId | matchType |
|---|---|---|---|
| 404 | 50:23168 | 50:23243 | text-content |
| 388 | 50:23224 | 50:23225 | anchor-topology-方向 |
| 398 | 50:23225 | 50:23242 | anchor-topology-方向 |
| 382 | 50:23242 | 50:23224 | text-content |
| 340 | 50:23243 | 50:23153 | text-content |
| 356 | 58:203 | 50:23168 | region-text-optimal |

**缺失（7对）**
| arkuiId | 期望 designId |
|---|---|
| 204 | 50:23136 |
| 296 | 50:23264 |
| 326 | 50:23154 |
| 342 | 50:23161 |
| 358 | 50:23172 |
| 374 | 50:23226 |
| 390 | 50:23244 |

**多余（11对）**
| arkuiId | 实际 designId | matchType |
|---|---|---|
| 107 | 50:23004 | anchor-topology-方向 |
| 256 | 50:23026 | anchor-topology-方向 |
| 252 | 50:23028 | anchor-topology-方向 |
| 324 | 50:23153 | region-text-optimal |
| 245 | 50:23286 | anchor-topology-方向 |
| 237 | 50:23386 | anchor-topology-方向 |
| 235 | 50:23406 | anchor-topology-方向 |
| 239 | 50:23428 | anchor-topology-方向 |
| 241 | 50:23433 | anchor-topology-方向 |
| 423 | 50:23665 | anchor-topology-方向 |
| 437 | 58:362 | anchor-topology-方向 |

#### case15

**多余（2对）**
| arkuiId | 实际 designId | matchType |
|---|---|---|
| 4626 | 121:69434 | long-text-fallback |
| 1316 | 128:46 | anchor-topology-方向 |
