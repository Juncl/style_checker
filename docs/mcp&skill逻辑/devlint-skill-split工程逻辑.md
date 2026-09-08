# devlint-skill-split 工程逻辑

> 配套阅读：[devlint-mcp工程逻辑.md](./devlint-mcp工程逻辑.md)。本文说明 **devlint-skill-split** 的工程结构、三个子 skill 的内部逻辑，以及它们与 **devlint-mcp** 的关系。

---

## 一、工程定位

### 1.1 设计理念：按主线拆分

devlint-skill-split 把 UI 检查相关能力拆成 3 个职责单一的独立 skill，每个 skill 有自己的 SKILL.md、CLI 入口、zip 产物，互不依赖、独立触发、按需安装。这样设计带来两个好处：

1. **触发精准**：用户只想做"视觉检查"时，只会加载视觉检查的 SKILL.md，不会把采集/规范检查等无关指令塞进 AI 上下文。
2. **按需安装**：用户只需其中一项能力时，只装对应的 skill，不捆绑无关能力。

### 1.2 三个子 skill 一览

| 子 skill | CLI 命令名 | 命令数 | 能力 | 触发场景 |
|---|---|---|---|---|
| **ui-param-diff** | `ui-param-diff` | 4 | 采集 ArkUI/Web/设计稿 + 节点树算法比对 | UI 一致性检查、设计稿对比、找差异 |
| **design-system-checker** | `design-system-checker` | 2 | 规范名模糊匹配 + 规范走查 | 设计规范检查、规范走查、是否符合 Octo |
| **ui-pixel-diff** | `ui-pixel-diff` | 1 | 视觉检查（agent 看对话图 → Markdown 报告） | 图图对比、视觉检查、对比图片 |

### 1.3 顶层架构

```
                          ┌──────────────────────────────────────────────────────────────┐
                          │                    devlint-skill-split                         │
                          │                   （3 个独立 skill 的源码工程）                 │
                          │                                                              │
   开发者 ──build──▶  顶层 build.js（调度器）                                              │
                          │   依次调用 3 个子 build → dist/ 下产出 3 个 zip                │
                          │                                                              │
                          ├── ui-param-diff/         （UI 一致性检查）                     │
                          ├── design-system-checker/ （设计规范检查）                      │
                          └── ui-pixel-diff/         （视觉检查）                          │
                          │                                                              │
                          │   三个子 build 都从 devlint-mcp/lib 按需拷贝引擎 → src/lib     │
                          │   （各自只拷自己用到的子目录，互不重叠）                        │
                          └──────────────────────────────────────────────────────────────┘

   用户 ──对话──▶ AI(opencode)
                 │  按用户意图分别加载 3 个 skill 之一（互不干扰）
                 │
                 ├── "UI 一致性检查" → 加载 ui-param-diff skill → bash 调 ui-param-diff ...
                 ├── "设计规范走查"   → 加载 design-system-checker skill → bash 调 design-system-checker ...
                 └── "对比图片"       → 加载 ui-pixel-diff skill → bash 调 ui-pixel-diff ...
```

**核心价值**（与 devlint-mcp 一致）：
- 文件内容由 CLI 进程内部读取并 multipart 上传，**不经过 AI 上下文**，避免大 JSON / 图片 base64 占用 token
- 采集文件直接落盘 `.devlint/`，路径回传 AI，无需 AI 处理文件内容
- 完整差异报告落盘为 md / html 文件，AI 仅拿前 10 个问题节点 preview

---

## 二、顶层工程结构

### 2.1 源码目录

```
devlint-skill-split/
├── package.json              # name=devlint-skill-split，仅 build 脚本，无运行时依赖
├── build.js                  # 顶层调度器：依次调用 3 个子 build，打出 3 个 zip
├── dist/                     # 产物输出目录（3 个 zip + 解压目录）
│   ├── ui-param-diff-<ver>.zip
│   ├── design-system-checker-<ver>.zip
│   └── ui-pixel-diff-<ver>.zip
│
├── ui-param-diff/            # 子工程一：UI 一致性检查
│   ├── package.json          # name=ui-param-diff，version 跟随 devlint-mcp（build 时读取）
│   ├── build.js              # 独立打包脚本
│   ├── SKILL.md              # skill 指令文档
│   ├── README.md             # 用户面向快速上手
│   └── bin/
│       └── ui-param-diff.js  # CLI 入口（4 命令）
│
├── design-system-checker/    # 子工程二：设计规范检查
│   ├── package.json          # name=design-system-checker，version=1.0.1（自身管理）
│   ├── build.js
│   ├── SKILL.md
│   ├── README.md
│   └── bin/
│       └── design-system-checker.js  # CLI 入口（2 命令）
│
└── ui-pixel-diff/            # 子工程三：视觉检查
    ├── package.json          # name=ui-pixel-diff，version=1.0.1（自身管理）
    ├── build.js
    ├── SKILL.md
    ├── README.md
    ├── bin/
    │   └── ui-pixel-diff.js  # CLI 入口（1 命令，两步 mode）
    └── lib/                  # skill 独有模块（源码工程直接包含，不来自 mcp）
        ├── imgCheckPrompt.js # system prompt 全文
        ├── vlmCheck.js       # --mode prompt：取回 prompt
        ├── mdBuilder.js      # --mode build：diff JSON → Markdown 报告
        ├── shared.js         # 公共工具（时间戳/落盘目录/base64/备选 server 方案）
        └── serverCheck.js    # server 兜底方案（备选，当前未启用）
```

