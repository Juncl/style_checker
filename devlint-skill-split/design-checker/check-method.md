# 设计规范检查方法论

> 本文档定义"前端实现 vs 设计规范文档"的对照检查方法。检查对象不限 HTML（任意前端工程/单文件均可），规范文档不限 Markdown（任意可读文本格式均可）。
> 检查产物（issues JSON）是后续修复工单的数据源，**每条 issue 必须携带可回溯的规范出处**——修复阶段的一切动作以规范原文为唯一依据，因此检查阶段就要把出处和原文摘录固化进 issue，而不是靠修复阶段的记忆。

---

## 总原则

1. **逐条规范、逐个元素**：规范文档中的每一条规则都要在前端代码中检查落地情况，不跳过任何一条规范、不遗漏任何一个相关元素。
2. **🔴 无出处不报**：每条 issue 必须能给出 `specFile`（规范库内文件路径）+ `specQuote`（规范原文逐字摘录）。**找不到规范出处的问题一律不报**——没有依据的问题无法被准确修复，报出来只会误导。这优先于"宁多报不漏报"。
3. **同元素多属性分别成条**：同一元素若字号、颜色、圆角都违反规范，**分别报成独立的 issue 条目**（rule 不同即独立一条），便于逐项修复。
4. **只查规范合规，不查业务逻辑**：找的是前端实现（HTML/CSS/Vue/JSX 等）与设计规范之间的偏差（颜色、字号、间距、圆角、组件尺寸等），不是业务功能是否正确。
5. **只提取 UI 规则，忽略生成类内容**：本 skill 只做检查 + 修复，不生成前端代码。规范文档中混杂的组件示例代码、生成指南、开发教程等"要求生成页面/组件/代码"的内容一律不纳入检查清单、不据此生成任何代码；AI 需自行甄别，只把可对照检查的 UI 规则条目（数值、色值、尺寸、状态样式等）提取进清单。

## 输入约定：单文件 or 前端工程

- **输入来源**：用户显式指定，或来自会话上下文推断（上一步刚用某规范生成/编辑的代码）——上下文推断出的对象同样按样式载体追链读取，其规范领域 key 必须命中 specFiles/index.md 清单；只在会话中、未落盘的代码需先确认落盘位置（AI 写入或用户自行保存）才能进入检查
- 用户提供的可能是单个文件（HTML / CSS / Vue / JSX 等），也可能是任意前端工程（原生 HTML+CSS、Vue、React 等）
- **样式载体均需读取**，按来源追链，漏读等于漏检：
  - HTML 文件：内联 style、`<style>` 块、`<link rel="stylesheet">` 引用的本地 CSS
  - Vue SFC（.vue）：`<template>` 中的内联 style/class + `<style>` 块（含 scoped）
  - JS/TS 工程文件（.js/.ts/.jsx/.tsx）：`import './xxx.css'` 引用的本地样式文件、内联样式对象（`style={{...}}`）
  - 独立样式文件：.css / .scss / .less / .styl（CSS 变量定义也常在这里，需一并解析）
- 工程目录场景：Glob 样式载体文件时**排除 node_modules / dist / build / .git / .next / .nuxt / .octo-uxlint 等依赖、构建产物与检查工作目录**；规模过大时分批读取，或先与用户圈定入口范围
- CSS-in-JS / JS 运行时注入的样式不做深查；若疑似违规，报 warning 并注明
- CDN / 绝对 URL 的外部 CSS 无法读取时，标注"外部样式，无法确认"，severity 用 warning

## 检查方法：三遍法 + 分区逐块

**第 1 遍｜通读规范，建立检查清单**
- 逐条阅读规范文件（任意文本格式，md/txt/json/yaml/yml/html/csv 等均按内容提取规则），提取每条可检查的规则（如"按钮高度 32px""主色 #0067D1""Tag 字号 10px""圆角 4px"等；json/yaml 等 token 文件按键值提取，如 `"buttonHeight": 32`）。
- 将规则整理为内部检查清单，每条规则记录：规则名、期望值、适用对象。

**第 2 遍｜逐元素检查（核心）**
- 解析工程代码，枚举所有视觉元素：按钮、输入框、文本、标签/Chip、卡片/容器、图标、分割线、开关、进度条等。
- 对每个元素，从模板/标签、class 名、内联样式、`<style>` 块、样式文件中提取其 CSS 属性值（颜色、字号、字重、圆角、间距、尺寸等）。
- 用第 1 遍的检查清单逐条比对：该元素的属性值是否符合对应规范条目。
- 不符合 → 记录为 issue。

**第 3 遍｜交叉验证一致性**
- 回头检查同类元素在工程中是否风格统一且符合规范：所有按钮高度/圆角是否一致、所有标签样式是否一致、所有卡片圆角是否一致。
- 同类元素之间不一致，或与规范不符，都要报。

