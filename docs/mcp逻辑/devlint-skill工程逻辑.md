# devlint-skill 工程逻辑

> 配套阅读：[devlint-mcp工程逻辑.md](./devlint-mcp工程逻辑.md)。本文重点说明 **skill 是什么、做什么、怎么用**，以及它与 **devlint-mcp** 的关系。

---

## 一、工程定位

devlint-skill 是一个 **opencode skill**：由「命令行工具 + SKILL.md 指令文档」两部分组成，安装后让 AI（opencode）具备 **UI 一致性检查**、**设计规范检查** 与 **视觉检查** 三类能力。

它通过 `devlint-skill` CLI 提供 7 个子命令，AI 用 **bash 工具** 直接调用，**不启动常驻进程**：

| 命令 | 职责 | 输出 |
|---|---|---|
| `collect-arkui` | 启动本地 ArkUI Inspector 采集程序，采集鸿蒙 ArkUI 节点树 + 截图（仅 Windows） | `arkui_<时间戳>.json` + `.png` 文件路径 |
| `collect-web` | puppeteer 打开网页/本地 HTML，采集 DOM 树 + 计算样式 + 截图 | `web_<w>x<h>_<时间戳>.json` + `.png` 文件路径 |
| `collect-design` | 通过传送码/URL 采集 Pixso 设计稿节点树 + 截图 | `design_<时间戳>.json` + `.png` 文件路径 |
| `ui-style-check` | 读本地设计稿/开发侧文件 → 上传 server 检查 → 输出差异清单（基于节点树 JSON 算法） | 前 10 个问题节点 preview + 完整报告 md 路径 |
| `list-design-specs` | 模糊匹配规范名/场景名，返回规则文件路径列表 | `filePaths` 或候选列表 JSON |
| `design-spec-check` | 检查 HTML/URL 是否符合设计规范（需先调 list-design-specs） | 问题清单 JSON |
| `ai-img-check` | 视觉检查，读两张截图 → 上传 server 比对 → 输出差异清单（skill 独有，mcp 无对应工具） | overallLevel + score + diffs preview + reportPath |

采集命令互相独立，任一侧中断不阻塞另一侧；采集结果统一落盘到 `--cwd/.devlint/` 子目录，路径直接传给 `ui-style-check` 完成端到端检查。

```
                          ┌──────────────────────────────────────────────────────────────┐
                          │                         devlint-skill                          │
用户 ──对话──▶ AI(opencode)│                                                              │
                       │   │  ┌─collect-arkui──┐  ┌─collect-web───┐  ┌─collect-design─────┐ │
                       │   │  │ 启动 exe 采集   │  │ puppeteer 采集 │  │ Pixso 采集(内网真实)│ │
                       │   │  │ arkui.json/png  │  │ web.json/png   │  │ design.json/png    │ │
                       │   │  │（仅 Windows）   │  │                │  │                    │ │
                       │   │  └───────┬────────┘  └───────┬────────┘  └──────────┬─────────┘ │
        bash 调用      │   │          │                   │                      │           │
        (子进程)       ▼   │          │         ┌─ui-style-check─┐                │           │
                  devlint-skill        └────────▶│ 读文件→multipart │◀──────────────┘           │
                          │                    │ →HTTP POST server│                           │
                          │                    └────────┬─────────┘                           │
                          │                             ▼                                     │
                          │                       server(3012)                                  │
                          │                       解析/匹配/比对                                │
                          │                             │                                       │
                          │                       ◀── JSON 结果 ──┘                             │
                          │         extractSummary + generateReport                            │
                          └─── preview(10) + reportPath ◀───────────────────────────────────│
                          │                                                                     │
                          │  主线二：list-design-specs → design-spec-check                      │
                          │                                                                     │
                          │  主线三：ai-img-check（视觉检查，skill 独有）                        │
                          │    读两张图片 → base64 → POST server /img/checker                   │
                          │    → Markdown 报告 → /img/checker/diff → 结构化 diff                │
                          │    → preview(overallLevel/score/diffs前10) + reportPath             │
                          └─────────────────────────────────────────────────────────────────────┘
```