> 三个子工程**源码都不包含 `src/lib/`**，该目录由各自 `build.js` 在打包时从 `devlint-mcp/lib/` 按需拷贝生成。`ui-pixel-diff/lib/` 是 skill 独有模块，源码工程直接包含。

### 2.2 顶层 build.js（调度器）

```bash
cd devlint-skill-split && npm run build    # = node build.js
```

顶层 `build.js` 只做一件事：依次执行 3 个子 build，最后汇总打印产物清单：

```js
const SKILLS = ['ui-param-diff', 'design-system-checker', 'ui-pixel-diff']
for (const name of SKILLS) {
  execSync(`node ${name}/build.js`, { stdio: 'inherit' })
}
```

也可单独运行某个子 build：

```bash
node ui-param-diff/build.js           # 只打 ui-param-diff
node design-system-checker/build.js   # 只打 design-system-checker
node ui-pixel-diff/build.js           # 只打 ui-pixel-diff
```

### 2.3 产物版本号来源

| 子 skill | 版本号来源 | 当前版本 |
|---|---|---|
| ui-param-diff | **跟随 devlint-mcp**（build.js 读 `devlint-mcp/package.json` 的 version） | 1.0.10 |
| design-system-checker | 自身 `package.json` 的 version | 1.0.1 |
| ui-pixel-diff | 自身 `package.json` 的 version | 1.0.1 |

> ui-param-diff 与 devlint-mcp 共用引擎最紧密（采集 + 检查全来自 mcp），版本跟随 mcp 便于同步升级；另两个 skill 引擎子集较稳定，版本独立管理。

---

## 三、通用机制（三个 skill 共用）

以下机制三个子 skill 完全一致，不再在各子工程章节重复。

### 3.1 opencode skill 的概念

opencode skill 是一种**轻量级能力扩展机制**：把一组操作指南（SKILL.md）和配套的可执行工具打包在一起，AI 根据用户意图自动加载对应 skill，然后按指南调用工具完成任务。

一个 skill 包含两部分：

| 组成 | 作用 | 本工程对应 |
|---|---|---|
| **SKILL.md** | 指令文档：告诉 AI 何时触发、有哪些命令、参数怎么传、失败怎么处理 | 各子工程根目录 `SKILL.md` |
| **可执行工具** | AI 通过 bash 调用的命令行程序 | 各子工程的 `bin/<entry>.js`（经 `npm link` 注册到 PATH） |

SKILL.md 的 frontmatter 示例（以 ui-param-diff 为例）：

```yaml
---
name: UI设计一致性检查
description: UI设计页面一致性检查能力。支持采集鸿蒙 ArkUI 开发侧数据……
             当用户提到 UI 一致性检查、设计稿对比……时加载本 skill。
---
```

- `name`：skill 唯一标识，对应 `~/.config/opencode/skills/<name>/SKILL.md`
- `description`：触发条件描述，opencode 用它判断何时加载本 skill
- 三个 skill 的 description 互不重叠，按用户意图精准触发

### 3.2 CLI 入口设计原则

三个子工程的 `bin/<entry>.js` 共用同一套设计：

- **无常驻进程**：每次调用都是独立 node 子进程，调用结束即退出
- **统一 IO 约定**：结果 JSON 输出到 stdout，错误信息输出到 stderr（`✗ <msg>`）并以非零退出码退出
- **直接复用引擎函数**：`import` 自 `src/lib/` 下的底层函数（与 devlint-mcp 共用同一份代码）
- **不碰 opencode.json**：安装只 `npm link` 注册命令 + 拷贝 SKILL.md，不修改任何 opencode 配置
- **手写 parseArgs**：解析 `--flag value` 参数对（无 zod，不依赖 MCP SDK）
- **`--cwd` 切换工作目录**：所有命令都支持 `--cwd <项目目录>`，默认用当前工作目录，无需向用户询问；采集结果/报告落在 `<cwd>/.devlint/` 子目录下

### 3.3 打包通用流程

每个子工程的 `build.js` 流程基本一致，差异只在"从 mcp 拷贝哪些目录"和"是否有 skill 独有 lib"：

