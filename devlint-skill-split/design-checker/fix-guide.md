# 设计规范修复守则

> 修复的唯一依据是 issue 携带的 `specFile` + `specQuote`（不是检查阶段的记忆、不是常识），每条修复的结果必须满足 `specQuote` 原文。修复全程在**副本**上进行，原文件 / 原工程只读。

## 🔴 副本红线

1. 修复前必须先创建副本（模式见下表），所有修改只落在副本上，原文件 / 原工程（含引用的全部资源）绝不修改
2. 副本已存在时先告知用户，确认后重新生成覆盖
3. 汇报时明确指出副本位置（🔴 一律绝对路径）

| 模式 | 判定条件 | 副本动作 |
|---|---|---|
| **单文件** | 检查对象是单文件，且全部修复都落在该文件自身 | cp → `<主名>.fixed.<扩展名>`，与原文件同文件夹 |
| **工程** | 其余一切情况（工程目录 / 落点 ≥ 2 个文件 / 落点在引用链的本地文件上） | 复制工程 → `<工程名>-fixed/`，与原工程同级 |

> 判定原则：**cp 单文件副本能否自生效**——修改不落在检查对象自身（如落在它引用的本地 css 上）时，单文件副本无效，一律走工程模式。

**工程模式要点**：内部文件一律不改名（引用路径天然有效）；排除 node_modules / dist / build / .next / .nuxt / .git、`.octo-uxlint/`；外部 CSS 无法复制 → 相关 issue 标 `failed`（"外部样式，无法修改"）；JS 注入样式不改注入逻辑 → 标 `failed`（"需人工处理"）。`.fixed` 副本 / `<工程名>-fixed/` 即修复后的完整工程入口。

## 修复流程

**1. 汇总 `issues[].file` → 按上表判定副本模式 → 生成副本**

**2. 按工单逐条修复（severity 排序：error → warning → missing → extra → info）**

每条 issue 按 `file` 找到对应副本：工程模式把路径中的工程根目录名替换为 `<工程名>-fixed`，单文件模式在文件名插入 `.fixed`。

| issue 类型 | 修复动作 |
|---|---|
| error / warning | 在副本中 Edit，改为 `expected` 值 |
| missing | 按工单在指定位置追加 CSS 规则，内容以 `specQuote` 原文为准 |
| extra | 目标值**必须从规范原文列举的档位/色板中选**，禁止凭常识补值 |
| info | 字面值 → CSS 变量写法（变量名以 `specQuote` 为准） |

- 🔴 **每条动手前 Read `<skill目录>/specFiles/<specFile>` 核对 specQuote**，出处不实（quote 与原文不符 / expected 无法得出）→ 标 `failed`（"规范出处不实"），不猜测目标值
- 🔴 **info 默认不修复**：一律标 `skipped`（"提示级：值已合规，仅变量形式未达标"），仅用户明确勾选时才修
- 一次编辑只修一条；行号锚点仅用于初次定位，Edit 以内容匹配为准；`element` 命中多个节点时逐个确认；`suggestion` 与 specQuote 冲突时以 specQuote 为准；范围外的 issue 标 `skipped`

**3. 快速复查（只验已修复条目，不做全量重查）**

按 `fixes[].file` 定位副本，Read 修复点确认新值**满足 specQuote 原文**（不是"改过就算通过"）；定性要求的 warning 只确认已按工单修改；多处同款问题抽查代表位置。结果记入 `recheck` 字段。

**4. fix-result 经 stdin 递交（🔴 AI 不写文件，存档与报告由脚本完成）**

```bash
node <skill目录>/bin/design-checker.mjs --fix --work-dir <检查工作目录> [--out-dir <绝对目录>] <<'JSON'
{
  "sourceFile": "/Users/name/project",
  "copyMode": "project",
  "fixedFiles": ["/Users/name/project-fixed/css/styles.css"],
  "fixes": [
    {
      "severity": "error", "rule": "按钮高度",
      "file": "/Users/name/project-fixed/css/styles.css", "element": ".login-btn",
      "current": "28px", "expected": "32px",
      "specFile": "ict_pc_3.1.1/button.md", "specQuote": "按钮高度统一为 32px",
      "action": "将 .login-btn 的 height 从 28px 改为 32px",
      "status": "fixed", "recheck": "passed", "note": ""
    }
  ]
}
JSON
```

字段说明：
- `copyMode`：`single` / `project`；`fixedFiles`：被修改的副本文件路径数组；`fixes[].file`：该条修复实际落在哪个副本（三者均**绝对路径**，Windows 反斜杠转义或用正斜杠）
- `specFile` + `specQuote` 从 issue 原样携带；`action` = 实际执行的动作（与 suggestion 有出入时以实际为准）
- `status`：`fixed` / `skipped`（范围外）/ `failed`（无法执行）；`recheck`：`passed` / `failed` / `null`（仅 fixed 参与）；`note`：skipped / failed / 复查未通过时的原因，其余空字符串

（汇报规则见 SKILL.md：原件未动 + 副本位置 + 修复统计 + 未通过/failed 条目说明并询问是否继续 + 报告绝对路径。）
