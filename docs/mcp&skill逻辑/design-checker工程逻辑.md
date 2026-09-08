# design-checker 工程逻辑

> 配套阅读：[devlint-skill-split工程逻辑.md](./devlint-skill-split工程逻辑.md)。该文档描述的是 devlint-skill-split 的前三个子 skill（ui-param-diff / design-system-checker / ui-pixel-diff）；本文专项说明第 4 个子 skill **design-checker** 的内部逻辑。它与前三个 skill 形态完全不同——是工程里唯一的"**纯指令型**"skill：没有 CLI 命令、没有引擎代码、零外部依赖，检查与修复的执行者就是 AI 本身。

---

## 一、工程定位

### 1.1 skill 是什么

**基于设计规范文档的前端工程 UI 规范检查与修复**：

- **检查对象不限 HTML**——任意前端工程（原生 HTML/CSS、Vue、React 等）或单文件均可
- **规则库不限 Markdown**——specFiles/ 下任意可读文本格式（md/txt/json/yaml/yml/html/csv 等）均可作为规范
- **能力闭环**：先检查是否符合设计规范并生成报告 → 经用户确认 → 在**副本**上逐条修复问题 → 复查验证 → 汇报
- **上下文无缝衔接**：用户未指定时优先从会话上下文推断检查对象与规范（典型链路：上一步刚用某规范生成代码，用户接着说"检查一下"，直接衔接，不重复索要信息）

### 1.2 与另外三个 skill 的本质区别：纯指令型 vs CLI 工具型

| 维度 | 另外三个 skill（ui-param-diff 等） | design-checker |
|---|---|---|
| **形态** | CLI 工具型：`bin/` 入口 + `npm link` 注册命令 | 纯指令型：方法论文档 + 单脚本，**无 bin、无 lib、无子 build.js** |
| **AI 的角色** | 调 bash 命令、解析 stdout JSON 结果 | **自己 Read 代码与规范、自己比对、自己编辑副本**，脚本只做报告整理 |
| **引擎来源** | build 时从 `devlint-mcp/lib/` 按需拷贝 | **无引擎**（不从 devlint-mcp 拷贝任何代码） |
| **依赖** | puppeteer 等运行时依赖 | **零依赖**（仅 Node.js 标准库，报告脚本用 .mjs 保证 ESM 解析） |
| **文件与 AI 上下文的关系** | 核心价值是"文件内容不经 AI 上下文，省 token" | 恰好相反：规范文件与前端源码**必须 Read 进 AI 上下文** |
| **打点** | `devlint_skill_*` 打点 | 无打点 |
| **工作目录** | `<cwd>/.devlint/` | `~/.octo-uxlint/design-check/<领域key>-<时间戳>/`（用户主目录，脚本硬编码兜底） |
| **修复能力** | 无（只检查出报告） | 检查 + 副本修复 + 复查闭环 |

> **这个取舍是刻意的**：规范条目提取、元素与规则的匹配、"值是否在规范档位/色板内"这类判断本质是**语义理解**，难以固化成确定性算法，所以交给 AI 推理；而 JSON → Markdown 报告、severity 排序、统计这类**确定性工作**交给脚本（build-report.mjs）。skill 的职责是"把 AI 推理的输入输出格式、流程、红线全部文档化约束住"。

### 1.3 与 design-system-checker 的辨析（名字最像，最易混淆）

| 维度 | design-system-checker | design-checker |
|---|---|---|
| 形态 | CLI 工具型（2 命令） | 纯指令型（文档 + 1 脚本） |
| 规范来源 | server 规则库（`fetchSpecList()` 拉取，两阶段模糊匹配规范名/场景名） | 本地 `specFiles/` 规则库（index.md 清单 + 领域 key 映射 + 上下文推断） |
| 检查对象 | HTML 文件 / URL（puppeteer 打开采集 DOM） | 任意前端工程 / 单文件（AI 直接 Read 源码并追链样式资源） |
| 检查执行者 | 引擎代码（`uxCheckOut`，来自 devlint-mcp） | AI 本身（按 check-method.md 三遍法推理） |
| 能力 | 只检查，输出问题清单 | 检查 + 询问 + 副本修复 + 复查 |
| 产物 | stdout 问题清单 JSON | 工作目录下 issues/fix JSON + 报告 md + 修复副本 |

### 1.4 顶层架构

```
                        ┌─────────────────────────────────────────────────────┐
                        │                design-checker skill                 │
                        │            （纯指令型：文档 + 单脚本）               │
                        │                                                     │
                        │  SKILL.md ────────── 四阶段主线流程指令             │
                        │  check-method.md ─── 检查方法论（三遍法+severity）  │
                        │  fix-guide.md ────── 修复守则（副本红线/映射规则）   │
                        │  build-report.mjs ─── 唯一脚本（JSON→Markdown 报告） │
                        │  specFiles/ ───────── 规范规则库（数据目录，可维护） │
                        └─────────────────────────────────────────────────────┘
                                          │
   用户 ──对话──▶ AI(opencode) ◀──────────┘
                  │  按 SKILL.md 主线流程执行：
                  │
                  ├── 阶段一 检查：Read 前端源码 + Read specFiles 规范
                  │            → AI 推理比对 → issues JSON 落盘
                  │            → node build-report.mjs <issues.json> [--out-dir] 生成报告
                  ├── 阶段二 询问：是否在副本上修复？（硬性交互点）
                  ├── 阶段三 修复：生成副本 → 逐条按 specQuote 修复 → 复查
                  │            → fix-result JSON 落盘
                  │            → node build-report.mjs --fix <fix-result.json> [--out-dir]
                  └── 阶段四 汇报：绝对路径告知副本位置 + 修复统计 + 报告路径
```