| 步骤 | 操作 | 说明 |
|---|---|---|
| 1. 校验源码 | 确认 `devlint-mcp/lib` 存在（ui-pixel-diff 额外确认自身 `lib/` 存在） | — |
| 2. 清空 & 创建产物目录 | `dist/<name>-<ver>/` | — |
| 3. 拷贝引擎 | `devlint-mcp/lib` → 产物 `src/lib`，**按各自 MCP_DIRS / MCP_FILES 清单按需拷贝**（排除 `node_modules`） | 三者拷贝范围不同，见各子工程章节 |
| 4. patch 打点前缀 | `src/lib/utils/track.js` 中 `devlint_mcp_*` → `devlint_skill_*` | 三者统一 |
| 5.（仅 ui-param-diff）拷贝脚本 | `devlint-mcp/script` → 产物 `src/script` | 保持 `getArkui.js` 中 `../../../script/export_arkui.exe` 相对路径正确 |
| 6.（仅 ui-pixel-diff）拷贝 skill 独有 lib | `ui-pixel-diff/lib` → 产物 `lib/` | skill 独有模块，不来自 mcp |
| 7. 拷贝 skill 专属文件 | `bin/<entry>.js` + `SKILL.md` + `README.md` | — |
| 8.（仅 ui-param-diff）patch SKILL.md | 把 `{{SKILL_GUIDE_URL}}` 替换为 `devlint-mcp/lib/config.js` 中的实际 URL | 只有 ui-param-diff 的 SKILL.md 含此占位符 |
| 9. 生成产物 package.json | `name`/`version`/`bin`/`dependencies`（dependencies 继承自 devlint-mcp） | — |
| 10. 打 zip | 跨平台：macOS/Linux 用 `zip`，Windows 用 PowerShell `Compress-Archive` | — |

> **关键设计**：build.js 对 devlint-mcp **只读拷贝**，不修改任何 mcp 源码（唯一改动是 patch 产物副本中的打点前缀和 SKILL.md 占位符）。三个 skill 与 devlint-mcp 共用同一份引擎代码，差异只在入口层（CLI vs MCP server）和各自拷贝的引擎子集。

### 3.4 安装流程

三个 skill 安装方式完全一致（**无 install.js 脚本**，手动三步）：

```bash
# 1. 解压 <skill>-<ver>.zip
# 2. 进入解压目录
npm install --omit=dev
npm link
# 3. 拷贝 SKILL.md 到 opencode skills 目录
#    ui-param-diff          → ~/.config/opencode/skills/UI设计一致性检查/SKILL.md
#    design-system-checker  → ~/.config/opencode/skills/design-system-checker/SKILL.md
#    ui-pixel-diff          → ~/.config/opencode/skills/ui-pixel-diff/SKILL.md
# 4. 重启 opencode 使 skill 生效
```

> 注意：SKILL.md 拷贝目标目录名取 frontmatter 里的 `name` 字段（如 ui-param-diff 的 name 是中文 `UI设计一致性检查`），不是 zip 包名。

安装后运行时布局：

| 内容 | 位置 | 说明 |
|---|---|---|
| 工具代码 | 解压目录（原地） | `src/lib/` 引擎 + `bin/` 入口（+ ui-pixel-diff 的 `lib/`） |
| 命令注册 | 全局 PATH（`npm link`） | 终端任意位置可执行 `<skill> ...` |
| Skill 指令 | `~/.config/opencode/skills/<name>/SKILL.md` | opencode 启动时加载，按 description 触发 |

### 3.5 硬性规则（三个 skill 一致）

**禁止修改 skill 源码**：skill 的所有文件（`bin/`、`src/`、`lib/`、`SKILL.md`、`package.json` 等）均为**只读**，AI 绝对不允许修改。

**tool 失败处理策略**：

| 原则 | 说明 |
|---|---|
| **失败即止步** | tool 返回错误（非零退出码 / stderr 有 `✗`）时，立即停止当前串联流程，不假装成功继续往下走 |
| **重试上限 2 次** | 同一 tool 同一参数最多重试 2 次（含首次共 3 次调用），超过后停止重试向用户报告 |
| **禁止改源码** | 失败原因不在 skill 源码，绝不修改 `bin/`、`src/`、`lib/` 下任何文件 |
| **禁止静默吞错** | 不忽略 stderr 错误信息继续执行，必须如实告知用户 |
| **向用户求助** | 重试耗尽或无法自动恢复时，停下让用户决定下一步 |

> 历史教训：曾出现 tool 失败后 agent 陷入死循环、擅自修改 skill 源码导致环境损坏的事故。任何失败都只能通过重新调用、调整参数或向用户求助来解决。

### 3.6 fallback 调用方式

三个 skill 的 SKILL.md 都规定：`<skill>` 命令不可用时（command not found），AI 可直接：

```bash
node <skill目录>/bin/<entry>.js <command> [options]
```

---

## 四、ui-param-diff（UI 一致性检查）

### 4.1 工程定位

负责**采集** ArkUI/Web/设计稿三侧数据，并基于**节点树 JSON 算法**对比设计稿与开发实现，输出差异修改清单。检查结果除 Markdown 报告外，还生成**可视化 HTML 报告**（调 server `/report/html` 接口生成交互式差异列表）。

### 4.2 目录结构

#### 源码工程（`devlint-skill-split/ui-param-diff/`）

```
ui-param-diff/
├── package.json              # name=ui-param-diff，version 跟随 devlint-mcp（build 时读取）
├── build.js                  # 独立打包脚本
├── SKILL.md                  # skill 指令文档
├── README.md
└── bin/
    └── ui-param-diff.js      # CLI 入口：4 个子命令分发
```

> 源码工程**不包含 `src/lib/`**，由 build.js 打包时从 `devlint-mcp/lib` 按需拷贝。

#### 分发产物（`dist/ui-param-diff-<ver>.zip` 解压后）