**分区逐块（确保不漏区域）**：
按 顶部导航栏 → 标题区 → 搜索/筛选/Tab → 内容区 → 列表项 → 底部操作栏 → 弹窗/浮层（如有）的顺序，逐块过一遍三遍法。

## 样式属性提取要点

从前端代码中提取 CSS 属性时，注意以下来源（按优先级）：
1. **内联样式**：HTML/模板中的 style 属性（`<div style="color: #0067D1; border-radius: 8px;">`）、JSX/TSX 的 style 对象（`style={{ color: '#0067D1' }}`）
2. **`<style>` 块**：HTML 页内 / Vue SFC（含 scoped）的 CSS 规则，按选择器匹配到对应元素
3. **本地引用的样式文件**：`<link>` 或 `import` 指向的本地 .css/.scss/.less，Read 读取后按选择器匹配（CSS 变量定义也常在这里，需一并解析）
4. **无法读取的引用**：CDN / 绝对 URL 的外部 CSS，标注"外部样式，无法确认"

**属性读取规范**：
- 颜色：提取为 #RRGGBB 或 rgba() 格式；CSS 变量（如 `var(--primary)`）需尝试解析其定义值
- 字号 / 圆角 / 间距 / 尺寸：提取为 px 值（如 `font-size: 14px`、`height: 32px`）

## 差异判定与分级

- **error（明确违规）**：代码中的属性值与规范文档的明确数值/颜色要求不符，且有把握判断。例如规范要求按钮高度 32px，代码中是 28px。
- **warning（疑似违规）**：**规范有明确要求，但当前无法确证违反**，以下情况标为 warning：
  - 规范有数值要求，但代码中用了 CSS 变量/继承值，无法确认最终渲染值
  - 规范是定性要求（如"使用主色"），代码中的值疑似不符但不能确定
- **missing（规范要求缺失）**：规范要求必须有某个元素/属性，但代码中缺失。例如规范要求按钮有 focus 光晕，但代码中没有 `:focus` 样式。
- **extra（规范未定义）**：代码中出现了规范明确定义的档位/色板之外的值。例如规范规定圆角仅 4px/8px/9999px，代码用了 6px。
- **info（提示，默认不修复）**：规范**明确要求必须使用某个 CSS 变量**（如"颜色一律使用 var(--octo-primary)"），代码中用的是字面值，但该字面值与变量的定义值**完全一致**——值已合规，只是形式未用变量。仅作提示，修复阶段默认跳过。

> info 的边界：字面值与变量定义值**不一致**时，不得降级为 info，仍按 error/warning 报（值本身违规）；规范**未要求**用变量、只给了具体值时，值一致即合规、不报（见豁免规则）。

> warning 与 error 的区别只是"确定性"，**都必须挂规范出处**。"规范未覆盖的属性"不在这五级中——它不报（见豁免规则）。info 仅在"强制用变量且值恰好一致"时使用，修复阶段默认跳过。

## 豁免规则（以下情况不报）

- **规范未覆盖的属性**：规范文档中没有提到的属性，不报为问题（如规范没说 line-height，就不检查 line-height）。无处挂 `specFile`/`specQuote` 的发现一律不报。
- **外部资源内容**：代码中引用的图片、图标的具体内容不检查（只检查其容器尺寸/圆角）。
- **动态数据**：文本内容、列表条数等动态数据不检查（只检查文本的样式属性）。
- **CSS 变量合规**：如果代码使用了 CSS 变量且变量值符合规范，视为合规（规范未强制用变量时，字面值与规范值一致同样视为合规；规范强制用变量而代码用字面值、值又与变量定义值一致时，按 info 提示级处理）。

## 数值读取规范

- 从前端代码中读取的数值通常是精确值（如 `font-size: 14px`），直接引用，不加"约"前缀。
- 如果是通过继承/计算推断的值（非源码直接声明），加"约"前缀。
- 颜色值：优先用源码中的精确值（如 `#0067D1`），不用猜测色值。

---

## 输出格式：简短总结 + 问题 JSON

输出分两部分：

**第 1 部分：简短文字总结**（给用户快速看）

**问题统计：共 N 处（error X / warning Y / missing Z / extra W / info V）**

一句话点出最突出的问题方向，服务于修复优先级判断。不超过两行。

**第 2 部分：问题 JSON**（落盘到检查根（工程根 / 单文件所在目录）下 `.octo-uxlint/design-check/<领域key>-<时间戳>/check-<时间戳>.json`，用于生成报告 + 驱动修复；时间戳格式为月日时分秒 MMddHHmmss，文件夹与文件用同一时间戳）

在 Markdown 中输出一个 JSON 代码块，结构如下（字段名固定，不可增减）：