---

## 二、目录结构与文件清单

### 2.1 源码结构

```
devlint-skill-split/design-checker/
├── package.json          # 仅 name/version/type/description，无 bin、无 dependencies
├── SKILL.md              # skill 指令文档（frontmatter + 硬性规则 + 四阶段主线流程）
├── check-method.md       # 检查方法论（三遍法 + 五级 severity + issues JSON 格式）
├── fix-guide.md          # 修复守则（副本红线 + 副本模式 + 修复流程 + fix-result JSON 格式）
├── build-report.mjs      # 唯一脚本：报告生成（零依赖，仅 Node.js 标准库）
└── specFiles/            # 规范规则库（数据目录，非源码）
    ├── index.md          # 规范清单（领域 key → 规范名称/路径/说明 映射表）
    └── ict_pc_3.1.1/     # 领域文件夹（名称 = 领域 key）
        └── design_system.md   # 规范文件（任意可读文本格式均可）
```

> **与另三个 skill 的显著差异**：无 `bin/`、无 `lib/`、无 `src/lib/`、无独立 `build.js`、无 `README.md`（用户面向说明内嵌在 SKILL.md 的引导词里）。打包由顶层 build.js 直接整目录拷贝完成。

### 2.2 文件职责表（含加载时机）

| 文件 | 用途 | 加载时机 |
|------|------|----------|
| `SKILL.md` | 四阶段主线流程指令 + 硬性规则 + build-report.mjs 用法 | skill 触发时由 opencode 加载 |
| `check-method.md` | 检查方法论 + issue JSON 格式 | 检查阶段开始时 Read |
| `fix-guide.md` | 修复守则（副本红线、副本模式、修复流程、复查标准） | 用户确认修复后 Read |
| `build-report.mjs` | 报告生成脚本（零依赖，仅需 Node.js） | 阶段一/阶段三末尾执行 |
| `specFiles/index.md` | 规范清单（领域 → 路径映射表） | 确认规范领域时 Read |
| `specFiles/<领域>/` | 规范规则库（按领域分子文件夹，任意可读文本格式） | 检查阶段扫描 + Read |

### 2.3 打包产物（`dist/design-checker-<ver>.zip` 解压后）

```
design-checker-<ver>/
├── SKILL.md
├── check-method.md
├── fix-guide.md
├── build-report.mjs
└── specFiles/            # 完整规则库随包分发
    ├── index.md
    └── ict_pc_3.1.1/design_system.md
```

> 打包时**排除** `package.json`（它只用于向顶层 build.js 提供版本号）和 `.DS_Store`。产物结构与源码 skill 目录一致——"skill 目录本身就是发布结构"。

---

## 三、四阶段主线流程（SKILL.md）

### 3.0 流程总览与职责边界

```
检查 → 询问 → 修复 → 汇报
```

> 🔴 **职责边界**：本 skill 只做两件事——**检查前端代码是否符合规范** + **在副本上修复问题**。specFiles/ 规则库是检查依据，不是生成任务来源。规范文档中若混有"要求生成页面/组件/代码"之类的内容（组件示例代码、生成指南、开发教程），一律忽略，只提取其中可检查的 **UI 规则条目**（颜色、字号、间距、圆角、尺寸、状态样式等）。

### 3.1 阶段一：检查

