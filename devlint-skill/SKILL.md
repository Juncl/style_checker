---
name: devlint-skill
description: UI 一致性检查与设计规范检查能力。支持采集鸿蒙 ArkUI 开发侧数据、采集 Web 页面 DOM 数据、采集 Pixso 设计稿数据、对比设计稿与开发实现输出差异修改清单、模糊匹配设计规范名并检查页面是否符合规范、视觉检查对比两张截图输出差异清单。当用户提到 UI 一致性检查、设计稿对比、采集开发侧/设计侧数据、设计规范检查、规范名匹配、图图对比、视觉检查、对比图片等场景时加载本 skill。
---

## 🔴 硬性规则：禁止修改 skill 源码

**skill 的所有文件（`bin/`、`src/`、`SKILL.md`、`install.js`、`package.json` 等）均为只读，绝对不允许修改。**

- ❌ 禁止：tool 失败时尝试"修复"skill 源码（改 `bin/devlint-skill.js`、改 `src/lib/` 下任何文件）
- ❌ 禁止：新增/删除/重命名 skill 目录下的文件
- ❌ 禁止：编辑 `SKILL.md` 内容
- ❌ 禁止：修改 `package.json` 依赖或版本号

**tool 失败时的正确处理**：
1. 读取 stderr 错误信息，分析失败原因
2. 向用户说明原因并提供恢复选项（重新采集 / 手动提供文件路径）
3. 如确认是 skill 本身的 bug，告知用户联系维护者，**不要自己动手改源码**

> ⚠️ 之前出现过 tool 失败后 agent 陷入死循环、擅自修改 skill 源码导致环境损坏的事故。任何失败都只能通过重新调用、调整参数或向用户求助来解决，绝不修改源码。

---

## 能力总览

本 skill 通过 `devlint-skill` 命令行工具提供 7 个能力，使用 bash 工具调用：

| 命令 | 用途 | 输出 |
|------|------|------|
| `collect-arkui` | 采集鸿蒙 ArkUI 开发侧数据（仅 Windows） | devJsonPath, devImagePath |
| `collect-web` | 采集 Web 页面 DOM 树 + 截图 | devJsonPath, devImagePath |
| `collect-design` | 采集 Pixso 设计稿数据 + 截图 | designJsonPath, designImagePath, account |
| `ui-style-check` | 对比设计稿与开发实现，输出差异清单（基于节点树 JSON 算法比对） | 问题节点 JSON + md 报告路径 |
| `list-design-specs` | 模糊匹配规范名/场景名，返回规则文件路径列表 | filePaths 或候选列表 JSON |
| `design-spec-check` | 检查 HTML/URL 是否符合设计规范（需先调 list-design-specs） | 问题清单 JSON |
| `ai-img-check` | 视觉检查，取 prompt → 看对话图 → 输出差异 JSON → 生成 HTML 标注图 | htmlPath + totalDiffs + overallLevel + score |

---

## 命令调用方式

本 skill 的可执行入口位于 skill 目录下的 `bin/devlint-skill.js`。

**调用方式**（按优先级尝试）：

1. 如果 `devlint-skill` 已注册到 PATH：
   ```bash
   devlint-skill <command> [options]
   ```

2. 如果 `command not found`，使用 node 直接执行 skill 目录下的入口：
   ```bash
   node <skill目录>/bin/devlint-skill.js <command> [options]
   ```

**首次使用前**，如果依赖未安装，需先在 skill 目录执行 `npm install --omit=dev`。

---

## 两条主线

### 主线一：UI 一致性检查

需要**设计侧**和**开发侧**两份数据，两侧就绪后执行 `ui-style-check`。

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

### 主线二：设计规范检查

```
用户意图：设计规范检查 / 规范走查 / 检查是否符合 Octo 规范
  │
  ├── 1. 先调 list-design-specs 匹配规范
  │     list-design-specs [--standard-name <规范名>] [--scene-name <场景名>]
  │     ├── matched=true  → 拿到 filePaths，进入步骤 2
  │     ├── stage=standard → 展示规范候选，用户选定后用完整 standardName 重新调用
  │     └── stage=scene    → 展示场景候选，用户选定后用 standardName + sceneName 重新调用
  │
  └── 2. 拿到 filePaths 后调 design-spec-check
        design-spec-check --source <HTML路径或URL> --spec-file-paths <path1,path2,...>
```

