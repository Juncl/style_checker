---
name: UI设计一致性检查
description: UI设计页面一致性检查能力。支持采集鸿蒙 ArkUI 开发侧数据、采集 Web 页面 DOM 数据、采集设计稿数据、对比设计稿与开发实现输出差异修改清单。当用户提到 UI 一致性检查、设计稿对比、采集开发侧/设计侧数据、找差异等场景时加载本 skill。
---

## 🔴 硬性规则：禁止修改 skill 源码

skill 所有文件均为只读，tool 失败时只能重新调用、调整参数或向用户求助，绝不修改源码。

---

## 能力总览

| 命令 | 用途 | 输出 |
|------|------|------|
| `collect-arkui` | 采集鸿蒙 ArkUI 开发侧数据（仅 Windows） | devJsonPath, devImagePath |
| `collect-web` | 采集 Web 页面 DOM 树 + 截图 | devJsonPath, devImagePath |
| `collect-design` | 采集设计稿数据 + 截图 | designJsonPath, designImagePath, account |
| `ui-style-check` | UI 一致性检查 | 节点差异 + md + HTML + Excel + textPairs |
| `add-text-tab` | 向已有 Excel 追加「文案对比」工作表 | added, count |
| `batch-pair` | 批量配对（N×M 算配对度，输出最优配对） | pairs, unmatchedDev, unmatchedDesign |
| `batch-summary` | 批量汇总（读多组 result.json → 输出 all.md） | groups, outputPath |

调用方式：`ui-param-diff <command> [options]`，或 `node <skill目录>/bin/ui-param-diff.js <command> [options]`。首次使用前需 `npm install --omit=dev`。

---

## 主线：UI 一致性检查

需要**设计侧**和**开发侧**两份数据，两侧就绪后执行 `ui-style-check`。采集只能用本 skill 自带命令，禁止调用其他 MCP 工具采集。

```
用户意图：UI 一致性检查 / 设计稿对比 / 找差异
  │
  ├── 判断开发侧数据来源
  │   ├── 本地 .json 文件路径 → 已采集数据，直接作为 --dev-json / --dev-image
  │   ├── 本地 .html 文件路径 → 先执行 collect-web（采集 HTML 的 DOM）
  │   ├── 网页 URL → 先执行 collect-web
  │   └── 鸿蒙设备 → 先执行 collect-arkui（仅 Windows）
  │
  ├── 判断设计侧数据来源
  │   ├── 本地文件路径 → 直接作为 --design-json / --design-image
  │   └── 传送码 / 设计稿 URL → 先执行 collect-design
  │
  └── 两侧就绪 → 执行 ui-style-check
```