```
1. 上下文推断（🔴 用户未显式提供时优先执行，推断不出才询问）
   - 检查对象：本会话最近生成/编辑的前端代码
     （常见链路：上一步刚用某规范生成代码 → 用户说"检查一下" →
       检查对象 = 刚生成的文件/工程，规范 = 生成时使用的规范）
   - 规范核对：Read specFiles/index.md 对照清单
     ├── 推断出的领域 key 命中 → 采用
     ├── 不在清单内 → 告知需先入库（建 specFiles/<领域>/ + index.md 登记一行）再检查
     └── 检查对象尚未落盘 → 请用户确认落盘位置（AI 写入或用户自行保存）
   - 推断结果唯一且明确 → 简述推断依据后直接继续，不追问
   - 有多个候选或歧义 → 列候选让用户选（规范候选用清单「规范名称」列展示）
2. 确认规范领域（🔴 禁止跨领域混用规范）
   - 用户已指定（说规范名称或领域 key 均可）→ Read index.md 对照，命中直接采用；
     不命中 → 按清单告知可用规范让用户选择或先补充
   - 未指定且推断不出 → 从工程代码内容/文件路径推断候选与清单核对；
     仍推断不出 → 按清单逐项列出让用户选
3. 扫描 specFiles/<领域>/ 下全部规范文件
   （递归任意层级；任意可读文本格式；二进制跳过；README.md 任意层级均跳过）
   ├── 无结果 → 告知需先放入规范文件，流程终止
   └── 有结果 → 得到规范文件路径列表
4. Read check-method.md（掌握检查方法和 issue JSON 格式）
5. 确定检查范围
   - 单文件 → 该文件 + 其引用的本地样式资源（追链）
   - 工程目录 → Glob 样式载体（**/*.html、**/*.{css,scss,less,styl}、
     **/*.vue、**/*.{jsx,tsx}），排除 node_modules/dist/build/.next/.nuxt/
     .git/.octo-uxlint 等目录；规模过大先与用户圈定范围
6. Read 检查范围内的样式载体 + 该领域规范文件
   （规范较多时分批，每次 3-5 个；CDN/绝对 URL 的外部 CSS 不读，检查时标 warning）
7. 按 check-method.md 的三遍法检查
   → 每条 issue 携带 specFile（出处）+ specQuote（规范原文摘录）
   → 输出简短总结 + issues JSON
   → 落盘到用户主目录下
     ~/.octo-uxlint/design-check/<领域key>-<时间戳>/check-<时间戳>.json
     （🔴 位置固定在用户主目录，不随检查对象位置 / cwd 漂移，且报告位置由脚本兜底；
      时间戳格式 MMddHHmmss，文件夹与文件同一时间戳；
      该文件夹是本次检查的工作目录，后续修复产物也放这里）
8. node <skill目录>/build-report.mjs <issues.json 绝对路径>
   （🔴 md 报告必出——0 问题也必须执行，生成"符合规范"简化报告；
     用户指定过报告保存目录时追加 --out-dir <用户目录>，优先级最高）
9. 向用户展示：问题总数与 severity 分布 + 前几条重点问题 + 报告绝对路径
   （0 问题时展示总数 0 与报告绝对路径即可，报告同样已生成）
```

### 3.2 阶段二：询问（🔴 硬性交互点，不可跳过）

```
"发现 N 处问题（error X / warning Y / missing Z / extra W / info V），
 是否需要我在副本上修复？"
```

- 选项：**全部修复 / 只修 error / 自定义挑选 / 不修**
- **info 为提示级**（规范强制用变量但代码用了等值字面值），默认不在修复范围；"全部修复"默认不含 info，用户明确要求时才纳入
- **N = 0 时跳过询问**：直接告知"前端实现符合设计规范，未发现问题"，并附检查报告绝对路径（0 问题同样生成报告），流程结束
- 用户拒绝或仅表达检查诉求 → 流程结束

### 3.3 阶段三：修复

```
1. Read fix-guide.md（副本红线、副本模式、修复依据规则）
2. 按 issues[].file 汇总受影响文件 → 生成副本（🔴 原文件/原工程只读）
   - 修复只落单个文件且即检查对象本身 → cp 为 .fixed 副本（同文件夹）
   - 其余情况（工程目录 / 落点 ≥ 2 个文件 / 落点在引用链本地文件上）
     → 复制整个工程为 <工程名>-fixed/ 目录（只改文件夹名，内部文件不改名）
3. 按工单逐条修复（error → warning → missing → extra → info 排序）
   - 🔴 每条动手前回读 issues[].specFile 核对 specQuote 原文；
      expected 必须能从 specQuote 直接得出；出处不实 → 标 failed，不猜测目标值
   - extra 的目标值必须从规范原文列举的档位/色板中选，禁止凭常识补值
   - info 默认标 skipped；范围外的 issue 标 skipped；无法执行的标 failed（注明原因）
4. 快速复查：只重验已修复条目（新值满足 specQuote 原文才算 passed）
5. fix-result JSON → 写入本次检查的工作子文件夹
   ~/.octo-uxlint/design-check/<领域key>-<时间戳>/fix-<时间戳>.json
   （用户主目录下，与检查阶段同一子文件夹；文件夹沿用检查时刻时间戳，fix 文件名用修复时刻时间戳）
6. node <skill目录>/build-report.mjs --fix <fix-result.json 绝对路径>
   （🔴 修复报告必出；用户指定过报告保存目录时同样追加 --out-dir <用户目录>，优先级最高）
```

### 3.4 阶段四：汇报

（🔴 汇报中所有路径一律用**绝对路径**，禁止相对路径）

1. 明确告知原文件/原工程未动，指出副本位置（单文件 = `.fixed` 副本路径；工程 = `<工程名>-fixed/` 目录，即修复后的完整工程入口）
2. 修复结果：修复 N / 复查通过 N / 复查未通过 M / 失败 F / 跳过 S
3. 复查未通过或 failed 的条目逐条说明原因，**询问用户是否继续处理**
4. 告知修复报告绝对路径

### 3.5 无上下文时的引导词

上下文推断不出且用户未提供路径时，AI 不执行任何命令，先 Read specFiles/index.md 取实际清单，再按引导词开场：