```
ui-param-diff-<ver>/
├── package.json              # 产物 package.json：含 bin 和 dependencies（继承自 mcp）
├── SKILL.md                  # 已 patch {{SKILL_GUIDE_URL}} 为实际 URL
├── README.md
├── bin/
│   └── ui-param-diff.js      # CLI 入口（同源码工程）
└── src/
    ├── lib/                  # 从 devlint-mcp/lib 按需拷贝
    │   ├── config.js         # 配置（内外网切换）
    │   ├── utils/            # tools.js / report.js / session.js / track.js / puppeteer.js
    │   └── collectData/
    │       ├── getArkui/     # 鸿蒙 ArkUI 采集
    │       ├── getWebDom/    # Web DOM 采集
    │       └── getPixData/   # Pixso 设计稿采集
    └── script/               # 从 devlint-mcp/script 拷贝（export_arkui.exe 等）
```

**build.js 拷贝清单**（`MCP_DIRS` / `MCP_FILES`）：

```js
const MCP_DIRS = [
  'utils',
  'collectData/getArkui',
  'collectData/getWebDom',
  'collectData/getPixData',
]
const MCP_FILES = ['config.js']
```

> 相比另两个 skill，ui-param-diff 是唯一拷贝 `collectData` 下三个采集子目录、且额外拷贝 `mcp/script` 的 skill。

### 4.3 4 个命令

| 命令 | 职责 | 输出 |
|---|---|---|
| `collect-arkui` | 启动本地 ArkUI Inspector 采集程序，采集鸿蒙 ArkUI 节点树 + 截图（仅 Windows） | `devJsonPath` + `devImagePath` |
| `collect-web` | puppeteer 打开网页/本地 HTML，采集 DOM 树 + 计算样式 + 截图 | `devJsonPath` + `devImagePath` |
| `collect-design` | 通过传送码/URL 采集 Pixso 设计稿节点树 + 截图 | `designJsonPath` + `designImagePath` + `account` |
| `ui-style-check` | 读本地设计稿/开发侧文件 → 上传 server 检查 → 输出差异清单（基于节点树 JSON 算法） | 前 10 个问题节点 preview + md 报告路径 + html 报告路径 |

子命令分发（`bin/ui-param-diff.js`）：

```js
const COMMANDS = {
  'collect-arkui':  cmdCollectArkui,    // → collectArkui()
  'collect-web':    cmdCollectWeb,      // → collectWebDom()
  'collect-design': cmdCollectDesign,   // → collectDesign()
  'ui-style-check': cmdUiStyleCheck,    // → fetch server + extractSummary + generateReport + HTML 报告
}
```

### 4.4 `ui-style-check` 内部流程

与 devlint-mcp 的 `ui_style_check` 工具 handler **完全等价**，只是把 MCP 的 `content` 包装换成 stdout JSON，并**额外生成可视化 HTML 报告**：

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
6. generateReport(result)    → 完整 Markdown 报告，落盘到 .devlint/octo_uxlint_result.md
7. 生成可视化 HTML 报告：
     POST `${config.CHECK_SERVER_URL}/report/html`（FormData: result.json + design.png + arkui.png）
     → 返回 HTML 字符串 → 落盘到 .devlint/octo_uxlint_result_<时间戳>.html
     （失败时静默跳过，不影响主流程）
8. trackCheckComplete(...)   → 打点（fire-and-forget）
9. resetSession()            → 结束本轮会话，下次采集开新目录
10. 输出 preview：{ platform, nodes: 前10个, totalNodes, reportPath, htmlReportPath }
```

> **HTML 报告**：浏览器打开可查看交互式差异列表（筛选/折叠/精准-模糊切换）。

### 4.5 主线流程

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

### 4.6 采集 → 检查串联映射表

| 采集命令返回字段 | ui-style-check 参数 |
|---|---|
| `devJsonPath` | `--dev-json` |
| `devImagePath` | `--dev-image` |
| `designJsonPath` | `--design-json` |
| `designImagePath` | `--design-image` |
| `account` | `--account`（透传用于打点；未传时自动用本机 IP 兜底） |

采集完成后**自动执行**检查命令，不需要用户再次确认。

### 4.7 结果呈现规则

- 每个设计节点作为一个分组展示，展示 **componentChain**（组件层级链）帮助定位代码位置
- web 平台额外标注 **devClassName**，arkuri 平台用 componentChain 定位
- 每条差异以**修改指令**格式输出：「属性」期望 expected，当前为 actual，需修改
- **不要展示**评分、匹配覆盖率、检查耗时等统计信息
- **不要展示**节点 ID、原始 path 数组等内部技术信息
- 无差异时直接说"开发侧与设计稿一致，无需修改"
- 完整问题清单见 **reportPath** 指向的 md 文件
- 可视化报告见 **htmlReportPath** 指向的 HTML 文件

---

## 五、design-system-checker（设计规范检查）

### 5.1 工程定位

负责**模糊匹配设计规范名/场景名**，并检查 HTML/URL 是否符合设计规范，输出问题清单。

### 5.2 目录结构

#### 源码工程（`devlint-skill-split/design-system-checker/`）

```
design-system-checker/
├── package.json              # name=design-system-checker，version=1.0.1（自身管理）
├── build.js                  # 独立打包脚本
├── SKILL.md
├── README.md
└── bin/
    └── design-system-checker.js  # CLI 入口：2 个子命令分发
