# 设计规范修复守则

> 修复阶段在检查之后执行，输入是 issues JSON（检查产物）+ 入口 HTML。
> 被修复的可能是独立 HTML，也可能是引用本地 CSS/JS 的前端包。
> **修复的唯一依据是 issue 携带的规范原文（`specFile` + `specQuote`），不是检查阶段的记忆、也不是常识**——每条修复的结果必须让 HTML 满足 `specQuote` 原文。
> 修复全程在**副本**上进行，原文件（含 css/js/图片等全部资源）是只读参照。

---

## 🔴 副本红线（不可协商）

1. **修复前必须先创建副本**：每个被修改的文件都生成副本，命名 `<主名>.fixed.<扩展名>`（page.html → page.fixed.html，styles.css → styles.fixed.css），副本与原文件**同文件夹**
2. **所有修改只落在副本上**，原文件（含引用的 css/js/图片等）绝不修改、绝不重命名、绝不删除
3. **副本与原文件同文件夹**是刻意设计：CSS 中的相对资源引用（`../img/`、`font/` 等）在副本中依然有效，图片/字体等资源**不需要也不允许**复制
4. 副本不落盘到 `.octo-uxlint/design-check/`（该目录只存 issues/fix-result JSON 和报告）
5. 副本已存在时，告知用户后将重新生成（覆盖前可提示）
6. 向用户汇报时，明确列出**全部副本文件**路径

## 前端包（多文件）副本规则

按 issues[].file 汇总受影响文件，生成**副本集**：

| 修复落点 | 副本动作 |
|---|---|
| HTML 自身（内联 style / `<style>` 块） | cp html → `.fixed.html`，在副本上 Edit |
| 本地引用的 CSS 文件 | cp 该 css → `.fixed.css`，在副本上 Edit；**同时入口 HTML 必须生成副本并重写对应 `<link>` href 指向 `.fixed.css`**（即使 HTML 自身无修复项，否则副本入口加载的还是原 css） |
| 未被修改的本地 CSS | 不生成副本，HTML 副本中对应引用保持原样 |
| CDN / 绝对 URL 的 CSS | 无法生成副本，相关 issue 标 `failed`，note 注明"外部样式，无法修改" |
| JS 动态注入的样式 | 不修改 JS，相关 issue 标 `failed`，note 注明"JS 注入样式，需人工处理" |

要点：**HTML 副本是修复后的唯一入口**——所有被修改的 css 引用都在 HTML 副本中重写，用户打开 `<原名>.fixed.html` 即可看到全部修复效果。

## 修复流程

**第 1 步：分析受影响文件，生成副本集**

```
1. 汇总 issues[].file → 受影响文件集合（入口 HTML + 被引用的本地 css）
2. 逐个 cp 生成 .fixed 副本（与原文件同文件夹）
3. 若存在 css 副本 → 确保入口 HTML 副本已生成，并重写其中受影响的 <link> href
```

**第 2 步：按工单逐条修复（severity 排序：error → warning → missing → extra）**

每条 issue 按 `file` 找到**对应文件的副本**，以 `specQuote` 为修复依据执行编辑：

| issue 类型 | 修复动作 |
|---|---|
| error / warning（改值） | 在 `file` 对应副本中 Edit 内联 style / `<style>` 块 / css 规则，改为 `expected` 值（expected 必须能从 specQuote 直接得出） |
| missing（缺失） | 按工单在指定位置追加 CSS 规则，规则内容以 `specQuote` 原文为准 |
| extra（规范外值） | 目标值**必须从 `specFile` 规范原文中列举的档位/色板里选**（如规范规定圆角 4px/8px/9999px，从中选；禁止凭常识或"感觉更接近"补一个规范里没有的值），选择时回 Read specFile 核对 |

🔴 **修复依据核实（每条必做）**：动手前用 `specFile` 回读规范文件，核对 `specQuote` 与原文一致、且 `expected` 确实由此得出。发现出处不实（quote 与原文不符 / expected 无法从 quote 得出）→ 该条标 `failed`，note 注明"规范出处不实"，**不要自行猜测目标值**。

修复规则：
- **一次编辑只修一条 issue**，不顺手改其他内容（保证 fix-result 可追溯）
- 行号锚点仅用于**初次定位**；Edit 以内容匹配为准（多次编辑会使后续行号漂移）
- `element` 定位到多个节点时，逐个确认是否都是该 issue 的目标；仅修与 issue 相关的
- `suggestion` 与 specQuote 冲突时，**以 specQuote 为准**，并在 action 中注明偏差
- 用户指定"只修 error"等范围时，范围外的 issue 标 `skipped`

**第 3 步：快速复查（默认执行）**

只验证**已修复条目**，不做全量重查，**判定标准是 `specQuote` 规范原文**：
- 按 `fixes[].file` 定位到对应副本，Read 每个修复点位置，确认新值存在且**满足 specQuote 原文**（不是"改过了就算通过"）
- expected 为定性要求的 warning 条目（如"使用主色"），复查只能确认值已按工单修改，最终合规留给人工确认
- 多处相同问题批量修复时，抽查代表性位置即可（如 5 处同款按钮修 5 处，抽查 2 处）
- 复查结果记入每条 fix 的 `recheck` 字段

**第 4 步：写 fix-result JSON → 落盘 `.octo-uxlint/design-check/fix-result-<时间戳>.json`**

```json
{
  "sourceFile": "path/to/page.html",
  "fixedFiles": ["path/to/page.fixed.html", "path/to/css/styles.fixed.css"],
  "fixes": [
    {
      "severity": "error",
      "rule": "按钮高度",
      "file": "css/styles.fixed.css",
      "element": ".login-btn",
      "current": "28px",
      "expected": "32px",
      "specFile": "ict_pc_3.1.1/button.md",
      "specQuote": "按钮高度统一为 32px",
      "action": "将 styles.fixed.css 中 .login-btn 的 height 从 28px 改为 32px",
      "status": "fixed",
      "recheck": "passed",
      "note": ""
    }
  ]
}
```

字段说明：
- `fixedFiles`：全部副本文件路径数组（含被重写引用的 HTML 副本）
- `fixes[].file`：该条修复实际落在哪个副本上
- `fixes[].specFile` + `specQuote`：修复依据（从 issue 原样携带，人工审核时按此回溯规范原文）
- `status`：`fixed`（已修复）/ `skipped`（用户范围外跳过）/ `failed`（无法执行）
- `recheck`：`passed` / `failed` / `null`（仅 `status=fixed` 的条目参与复查）
- `note`：`skipped` / `failed` / 复查未通过时的原因说明，其余为空字符串
- `action`：实际执行的编辑动作（可与 suggestion 一致，有出入时以实际为准）

**第 5 步：生成修复报告 → 汇报**

```bash
node <skill目录>/build-report.mjs --fix .octo-uxlint/design-check/fix-result-<时间戳>.json
```

向用户汇报：
- 全部副本文件清单（与原稿同文件夹，明确提示原文件未动）
- 修复 N / 复查通过 N / 复查未通过 M / 跳过 S / 失败 F
- 复查未通过或 failed 的条目，逐条说明原因，询问用户是否继续处理