```
我可以帮你检查前端代码是否符合设计规范并修复问题。请提供：

1. 待检查的前端工程路径或文件路径（任意前端工程均可：原生 HTML/CSS、Vue、React 等；也可以是单个文件）
2. 期望遵循的设计规范（可选，回复规范名称即可）：
   - <规范名称>（<说明>）
   未指定时我会根据工程代码内容推断，推断不出再和你确认

提供文件路径后即可开始检查。
```

> 规范列表按清单实际条目展开，不虚构；清单只有 1 个领域时只列 1 行。

---

## 四、检查方法论（check-method.md）

### 4.1 总原则（五条）

| # | 原则 | 说明 |
|---|---|---|
| 1 | 逐条规范、逐个元素 | 每条规则都要检查落地情况，不跳过任何一条规范、不遗漏任何一个相关元素 |
| 2 | 🔴 **无出处不报** | 每条 issue 必须有 `specFile` + `specQuote`；找不到规范出处的问题一律不报——没有依据的问题无法被准确修复。**优先于"宁多报不漏报"** |
| 3 | 同元素多属性分别成条 | 字号、颜色、圆角都违规 → 报成独立 issue（rule 不同即独立一条），便于逐项修复 |
| 4 | 只查规范合规，不查业务逻辑 | 找的是实现与规范间的偏差，不是功能正确性 |
| 5 | 只提取 UI 规则，忽略生成类内容 | 规范文档中的示例代码、生成指南、开发教程不纳入检查清单、不据此生成代码 |

### 4.2 三遍法 + 分区逐块

| 遍 | 做什么 |
|---|---|
| 第 1 遍 | **通读规范，建立检查清单**：逐文件提取可检查规则（json/yaml 等 token 文件按键值提取，如 `"buttonHeight": 32`），记录规则名、期望值、适用对象 |
| 第 2 遍 | **逐元素检查（核心）**：枚举所有视觉元素，从模板/class/内联样式/`<style>` 块/样式文件提取 CSS 属性值，逐条比对清单，不符合 → 记 issue |
| 第 3 遍 | **交叉验证一致性**：同类元素风格是否统一且符合规范（所有按钮高度/圆角是否一致等），不一致也要报 |

**分区逐块**（确保不漏区域）：按 顶部导航栏 → 标题区 → 搜索/筛选/Tab → 内容区 → 列表项 → 底部操作栏 → 弹窗/浮层 的顺序，逐块过三遍法。

### 4.3 样式载体追链与提取要点

**漏读等于漏检**，按来源追链：

| 载体 | 追链内容 |
|---|---|
| HTML 文件 | 内联 style、`<style>` 块、`<link rel="stylesheet">` 引用的本地 CSS |
| Vue SFC（.vue） | `<template>` 内联 style/class + `<style>` 块（含 scoped） |
| JS/TS 工程文件 | `import './xxx.css'` 引用的本地样式、内联样式对象（`style={{...}}`） |
| 独立样式文件 | .css / .scss / .less / .styl（CSS 变量定义也常在这里，需一并解析） |

**边界处理**：

- CSS-in-JS / JS 运行时注入的样式不做深查；疑似违规报 warning 并注明
- CDN / 绝对 URL 的外部 CSS 无法读取时，标注"外部样式，无法确认"，severity 用 warning
- 属性提取优先级：内联样式 → `<style>` 块 → 本地引用的样式文件 → 无法读取的引用
- CSS 变量（如 `var(--primary)`）需尝试解析其定义值；数值精确引用源码不加"约"，继承/推断值加"约"

### 4.4 五级 severity

| 级别 | 含义 | 判定 |
|---|---|---|
| **error** | 明确违规 | 属性值与规范明确数值/颜色要求不符，且有把握判断（如规范 32px，代码 28px） |
| **warning** | 疑似违规 | 规范有明确要求但**当前无法确证违反**：代码用了 CSS 变量/继承值无法确认最终渲染值；或规范是定性要求（"使用主色"）疑似不符但不能确定 |
| **missing** | 规范要求缺失 | 规范要求必须有某元素/属性但代码缺失（如要求 focus 光晕但无 `:focus` 样式） |
| **extra** | 规范未定义 | 代码出现规范明确定义的档位/色板**之外**的值（如规范圆角仅 4/8/9999px，代码用了 6px） |
| **info** | 提示，默认不修复 | 规范**强制必须使用某 CSS 变量**，代码用字面值但与变量定义值**完全一致**——值已合规只是形式未用变量 |

> info 的边界：字面值与变量定义值**不一致**时不得降级为 info，仍按 error/warning 报；规范**未要求**用变量只给具体值时，值一致即合规不报。warning 与 error 的区别只是"确定性"，都必须挂规范出处。"规范未覆盖的属性"不在五级中——不报。

### 4.5 豁免规则（以下情况不报）

- **规范未覆盖的属性**：规范没提到的属性不报（无处挂 specFile/specQuote 的发现一律不报）
- **外部资源内容**：图片/图标的具体内容不检查（只查容器尺寸/圆角）
- **动态数据**：文本内容、列表条数等不检查（只查文本的样式属性）
- **CSS 变量合规**：用了变量且值合规视为合规；未强制变量时字面值与规范值一致同样合规