```

#### 分发产物（`dist/design-system-checker-<ver>.zip` 解压后）

```
design-system-checker-<ver>/
├── package.json              # 产物 package.json：含 bin 和 dependencies
├── SKILL.md
├── README.md
├── bin/
│   └── design-system-checker.js
└── src/
    └── lib/                  # 从 devlint-mcp/lib 按需拷贝
        ├── config.js         # 配置（内外网切换）
        ├── utils/            # tools.js / report.js / session.js / track.js / puppeteer.js
        └── collectData/
            └── uxCheckOut/   # 规范检查引擎（fetchSpecList / resolveSpec / collectDom / specCheck / index）
```

**build.js 拷贝清单**：

```js
const MCP_DIRS = [
  'utils',
  'collectData/uxCheckOut',
]
const MCP_FILES = ['config.js']
```

> 只拷贝规范检查相关的 `uxCheckOut` 子目录，不拷贝任何采集模块。

### 5.3 2 个命令

| 命令 | 职责 | 输出 |
|---|---|---|
| `list-design-specs` | 模糊匹配规范名/场景名，返回规则文件路径列表 | `filePaths` 或候选列表 JSON |
| `design-spec-check` | 检查 HTML/URL 是否符合设计规范（需先调 list-design-specs） | 问题清单 JSON |

子命令分发（`bin/design-system-checker.js`）：

```js
const COMMANDS = {
  'list-design-specs':  cmdListDesignSpecs,   // → fetchSpecList() + resolveSpec()
  'design-spec-check':  cmdDesignSpecCheck,   // → uxCheck()
}
```

### 5.4 命令内部流程

#### `list-design-specs`

```
1. 读取 --standard-name / --scene-name（均可选）
2. fetchSpecList()  → 拉取规则库全量数据
3. resolveSpec(specData, standardName, sceneName)  → 两阶段模糊匹配
4. 输出 JSON，三种情况：
   ① 唯一匹配 matched:true  → 含 filePaths，直接传给 design-spec-check
   ② 需选规范 stage:"standard" → 含 candidates，展示让用户选定后重新调用
   ③ 需选场景 stage:"scene"    → 含 candidates，展示让用户选定后重新调用
```

#### `design-spec-check`

```
1. 校验必填参数：--source、--spec-file-paths
2. 解析 --spec-file-paths：支持逗号分隔字符串或 JSON 数组字符串
3. uxCheck(source, specFilePaths)  → puppeteer 打开 source（HTML/URL）→ 采集 DOM → 按规则文件检查
4. trackSpecCheckComplete(...)  → 打点（fire-and-forget）
5. 输出问题清单 JSON
```

### 5.5 主线流程

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

### 5.6 串联映射表

| list-design-specs 返回字段 | design-spec-check 参数 |
|---|---|
| `filePaths`（数组） | `--spec-file-paths`（逗号分隔或 JSON 数组字符串） |

- `matched=true` 时，拿到 `filePaths` 后**自动执行** `design-spec-check`，不需要用户再次确认
- `matched=false` 时，必须先展示候选让用户选定，重新调用 `list-design-specs` 直到 `matched=true`

### 5.7 结果呈现规则

- 按问题分组展示，每条问题包含：规则名、问题描述、当前位置/值、期望值
- 问题较多时先展示问题总数，再逐条列出
- 无问题时直接说"页面符合设计规范，未发现问题"

---

## 六、ui-pixel-diff（视觉检查）

### 6.1 工程定位

负责**视觉检查**：对比设计稿截图与开发实现截图，输出差异清单 Markdown 报告。

采用 **agent 自检模式**：图片已在对话上下文中，**agent 自己看图**按 system prompt 输出差异 JSON，skill 只负责"取 prompt"和"整理 Markdown 报告"两件事，**全程不调 server VLM、不读图片文件、不占 server 额度**。

> `lib/serverCheck.js` 保留了调 server VLM 的完整实现作为**备选方案（当前未启用）**，等非 VLM agent 有需求时再接入。

### 6.2 目录结构

#### 源码工程（`devlint-skill-split/ui-pixel-diff/`）

```
ui-pixel-diff/
├── package.json              # name=ui-pixel-diff，version=1.0.1（自身管理）
├── build.js                  # 独立打包脚本
├── SKILL.md
├── README.md
├── bin/
│   └── ui-pixel-diff.js      # CLI 入口：1 个子命令（两步 mode）
└── lib/                      # ★ skill 独有模块（源码工程直接包含，不来自 mcp）
    ├── imgCheckPrompt.js     # system prompt 全文（280 行，引导 agent 地毯式逐属性比对）
    ├── vlmCheck.js           # --mode prompt：取回 prompt
    ├── mdBuilder.js          # --mode build：diff JSON → Markdown 报告（落盘 .devlint/）
    ├── shared.js             # 公共工具（timestamp / getOutputDir / base64 / 备选 server 方案工具）
    └── serverCheck.js        # server 兜底方案（备选，当前未启用）