**规范名拆分规则**：用户给"Octo Web端深色"这种组合时，拆成 `--standard-name Octo --scene-name Web端深色` 分别传入。用户只说"octo"则只传 `--standard-name octo`。用户没给任何名称则都不传，返回全量规范列表让用户选。

### 主线三：视觉检查

用户已把**设计稿截图**和**开发侧截图**两张图片传入对话，agent 直接看图做视觉比对。无需采集节点树 JSON。

两步操作：

1. `ai-img-check --mode prompt` → 取回 system prompt
2. 看对话中的两张截图 + prompt → 输出简短总结 + 差异 JSON（含归一化坐标）→ 把 JSON 写入文件 → 调 `ai-img-check --mode build --diff-file <json> --design-image <img> --dev-image <img>` 生成 HTML 标注图

```
用户意图：图图对比 / 视觉检查 / 对比图片
  │
  └── 用户已在对话中传入两张截图
      ├── ai-img-check --mode prompt                                          取 prompt
      ├── 看对话中的两张图 + prompt → 输出简短总结 + 差异 JSON → 写入文件（如 diff.json）
      └── ai-img-check --mode build --diff-file diff.json --design-image <设计稿图> --dev-image <实现图>
          → 生成 HTML 标注图（红框/黄框叠在图上 + 差异清单表格）→ 返回 htmlPath
          → 告诉用户用浏览器打开 htmlPath 查看
```

全程不调 server `/img/checker`，不占 server VLM 额度。

**与 `ui-style-check` 的区别与关系**：
- `ui-style-check`：基于**节点树 JSON** 的算法比对，精确到属性值，需要采集结构化数据
- `ai-img-check`：基于**截图**的视觉比对，直观，适合无结构化数据的场景或作为算法结果的补充
- 两者可独立使用，也可先后使用互相印证

---

## 命令详细参数

> **通用参数**：所有命令都支持 `--cwd <项目目录>`（可选），用于指定采集结果和报告的保存位置。**默认使用当前工作目录，无需向用户询问**。仅在用户明确要求保存到其他目录时才需要传入。

### collect-arkui

```bash
devlint-skill collect-arkui [--cwd <项目目录>] [--timeout 60000]
```

- `--timeout`: 采集超时时间（ms），默认 60000
- 仅 Windows 可用
- 输出：`{"devJsonPath":"...","devImagePath":"..."}`

### collect-web

```bash
devlint-skill collect-web [--cwd <项目目录>] --url <url或本地HTML路径> [--width 1920] [--height 1080] [--scale-factor 2] [--headless true]
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
devlint-skill collect-design [--cwd <项目目录>] --code <传送码> | --url <设计稿URL>
```

- `--code`: 传送码（如 `111`）
- `--url`: 设计稿 URL
- `--code` 和 `--url` 至少传一个，同时传时 code 优先
- 采集结果保存到 `--cwd` 指定的项目目录下的 `.devlint/` 子目录中
- 输出：`{"designJsonPath":"...","designImagePath":"...","account":"x123456"}`

### ui-style-check

```bash
devlint-skill ui-style-check [--cwd <项目目录>] \
  --design-json <path> \
  --dev-json <path> \
  [--platform hmPhone|hmWatch|web] \
  [--design-image <path>] \
  [--dev-image <path>] \
  [--account <账号>]
```

- `--design-json`: 设计稿 JSON 文件路径（必填）
- `--dev-json`: 开发侧 JSON 文件路径（必填）
- `--platform`: 平台类型，默认 hmPhone
- `--design-image`: 设计稿截图路径（可选）
- `--dev-image`: 开发侧截图路径（可选）
- `--account`: 用户账号字符串（可选），来自 collect-design 返回的 account，透传用于打点；未传时自动用本机 IP 兜底
- 输出：`{"platform":"...","nodes":[...],"totalNodes":N,"reportPath":"..."}`
- 工具内部读取文件，**文件内容不占用 AI 上下文**

### list-design-specs

```bash
devlint-skill list-design-specs [--cwd <项目目录>] [--standard-name <规范名>] [--scene-name <场景名>]
```