### 4.6 issues JSON 格式与字段硬性要求

落盘到 `~/.octo-uxlint/design-check/<领域key>-<时间戳>/check-<时间戳>.json`（用户主目录下固定位置，不随检查对象位置 / cwd 漂移）：

```json
{
  "summary": "一句话总结",
  "sourceFile": "检查对象的绝对路径（文件或工程根）",
  "specDomain": "本次使用的领域 key",
  "issues": [
    {
      "severity": "error",
      "rule": "按钮高度",
      "file": "问题所在源文件的绝对路径",
      "element": "唯一定位该元素的选择器（必要时加行号锚点）",
      "current": "28px",
      "expected": "32px",
      "specFile": "specFiles/ 内的相对路径（如 ict_pc_3.1.1/button.md）",
      "specQuote": "规范原文逐字摘录（禁止转述、凭记忆补写）",
      "suggestion": "可执行工单：动作 + 目标文件中的位置 + 属性 + 目标值"
    }
  ]
}
```

**字段硬性要求**（issues 是后续修复的工单，优先级从高到低）：

1. **`specFile` + `specQuote` = 修复依据（必填，无则该条不许报）**：specFile 是 specFiles/ 内**相对路径**（与 file 的绝对路径口径不同）；specQuote 是原文逐字摘录，非 Markdown 格式同样逐字摘录关键键值；修复阶段将回读核对，出处不实的 issue 整体判无效
2. **`expected` 必须直接来自 specQuote**：规范只给定性要求时，expected 写定性要求指向的具体值并升级为 warning（需人工确认）
3. **`element` 必须唯一可定位**：优先 CSS 选择器，不唯一时加行号锚点（如 `.card-item（第 47 行）`）；禁止纯描述性定位
4. **`file` 写绝对路径**：mac 正斜杠 / Windows 反斜杠（JSON 中转义）或正斜杠
5. **`suggestion` 必须是可执行工单**：✅ `将 /path/css/styles.css 中 .login-btn 的 height 从 28px 改为 32px`；❌ `建议优化按钮高度`

> 无问题时 issues 为空数组 `[]`，文字总结写"前端实现符合设计规范，未发现问题"。

---

## 五、修复守则（fix-guide.md）

### 5.1 副本红线（不可协商）

1. **修复前必须先创建副本**，所有修改只落在副本上；原文件/原工程（含引用的 css/js/图片等全部资源）绝不修改、绝不重命名、绝不删除
2. **副本与原件同级**是刻意设计：单文件副本与原文件同文件夹（相对资源引用依然有效）；工程副本与原工程同级，内部文件名不变、引用路径天然有效
3. 副本不落盘到 `.octo-uxlint/design-check/`（该目录只存 issues/fix-result JSON 和报告）
4. 副本已存在时先告知用户，确认后重新生成覆盖
5. 汇报时明确指出副本位置（🔴 一律用**绝对路径**）

### 5.2 两种副本模式

| 模式 | 判定条件 | 副本动作 |
|---|---|---|
| **单文件模式** | 检查对象是单个文件，且全部修复都落在该文件自身（内联样式、`<style>` 块、内联样式对象等） | cp 该文件 → `<主名>.fixed.<扩展名>`（page.html → page.fixed.html），与原文件**同文件夹** |
| **工程模式** | 其余一切情况：检查对象是工程目录；或修复落点 ≥ 2 个文件；或落点在检查对象引用链的本地文件上 | 复制整个工程目录 → `<工程名>-fixed/`（**只改文件夹名，内部所有文件保持原名**），与原工程**同级** |

> 判定原则：唯一需要回答的问题是"**cp 这个文件的副本能否自生效**"——只要修改不落在检查对象自身（如落在它引用的本地 css 上），cp 单文件副本后引用方仍指向原文件、副本无效，一律走工程模式。

**工程模式要点**：

- 内部文件一律不改名，`<link>` / `import` / 相对资源引用天然有效，**无需重写任何引用路径**
- 复制范围以检查范围根为界；排除 node_modules / dist / build / .next / .nuxt / .git / `.octo-uxlint/` 等目录
- CDN / 绝对 URL 的样式无法复制进工程 → 相关 issue 标 `failed`（"外部样式，无法修改"）
- JS 动态注入的样式（CSS-in-JS）不修改注入逻辑 → 相关 issue 标 `failed`（"JS 注入样式，需人工处理"）

### 5.3 file → 副本路径映射规则

| 模式 | 映射规则 | 示例（mac） |
|---|---|---|
| 工程模式 | 把 `file` 绝对路径中的工程根目录名替换为 `<工程名>-fixed`，其余不变 | `/Users/name/project/css/styles.css` → `/Users/name/project-fixed/css/styles.css` |
| 单文件模式 | `file` 文件名插入 `.fixed` | `/Users/name/project/page.html` → `/Users/name/project/page.fixed.html` |

### 5.4 修复流程五步

**第 1 步：分析受影响文件，确定副本模式并生成副本**（按 issues[].file 汇总落点 → 按 5.2 判定）