```json
{
  "summary": "按钮高度和标签字号多处不符合 ict_pc_3.1.1 规范，需统一修改。",
  "sourceFile": "/Users/name/project",
  "specDomain": "ict_pc_3.1.1",
  "issues": [
    {
      "severity": "error",
      "rule": "按钮高度",
      "file": "C:\\Users\\name\\project\\css\\styles.css",
      "element": ".login-btn",
      "current": "28px",
      "expected": "32px",
      "specFile": "ict_pc_3.1.1/button.md",
      "specQuote": "按钮高度统一为 32px",
      "suggestion": "将 C:\\Users\\name\\project\\css\\styles.css 中 .login-btn 的 height 从 28px 改为 32px"
    },
    {
      "severity": "missing",
      "rule": "focus 光晕",
      "file": "/Users/name/project/page.html",
      "element": ".search-input",
      "current": "无 :focus 样式",
      "expected": "box-shadow: 0 0 0 2px rgba(0,103,209,0.2)",
      "specFile": "ict_pc_3.1.1/input.md",
      "specQuote": "输入框聚焦时显示蓝色光晕 box-shadow: 0 0 0 2px rgba(0,103,209,0.2)",
      "suggestion": "在 /Users/name/project/page.html <style> 块追加 .search-input:focus { box-shadow: 0 0 0 2px rgba(0,103,209,0.2); }"
    }
  ]
}
```

> 示例中两条 issue 分别演示 Windows（反斜杠已按 JSON 规则转义）与 mac 两种路径格式，实际按运行平台写对应的绝对路径即可。
> 顶层字段：`summary` = 一句话总结；`sourceFile` = 检查对象的**绝对路径**（文件或工程根）；`specDomain` = 本次使用的领域 key——两者供报告头部展示与存档追溯，必填。

### 🔴 字段硬性要求（修复工单数据源）

issues 是后续修复的工单，修复阶段以 `specQuote` 为唯一修复依据，以下要求优先级从高到低：

1. **`specFile` + `specQuote` = 修复依据（必填，无则该条不许报）**：
   - `specFile`：规范库 `specFiles/` 下的文件相对路径（本次检查实际 Read 过的文件），如 `ict_pc_3.1.1/button.md`、`ict_pc_3.1.1/tokens.json`（任意可读文本格式，按实际路径写）；规范文件在领域内子文件夹时按实际层级写，如 `ict_pc_3.1.1/components/input.md`
     （注意：`specFile` 是 specFiles/ 内的**相对路径**，与 `file` 的**绝对路径**口径不同，勿混用）
   - `specQuote`：该文件中规范条目的**原文逐字摘录**（可截取关键句，禁止转述、禁止凭记忆补写），修复目标值必须能从这句话直接得出；非 Markdown 格式（json/yaml 等 token 文件）同样逐字摘录关键键值（如 `"buttonHeight": 32`）
   - 修复阶段将依据 `specFile` 回读规范原文核对 `specQuote`，出处不实的 issue 会被整体判为无效
2. **`expected` 必须直接来自 `specQuote`**：是规范原文中的值，不是推断值。规范只给定性要求（如"使用主色"）时，expected 写该定性要求指向的具体值并升级为 warning（需人工确认）
3. **`element` 必须唯一可定位**：
   - 优先输出能唯一定位该元素的 CSS 选择器（如 `.login-btn`、`button.primary`、`#header .title`；JSX/TSX 的 className 按渲染后 class 匹配）
   - 选择器不唯一时，输出 `选择器 + 行号` 锚点（如 `.card-item（第 47 行）`）
   - 禁止输出"顶部按钮""列表里的标签"这类纯描述性定位——修复时无法据此定位
4. **`file` 标明问题所在源文件**：
   - 写**绝对路径**——mac 如 `/Users/name/project/index.html`；Windows 如 `C:\Users\name\project\index.html`
     （写进 JSON 时 Windows 反斜杠需转义为 `C:\\Users\\name\\project\\index.html`，或直接用正斜杠 `C:/Users/name/project/index.html`）
   - 修复时需据此决定修改哪个文件的副本，缺失会导致修复落错文件
5. **`suggestion` 必须是可执行工单**，格式：`动作 + 目标文件中的位置 + 属性 + 目标值`，与 `file` 保持一致：
   - ✅ `将 /Users/name/project/css/styles.css 中 .login-btn 的 height 从 28px 改为 32px`（Windows 同理，如 `将 C:\Users\name\project\css\styles.css 中 .login-btn 的 height 从 28px 改为 32px`）
   - ❌ `建议优化按钮高度`（不可执行）
   - ❌ `按钮高度应符合规范`（缺目标值）

### 其余约束

1. `severity` 只能是：`error` / `warning` / `missing` / `extra` / `info`（info 为提示级，修复默认跳过）。
2. `rule` 为规范条目的简短名称（如"按钮高度""Tag 字号""主色""圆角"），用中文。
3. `current` 为代码中的当前值，`expected` 为规范要求的期望值。数值精确引用源码，推断值加"约"前缀。
4. 同一元素多属性违规**分别成条**（rule 不同即独立一条），不要合并。
5. 动态数据差异不报。外部资源内容不检查。
6. 无问题时，issues 为空数组 `[]`，文字总结写"前端实现符合设计规范，未发现问题"。