- `--standard-name`: 规范名或分类名（可选，模糊匹配），如 `Octo`、`ICT 领域组件库`、`octo`
- `--scene-name`: 场景名（可选，模糊匹配），如 `Web端_深色`、`移动端`
- 两个参数都可选；都不传时返回全量规范列表
- 输出 JSON，三种情况：
  1. **唯一匹配** `matched:true`：含 `standardId` / `standardName` / `sceneName?` / `filePaths` → 把 `filePaths` 传给 `design-spec-check`
  2. **需选规范** `matched:false, stage:"standard"`：含 `candidates:[{standardId,standardName,categoryName}]` → 展示候选，用户选定后用完整 `standardName` 重新调用
  3. **需选场景** `matched:false, stage:"scene"`：含 `standardId` / `standardName` / `candidates:[{sceneId,sceneName,sceneCategory}]` → 展示候选，用户选定后用 `standardName + sceneName` 重新调用

### design-spec-check

```bash
devlint-skill design-spec-check [--cwd <项目目录>] --source <HTML路径或URL> --spec-file-paths <path1,path2,...>
```

- `--source`: 本地 HTML 文件路径 或 Web 页面 URL（必填）
- `--spec-file-paths`: 规则文件路径数组（必填），来自 `list-design-specs` 返回的 `filePaths`。CLI 传参方式：
  - 逗号分隔字符串：`--spec-file-paths "/a.json,/b.json,/c.json"`
  - 或 JSON 数组字符串：`--spec-file-paths '["/a.json","/b.json"]'`
- **必须先调 `list-design-specs`** 拿到 `filePaths`，再传入本命令，不要直接传规范名
- 输出：问题清单 JSON（结构由检查方法决定，外网环境为空结果占位，内网替换为真实检查实现）

### ai-img-check

两步操作：取 prompt → 看图输出差异 JSON → 生成 HTML 标注图。

#### 第 1 步：取 prompt（`--mode prompt`）

```bash
devlint-skill ai-img-check [--cwd <项目目录>] --mode prompt
```

- 返回 system prompt（针对对话场景优化，不依赖 server 运行）
- 图片已在对话上下文中，agent 直接看图，无需额外传参
- 输出：`{ mode:"prompt", prompt, hint }`
- **下一步**：看对话中的两张截图 + prompt，输出简短总结 + 差异 JSON（含归一化坐标），把 JSON 写入文件后调第 2 步

#### 第 2 步：生成 HTML 标注图（`--mode build`）

```bash
devlint-skill ai-img-check [--cwd <项目目录>] --mode build --diff-file <diff.json> --design-image <设计稿图> --dev-image <实现图>
```

- `--diff-file`：agent 输出的差异 JSON 文件（纯 JSON 或含 json 代码块的 Markdown 均可）
- `--design-image`：设计稿截图（png/jpg/webp/bmp）
- `--dev-image`：开发侧截图（png/jpg/webp/bmp）
- 生成自包含 HTML 文件（红框/黄框/蓝框叠在图上 + 差异清单表格），用户用浏览器打开即可查看
- 输出：`{ htmlPath, totalDiffs, overallLevel, score }`
  - `htmlPath`：HTML 标注图文件，告诉用户用浏览器打开
  - `totalDiffs`：差异总数
  - `overallLevel`：还原度等级（"高"/"中"/"低"）
  - `score`：还原度评分（0-100）

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

### 规范检查串联（list-design-specs → design-spec-check）

`list-design-specs` 返回的 `filePaths` **直接传给** `design-spec-check`：

| list-design-specs 返回字段 | design-spec-check 参数 |
|---|---|
| `filePaths`（数组） | `--spec-file-paths`（逗号分隔或 JSON 数组字符串） |

- `matched=true` 时，拿到 `filePaths` 后应**自动执行** `design-spec-check`，不需要用户再次确认
- `matched=false` 时，必须先展示候选让用户选定，重新调用 `list-design-specs` 直到 `matched=true`，再执行 `design-spec-check`
- 不要跳过 `list-design-specs` 直接给 `design-spec-check` 传规范名，`--spec-file-paths` 只接受规则文件路径

### platform 设置

| 开发侧来源 | platform |
|---|---|
| collect-arkui | `hmPhone`（默认） |
| collect-web | `web` |
| 本地文件 | 根据文件名判断（arkui.json → hmPhone，web.json → web） |

---

## 🔴 硬性规则：tool 失败处理策略

**任何 tool 调用失败时，必须遵守以下原则，禁止自行修复或绕过：**

### 总原则

