# 设计规范修复守则

> 修复阶段在检查之后执行，输入是 issues JSON（检查产物）+ 待修复的前端文件/工程。
> 被修复的可能是任意前端工程（原生 HTML+CSS、Vue、React 等）或单个文件。
> **修复的唯一依据是 issue 携带的规范原文（`specFile` + `specQuote`），不是检查阶段的记忆、也不是常识**——每条修复的结果必须让代码满足 `specQuote` 原文。
> 修复全程在**副本**上进行，原文件 / 原工程是只读参照。

---

## 🔴 副本红线（不可协商）

1. **修复前必须先创建副本**（模式见下节）：单文件修改 → 该文件的 `.fixed` 副本；涉及整个工程 → 整个工程目录的副本（只改文件夹名，内部文件不改名）
2. **所有修改只落在副本上**，原文件 / 原工程（含引用的 css/js/图片等全部资源）绝不修改、绝不重命名、绝不删除
3. **副本与原件同级**是刻意设计：单文件副本与原文件同文件夹（样式中的相对资源引用依然有效）；工程副本与原工程目录同级，内部文件名不变、引用路径天然有效
4. 副本不落盘到 `.octo-uxlint/design-check/`（该目录及其子文件夹只存 issues/fix-result JSON 和报告）
5. 副本已存在时，先告知用户，确认后重新生成覆盖（旧副本内容会被替换）
6. 向用户汇报时，明确指出副本位置（🔴 一律用**绝对路径**）：单文件 = 副本文件绝对路径；工程 = 副本目录绝对路径 + 副本内被修改文件的绝对路径清单

## 副本模式：单文件 vs 整工程

按检查对象与修复落点判定，两种模式二选一：

| 模式 | 判定条件 | 副本动作 |
|---|---|---|
| **单文件模式** | 检查对象是单个文件，且全部修复都落在该文件自身（内联样式、`<style>` 块、内联样式对象等） | cp 该文件 → `<主名>.fixed.<扩展名>`（page.html → page.fixed.html），与原文件**同文件夹** |
| **工程模式** | 其余一切情况：检查对象是工程目录；或修复落点 ≥ 2 个文件；或落点在检查对象引用链的本地文件上（如单文件入口引用的本地 css） | 复制整个工程目录 → `<工程名>-fixed/`（**只改文件夹名，内部所有文件保持原名**），与原工程**同级** |

> 判定原则：唯一需要单文件模式回答的问题是"**cp 这个文件的副本能否自生效**"——只要修改不落在检查对象自身（比如落在它引用的本地 css 上），cp 单个文件副本后引用方仍指向原文件、副本无效，一律走工程模式。

### 工程模式要点

- **内部文件一律不改名**：`<link>` / `import` / 相对资源引用在副本工程中天然有效，**无需重写任何引用路径**
- **复制范围**：以检查范围根为界（用户提供的工程目录；单文件跨文件场景取被修改文件的公共祖先目录，复制前向用户说明范围）
- **排除目录**：node_modules / dist / build / .next / .nuxt / .git 等依赖与构建产物目录不复制（体积大且修复不需要）；`.octo-uxlint/` 检查工作目录同样排除
- 被修改文件全部落在副本工程内（保持原文件名），在副本工程内正常 Edit
- CDN / 绝对 URL 的样式：无法复制进工程，相关 issue 标 `failed`，note 注明"外部样式，无法修改"
- JS 动态注入的样式（CSS-in-JS 等）：不修改注入逻辑，相关 issue 标 `failed`，note 注明"JS 注入样式，需人工处理"

要点：**单文件模式的 `.fixed` 副本文件即修复产物入口；工程模式的 `<工程名>-fixed/` 目录即修复后的完整工程**——用户直接打开 / 运行该目录即可看到全部修复效果。

## 修复流程

**第 1 步：分析受影响文件，确定副本模式并生成副本**

```
1. 汇总 issues[].file → 修复落点文件集合
2. 落点仅 1 个文件且即检查对象本身 → 单文件模式：cp 为 .fixed 副本（与原文件同文件夹）
3. 其余情况（检查对象是工程目录 / 落点 ≥ 2 个文件 / 落点在检查对象引用链的本地文件上）→ 工程模式：
   复制工程目录为 <工程名>-fixed/（排除构建产物等目录），内部文件不改名、引用路径不动
```

**第 2 步：按工单逐条修复（severity 排序：error → warning → missing → extra → info）**

每条 issue 按 `file` 找到**对应文件的副本**，以 `specQuote` 为修复依据执行编辑。

file → 副本映射规则（issue 的 `file` 为绝对路径，副本路径同样为绝对路径；按运行平台选对应格式）：
- **工程模式**：把 `file` 绝对路径中的工程根目录名替换为 `<工程名>-fixed`，其余不变
  （mac：`/Users/name/project/css/styles.css` → `/Users/name/project-fixed/css/styles.css`；
   Windows：`C:\Users\name\project\css\styles.css` → `C:\Users\name\project-fixed\css\styles.css`）