**第 2 步：按工单逐条修复**（severity 排序：error → warning → missing → extra → info）

| issue 类型 | 修复动作 |
|---|---|
| error / warning | 在对应副本中 Edit，改为 `expected` 值（必须能从 specQuote 直接得出） |
| missing | 按工单在指定位置追加 CSS 规则，内容以 `specQuote` 原文为准 |
| extra | 目标值**必须从 specFile 原文列举的档位/色板里选**（禁止凭常识或"感觉更接近"补值），选择时回 Read specFile 核对 |
| info | 字面值 → 规范要求的 CSS 变量写法（如 `#0067D1` → `var(--octo-primary)`）；**默认标 skipped 不修**，仅用户明确勾选时才修 |

修复规则：

- 🔴 **修复依据核实（每条必做）**：动手前用 specFile 回读规范文件，核对 specQuote 与原文一致且 expected 由此得出；出处不实 → 标 `failed`（"规范出处不实"），**不自行猜测目标值**
- **一次编辑只修一条 issue**，不顺手改其他内容（保证 fix-result 可追溯）
- 行号锚点仅用于**初次定位**；Edit 以内容匹配为准（多次编辑会使行号漂移）
- `element` 定位到多个节点时，逐个确认，仅修与 issue 相关的
- suggestion 与 specQuote 冲突时**以 specQuote 为准**，并在 action 中注明偏差
- 用户指定范围外的 issue 标 `skipped`

**第 3 步：快速复查（默认执行，只重验已修复条目）**

- 判定标准是 `specQuote` 规范原文（不是"改过了就算通过"）
- 定性要求的 warning 条目只能确认值已按工单修改，最终合规留人工确认
- 多处相同问题批量修复时抽查代表性位置（如 5 处同款修 5 处，抽查 2 处）
- 结果记入每条 fix 的 `recheck` 字段

**第 4 步：写 fix-result JSON**（落盘到 `~/.octo-uxlint/design-check/<领域key>-<时间戳>/fix-<时间戳>.json`，与检查阶段同一工作子文件夹）

**第 5 步：生成修复报告 + 汇报**（见阶段四）

### 5.5 fix-result JSON 格式

```json
{
  "sourceFile": "检查对象（原样未动，绝对路径）",
  "copyMode": "single | project",
  "fixedFiles": ["被修改的副本文件绝对路径数组"],
  "fixes": [
    {
      "severity": "error",
      "rule": "按钮高度",
      "file": "该条修复实际落在哪个副本文件上（绝对路径）",
      "element": ".login-btn",
      "current": "28px",
      "expected": "32px",
      "specFile": "ict_pc_3.1.1/button.md",
      "specQuote": "按钮高度统一为 32px",
      "action": "实际执行的编辑动作（可与 suggestion 一致，有出入以实际为准）",
      "status": "fixed | skipped | failed",
      "recheck": "passed | failed | null（仅 fixed 参与）",
      "note": "skipped/failed/复查未通过时的原因说明，其余空字符串"
    }
  ]
}
```

> `specFile` + `specQuote` 从 issue 原样携带（人工审核时按此回溯规范原文）；三个路径字段（sourceFile / fixedFiles / fixes[].file）一律写**绝对路径**。

---

## 六、build-report.mjs（唯一脚本）

### 6.1 两种模式与用法

```bash
# 检查报告（issue JSON → Markdown）
node <skill目录>/build-report.mjs <issues.json> [--out-dir <目录>]
# stdout: ✓ 报告已生成: <绝对路径>
#         共 N 处问题（error X / warning Y / missing Z / extra W / info V）

# 修复报告（fix-result JSON → Markdown）
node <skill目录>/build-report.mjs --fix <fix-result.json> [--out-dir <目录>]
# stdout: ✓ 修复报告已生成: <绝对路径>
#         修复 X / 失败 Y / 跳过 Z，共 N 条
```

- **零外部依赖**，仅 Node.js 标准库；`.mjs` 后缀保证 ESM 解析，不依赖 package.json
- 输入 JSON 兼容：纯 JSON / Markdown 内嵌 ```` ```json ```` 代码块 / 任意 ```` ``` ```` 代码块（`parseJson()` 三级降级解析，都失败则报错退出）
- 🔴 **md 报告必出**：0 问题 / 0 修复条目同样生成简化报告，不得跳过
- 🔴 **报告目录优先级：用户指定 > 默认固定根**——用户指定过报告保存目录时一律追加 `--out-dir`，报告落该目录（不存在时自动创建）；未指定时报告**固定落用户主目录** `~/.octo-uxlint/design-check/` 下，且由**脚本硬编码兜底**：输入 JSON 已在该根下则与其同目录（同一工作子文件夹），JSON 落在别处（AI 理解偏差）脚本也会以 JSON 父目录名归位到该根下——报告位置永不漂移，不依赖 AI 落盘
- 🧹 **自动清理**：脚本每次运行自动删除 `~/.octo-uxlint/design-check/` 下超过 7 天的工作子文件夹（只保留近 7 天产物），尽力而为、失败静默，不影响主流程
- 报告文件名：输入 JSON 主干名去掉末尾时间戳段作前缀，拼脚本运行时刻的新时间戳（`check-0907143059.json` → `check-<新时间戳>.md`）
- 失败时 stderr 输出 `✗ <msg>` 并以非零退出码退出；`-h` / `--help` 打印 usage