**数据来源判断规则：**
- `http://` 或 `https://` 开头 → URL
- 纯数字或短字符串（如 `111`）→ 传送码
- `.json` 结尾 → 已采集的 JSON 数据文件，直接传给 `ui-style-check`
- `.html` 结尾 → 本地 HTML 源文件，走 `collect-web` 采集 DOM
- `/` 或盘符（如 `C:\`）开头且无上述后缀 → 按本地文件路径，根据上下文判断是 JSON 数据还是 HTML 源文件

**两侧采集相互独立**：一侧中断不阻塞另一侧。中断后向用户提供恢复选项（重新采集 / 手动提供文件路径），待两侧都就绪后再执行 `ui-style-check`。

### 🔵 用户未提供任何数据时的引导

当用户只说"帮我做 UI 检查/一致性检查/找差异"但**没有提供任何数据**时，**不要直接执行任何命令**，先向用户列出需要提供的信息，引导用户逐项补充：

本检查需要两份数据，缺一不可：

**① 开发侧数据**（提供其一即可）：
- 本地文件路径（`arkui.json` 或 `web.json`，附截图 `png/jpg`）→ 直接作为 `--dev-json` / `--dev-image`
- 网页 URL 或本地 HTML 文件路径 → 执行 `collect-web` 自动采集（Web 平台）
- 鸿蒙设备 → 执行 `collect-arkui` 自动采集（仅 Windows，需连接设备）

**② 设计侧数据**（提供其一即可）：
- 本地文件路径（`design.json`，附截图 `png/jpg`）→ 直接作为 `--design-json` / `--design-image`
- 传送码（如 `111`）或设计稿 URL → 执行 `collect-design` 自动采集

**③ 平台类型**（可选，默认 `hmPhone`）：`hmPhone`（鸿蒙手机）/ `hmWatch`（鸿蒙手表）/ `web`（Web 网页）

请把上述清单整理成易读的文字发给用户，等用户逐项提供、两侧数据都就绪后再执行采集或检查命令。**如果用户只提供了一侧数据，继续追问缺失的那一侧，不要只拿一侧数据就执行检查。**

> 此时向用户提供使用指南链接：`{{SKILL_GUIDE_URL}}`（其他场景是否给指南见下方「tool 失败处理」）

---

## 命令详细参数

> **通用参数**：所有命令都支持 `--cwd <项目目录>`（可选），用于指定采集结果和报告的保存位置。**默认使用当前工作目录，无需向用户询问**。仅在用户明确要求保存到其他目录时才需要传入。

### collect-arkui

```bash
ui-param-diff collect-arkui [--cwd <项目目录>] [--timeout 60000]
```

- `--timeout`: 采集超时时间（ms），默认 60000
- 仅 Windows 可用
- 输出：`{"devJsonPath":"...","devImagePath":"..."}`

### collect-web

```bash
ui-param-diff collect-web [--cwd <项目目录>] --url <url或本地HTML路径> [--width 1920] [--height 1080] [--scale-factor 2] [--headless true]
```

- `--url`: 目标页面地址（必填），支持两种格式：
  - Web 页面 URL（`http://` 或 `https://` 开头）→ puppeteer 打开网页采集
  - 本地 HTML 文件路径（如 `/path/to/page.html`）→ 自动转 `file://` 协议打开本地文件采集
- `--width`: 视口宽度，默认 1920
- `--height`: 视口高度，默认 1080
- `--scale-factor`: 截图倍率，默认 2
- `--headless`: 无头模式，`true`（默认）或 `false`
- 输出：`{"devJsonPath":"...","devImagePath":"..."}`

### collect-design

```bash
ui-param-diff collect-design [--cwd <项目目录>] --code <传送码> | --url <设计稿URL>
```

- `--code`: 传送码（如 `111`）
- `--url`: 设计稿 URL
- `--code` 和 `--url` 至少传一个，同时传时 code 优先
- 采集结果保存到 `--cwd` 指定的项目目录下的 `.devlint/` 子目录中
- 输出：`{"designJsonPath":"...","designImagePath":"...","account":"x123456"}`

### ui-style-check

```bash
ui-param-diff ui-style-check [--cwd <项目目录>] \
  --design-image <path> \
  --dev-image <path> \
  [--design-json <path>] \
  [--dev-json <path>] \
  [--platform hmPhone|hmWatch|web] \
  [--account <账号>] \
  [--text-rules <文案规则文本文件路径>]
```

- `--design-image`: 设计稿截图路径（**必填**，图图对比最小输入）
- `--dev-image`: 开发侧截图路径（**必填**，图图对比最小输入）
- `--design-json`: 设计稿 JSON 文件路径（可选，传了则进入双轨比对模式）
- `--dev-json`: 开发侧 JSON 文件路径（可选，与 `--design-json` 配对使用）
- `--platform`: 平台类型，默认 hmPhone
- `--account`: 用户账号字符串（可选），来自 collect-design 返回的 account，透传用于打点；未传时自动用本机 IP 兜底
- `--text-rules`: 文案规则文本文件路径（可选，仅双轨比对模式）。用户传了才触发文案走查，规则始终针对开发侧文案（设计侧文案不报）
- 模式判断：
  - 只传 `--design-image` + `--dev-image`（无 JSON）→ **图图对比模式**
  - 同时传 JSON + 图 → **双轨比对模式**
- 输出：`{"platform":"...","nodes":[...],"totalNodes":N,"reportPath":"...","htmlReportPath":"...","excelReportPath":"..."}`
  - 图图对比模式：`reportPath`/`htmlReportPath` 为 null，仅输出 `excelReportPath`
  - 双轨比对模式：三份报告（md + HTML + Excel）齐全；传了 `--text-rules` 时额外输出 `textPairs`
- 工具内部读取文件，**文件内容不占用 AI 上下文**

### add-text-tab

