---
name: design-checker
description: 基于规范 Markdown 文档的 HTML 设计规范检查与修复能力。支持独立 HTML 和引用本地 CSS 的前端包，先检查是否符合设计规范并生成报告，经用户确认后在副本上逐条修复问题并复查验证。当用户提到 HTML 规范检查、规范走查、检查并修复设计规范问题等场景时加载本 skill。
---

## 🔴 硬性规则

**1. 禁止修改 skill 源码**

`SKILL.md`、`check-method.md`、`fix-guide.md`、`build-report.mjs` 均为只读，绝对不允许修改。
`specFiles/` 是规范规则库（数据目录，非源码），规范 md 的增删维护不视为修改源码。
`package.json` 仅提供版本号（供打包），除升级 `version` 字段外不得改动，不参与 skill 运行。
脚本失败时读取 stderr 分析原因，向用户说明并提供恢复选项，绝不修改源码。重试上限 2 次。

**2. 副本红线（修复阶段）**

修复前必须为每个被修改的文件生成 `.fixed` 副本（与原文件同文件夹），所有修改只落在副本上，**原文件（含引用的 css/js/图片等全部资源）绝不修改**。详见 fix-guide.md。

**3. 修复前必须询问（不可跳过）**

检查完成后必须询问用户是否需要修复，未经用户确认不得进入修复阶段。

---

## 文件清单

| 文件 | 用途 | 加载时机 |
|------|------|----------|
| `check-method.md` | 检查方法论 + issue JSON 格式 | 检查阶段开始时 Read |
| `fix-guide.md` | 修复守则（副本红线、修复流程、复查标准） | 用户确认修复后 Read |
| `build-report.mjs` | 报告生成脚本（零依赖，仅需 Node.js） | 阶段一/阶段三末尾执行 |
| `specFiles/index.md` | 规范清单（领域 → 路径映射表） | 确认规范领域时 Read |
| `specFiles/` | 规范规则库（按领域分子文件夹） | 检查阶段 Glob + Read |

---

## 主线流程：检查 → 询问 → 修复 → 复查

### 阶段一：检查

```
1. 确认规范领域（🔴 禁止跨领域混用规范）
   - 用户已指定领域（如"用 ict_pc_3.1.1 规范检查"）→ Read specFiles/index.md 对照清单，
     key 存在 → 直接采用；key 不存在 → 告知清单中的可用领域，让用户选择或先补充规范
   - 未指定 → Read specFiles/index.md 规范清单
     - 从 HTML 内容 / 文件路径推断候选领域 → 与清单核对，命中后向用户确认
     - 推断不出 → 按清单逐项列出（key + 名称 + 说明），让用户选择
2. Glob specFiles/<领域>/**/*.md（排除 README.md）
   ├── 无结果 → 告知用户该领域无规范，需放入规范 md，流程终止
   └── 有结果 → 得到规范文件路径列表
3. Read check-method.md，掌握检查方法和 issue JSON 格式
4. Read 待检查 HTML + 其引用的本地 CSS 文件 + 该领域规范 md 文件
   （规范较多时分批，每次 3-5 个；CDN/绝对 URL 的外部 CSS 不读，检查时标 warning）
5. 按 check-method.md 的三遍法检查
   → 每条 issue 携带 specFile（出处）+ specQuote（规范原文摘录）
   → 输出简短总结 + issues JSON → 写入 .octo-uxlint/design-check/issues-<时间戳>.json
6. node <skill目录>/build-report.mjs <issues.json>
7. 向用户展示：问题总数与 severity 分布（error X / warning Y / missing Z / extra W）+ 前几条重点问题
```

用户未提供 HTML 文件路径时，先向用户索要，不要执行任何命令。
用户什么都没提供（无 HTML 路径、无规范信息）时，先 Read specFiles/index.md 取实际清单，
再按以下引导词开场：