**核心价值**（与 devlint-mcp 一致）：
- 文件内容由 CLI 进程内部读取并 multipart 上传，**不经过 AI 上下文**，避免大 JSON / 图片 base64 占用 token
- 采集文件直接落盘 `.devlint/`，路径回传 AI，无需 AI 处理文件内容
- 完整差异报告落盘为 md 文件，AI 仅拿前 10 个问题节点 preview

**与 devlint-mcp 的差别**：见 [第七章 · skill 与 mcp 的关系](#七skill-与-mcp-的关系)。

---

## 二、目录结构

devlint-skill 在仓库内是**源码工程**，通过 `build.js` 打成可分发的 zip 包。产物结构与源码略有不同：

### 2.1 源码工程（仓库内 `devlint-skill/`）

```
devlint-skill/
├── package.json              # name=devlint-skill，仅 build 依赖（无运行时依赖声明）
├── build.js                  # 打包脚本：从 devlint-mcp/lib 拷贝引擎 → src/lib，从 devlint-skill/lib 拷贝 → lib，组装产物 → zip
├── install.js                # 用户安装脚本：npm install + npm link + 拷贝 SKILL.md
├── SKILL.md                  # skill 指令文档（frontmatter + 调用规范 + 硬性规则）
├── README.md                 # 用户面向的快速上手文档
├── bin/
│   └── devlint-skill.js      # CLI 入口：7 个子命令分发，import src/lib（mcp 共享）+ lib/（skill 独有）
└── lib/                      # skill 独有模块（不依赖 mcp 引擎，仅依赖 src/lib/config.js）
    └── aiImgCheck.js         # ai-img-check 命令实现：读图→base64→POST server→落盘→返回 preview
```

> 源码工程**不包含 `src/lib/`**，该目录由 `build.js` 在打包时从 `devlint-mcp/lib/` 拷贝生成。`lib/` 是 skill 独有模块，源码工程直接包含。

### 2.2 分发产物（`dist/devlint-skill-<ver>.zip` 解压后）

```
devlint-skill-<ver>/
├── package.json              # 产物 package.json：name=devlint-skill，含 bin 和 dependencies
├── install.js                # 同源码工程
├── SKILL.md                  # 同源码工程
├── README.md                 # 同源码工程
├── bin/
│   └── devlint-skill.js      # CLI 入口（同源码工程）
├── lib/                      # skill 独有模块（从 devlint-skill/lib 拷贝）
│   └── aiImgCheck.js         # 视觉检查实现
└── src/
    ├── lib/                  # 从 devlint-mcp/lib 整体拷贝（排除 server.js 和 node_modules）
    │   ├── config.js         # 配置（内外网切换，ai-img-check 也复用此文件）
    │   ├── utils/            # tools.js / report.js / session.js / track.js / puppeteer.js
    │   └── collectData/      # getArkui / getWebDom / getPixData / uxCheckOut
    └── script/               # 从 devlint-mcp/script 拷贝（export_arkui.exe 等）
```

### 2.3 安装后的运行时布局

| 内容 | 位置 | 说明 |
|---|---|---|
| 工具代码 | 解压目录（原地） | `src/lib/` 引擎 + `bin/` 入口 |
| 命令注册 | 全局 PATH（`npm link`） | 终端任意位置可执行 `devlint-skill ...` |
| Skill 指令 | `~/.config/opencode/skills/devlint-skill/SKILL.md` | opencode 启动时加载，按 description 触发 |

---

## 三、Skill 是什么

### 3.1 opencode skill 的概念

opencode skill 是一种**轻量级能力扩展机制**：把一组操作指南（SKILL.md）和配套的可执行工具打包在一起，AI 根据用户意图自动加载对应 skill，然后按指南调用工具完成任务。

一个 skill 包含两部分：

| 组成 | 作用 | 本工程对应 |
|---|---|---|
| **SKILL.md** | 指令文档：告诉 AI 何时触发、有哪些命令、参数怎么传、失败怎么处理 | `devlint-skill/SKILL.md` |
| **可执行工具** | AI 通过 bash 调用的命令行程序 | `devlint-skill` CLI（`bin/devlint-skill.js`） |

### 3.2 SKILL.md 的 frontmatter

```yaml
---
name: devlint-skill
description: UI 一致性检查与设计规范检查能力。支持采集鸿蒙 ArkUI 开发侧数据、采集 Web 页面 DOM 数据、
             采集 Pixso 设计稿数据、对比设计稿与开发实现输出差异修改清单、模糊匹配设计规范名并检查
             页面是否符合规范、视觉检查对比两张截图输出差异清单。当用户提到 UI 一致性检查、设计稿对比、
             采集开发侧/设计侧数据、设计规范检查、规范名匹配、图图对比、视觉检查、对比图片等场景时
             加载本 skill。
---
```

- `name`：skill 唯一标识，对应 `~/.config/opencode/skills/<name>/SKILL.md`
- `description`：触发条件描述，opencode 用它判断何时加载本 skill

### 3.3 SKILL.md 的正文结构

| 章节 | 内容 |
|---|---|
| 硬性规则 | 禁止修改 skill 源码；tool 失败处理策略（重试上限 2 次、失败即止步、向用户求助） |
| 能力总览 | 7 个命令的用途和输出 |
| 命令调用方式 | 优先用 `devlint-skill`，command not found 时 fallback 到 `node <skill目录>/bin/devlint-skill.js` |
| 三条主线 | 主线一：UI 一致性检查（采集 → ui-style-check）；主线二：设计规范检查（list-design-specs → design-spec-check）；主线三：视觉检查（ai-img-check） |
| 命令详细参数 | 每个命令的参数、默认值、输出格式 |
| 采集 → 检查串联规则 | 采集返回字段直接传给检查命令的映射表 |
| 结果呈现规则 | 差异清单展示格式（修改指令格式、不展示评分等统计信息） |
| 决策检查清单 | 执行命令前 AI 需逐项确认的问题 |

---

## 四、CLI 入口（`bin/devlint-skill.js`）

### 4.1 设计原则

- **无常驻进程**：每次调用都是一个独立的 node 子进程，调用结束即退出
- **统一 IO 约定**：结果 JSON 输出到 stdout，错误信息输出到 stderr 并以非零退出码退出
- **直接复用引擎函数**：`import` 自 `src/lib/` 下的底层函数（与 devlint-mcp 共用同一份代码）
- **不碰 opencode.json**：安装脚本不修改任何 opencode 配置，只拷贝 SKILL.md 和注册命令

### 4.2 子命令分发

```js
const COMMANDS = {
  'collect-arkui':    cmdCollectArkui,      // → collectArkui()
  'collect-web':      cmdCollectWeb,        // → collectWebDom()
  'collect-design':   cmdCollectDesign,     // → collectDesign()
  'ui-style-check':   cmdUiStyleCheck,      // → fetch server + extractSummary + generateReport
  'list-design-specs':cmdListDesignSpecs,   // → fetchSpecList() + resolveSpec()
  'design-spec-check':cmdDesignSpecCheck,   // → uxCheck()
  'ai-img-check':     cmdAiImgCheck,        // → aiImgCheck()（来自 lib/aiImgCheck.js，skill 独有）
}
```

> `ai-img-check` 的实现在 `lib/aiImgCheck.js`（skill 独有模块），其余 6 个命令的实现在 `src/lib/`（mcp 共享引擎）。

### 4.3 `ui-style-check` 子命令的内部流程

与 devlint-mcp 的 `ui_style_check` 工具 handler **完全等价**，只是把 MCP 的 `content` 包装换成 stdout JSON：

```
1. 校验必填参数：--design-json、--dev-json
2. 校验文件存在：existsSync 检查所有传入路径
3. 构造 FormData：
     form.append('platform', platform)
     form.append('designJson',  fileToBlob(designJsonPath), 'design.json')
     form.append('arkuiJson',   fileToBlob(devJsonPath),    'arkui.json')
     form.append('designImage', fileToBlob(designImagePath),'design.png')   ← 可选
     form.append('arkuiImage',  fileToBlob(devImagePath),   'arkui.png')    ← 可选
4. POST `${config.CHECK_SERVER_URL}/check/upload`
5. extractSummary(result)    → 精简摘要（以设计侧节点维度，仅 error 级）
6. generateReport(result)    → 完整 Markdown 报告，落盘到 .devlint/devlint_result.md
7. trackCheckComplete(...)   → 打点（fire-and-forget）
8. resetSession()            → 结束本轮会话，下次采集开新目录
9. 输出 preview：{ platform, nodes: 前10个, totalNodes, reportPath }
```

### 4.4 `ai-img-check` 子命令的内部流程

**skill 独有**，mcp 无对应工具。实现位于 `lib/aiImgCheck.js`，`bin/devlint-skill.js` 中 `cmdAiImgCheck` 只做参数解析和调用。

```
1. 校验必填参数：--design-image、--dev-image
2. 校验文件存在：existsSync 检查两张图片
3. 读两张图片 → base64 data URL（fileToBase64DataUrl，按扩展名设 MIME，不经过 AI 上下文）
4. 构建 messages：
     [{ role:'user', content:[
        { type:'image_url', image_url:{ url: <设计稿 base64> } },
        { type:'image_url', image_url:{ url: <开发侧 base64> } },
        { type:'input_text', text: <prompt> || '请对比这两张图的 UI 还原差异' }
     ]}]
5. POST `${config.CHECK_SERVER_URL}/img/checker`  body: { messages, stream:true }
   → server 内部完成图片比对，流式返回 SSE 帧
   → 流式模式：首字节几秒即到（模型边生成边吐），避免非流式总时长超时
   → 不设 fetch 硬超时，由 bash 工具 timeout 兜底（SKILL.md 指导 AI 设 300000ms）
6. 读取完整 SSE 流（checkRes.text()），parseSSEContent 累积 delta.content → 完整 Markdown 报告
7. POST `${config.CHECK_SERVER_URL}/img/checker/diff`  body: { markdown }
   → 返回 { overallLevel, score, stats, diffs, ... }
8. 落盘完整 Markdown 到 <cwd>/.devlint/ai_img_check_<时间戳>.md
9. 返回 preview：{ overallLevel, score, stats, diffs: 前10条, totalDiffs, reportPath }
```

**为什么用流式而非非流式**：非流式要等 VLM 完整生成所有内容才返回首字节（通常 60-150 秒），容易撞 fetch 硬超时和 bash 默认 120 秒超时；流式首字节几秒即到，连接持续有数据流不会超时。skill 侧读完整个流后拼接为完整 Markdown，再调 `/img/checker/diff` 解析。

**与 `ui-style-check` 的区别**：
- `ui-style-check`：基于**节点树 JSON** 的算法比对，精确到属性值，需要采集结构化数据
- `ai-img-check`：基于**截图**的视觉比对，仅需两张图片，适合无结构化数据的场景或作为算法结果的补充
- 两者可独立使用，也可先后使用互相印证

**配置复用**：`lib/aiImgCheck.js` import `../src/lib/config.js`，与 `ui-style-check` 等命令共用同一份 `config.CHECK_SERVER_URL`，内外网切换只需改 `config.js` 的 `CHECK_ENV` 一处。

### 4.5 通用参数 `--cwd`

所有命令都支持 `--cwd <项目目录>`，用于指定采集结果和报告的保存位置：

```js
if (args.cwd) {
  process.chdir(args.cwd)
}
```

- **默认使用当前工作目录，无需向用户询问**
- 仅在用户明确要求保存到其他目录时才传入
- 采集结果落在 `<cwd>/.devlint/` 子目录下

---

## 五、安装与打包

### 5.1 打包流程（`build.js`，开发者执行）

```
cd devlint-skill && npm run build
```

| 步骤 | 操作 |
|---|---|
| 1. 校验源码 | 确认 `../devlint-mcp/lib` 存在 + `devlint-skill/lib` 存在 |
| 2a. 拷贝 mcp 引擎 | `devlint-mcp/lib` → `dist/devlint-skill-<ver>/src/lib`（排除 `node_modules` 和 `server.js`） |
| 2b. 拷贝 mcp 脚本 | `devlint-mcp/script` → `dist/devlint-skill-<ver>/src/script`（保持 `../../../script` 相对路径正确） |
| 2c. 拷贝 skill 独有模块 | `devlint-skill/lib` → `dist/devlint-skill-<ver>/lib`（含 `aiImgCheck.js`，不依赖 mcp 引擎） |
| 3. 拷贝 skill 专属文件 | `bin/devlint-skill.js` + `SKILL.md` + `install.js` |
| 4. 生成产物 package.json | 从 devlint-mcp 的 package.json 继承 `dependencies`，加上 `bin` 字段 |
| 5. 打 zip | 跨平台：macOS/Linux 用 `zip`，Windows 用 PowerShell `Compress-Archive` |

产物：`dist/devlint-skill-<ver>.zip`

> **关键设计**：build.js 对 devlint-mcp **只读拷贝**，不修改任何源码。devlint-skill 与 devlint-mcp 共用同一份引擎代码，差异只在入口层（CLI vs MCP server）。

### 5.2 安装流程（`install.js`，用户执行）

```
解压 devlint-skill-<ver>.zip
cd devlint-skill-<ver>
node install.js
```

三步操作：

| 步骤 | 操作 | 失败处理 |
|---|---|---|
| 1. 安装依赖 | `npm install --omit=dev` | 提示用户手动在产物目录运行 `npm install` |
| 2. 注册命令 | `npm link` → `devlint-skill` 进入全局 PATH | 提示用户确认 npm 全局 bin 目录在 PATH 中 |
| 3. 安装 SKILL.md | 拷贝到 `~/.config/opencode/skills/devlint-skill/SKILL.md` | — |

完成后提示用户**重启 opencode** 使 skill 生效。

### 5.3 验证安装

```bash
devlint-skill --help
```

输出 7 个命令的简要说明即代表安装成功。

---

## 六、三条主线

### 6.1 主线一：UI 一致性检查

需要**设计侧**和**开发侧**两份数据，两侧就绪后执行 `ui-style-check`。

```
用户意图：UI 一致性检查 / 设计稿对比 / 找差异
  │
  ├── 判断开发侧数据来源
  │   ├── 本地 .json 文件路径 → 直接作为 --dev-json / --dev-image
  │   ├── 本地 .html 文件路径 → 先 collect-web 采集 DOM
  │   ├── 网页 URL            → 先 collect-web
  │   └── 鸿蒙设备            → 先 collect-arkui（仅 Windows）
  │
  ├── 判断设计侧数据来源
  │   ├── 本地文件路径        → 直接作为 --design-json / --design-image
  │   └── 传送码 / 设计稿 URL → 先 collect-design
  │
  └── 两侧就绪 → ui-style-check
```

**数据来源判断规则**（SKILL.md 中明文规定）：

| 用户输入特征 | 判定 |
|---|---|
| `http://` 或 `https://` 开头 | URL |
| 纯数字或短字符串（如 `111`） | 传送码 |
| `.json` 结尾 | 已采集的 JSON 数据文件，直接传给 ui-style-check |
| `.html` 结尾 | 本地 HTML 源文件，走 collect-web 采集 |
| `/` 或盘符（如 `C:\`）开头且无上述后缀 | 本地文件路径，根据上下文判断类型 |

**两侧采集互相独立**：一侧中断不阻塞另一侧。中断后向用户提供恢复选项（重新采集 / 手动提供文件路径），待两侧都就绪后再执行 `ui-style-check`。

### 6.2 主线二：设计规范检查

```
用户意图：设计规范检查 / 规范走查 / 检查是否符合 Octo 规范
  │
  ├── 1. 先调 list-design-specs 匹配规范
  │     list-design-specs [--standard-name <规范名>] [--scene-name <场景名>]
  │     ├── matched=true       → 拿到 filePaths，进入步骤 2
  │     ├── stage="standard"   → 展示规范候选，用户选定后用完整 standardName 重新调用
  │     └── stage="scene"      → 展示场景候选，用户选定后用 standardName + sceneName 重新调用
  │
  └── 2. 拿到 filePaths 后调 design-spec-check
        design-spec-check --source <HTML路径或URL> --spec-file-paths <path1,path2,...>
```

**规范名拆分规则**：用户给"Octo Web端深色"这种组合时，拆成 `--standard-name Octo --scene-name Web端深色` 分别传入。

**禁止跳步**：`--spec-file-paths` 只接受规则文件路径，不能直接传规范名。必须先 `list-design-specs` 拿到 `filePaths` 再传入 `design-spec-check`。

### 6.3 主线三：视觉检查

需要**设计稿截图**和**开发侧截图**两张图片，直接执行 `ai-img-check`。无需采集节点树 JSON，仅基于截图做视觉比对。

```
用户意图：图图对比 / 视觉检查 / 对比图片
  │
  ├── 判断截图来源
  │   ├── 本地图片文件路径 → 直接作为 --design-image / --dev-image
  │   ├── collect-design 返回的 designImagePath → 直接作为 --design-image
  │   ├── collect-web / collect-arkui 返回的 devImagePath → 直接作为 --dev-image
  │   └── 未提供 → 提示用户提供两张截图（设计稿 + 开发实现）
  │
  └── 两张图就绪 → ai-img-check
```

**耗时提示**：本命令通常耗时 30-90 秒，调用前应告知用户耐心等待。

**结果呈现**（与 ui-style-check 略有不同）：
- 先展示整体还原度（等级 + 评分）和差异统计
- 再按修改指令格式逐条展示差异
- 完整报告见 reportPath 指向的 md 文件

### 6.4 串联映射表

| 采集命令返回字段 | ui-style-check 参数 |
|---|---|
| `devJsonPath` | `--dev-json` |
| `devImagePath` | `--dev-image` |
| `designJsonPath` | `--design-json` |
| `designImagePath` | `--design-image` |
| `userInfo` | `--user-info`（JSON 字符串） |

| list-design-specs 返回字段 | design-spec-check 参数 |
|---|---|
| `filePaths`（数组） | `--spec-file-paths`（逗号分隔或 JSON 数组字符串） |

采集完成后**自动执行**检查命令，不需要用户再次确认。

---

## 七、skill 与 mcp 的关系

devlint-skill 和 devlint-mcp 是**同一套能力的两种交付形态**，二者**互斥使用**，选其一即可。

### 7.1 能力对照（一一对应）

| 能力 | devlint-mcp 工具名 | devlint-skill 命令名 |
|---|---|---|
| 鸿蒙 ArkUI 采集 | `collect_arkui` | `collect-arkui` |
| Web DOM 采集 | `collect_web` | `collect-web` |
| Pixso 设计稿采集 | `collect_design` | `collect-design` |
| UI 一致性检查 | `ui_style_check` | `ui-style-check` |
| 规范名模糊匹配 | `list_design_specs` | `list-design-specs` |
| 设计规范检查 | `design_spec_check` | `design-spec-check` |
| 视觉检查 | **无**（mcp 不提供） | `ai-img-check`（skill 独有） |

> 命名差异：MCP 工具用下划线（MCP 社区惯例），CLI 命令用连字符（Unix CLI 惯例）。
>
> **视觉检查是 skill 独有能力**，mcp 不提供对应工具。原因：该命令耗时 30-90 秒，超过 MCP tool 默认 60 秒超时（opencode 不暴露 tool 调用超时配置），skill 走 bash 调用无此限制。

### 7.2 架构对照

| 维度 | devlint-mcp | devlint-skill |
|---|---|---|
| **协议** | MCP（Model Context Protocol），stdio JSON-RPC | 无协议，直接 bash 调用 |
| **进程模型** | 常驻子进程，opencode 启动时拉起，opencode 关闭时退出 | 一次一进程，调用结束即退出 |
| **AI 调用方式** | opencode 内置 MCP 客户端调用 `mcp.tool` | AI 用 bash 工具执行 `devlint-skill <cmd>` |
| **参数校验** | zod schema（MCP SDK 自动校验） | 手写 `parseArgs`（`bin/devlint-skill.js`） |
| **返回格式** | MCP `content: [{ type:'text', text: ... }]` | stdout JSON + stderr 错误 + 退出码 |
| **指令文档** | 工具 description 内嵌在 server.js 中（每个 tool 几十行说明） | 独立 `SKILL.md` 文件（opencode skill 规范） |
| **注册方式** | `opencode.json` 的 `mcp` 字段配置 | `npm link` 注册命令 + 拷贝 SKILL.md 到 `~/.config/opencode/skills/` |
| **配置文件** | 改 `opencode.json` | 不碰 `opencode.json` |
| **分发形态** | `npm pack` 生成 tgz，需在 opencode.json 中引用本地路径 | `build.js` 生成 zip，用户解压 + `node install.js` |
| **依赖加载** | opencode 启动时 `npx -y file:...tgz` 自动安装 | 用户手动 `npm install --omit=dev` |

### 7.3 共用引擎代码

二者**共用同一份引擎代码**（`devlint-mcp/lib/`），关系如下：

```
devlint-mcp/                       devlint-skill/
├── index.js   (MCP 入口)          ├── bin/devlint-skill.js  (CLI 入口)
├── lib/                           ├── build.js
│   ├── server.js  (MCP 工具注册)  ├── install.js
│   ├── config.js ◀─────────────┐  ├── SKILL.md
│   ├── utils/    ◀─────────────┤  ├── lib/                ◀── skill 独有（源码工程直接包含）
│   └── collectData/ ◀──────────┤  │   └── aiImgCheck.js      视觉检查实现，import ../src/lib/config.js
└── script/      ◀──────────────┤  └── src/lib/  ◀── build.js 从 devlint-mcp/lib 拷贝
                                 │      ├── config.js          （ai-img-check 也复用此配置）
                                 └──────┤── utils/
                                        ├── collectData/
                                        └── script/  ◀── 从 devlint-mcp/script 拷贝
```

- **`build.js` 拷贝规则**：`devlint-mcp/lib` 整体拷贝到 `src/lib`，**排除 `server.js`**（server.js 是 MCP 专属的工具注册层，CLI 不需要）和 `node_modules`
- **`src/script` 拷贝**：`devlint-mcp/script` 拷贝到 `src/script`，保持 `getArkui.js` 中 `../../../script/export_arkui.exe` 的相对路径正确
- **`lib/` 拷贝**：`devlint-skill/lib` 拷贝到产物 `lib/`，是 skill 独有模块（`aiImgCheck.js`），不来自 mcp
- **引擎函数完全复用**：`collectArkui` / `collectWebDom` / `collectDesign` / `uxCheck` / `fetchSpecList` / `resolveSpec` / `extractSummary` / `generateReport` / `fileToBlob` 等函数在 mcp 和 skill 中是同一份代码
- **配置完全复用**：`ai-img-check` import `src/lib/config.js`，与其余 6 个命令共用 `config.CHECK_SERVER_URL`，内外网切换只需改 `config.js` 的 `CHECK_ENV` 一处

### 7.4 何时用 skill，何时用 mcp

| 场景 | 推荐 | 原因 |
|---|---|---|
| 分发给最终用户（非开发者） | **skill** | zip 包解压 + `node install.js` 即用，不需改 opencode.json |
| 开发者本机调试 | **mcp** | 改 `lib/` 下代码后 opencode 重启即生效，无需重新 build + install |
| CI / 自动化环境 | **skill** | 命令行调用更稳定，不依赖 opencode 进程拉起 MCP 子进程 |
| 需要同时用多个 opencode 实例 | **skill** | MCP 工具名全局唯一，多实例可能冲突；CLI 命令无此问题 |
| 内网部署（无 opencode.json 配置权限） | **skill** | 只需解压 + install，不动配置文件 |

### 7.5 切换注意事项

- **不要同时安装**：两者能力等价，同时安装会让 AI 同时看到 MCP 工具和 skill 指令，可能重复触发
- **从 mcp 切到 skill**：在 `opencode.json` 中把 `devlint-mcp` 的 `enabled` 改为 `false`（或删除该条目），然后安装 skill 并重启 opencode
- **从 skill 切到 mcp**：删除 `~/.config/opencode/skills/devlint-skill/` 目录 + `npm uninstall -g devlint-skill`（取消 link），然后在 `opencode.json` 启用 `devlint-mcp`，重启 opencode

---

## 八、硬性规则

### 8.1 禁止修改 skill 源码

skill 的所有文件（`bin/`、`src/`、`SKILL.md`、`install.js`、`package.json` 等）均为**只读**，AI 绝对不允许修改。

- ❌ 禁止：tool 失败时尝试"修复"skill 源码
- ❌ 禁止：新增/删除/重命名 skill 目录下的文件
- ❌ 禁止：编辑 `SKILL.md` 内容
- ❌ 禁止：修改 `package.json` 依赖或版本号

**tool 失败时的正确处理**：
1. 读取 stderr 错误信息，分析失败原因
2. 向用户说明原因并提供恢复选项（重新采集 / 手动提供文件路径）
3. 如确认是 skill 本身的 bug，告知用户联系维护者，**不要自己动手改源码**

> 历史教训：曾出现 tool 失败后 agent 陷入死循环、擅自修改 skill 源码导致环境损坏的事故。任何失败都只能通过重新调用、调整参数或向用户求助来解决。

### 8.2 tool 失败处理策略

| 原则 | 说明 |
|---|---|
| **失败即止步** | tool 返回错误（非零退出码 / stderr 有 `✗`）时，立即停止当前串联流程，不假装成功继续往下走 |
| **重试上限 2 次** | 同一 tool 同一参数最多重试 2 次（含首次共 3 次调用），超过后停止重试向用户报告 |
| **禁止改源码** | 失败原因不在 skill 源码，绝不修改 `bin/`、`src/` 下任何文件 |
| **禁止静默吞错** | 不忽略 stderr 错误信息继续执行，必须如实告知用户 |
| **向用户求助** | 重试耗尽或无法自动恢复时，停下让用户决定下一步 |

各 tool 的失败处理见 SKILL.md「各 tool 失败处理」表，此处不再赘述。

---

## 九、关键设计点总结

| 设计点 | 说明 |
|---|---|
| **skill = 指令文档 + CLI 工具** | SKILL.md 告诉 AI 怎么用，`devlint-skill` CLI 提供实际能力，两者打包分发 |
| **7 命令架构** | 3 个采集 + 1 个 UI 检查 + 1 个规范匹配 + 1 个规范检查 + 1 个视觉检查，覆盖三条主线 |
| **视觉检查是 skill 独有** | `ai-img-check` 在 `lib/aiImgCheck.js` 实现，mcp 无对应工具（耗时长超 MCP 60s 超时） |
| **skill 独有模块与 mcp 共享引擎分离** | `lib/`（skill 独有）与 `src/lib/`（mcp 共享）平级，build.js 分别拷贝；`lib/aiImgCheck.js` 只依赖 `src/lib/config.js` |
| **与 devlint-mcp 共用引擎** | `src/lib` 由 `build.js` 从 `devlint-mcp/lib` 拷贝而来（排除 `server.js`），同一份代码两种入口 |
| **配置完全复用** | `ai-img-check` 与其余 6 个命令共用 `src/lib/config.js`，内外网切换只改 `CHECK_ENV` 一处 |
| **无常驻进程** | 每次 bash 调用都是独立子进程，调用结束即退出，不依赖 opencode 进程生命周期 |
| **文件不经 AI 上下文** | CLI 内部 `fileToBlob` / `fileToBase64DataUrl` 读取文件并上传，文件/图片内容不占用 AI token |
| **preview + 完整报告落盘** | `extractSummary` 截前 10 个节点返回 AI，`generateReport` / `writeFileSync` 生成完整 md 落盘供后续读取 |
| **采集与检查解耦** | 采集命令只负责采集落盘返回路径，检查命令只负责读文件检查，通过文件路径串联 |
| **采集命令互相独立** | `collect-arkui` / `collect-web` / `collect-design` 互相独立，任一侧中断不阻塞其他侧 |
| **`--cwd` 默认当前目录** | 不向用户询问保存位置，默认用当前工作目录，仅在用户明确要求时才传入 |
| **不碰 opencode.json** | 安装脚本只拷贝 SKILL.md + `npm link`，不修改任何 opencode 配置 |
| **zip 分发** | `build.js` 打成跨平台 zip（macOS/Linux 用 `zip`，Windows 用 PowerShell），用户解压 + `node install.js` 即用 |
| **硬性规则：源码只读** | AI 禁止修改 skill 任何文件，失败只能重试或向用户求助 |
| **硬性规则：失败即止步** | tool 失败立即停止串联，不假装成功继续往下走 |
| **内外网切换** | 引擎内 `config.js` 的 `CHECK_ENV` 常量切换，skill 侧无需额外处理（继承自 mcp） |
| **fallback 调用方式** | `devlint-skill` 命令不可用时，AI 可直接 `node <skill目录>/bin/devlint-skill.js <cmd>` |
| **规范检查必须先匹配** | `design-spec-check` 的 `--spec-file-paths` 只接受文件路径，必须先调 `list-design-specs` 拿到 `filePaths` |