```

#### 分发产物（`dist/ui-pixel-diff-<ver>.zip` 解压后）

```
ui-pixel-diff-<ver>/
├── package.json              # 产物 package.json：含 bin 和 dependencies
├── SKILL.md
├── README.md
├── bin/
│   └── ui-pixel-diff.js
├── lib/                      # 从 ui-pixel-diff/lib 拷贝（skill 独有）
│   ├── imgCheckPrompt.js
│   ├── vlmCheck.js
│   ├── mdBuilder.js
│   ├── shared.js
│   └── serverCheck.js
└── src/
    └── lib/                  # 从 devlint-mcp/lib 按需拷贝
        ├── config.js         # 配置（内外网切换，skill 独有 lib 也复用此文件）
        └── utils/            # tools.js / report.js / session.js / track.js / puppeteer.js
```

**build.js 拷贝清单**：

```js
const MCP_DIRS = ['utils']
const MCP_FILES = ['config.js']
```

> ui-pixel-diff 是三个 skill 里拷贝 mcp 引擎最少的一个（只要 config + utils），且唯一带 skill 独有 `lib/` 的 skill。build.js 统计文件数时 `src` 和 `lib` 都计入。

### 6.3 命令：`ai-img-check`（两步 mode）

只有一个命令 `ai-img-check`，通过 `--mode` 区分两步：

| mode | 作用 | 输出 |
|---|---|---|
| `--mode prompt` | 取回 system prompt（针对对话场景优化） | stdout 纯文本输出 prompt 全文（非 JSON），agent 当 system prompt 用 |
| `--mode build --diff-file <json>` | 把 agent 输出的 diff JSON 整理成 Markdown 差异报告 | stdout 两行：`✓ 报告已生成: <path>` + `还原度: <等级>（<分数> / 100），共 <N> 处差异` |

子命令分发（`bin/ui-pixel-diff.js`）：

```js
const COMMANDS = {
  'ai-img-check': cmdAiImgCheck,   // 按 --mode 分流
}
```

### 6.4 完整工作流（agent + skill 协作）

```
用户在对话中传入两张截图（设计稿 + 开发实现）
  │
  ├── 步骤 0：确认图片角色（必须最先做）
  │   用户已明确指出哪张是设计稿、哪张是开发实现 → 进入步骤 1
  │   用户没有明确指出 → 必须问清楚，禁止猜测图片角色
  │
  ├── 步骤 1：取 prompt
  │   bash: ui-pixel-diff ai-img-check --mode prompt
  │   → stdout 输出 system prompt 全文（agent 当 system prompt 用）
  │   → lib/vlmCheck.js → getImgCheckPrompt() → 返回 IMG_CHECKER_SYSTEM_PROMPT
  │
  ├── 步骤 2：agent 看图 + prompt → 输出差异 JSON
  │   agent 用 VLM 能力直接看对话中的两张截图
  │   按 prompt 指引：三遍法 + 逐元素逐属性比对 → 输出「简短总结 + 差异 JSON 代码块」
  │   agent 把差异 JSON 写入文件（如 diff.json）
  │   ★ 全程不调 server，不读图片文件，图片已在对话上下文中
  │
  └── 步骤 3：整理成 Markdown 报告
      bash: ui-pixel-diff ai-img-check --mode build --diff-file diff.json
      → lib/mdBuilder.js → buildMdReport({ diffFile })
         → 读 diff JSON（兼容纯 JSON 或 Markdown 内嵌 ```json 代码块）
         → 整理成 Markdown 报告（还原度评分 + 总结 + 差异清单表格，按严重级别排序）
         → 落盘到 .devlint/ai_img_check_<时间戳>.md
         → 打点 reportInteraction（fire-and-forget）
      → stdout: ✓ 报告已生成: <path> / 还原度: <等级>（<分数> / 100），共 <N> 处差异
      → agent 告诉用户打开 md 报告查看
```

### 6.5 lib/ 模块说明

#### `imgCheckPrompt.js` — system prompt 全文

导出 `IMG_CHECKER_SYSTEM_PROMPT`（约 280 行），引导 agent 以"资深 UI 设计师 + 设计还原检查引擎"视角，**地毯式、逐元素、逐属性**找出全部视觉还原差异。核心要点：

- **三遍法**：整体观感 → 逐元素逐属性 → 交叉验证同类一致性
- **节点匹配**：先文本后容器，拓扑兜底，分成匹配对/缺失/多余三类
- **比对属性集合**：字号/字重/字色/填充/圆角/描边/阴影/内边距/间距/尺寸/位置等
- **动态数据必须忽略**：文字内容、图片内容、列表条数不同不报
- **数值估读策略**：从截图无法读精确值，颜色给"约 #RRGGBB"、字号给"约 18px"，禁止编造假数字
- **差异分级**：error（明显）/ warning（轻微）/ maybe_high（可能·大）/ maybe_low（可能·小）/ missing（缺失）/ extra（多余）
- **输出格式**：先简短文字总结，再输出 JSON 代码块（字段名固定：overallLevel/score/summary/diffs[]）

#### `vlmCheck.js` — `--mode prompt`

```js
export function getImgCheckPrompt() {
  return {
    mode: 'prompt',
    prompt: IMG_CHECKER_SYSTEM_PROMPT,
    hint: '用户已确认哪张是设计稿、哪张是开发实现后，看这两张截图...',
  }
}
```

bin 入口取 `result.prompt` 直接 stdout 输出。

#### `mdBuilder.js` — `--mode build`