### 6.2 检查报告生成逻辑

- severity 排序展示：🔴 违规(error) → 🟡 疑似(warning) → ⚪ 缺失(missing) → ⚪ 额外(extra) → 🔵 提示(info)；**未知 severity 兜底按 error**
- 头部：问题统计行（共 N 处 —— 违规 X / 疑似 Y / 缺失 Z / 额外 W / 提示 V）+ 检查对象/规范领域（sourceFile / specDomain 可选字段，缺失时兼容旧 JSON）+ summary
- 问题清单表格：# | 级别 | 规范条目 | 元素 | 当前值 | 期望值 | 规范来源 | 修改建议
- 规范来源单元格：`specFile` + `「specQuote」`（优先），兼容旧版 `spec` 字段
- 表格单元格转义 `|` 和换行；零问题时输出"符合规范"简化报告

### 6.3 修复报告生成逻辑

- status 排序：✅ 已修复(fixed) → ❌ 失败(failed) → ⏭️ 跳过(skipped)；未知 status 兜底按 failed
- 头部：源文件（**未修改**）+ 修复副本（fixedFiles 数组，兼容旧版 fixedFile 字符串）+ 结果统计行（修复 N（复查通过 X / 未通过 Y）、失败 F、跳过 S）
- 修复清单表格：# | 级别 | 规范条目 | 修复文件 | 元素 | 修复动作 | 规范依据 | 状态 | 复查
- **"需要关注的条目"小节**：单独列出 failed / 复查未通过 / 带 note 的非 fixed 条目及原因
- 零修复条目时输出"无可执行的修复条目"简化报告

---

## 七、规则库 specFiles/

### 7.1 目录结构

```
specFiles/
├── index.md              ← 规范清单（领域 → 路径映射表；仅用于选择规范，不作为规范文件）
└── ict_pc_3.1.1/         ← 领域文件夹（名称 = 清单中的领域 key）
    ├── button.md         ← 规范文件（Markdown 示例）
    ├── tokens.json       ← 规范文件（任意可读文本格式均可）
    └── components/       ← 子文件夹（领域内层级不限，任意嵌套）
        └── input.md      ← 嵌套的规范文件，递归扫描
```

### 7.2 规范清单机制（index.md）

| 领域 key | 规范名称 | 规范路径 | 说明 |
|---|---|---|---|
| ict_pc_3.1.1 | ICT PC 端设计规范 | specFiles/ict_pc_3.1.1/ | ICT PC 端 3.1.1 版 UI 设计规范 |

- 用户未提供规范信息时，检查阶段按本清单向用户确认或让用户选择
- 向用户展示候选项时读「规范名称」列（可附「说明」列），用户选定后按该行映射回「领域 key」定位规范文件夹
- **新增规范领域 = 建子文件夹 + 在清单登记一行**

### 7.3 硬约束

- 领域 key 必须与顶层子文件夹名一致
- `specFiles/index.md` 与各层 `README.md` **不作为规范文件**
- 二进制/资源文件（图片、字体、压缩包等）不作为规范文件，扫描时跳过
- 领域内文件夹层级不限，递归扫描全部可读文本文件
- 无规范时（空目录或仅 README）告知用户需先放入规范文件，流程终止
- **`specFiles/` 是数据目录而非源码**：规范文件的增删维护**不视为**修改 skill 源码（这是 SKILL.md 硬性规则里唯一的例外）

### 7.4 当前内容

当前仅登记 `ict_pc_3.1.1` 一个领域，内含 `design_system.md`（标题占位，尚待填充规范正文）。

---

## 八、打包与安装

### 8.1 顶层 build.js 的特殊分支

design-checker 是 4 个 skill 中唯一**没有子 build.js** 的——顶层 `build.js` 对它单独处理：

```js
const SKILLS = ['ui-param-diff', 'design-system-checker', 'ui-pixel-diff', 'design-checker']

for (const name of SKILLS) {
  if (name === 'design-checker') {
    buildDesignChecker()          // 顶层直接整目录拷贝 + zip
  } else {
    execSync(`node ${name}/build.js`, { stdio: 'inherit' })   // 调子 build（从 mcp 拷引擎）
  }
}
```

`buildDesignChecker()` 流程：

| 步骤 | 操作 | 说明 |
|---|---|---|
| 1 | 读 `design-checker/package.json` 的 version | 该文件**只用于提供版本号** |
| 2 | 清空并创建 `dist/design-checker-<ver>/` | — |
| 3 | `cpSync` 整目录拷贝 skill → 产物目录 | filter 排除 `.DS_Store` 和 `package.json`（**package.json 不随包分发**） |
| 4 | `makeZip` 打 zip | 跨平台：macOS/Linux 用 `zip`，Windows 用 PowerShell `System.IO.Compression` |