```
我可以帮你检查 HTML 是否符合设计规范并修复问题。请提供：

1. 待检查的 HTML 文件路径（必须是入口 HTML；引用本地 CSS 的前端包也支持）
2. 期望遵循的设计规范（可选）：
   - <领域 key> — <规范名称>
   - <领域 key> — <规范名称>
   未指定时我会根据 HTML 内容推断，推断不出再和你确认

提供文件路径后即可开始检查。
```

（规范列表按清单实际条目逐行展开；清单只有 1 个领域时只列 1 行，不虚构条目。）

### 阶段二：询问（🔴 硬性交互点）

```
"发现 N 处问题（error X / warning Y / missing Z / extra W），
 是否需要我在副本上修复？"
```

选项：**全部修复 / 只修 error / 自定义挑选 / 不修**。
用户拒绝或仅表达检查诉求 → 流程结束。
用户确认修复范围 → 进入阶段三。

### 阶段三：修复

```
1. Read fix-guide.md，掌握副本红线、前端包副本规则和修复依据规则
2. 按 issues[].file 汇总受影响文件 → 生成副本集（🔴 原文件只读）
   - 每个被修改的文件 cp 出 .fixed 副本（与原文件同文件夹）
   - 若有 css 被修改 → 入口 HTML 必须生成副本并重写对应 <link> href
3. 按工单逐条修复（error → warning → missing → extra 排序）
   - 🔴 每条动手前回读 issues[].specFile 核对 specQuote 原文，
     expected 必须能从 specQuote 直接得出；出处不实 → 标 failed，不猜测目标值
   - extra 的目标值必须从规范原文列举的档位/色板中选，禁止凭常识补值
   - 范围外的 issue 标 skipped，无法执行的标 failed（注明原因）
4. 快速复查：只重验已修复条目
   （按 fixes[].file 定位副本，新值满足 specQuote 原文才算 passed）
5. fix-result JSON（含 specFile/specQuote 与复查结果）
   → 写入 .octo-uxlint/design-check/fix-result-<时间戳>.json
6. node <skill目录>/build-report.mjs --fix <fix-result.json>
```

### 阶段四：汇报

1. 明确告知：原文件未动，列出全部副本文件路径（与原稿同文件夹，HTML 副本是修复后入口）
2. 修复结果：修复 N / 复查通过 N / 复查未通过 M / 失败 F / 跳过 S
3. 复查未通过或 failed 的条目逐条说明原因，**询问用户是否继续处理**
4. 告知用户打开修复报告查看完整清单

---

## build-report.mjs 用法

```bash
# 检查报告
node <skill目录>/build-report.mjs <issues.json>
# stdout: ✓ 报告已生成: <path> + 问题统计摘要

# 修复报告
node <skill目录>/build-report.mjs --fix <fix-result.json>
# stdout: ✓ 修复报告已生成: <path> + 修复结果摘要
```

- 输入 JSON 兼容纯 JSON 或 Markdown 内嵌 ```json 代码块
- 报告落盘到当前工作目录 `.octo-uxlint/design-check/` 下

---

## 规则库（specFiles/）

```
specFiles/
├── index.md              ← 规范清单（领域 → 路径映射表；仅用于选择规范，不作为规范文件）
└── ict_pc_3.1.1/         ← 领域文件夹（名称 = 清单中的领域 key）
    ├── button.md         ← 规范文件（内容格式不限，任意 Markdown）
    └── components/       ← 子文件夹（领域内层级不限，任意嵌套）
        └── input.md      ← 嵌套的规范文件，递归扫描
```

- 规范清单 `index.md`：登记全部可用领域，新增领域 = 建子文件夹 + 在清单登记一行
- 规范 md 按领域分子文件夹存放，由维护者直接增删
- **规范 md 内容格式不限**：任意 Markdown 均可，检查阶段直接 Read 并从中提取规则条目
- **领域内文件夹层级不限**：Glob `specFiles/<领域>/**/*.md` 递归扫描；`README.md` 在任意层级均跳过
- 仅两条硬约束：领域 key 必须与顶层子文件夹名一致；`specFiles/index.md` 与各层 `README.md` 不作为规范文件
- 无规范时（空目录或仅 README）告知用户需先放入规范 md