```
buildMdReport({ diffFile })
  → 读 diff JSON（parseDiffJson 兼容纯 JSON / ```json 代码块 / 任意 ``` 代码块）
  → generateMd：按严重级别排序（明显→轻微→缺失→多余→可能·大→可能·小）编号生成表格
  → 落盘 .devlint/ai_img_check_<时间戳>.md
  → 返回 { reportPath, totalDiffs, overallLevel, score }
```

报告是**纯文本 Markdown**，不嵌入图片、不转 base64、没有图片占位符/填图步骤，打开即看。

#### `shared.js` — 公共工具

- `timestamp()` / `getOutputDir()`：时间戳与落盘目录（`<cwd>/.devlint/`）
- `fileToBase64DataUrl()`：读图片转 base64（备选 server 方案专用）
- `parseDiffReport()` / `finalizeReport()`：调 server `/img/checker/diff` 解析（备选 server 方案专用）
- 配置（server 地址 / .devlint 目录名）复用 `src/lib/config.js`

#### `serverCheck.js` — server 兜底方案（备选，未启用）

保留了调 server VLM 的完整实现：读两张图片 → base64 → POST `/img/checker`（流式 SSE）→ 累积 content → POST `/img/checker/diff` → 落盘。

> 当前 SKILL.md 和 bin 入口均未接入。当 agent 非 VLM（无法直接看对话中的图）时才需要此方案：用户提供两张图片的本地文件路径 → skill 读文件转 base64 → 调 server VLM。接入方式：bin 顶部加 `import { aiImgCheck } from '../lib/serverCheck.js'`，cmdAiImgCheck 里恢复 `--mode server` 分支。

### 6.6 结果呈现规则

- 展示**整体还原度**：等级（高/中/低）+ 评分（0-100）+ 差异总数（从 stdout 第二行摘要获取）
- 告诉用户**打开生成的 Markdown 报告**（stdout 第一行的 reportPath）查看完整差异清单
- 简要口述前几条重点差异（从 agent 自己输出的简短总结中提取，不复述全部）
- 无差异时（totalDiffs=0）直接说"视觉检查未发现明显还原差异，还原度良好"

### 6.7 与 `ui-param-diff` 的 `ui-style-check` 的区别

| 维度 | ui-param-diff `ui-style-check` | ui-pixel-diff `ai-img-check` |
|---|---|---|
| 比对基础 | **节点树 JSON** 算法比对 | **截图** 视觉比对（agent 看图） |
| 精度 | 精确到属性值（零容差） | 视觉近似（数值加"约"前缀） |
| 数据要求 | 需采集结构化 JSON + 截图 | 仅需两张截图（在对话中） |
| 是否调 server | 调 server `/check/upload` + `/report/html` | **不调 server**（agent 自检） |
| 报告 | md + html | md（纯文本） |
| 适用场景 | 有结构化数据、需精确属性比对 | 无结构化数据、或作为算法结果补充 |

两者可独立使用，也可先后使用互相印证。

---

## 七、三个 skill 的关系与协同

### 7.1 独立触发，互不干扰

三个 skill 的 SKILL.md `description` 互不重叠，opencode 按用户意图精准加载：

| 用户说的 | 加载的 skill |
|---|---|
| UI 一致性检查 / 设计稿对比 / 采集开发侧数据 / 找差异 | ui-param-diff |
| 设计规范检查 / 规范走查 / 规范名匹配 / 是否符合 Octo | design-system-checker |
| 图图对比 / 视觉检查 / 对比图片 | ui-pixel-diff |

三个 skill 可同时安装，不会冲突（CLI 命令名、skill name 均不同）。

### 7.2 协同场景

| 场景 | 协同方式 |
|---|---|
| 先算法比对再视觉补充 | ui-param-diff 采集 + `ui-style-check` 拿精确属性差异 → 再用 ui-pixel-diff `ai-img-check` 做视觉补充（算法看不到的整体观感问题） |
| 采集复用 | ui-param-diff 的 `collect-design` 返回的 `designImagePath`、`collect-web`/`collect-arkui` 返回的 `devImagePath` 可直接作为 ui-pixel-diff 的截图传入对话（但 ui-pixel-diff 走对话图，不直接读文件路径） |

### 7.3 引擎复用对照

三个 skill 都从 `devlint-mcp/lib` 按需拷贝引擎，各自拷贝范围：

| mcp/lib 子路径 | ui-param-diff | design-system-checker | ui-pixel-diff |
|---|:---:|:---:|:---:|
| `config.js` | ✅ | ✅ | ✅ |
| `utils/` | ✅ | ✅ | ✅ |
| `collectData/getArkui/` | ✅ | — | — |
| `collectData/getWebDom/` | ✅ | — | — |
| `collectData/getPixData/` | ✅ | — | — |
| `collectData/uxCheckOut/` | — | ✅ | — |
| `script/`（mcp/script） | ✅ | — | — |
| skill 独有 `lib/` | — | — | ✅ |

> 三者共用 `config.js` + `utils/`，差异在各自的 `collectData` 子目录。打点前缀统一 patch 为 `devlint_skill_*`。

---

## 八、与 devlint-mcp 的关系

### 8.1 与 devlint-mcp 的关系