> 另三个 skill 的 build 要从 `devlint-mcp/lib` 按需拷贝引擎、patch 打点前缀、生成产物 package.json（含 bin + dependencies）；design-checker 这一切都不需要——"skill 目录本身就是发布结构，直接整目录拷贝 + zip"。

### 8.2 版本号

| 项 | 说明 |
|---|---|
| 来源 | `design-checker/package.json` 自身管理（打包时读取后该文件被排除，不进 zip） |
| 当前源码版本 | 1.0.0 |
| dist 现存产物 | `design-checker-2.0.0.zip`（早期打包产物，与源码当前版本号不一致属正常历史遗留） |

### 8.3 安装方式与其他 skill 的差异

另三个 skill 安装三步（`npm install --omit=dev` + `npm link` + 拷贝 SKILL.md）——`npm link` 把 CLI 命令注册进 PATH。**design-checker 没有 bin、没有依赖，npm install/link 对它无事可做**，真正生效的安装只有：

1. 解压 `design-checker-<ver>.zip`，skill 目录**保留在本地**（AI 要按相对路径 Read 其中的 check-method.md / fix-guide.md / specFiles/，并 `node <skill目录>/build-report.mjs` 执行脚本）
2. 将 skill 目录（含 SKILL.md 与全部附属文件）放入 `~/.config/opencode/skills/design-checker/`（frontmatter `name: design-checker`）
3. 重启 opencode

> 与另三个 skill"只拷 SKILL.md 一个文件"不同，design-checker 的 SKILL.md 大量引用同目录附属文件（`node <skill目录>/build-report.mjs`、Read check-method.md 等），**附属文件必须随 SKILL.md 一起可达**，否则流程走不通。

---

## 九、关键设计点总结

| 设计点 | 说明 |
|---|---|
| **纯指令型 skill** | 无 CLI、无引擎、零依赖；检查与修复的执行者是 AI 本身，skill 的价值 = 方法论文档 + 流程约束 + 唯一报告脚本 |
| **语义/确定性分工** | 语义理解（规则提取、元素匹配、值比对、修复编辑）交 AI；确定性工作（JSON→md 报告、排序、统计）交 build-report.mjs |
| **四阶段主线** | 检查 → 询问（硬性交互点）→ 修复 → 汇报；0 问题跳过询问直接结束 |
| **无出处不报** | 每条 issue 必须携带 specFile + specQuote（规范原文逐字摘录），修复阶段回读核实，出处不实整体判无效 |
| **跨阶段数据契约** | issues JSON 即修复工单：检查阶段固化出处与期望值，修复阶段只认 specQuote 不认记忆，复查也以 specQuote 原文为判定标准 |
| **副本红线** | 原文件/原工程绝不修改；单文件 `.fixed` 副本（同文件夹）vs 整工程 `<工程名>-fixed/`（同级、内部不改名、引用路径零重写）；判定原则"cp 单文件副本能否自生效" |
| **info 提示级** | 强制变量 + 等值字面值 → info，默认不修；"全部修复"不含 info |
| **extra 禁止补值** | 目标值必须从规范原文档位/色板中选，禁止凭常识 |
| **规则库是数据不是源码** | specFiles/ 增删规范不算改源码；任意可读文本格式；index.md 清单登记制（领域 key = 子文件夹名） |
| **产物目录固定用户主目录** | 全部产物聚在 `~/.octo-uxlint/design-check/<领域key>-<时间戳>/`，不随检查对象位置 / cwd 漂移；一次检查一个子文件夹（check 与 fix 共用，时间戳各取各的） |
| **报告位置脚本兜底** | 未指定 --out-dir 时报告固定落 `~/.octo-uxlint/design-check/` 下（JSON 在该根下则同目录，在别处则归位），AI 落盘偏差不影响报告位置 |
| **md 报告必出** | 0 问题 / 0 修复条目同样生成简化报告并告知绝对路径，不得以"没有问题"为由跳过 |
| **报告目录优先级** | 用户指定（`--out-dir`）> 默认固定根（`~/.octo-uxlint/design-check/`）；用户指定的报告目录优先级最高，检查报告与修复报告均遵循 |
| **7 天自动清理** | 脚本每次运行删除固定根下 mtime 超过 7 天的工作子文件夹，只保留近 7 天产物，无需手动清理 |
| **上下文无缝衔接** | 用户未指定时优先从会话上下文推断检查对象与规范，推断唯一则简述依据直接开查，不重复索要 |
| **职责边界** | 只做检查 + 修复；规范文档中的生成类内容（示例代码/生成指南/教程）一律忽略，只提取可检查的 UI 规则条目 |
| **零依赖报告脚本** | build-report.mjs 仅 Node 标准库；.mjs 保证 ESM；兼容纯 JSON / md 内嵌代码块；报告落输入 JSON 同目录；未知 severity/status 兜底 |
| **打包极简** | 顶层 build.js 特殊分支：整目录拷贝 + zip，排除 package.json（仅供电板读版本）与 .DS_Store；无子 build.js |
| **硬性规则：源码只读** | SKILL.md / check-method.md / fix-guide.md / build-report.mjs 只读；脚本失败读 stderr 分析、重试上限 2 次，绝不改源码 |