```bash
ui-param-diff add-text-tab --excel <Excel路径> --text-issues <文案差异JSON路径> \
  [--design-image <path>] [--dev-image <path>] \
  [--design-canvas-w <num>] [--design-canvas-h <num>] \
  [--dev-canvas-w <num>] [--dev-canvas-h <num>]
```

- 向 Excel 追加「文案对比」工作表(表头：id/页面/模块/严重等级/设计稿文案/开发文案/问题描述/修复建议/设计稿截图/开发截图)
- 图片路径+画布尺寸由参数传入(与 ui-style-check 相同的值),用于切图
- 无文案差异时不追加

---

## 采集 → 检查串联规则

采集命令返回的路径**直接传给** `ui-style-check`：

| 采集命令返回字段 | ui-style-check 参数 |
|---|---|
| `devJsonPath` | `--dev-json` |
| `devImagePath` | `--dev-image` |
| `designJsonPath` | `--design-json` |
| `designImagePath` | `--design-image` |
| `account` | `--account` |

采集完成后应**自动执行** `ui-style-check`，不需要用户再次确认。

### platform 设置

| 开发侧来源 | platform |
|---|---|
| collect-arkui | `hmPhone`（默认） |
| collect-web | `web` |
| 本地文件 | 根据文件名判断（arkui.json → hmPhone，web.json → web） |

---

## 两种比对模式

### 图图对比模式（只传图）

当用户只提供两张图（设计稿截图 + 开发侧截图），没有 JSON 数据时，`ui-style-check` 自动进入**图图对比模式**：

- 调用 server `/api/check/pixel-diff`，做局部图对比（对齐 → 灰度 diff → 连通域聚类 → 差异块）
- 输出局部图差异块列表（bbox + 差异率 + 严重等级）
- 生成 Excel 报告（仅局部图对比工作表）
  - 无节点信息时，「模块」列填差异块位置描述（坐标 + 尺寸）
  - 「修复建议」列填"请对照设计稿核对该区域视觉"
  - 「设计稿截图」「开发截图」列按差异块 bbox 裁切局部图

### 双轨比对模式（JSON + 图）

同时传 JSON 和图时，两侧比对并行执行，结果合并去重：

1. **节点树比对**：调 `/api/check/upload`，得到节点属性差异
2. **局部图对比**：调 `/api/check/pixel-diff`（附带节点列表，server 按节点 rect 区域逐个对比）
3. **合并去重**：skill 侧 `mergeDiffs` 按节点归并
4. 输出 md + HTML + Excel 三份报告

---

## 文案走查（仅双轨比对模式 + 用户主动提供规则时触发）

用户传 `--text-rules <path>` 时才触发文案走查，不传则跳过。规则内容不固定，但**始终针对开发侧文案**（设计侧文案不报）:

- 可能只约束开发侧（如「按钮文案不超过 6 个字」）
- 可能用设计侧文案约束开发侧（如「开发稿文案需与设计稿一致」）
- 无论哪种，只报开发侧的问题，设计侧文案即使有问题也不报

AI 拿到 `textPairs`（每对含 designText/arkuiText/designRect/devRect）后，**按用户规则语义**判断开发侧文案是否违规：

1. AI 逐对判断开发侧文案是否违反用户规则
2. 将违规的写成 JSON 数组文件：

```json
[{"id":"TXT-001","nodeId":"224","nodeName":"Text","severity":"high","designText":"畅享套餐","devText":"会员活动","reason":"违反规则:开发稿文案需与设计稿一致","suggestion":"改为畅享套餐","designRect":{"x":1,"y":2,"w":3,"h":4},"devRect":{"x":1,"y":2,"w":3,"h":4}}]
```

3. AI 调 `add-text-tab` 追加到 Excel 第三工作表：

```bash
ui-param-diff add-text-tab --excel <excelReportPath> --text-issues <issues.json> \
  --design-image <design.png> --dev-image <arkui.png> \
  --design-canvas-w <w> --design-canvas-h <h> \
  --dev-canvas-w <w> --dev-canvas-h <h>
```

无违规时不调用。

---

## Excel 报告

