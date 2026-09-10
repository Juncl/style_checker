# 设计规范检查方法论

> 检查产物（issues JSON）是修复工单的数据源，**每条 issue 必须携带可回溯的规范出处**（`specFile` + `specQuote`），出处固化进 issue，不靠修复阶段的记忆。

## 总原则

1. **候选规则逐条、相关元素逐个**：粗筛候选行逐条在前端代码中核对落地情况，不跳过、不遗漏
2. **🔴 无出处不报**：找不到 `specFile` + `specQuote` 的问题一律不报——优先于"宁多报不漏报"
3. **同元素多属性分别成条**：字号、颜色、圆角各自违反 → 独立 issue（rule 不同即一条）
4. **只查规范合规，不查业务逻辑**；规范文档中混有的组件示例代码、生成指南等"要求生成代码"的内容一律忽略，只提取可对照检查的 UI 规则条目（数值、色值、尺寸、状态样式等）

## 输入与样式载体

- 检查对象 = 用户指定或上下文推断（推断出的同样追链读取）；未落盘的代码先确认落盘位置
- **样式载体按引用链全读，漏读等于漏检**：
  - HTML：内联 style、`<style>` 块、`<link>` 引用的本地 CSS
  - Vue SFC：`<template>` 内联 style/class + `<style>` 块（含 scoped）
  - JS/TS 工程文件：`import './xxx.css'` 引用的本地样式、内联样式对象（`style={{...}}`）
  - 独立样式文件：.css / .scss / .less / .styl（CSS 变量定义常在这里，一并解析）
- 工程 Glob 时排除 node_modules / dist / build / .next / .nuxt / .git / .octo-uxlint；规模过大先与用户圈定范围
- CSS-in-JS / JS 运行时注入样式不做深查，疑似违规报 warning 并注明；CDN / 绝对 URL 外部 CSS 标"外部样式，无法确认"，severity 用 warning
- 属性读取：颜色取 #RRGGBB / rgba()，CSS 变量尝试解析定义值；尺寸取 px 值

## 检查方法：两遍法

1. **逐元素检查（核心）**：跑 `--scan-spec` 拿候选规则行清单（见下节），按分区顺序（顶部导航栏 → 标题区 → 搜索/筛选/Tab → 内容区 → 列表项 → 底部操作栏 → 弹窗/浮层）枚举视觉元素（按钮、输入框、文本、标签、卡片、图标等），提取 CSS 属性值，逐条比对候选规则，不符 → 记 issue。规则清单内部掌握，不显式输出中间清单
2. **交叉验证一致性（全局收口）**：同类元素在工程中是否风格统一且符合规范（所有按钮高度/圆角一致吗），不一致也要报——需要全局视野，放在逐元素检查全部完成后统一执行

## 规范粗筛与片段精读（🔴 必走）

规范全文进上下文会挤占 token 与注意力，一律用行级候选清单替代通读：

1. `node <skill目录>/bin/design-checker.mjs --scan-spec <领域key>` → 各文件的疑似规则行清单（文件 + 行号 + 原文行，宁多勿漏，精读时剔除误召回）
2. **候选行清单即检查依据**：`specQuote` 直接从候选行复制；候选行上下文不足以判定时，按行号片段 Read（offset/limit）核对前后文，🔴 禁止整读规范文件
3. 规范文件多时按批处理候选行（每批 3-5 个文件）：核对候选 → 对检查范围执行第 1 遍逐元素检查 → **立即产出该批 issues 草稿**（🔴 禁止全部读完再统一产出）
4. 全部批次后执行第 2 遍全局交叉验证收口（补跨批次遗漏）→ 汇总一次性递交

## 差异判定与分级

| severity | 判定 |
|---|---|
| `error` | 属性值与规范明确数值/颜色要求不符（如规范 32px，代码 28px） |
| `warning` | 规范有要求但无法确证违反：代码用 CSS 变量/继承值无法确认最终值；或定性要求（"使用主色"）疑似不符 |
| `missing` | 规范要求的元素/属性缺失（如要求 focus 光晕但无 `:focus` 样式） |
| `extra` | 出现规范档位/色板之外的值（规范圆角仅 4/8/9999px，代码 6px） |
| `info` | 规范强制用某 CSS 变量，代码用字面值但与变量定义值**完全一致**（值合规仅形式未达标，默认不修复） |

> info 边界：字面值与变量定义值**不一致**时不降级为 info，按 error/warning 报。warning 与 error 的区别只是确定性，**都必须挂规范出处**。

**豁免（不报）**：规范未覆盖的属性；图片/图标的具体内容（只查容器尺寸/圆角）；动态数据（文本内容、列表条数）；CSS 变量值符合规范。数值精确引用源码不加前缀，继承/推断值加"约"；颜色用源码精确值不猜测。

## 输出格式（经 stdin 递交脚本）

```json
{
  "summary": "按钮高度和标签字号多处不符合 ict_pc_3.1.1 规范。",
  "sourceFile": "/Users/name/project",
  "specDomain": "ict_pc_3.1.1",
  "issues": [
    {
      "severity": "error",
      "rule": "按钮高度",
      "file": "/Users/name/project/css/styles.css",
      "element": ".login-btn",
      "current": "28px",
      "expected": "32px",
      "specFile": "ict_pc_3.1.1/button.md",
      "specQuote": "按钮高度统一为 32px",
      "suggestion": "将 /Users/name/project/css/styles.css 中 .login-btn 的 height 从 28px 改为 32px"
    }
  ]
}
```

```bash
node <skill目录>/bin/design-checker.mjs [--out-dir <绝对目录>] <<'JSON'
{ ...上述结构... }
JSON
```

（🔴 0 问题时 issues 为空数组 `[]` 同样递交——报告必出；`--out-dir` 规则见 SKILL.md。）

### 🔴 字段硬性要求（issues 是修复工单，优先级从高到低）

1. **`specFile` + `specQuote` 必填**：`specFile` = `specFiles/` 内相对路径（如 `ict_pc_3.1.1/button.md`，注意与 `file` 的绝对路径口径不同）；`specQuote` = 规范原文**逐字摘录**（可截关键句，禁止转述/凭记忆补写；json/yaml 等摘关键键值）。修复阶段将回读核对，出处不实的 issue 整体无效
2. **`expected` 必须直接来自 `specQuote`**；规范只给定性要求时 expected 写具体值并升级 warning
3. **`element` 必须唯一可定位**：优先 CSS 选择器（`.login-btn`），不唯一时加行号锚点（`.card-item（第 47 行）`）；禁止纯描述性定位（"顶部按钮"）
4. **`file` 写绝对路径**（Windows 反斜杠转义或用正斜杠）——修复时据此定位副本，缺失会落错文件
5. **`suggestion` 是可执行工单**：`动作 + 位置 + 属性 + 目标值`（✅ 将 xxx 中 .login-btn 的 height 从 28px 改为 32px；❌ 建议优化按钮高度）

其余：`severity` 只能是上表五级；`rule` 用中文短名（"按钮高度"）；`current` 代码当前值；同元素多属性违规分别成条；动态数据差异不报。