1. **失败即止步**：tool 返回错误（非零退出码 / stderr 有 `✗` / `isError: true`）时，**立即停止当前串联流程**，不要假装成功继续往下走
2. **重试上限 2 次**：同一 tool 同一参数最多重试 2 次（含首次共 3 次调用）。超过后**停止重试**，向用户报告失败
3. **禁止改源码**：失败原因不在 skill 源码，**绝不修改 `bin/`、`src/` 下任何文件**（参见顶部硬性规则）
4. **禁止静默吞错**：不要忽略 stderr 错误信息继续执行，必须将错误原因如实告知用户
5. **向用户求助**：重试耗尽或无法自动恢复时，**停下来让用户决定下一步**，不要自行猜测原因反复尝试

### 各 tool 失败处理

| tool | 失败场景 | 处理方式 |
|---|---|---|
| `collect-arkui` | 非 Windows / 启动失败 / 超时 | 继续设计侧采集；向用户提供：① Windows 环境重试 ② 手动提供 arkui.json/arkui.png 路径跳过采集 |
| `collect-web` | 登录超时 / 导航超时 / 证书拦截 | 继续设计侧采集；向用户提供：① `--headless false` 有头模式重试 ② 手动提供 web.json/web.png 路径跳过采集 |
| `collect-design` | 传送码无效 / 采集超时 / 网络错误 | 向用户提供：① 检查传送码后重新采集 ② 手动提供 design.json/design.png 路径 |
| `ui-style-check` | server 不可达 / 文件不存在 / 检查超时 | 向用户提供：① 确认检查服务是否正常运行 ② 确认文件路径是否正确 ③ 重试一次 |
| `list-design-specs` | 规则库拉取失败 / 网络错误 | 向用户报告错误，询问是否重试；不要自行假设规范名直接调 design-spec-check |
| `design-spec-check` | source 不可达 / 规则文件不存在 / 检查超时 | 向用户提供：① 确认 source 路径/URL 可访问 ② 确认 spec-file-paths 来自 list-design-specs ③ 重试一次 |
| `ai-img-check` | prompt 取回失败 / build 时 diff JSON 解析失败 / 图片读取失败 | 向用户提供：① 确认 diff JSON 格式正确 ② 确认图片可正常读取 ③ 重试一次 |

### 严格禁止的失败处理方式

- ❌ 失败后修改 skill 源码（改 `bin/devlint-skill.js`、改 `src/lib/` 下文件）
- ❌ 失败后修改 `SKILL.md` 或 `package.json`
- ❌ 失败后跳过该 tool，用空数据或假数据继续往下走
- ❌ 失败后无限重试（同一参数调用超过 3 次）
- ❌ 失败后不告知用户，自行更换参数反复尝试
- ❌ 忽略 stderr 错误信息，假装成功

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

---

## ai-img-check 结果呈现规则

拿到 build 结果后，按以下格式展示给用户：

1. 展示**整体还原度**：等级（高/中/低）+ 评分（0-100）+ diff 总数
2. 告诉用户**用浏览器打开 htmlPath** 查看带红框标注的对比图
3. 简要口述前几条重点差异（从 agent 自己输出的简短总结中提取，不要复述全部）
4. 如果没有差异（totalDiffs=0），直接说 **"视觉检查未发现明显还原差异，还原度良好"**

---

## 环境要求

- `collect-arkui` 只能在 **Windows** 上执行（依赖 ArkUI Inspector 导出工具）
- `collect-web` 和 `collect-design` 需要 **Chrome 浏览器**（自动查找，或通过 `CHROME_PATH` 环境变量指定）
- 工具内部读取文件，**文件内容不占用 AI 上下文**

---

## 决策检查清单

执行命令前逐项确认：

- [ ] 用户意图是 UI 一致性检查、设计规范检查还是视觉检查？
- [ ] 开发侧数据来源是什么？（本地文件 / URL / 鸿蒙设备）
- [ ] 设计侧数据来源是什么？（本地文件 / 传送码 / URL）
- [ ] 两侧数据是否都已就绪？（未就绪先采集，采集完自动串联）
- [ ] platform 设置是否正确？
- [ ] 采集中断后是否继续了另一侧的采集？
- [ ] 设计规范检查是否先调了 list-design-specs？（不能直接给 design-spec-check 传规范名）
- [ ] list-design-specs 返回 matched=false 时，是否展示了候选让用户选定后重新匹配？
- [ ] 视觉检查时，用户是否已在对话中传入两张截图？是 → 取 prompt → 看图输出差异 JSON → build 生成 HTML 标注图 → 告诉用户打开 htmlPath。