- 路径在返回 JSON 的 `excelReportPath` 字段
- **节点对比**工作表：id/页面/模块/严重等级/问题类型/问题描述/差异/修复建议/设计稿截图/开发截图（问题类型为具体分类如字号/字体颜色/填充/圆角，按节点 y 坐标排序）
- **局部图对比**工作表：id/页面/模块/严重等级/问题类型/问题描述/设计稿截图/开发截图（差异率 ≥35% 才报，按差异率从高到低排序；35%-60% low，60%-85% mid，>85% high）
- **文案对比**工作表：id/页面/模块/严重等级/设计稿文案/开发文案/问题描述/修复建议/设计稿截图/开发截图（由 `add-text-tab` 追加）
- 节点 id 和模块统一用开发侧（arkui）
- 「设计稿截图」「开发截图」列按 rect 裁切局部图嵌入

---

## ui-style-check 结果呈现规则

拿到结果后，按以下格式展示给用户：

1. **每个设计节点作为一个分组**展示
2. 展示 **componentChain**（组件层级链），帮助开发者定位代码位置
3. web 平台额外标注 **devClassName**（className），arkui 平台用 componentChain 定位
4. 标注节点在页面中的**相对位置**（用 designRect 概括，如"位于页面顶部"）
5. 每条差异以**修改指令**格式输出：
   - 「属性」期望 expected，当前为 actual，需修改
6. **不要展示**评分、匹配覆盖率、检查耗时等统计信息
7. **不要展示**节点 ID、原始 path 数组等内部技术信息
8. 如果没有差异，直接说 **"开发侧与设计稿一致，无需修改"**
9. 完整问题清单见 **reportPath** 指向的 md 文件，后续修改代码时直接读该文件
10. 可视化报告见 **htmlReportPath** 指向的 HTML 文件，浏览器打开可查看交互式差异列表（筛选/折叠/精准-模糊切换）
11. Excel 报告见 **excelReportPath**：节点对比（属性差异）+ 局部图对比（差异率 ≥35%）两个工作表
12. **双轨比对模式**下传了 `--text-rules` 时，结果含 **textPairs**，需执行文案走查（见「文案走查」小节），完成后调 `add-text-tab` 把文案差异追加到 Excel 第三工作表

---

## 🔴 tool 失败处理策略

### 总原则

1. **失败即止步**：tool 返回错误（非零退出码 / stderr 有 `✗` / `isError: true`）时，**立即停止当前串联流程**，不要假装成功继续往下走
2. **重试上限 2 次**：同一 tool 同一参数最多重试 2 次（含首次共 3 次调用）。超过后**停止重试**，向用户报告失败
3. **禁止静默吞错**：不要忽略 stderr 错误信息继续执行，必须将错误原因如实告知用户
4. **向用户求助**：重试耗尽或无法自动恢复时，**停下来让用户决定下一步**，不要自行猜测原因反复尝试

### 何时附上使用指南

| 场景 | 是否给指南 |
|---|---|
| 用户什么都没提供、正在引导补充数据 | ✅ 给指南 `{{SKILL_GUIDE_URL}}` |
| `collect-design` 传送码无效 / 设计稿 URL 无法访问 / 采集超时 | ✅ 给指南 |
| `collect-web` URL 无法访问 / 采集超时 | ❌ 不给指南 |
| `collect-arkui` 非 Windows / 采集超时 | ❌ 不给指南 |
| `ui-style-check` server 不可达 / 文件不存在 / 检查超时 | ❌ 不给指南 |
| 检查正常完成、有差异结果 | ❌ 不给指南 |

### 各 tool 失败处理

| tool | 失败场景 | 处理方式 |
|---|---|---|
| `collect-arkui` | 非 Windows / 启动失败 / 超时 | 继续设计侧采集；向用户提供：① Windows 环境重试 ② 手动提供 arkui.json/arkui.png 路径跳过采集 |
| `collect-web` | 登录超时 / 导航超时 / 证书拦截 | 继续设计侧采集；向用户提供：① `--headless false` 有头模式重试 ② 手动提供 web.json/web.png 路径跳过采集 |
| `collect-design` | 传送码无效 / 采集超时 / 网络错误 | 向用户提供：① 检查传送码后重新采集 ② 手动提供 design.json/design.png 路径 ③ 附上使用指南链接 `{{SKILL_GUIDE_URL}}` |
| `ui-style-check` | server 不可达 / 文件不存在 / 检查超时 / 局部图对比失败 / Excel 生成失败 | 局部图对比或 Excel 失败时 stderr 提示，不阻塞其他报告生成；向用户提供：① 确认检查服务是否正常运行 ② 确认文件路径是否正确 ③ 重试一次 |