三个 skill 与 devlint-mcp 共用同一份引擎代码（`devlint-mcp/lib/`），build.js 只读拷贝。差异只在入口层：

| 维度 | devlint-mcp | devlint-skill-split（三个 skill） |
|---|---|---|
| **协议** | MCP（stdio JSON-RPC） | 无协议，直接 bash 调用 |
| **进程模型** | 常驻子进程，opencode 启动时拉起 | 一次一进程，调用结束即退出 |
| **AI 调用方式** | opencode 内置 MCP 客户端调 `mcp.tool` | AI 用 bash 工具执行 `<skill> <cmd>` |
| **参数校验** | zod schema（MCP SDK 自动校验） | 手写 parseArgs |
| **返回格式** | MCP `content: [{ type:'text', text: ... }]` | stdout JSON / 纯文本 + stderr 错误 + 退出码 |
| **指令文档** | 工具 description 内嵌在 server.js | 独立 SKILL.md（每个 skill 一份） |
| **注册方式** | `opencode.json` 的 `mcp` 字段 | `npm link` + 拷贝 SKILL.md |
| **配置文件** | 改 `opencode.json` | 不碰 `opencode.json` |
| **分发形态** | `npm pack` 生成 tgz | build.js 生成 3 个 zip |
| **能力拆分** | 一个 mcp 含全部工具 | 拆成 3 个 skill，各管一条主线 |

### 8.2 何时用 skill-split，何时用 mcp

| 场景 | 推荐 | 原因 |
|---|---|---|
| 分发给最终用户（非开发者） | **skill-split** | zip 包解压 + `npm install` + `npm link` 即用，按需装其中一两个 |
| 开发者本机调试 | **mcp** | 改 `lib/` 下代码后 opencode 重启即生效，无需重新 build |
| CI / 自动化环境 | **skill-split** | 命令行调用更稳定，不依赖 opencode 进程拉起 MCP 子进程 |
| 只需视觉检查 | **skill-split**（仅装 ui-pixel-diff） | 不用装采集/规范检查等无关能力 |
| 内网部署（无 opencode.json 配置权限） | **skill-split** | 只需解压 + link，不动配置文件 |

### 8.3 切换注意事项

- **不要同时安装 mcp 和 skill**：能力等价，同时安装会让 AI 同时看到 MCP 工具和 skill 指令，可能重复触发
- **从 mcp 切到 skill-split**：在 `opencode.json` 中把 `devlint-mcp` 的 `enabled` 改为 `false`（或删除），然后安装需要的 skill 并重启 opencode
- **从 skill-split 切到 mcp**：删除 `~/.config/opencode/skills/` 下对应 skill 目录 + `npm uninstall -g <skill>`（取消 link），然后在 `opencode.json` 启用 `devlint-mcp`，重启 opencode
- **三个 skill 可按需部分安装**：例如只装 ui-pixel-diff 不装另两个，互不影响

---

## 九、关键设计点总结

| 设计点 | 说明 |
|---|---|
| **按主线拆分为 3 个独立 skill** | 按"一条主线一个 skill"拆成 ui-param-diff / design-system-checker / ui-pixel-diff，独立触发、按需安装 |
| **顶层 build.js 调度** | 一次打出 3 个 zip，也可单独运行子 build |
| **引擎按需拷贝** | 各 skill 只从 devlint-mcp/lib 拷贝自己用到的子目录，互不重叠；共用 config.js + utils |
| **版本策略** | ui-param-diff 跟随 devlint-mcp 版本；另两个自身 package.json 管理 |
| **打点前缀统一** | build.js patch `devlint_mcp_*` → `devlint_skill_*` |
| **ui-param-diff 的 HTML 报告** | `ui-style-check` 调 server `/report/html` 生成可视化交互式差异列表 |
| **ui-pixel-diff 的 agent 自检模式** | agent 看对话图按 prompt 输出差异 JSON，skill 只整理报告；不调 server、不读图片文件、不占 server 额度；server 方案保留为备选 |
| **无常驻进程** | 每次 bash 调用都是独立子进程，调用结束即退出 |
| **文件不经 AI 上下文** | CLI 内部 `fileToBlob` 读取文件并上传，文件内容不占用 AI token（ui-pixel-diff 走对话图更彻底） |
| **preview + 完整报告落盘** | 前 10 个问题节点 preview 返回 AI，完整 md/html 报告落盘供后续读取 |
| **采集与检查解耦** | 采集命令只负责采集落盘返回路径，检查命令只负责读文件检查 |
| **`--cwd` 默认当前目录** | 不向用户询问保存位置，默认用当前工作目录 |
| **不碰 opencode.json** | 安装只 `npm link` + 拷贝 SKILL.md |
| **无 install.js** | 安装手动三步（npm install + npm link + 拷贝 SKILL.md） |
| **硬性规则：源码只读** | AI 禁止修改 skill 任何文件，失败只能重试或向用户求助 |
| **硬性规则：失败即止步** | tool 失败立即停止串联，不假装成功继续往下走 |
| **内外网切换** | 引擎内 `config.js` 的 `CHECK_ENV` 切换，skill 侧无需额外处理 |
| **fallback 调用** | `<skill>` 命令不可用时，AI 可 `node <skill目录>/bin/<entry>.js <cmd>` |
