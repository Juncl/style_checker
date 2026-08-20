---
name: design-system-checker
description: UI规范一致性检查能力。支持模糊匹配设计规范名/场景名、检查 HTML/URL 是否符合设计规范。当用户提到设计规范检查、规范走查、规范名匹配、检查是否符合 Octo 规范等场景时加载本 skill。
---

## 🔴 硬性规则：禁止修改 skill 源码

**skill 的所有文件（`bin/`、`src/`、`SKILL.md`、`install.js`、`package.json` 等）均为只读，绝对不允许修改。**

- ❌ 禁止：tool 失败时尝试"修复"skill 源码（改 `bin/design-system-checker.js`、改 `src/lib/` 下任何文件）
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

本 skill 通过 `design-system-checker` 命令行工具提供 2 个能力，使用 bash 工具调用：

| 命令 | 用途 | 输出 |
|------|------|------|
| `list-design-specs` | 模糊匹配规范名/场景名，返回规则文件路径列表 | filePaths 或候选列表 JSON |
| `design-spec-check` | 检查 HTML/URL 是否符合设计规范（需先调 list-design-specs） | 问题清单 JSON |

---

## 命令调用方式

本 skill 的可执行入口位于 skill 目录下的 `bin/design-system-checker.js`。

**调用方式**（按优先级尝试）：

1. 如果 `design-system-checker` 已注册到 PATH：
   ```bash
   design-system-checker <command> [options]
   ```

2. 如果 `command not found`，使用 node 直接执行 skill 目录下的入口：
   ```bash
   node <skill目录>/bin/design-system-checker.js <command> [options]
   ```

**首次使用前**，如果依赖未安装，需先在 skill 目录执行 `npm install --omit=dev`。

---

## 主线：设计规范检查

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

**source 来源判断规则：**
- `http://` 或 `https://` 开头 → URL，直接传给 `design-spec-check --source`
- `.html` 结尾或本地路径 → 本地 HTML 文件，直接传给 `design-spec-check --source`

---

## 命令详细参数

> **通用参数**：所有命令都支持 `--cwd <项目目录>`（可选），用于指定采集结果和报告的保存位置。**默认使用当前工作目录，无需向用户询问**。仅在用户明确要求保存到其他目录时才需要传入。

### list-design-specs

```bash
design-system-checker list-design-specs [--cwd <项目目录>] [--standard-name <规范名>] [--scene-name <场景名>]
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
design-system-checker design-spec-check [--cwd <项目目录>] --source <HTML路径或URL> --spec-file-paths <path1,path2,...>
```

- `--source`: 本地 HTML 文件路径 或 Web 页面 URL（必填）
- `--spec-file-paths`: 规则文件路径数组（必填），来自 `list-design-specs` 返回的 `filePaths`。CLI 传参方式：
  - 逗号分隔字符串：`--spec-file-paths "/a.json,/b.json,/c.json"`
  - 或 JSON 数组字符串：`--spec-file-paths '["/a.json","/b.json"]'`
- **必须先调 `list-design-specs`** 拿到 `filePaths`，再传入本命令，不要直接传规范名
- 输出：问题清单 JSON（结构由检查方法决定，外网环境为空结果占位，内网替换为真实检查实现）

---

## 规范检查串联规则（list-design-specs → design-spec-check）

`list-design-specs` 返回的 `filePaths` **直接传给** `design-spec-check`：

| list-design-specs 返回字段 | design-spec-check 参数 |
|---|---|
| `filePaths`（数组） | `--spec-file-paths`（逗号分隔或 JSON 数组字符串） |

- `matched=true` 时，拿到 `filePaths` 后应**自动执行** `design-spec-check`，不需要用户再次确认
- `matched=false` 时，必须先展示候选让用户选定，重新调用 `list-design-specs` 直到 `matched=true`，再执行 `design-spec-check`
- 不要跳过 `list-design-specs` 直接给 `design-spec-check` 传规范名，`--spec-file-paths` 只接受规则文件路径

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
| `list-design-specs` | 规则库拉取失败 / 网络错误 | 向用户报告错误，询问是否重试；不要自行假设规范名直接调 design-spec-check |
| `design-spec-check` | source 不可达 / 规则文件不存在 / 检查超时 | 向用户提供：① 确认 source 路径/URL 可访问 ② 确认 spec-file-paths 来自 list-design-specs ③ 重试一次 |

### 严格禁止的失败处理方式

- ❌ 失败后修改 skill 源码（改 `bin/design-system-checker.js`、改 `src/lib/` 下文件）
- ❌ 失败后修改 `SKILL.md` 或 `package.json`
- ❌ 失败后跳过该 tool，用空数据或假数据继续往下走
- ❌ 失败后无限重试（同一参数调用超过 3 次）
- ❌ 失败后不告知用户，自行更换参数反复尝试
- ❌ 忽略 stderr 错误信息，假装成功

---

## design-spec-check 结果呈现规则

拿到结果后，按以下格式展示给用户：

1. 按**问题分组**展示，每条问题包含：规则名、问题描述、当前位置/值、期望值
2. 如果问题较多，先展示**问题总数**，再逐条列出
3. 如果没有问题，直接说 **"页面符合设计规范，未发现问题"**
4. 完整问题清单可直接从返回的 JSON 中读取

---

## 环境要求

- `design-spec-check` 需要 **Chrome 浏览器**（自动查找，或通过 `CHROME_PATH` 环境变量指定）
- 工具内部读取文件，**文件内容不占用 AI 上下文**

---

## 决策检查清单

执行命令前逐项确认：

- [ ] 用户要进行设计规范检查吗？
- [ ] 是否先调了 list-design-specs？（不能直接给 design-spec-check 传规范名）
- [ ] list-design-specs 返回 matched=false 时，是否展示了候选让用户选定后重新匹配？
- [ ] design-spec-check 的 --source 是否可访问？（本地 HTML 路径或 URL）
- [ ] --spec-file-paths 是否来自 list-design-specs 的 filePaths？