- **单文件模式**：`file` 文件名插入 `.fixed`
  （mac：`/Users/name/project/page.html` → `/Users/name/project/page.fixed.html`；
   Windows：`C:\Users\name\project\page.html` → `C:\Users\name\project\page.fixed.html`）

| issue 类型 | 修复动作 |
|---|---|
| error / warning（改值） | 在 `file` 对应副本中 Edit 内联样式 / `<style>` 块 / 样式文件规则，改为 `expected` 值（expected 必须能从 specQuote 直接得出） |
| missing（缺失） | 按工单在指定位置追加 CSS 规则，规则内容以 `specQuote` 原文为准 |
| extra（规范外值） | 目标值**必须从 `specFile` 规范原文中列举的档位/色板里选**（如规范规定圆角 4px/8px/9999px，从中选；禁止凭常识或"感觉更接近"补一个规范里没有的值），选择时回 Read specFile 核对 |
| info（变量形式提示） | 把字面值替换为规范要求的 CSS 变量写法（变量名以 `specQuote` 原文为准，如 `#0067D1` → `var(--octo-primary)`） |

🔴 **修复依据核实（每条必做）**：动手前用 `specFile` 回读规范文件，核对 `specQuote` 与原文一致、且 `expected` 确实由此得出。发现出处不实（quote 与原文不符 / expected 无法从 quote 得出）→ 该条标 `failed`，note 注明"规范出处不实"，**不要自行猜测目标值**。

修复规则：
- 🔴 **info（提示级）默认不修复**：info 条目一律标 `skipped`（note 注明"提示级：值已合规，仅变量形式未达标，默认不修复"），**仅当用户在修复范围中明确勾选 info 时才执行修复**——"全部修复"默认不含 info，需向用户说明后确认
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

**第 4 步：写 fix-result JSON → 落盘到本次检查的工作子文件夹 `<检查根>/.octo-uxlint/design-check/<领域key>-<时间戳>/fix-<时间戳>.json`**（时间戳格式为月日时分秒 MMddHHmmss；文件夹沿用检查时刻的时间戳，fix 文件名用修复时刻的时间戳）

```json
{
  "sourceFile": "C:\\Users\\name\\project",
  "copyMode": "project",
  "fixedFiles": ["C:\\Users\\name\\project-fixed\\css\\styles.css"],
  "fixes": [
    {
      "severity": "error",
      "rule": "按钮高度",
      "file": "C:\\Users\\name\\project-fixed\\css\\styles.css",
      "element": ".login-btn",
      "current": "28px",
      "expected": "32px",
      "specFile": "ict_pc_3.1.1/button.md",
      "specQuote": "按钮高度统一为 32px",
      "action": "将 C:\\Users\\name\\project-fixed\\css\\styles.css 中 .login-btn 的 height 从 28px 改为 32px",
      "status": "fixed",
      "recheck": "passed",
      "note": ""
    }
  ]
}
```

> 示例为 Windows 格式（反斜杠已按 JSON 规则转义）；mac 平台写 `/Users/name/project` 风格的绝对路径即可。

字段说明：
- `sourceFile`：检查对象（用户提供的文件或工程，原样未动）
- `copyMode`：本次副本模式——`single`（单文件 `.fixed` 副本）/ `project`（整工程 `-fixed/` 副本）
- `fixedFiles`：被修改的副本文件路径数组——single 模式 = `.fixed` 副本路径；project 模式 = `<工程名>-fixed/` 内被修改文件的路径（保持原文件名）
- `fixes[].file`：该条修复实际落在哪个副本文件上
- 🔴 上述三个路径字段一律写**绝对路径**（mac：`/Users/name/project/...`；Windows：`C:\Users\name\project\...`，JSON 中反斜杠转义或用正斜杠），须可直接定位（复查按此 Read，报告与汇报按此展示）
- `fixes[].specFile` + `specQuote`：修复依据（从 issue 原样携带，人工审核时按此回溯规范原文）
- `status`：`fixed`（已修复）/ `skipped`（用户范围外跳过）/ `failed`（无法执行）
- `recheck`：`passed` / `failed` / `null`（仅 `status=fixed` 的条目参与复查）
- `note`：`skipped` / `failed` / 复查未通过时的原因说明，其余为空字符串
- `action`：实际执行的编辑动作（可与 suggestion 一致，有出入时以实际为准）

**第 5 步：生成修复报告 → 汇报**

```bash
node <skill目录>/build-report.mjs --fix <检查根>/.octo-uxlint/design-check/<领域key>-<时间戳>/fix-<时间戳>.json
```

向用户汇报（🔴 所有路径一律用**绝对路径**，禁止相对路径）：
- 报告路径：修复报告 md 的绝对路径（build-report.mjs stdout 已输出全路径，原样告知）
- 副本位置：单文件模式 = `.fixed` 副本绝对路径（与原文件同文件夹）；工程模式 = `<工程名>-fixed/` 目录绝对路径（与原工程同级，即修复后的完整工程入口），并附副本内被修改文件的绝对路径清单；明确提示原文件 / 原工程未动
- 修复 N / 复查通过 N / 复查未通过 M / 跳过 S / 失败 F
- 复查未通过或 failed 的条目，逐条说明原因，询问用户是否继续处理