### 严格禁止的失败处理方式

- ❌ 失败后跳过该 tool，用空数据或假数据继续往下走
- ❌ 失败后无限重试（同一参数调用超过 3 次）
- ❌ 失败后不告知用户，自行更换参数反复尝试
- ❌ 忽略 stderr 错误信息，假装成功

---

## 环境要求

- `collect-arkui` 只能在 **Windows** 上执行（依赖 ArkUI Inspector 导出工具）
- `collect-web` 和 `collect-design` 需要 **Chrome 浏览器**（自动查找，或通过 `CHROME_PATH` 环境变量指定）
- 工具内部读取文件，**文件内容不占用 AI 上下文**

---

## 批量检查（用户提供多组文件时触发）

当用户提供超过 2 个文件路径，**或明确说"批量"/"多组"/"一起检查"** 时，识别为批量模式。AI 负责编组、配对、逐组执行、汇总。

### 1. AI 编组

按文件名区分侧（`design*` → 设计侧，`arkui*`/`web*` → 开发侧），按组聚类（同前缀/同目录的 json+png 为一组）。

### 2. batch-pair（N×M 算配对度）

```bash
ui-param-diff batch-pair \
  --dev-groups "dev1.json,dev1.png" "dev2.json,dev2.png" \
  --design-groups "design1.json,design1.png" "design2.json,design2.png" \
  --platform hmPhone \
  --output <batch目录>/pairs.json
```

- N×M 调 server `/api/check/pair-score`（只做 parse+match，不含比对）
- 配对度 = 绝对匹配率×0.3 + 覆盖率×0.2 + 高可信占比×0.2 + 文本匹配率×0.3
- 纯图模式（无 json）用图片相似度（pHash）配对，不调 server
- 贪心配对（按配对度降序，已配过的跳过）
- N≠M 时配对 min(N,M) 组，多余标"未配对"
- 输出 pairs.json（含配对结果 + 未配对清单）

### 3. AI 确认配对

读 pairs.json，展示配对结果给用户。未配对的文件列出，提示用户补充。

### 4. 逐组执行（串行，避免资源爆）

```bash
ui-param-diff ui-style-check \
  --design-json <designN.json> --dev-json <devN.json> \
  --design-image <designN.png> --dev-image <devN.png> \
  --group-dir <batch目录>/devN_designN \
  --save-result <batch目录>/devN_designN/result.json \
  --pair-score <配对度> --group-name devN_designN
```

每组独立执行，失败不阻塞，继续下一组。每组子文件夹含 md/html/excel + result.json。

### 5. batch-summary 汇总

```bash
ui-param-diff batch-summary \
  --results <batch目录>/group1/result.json,<batch目录>/group2/result.json \
  --output <batch目录>/all.md
```

输出 `all.md`（总览表格 + 各组详情 + 报告链接），向用户展示。

### 批量目录结构

```
.octo-uxlint/batch_<时间戳>/       ← 报告根目录下,每次批量一个目录
├── all.md                         ← 汇总文档
├── pairs.json                     ← 配对结果
├── <时间戳>_group1/               ← 每组子文件夹
│   ├── octo_uxlint_result.md
│   ├── octo_uxlint_result.html
│   ├── octo_uxlint_result.xlsx
│   └── result.json
├── <时间戳>_group2/
│   └── ...
```

---

## 决策检查清单

执行命令前逐项确认：

- [ ] 开发侧数据来源是什么？（本地文件 / URL / 鸿蒙设备）
- [ ] 设计侧数据来源是什么？（本地文件 / 传送码 / URL）
- [ ] 两侧数据是否都已就绪？（未就绪先采集，采集完自动串联）
- [ ] 两侧是否至少都有图？（图图对比最小输入；有 JSON 无图无法运行）
- [ ] platform 设置是否正确？
- [ ] 采集中断后是否继续了另一侧的采集？
- [ ] 用户是否传了 `--text-rules`？（传了才做文案走查）
- [ ] 是否批量模式？（>2 个文件 → 批量：编组→配对→逐组执行→汇总）
