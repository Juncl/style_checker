---
name: aiCheck-skill
description: 视觉检查能力。支持对比两张截图（设计稿与开发实现），输出差异清单和带标注的 HTML 对比图。当用户提到图图对比、视觉检查、对比图片等场景时加载本 skill。
---

## 🔴 硬性规则：禁止修改 skill 源码

**skill 的所有文件（`bin/`、`src/`、`lib/`、`SKILL.md`、`install.js`、`package.json` 等）均为只读，绝对不允许修改。**

- ❌ 禁止：tool 失败时尝试"修复"skill 源码（改 `bin/aiCheck-skill.js`、改 `src/lib/` 或 `lib/` 下任何文件）
- ❌ 禁止：新增/删除/重命名 skill 目录下的文件
- ❌ 禁止：编辑 `SKILL.md` 内容
- ❌ 禁止：修改 `package.json` 依赖或版本号

**tool 失败时的正确处理**：
1. 读取 stderr 错误信息，分析失败原因
2. 向用户说明原因并提供恢复选项
3. 如确认是 skill 本身的 bug，告知用户联系维护者，**不要自己动手改源码**

> ⚠️ 之前出现过 tool 失败后 agent 陷入死循环、擅自修改 skill 源码导致环境损坏的事故。任何失败都只能通过重新调用、调整参数或向用户求助来解决，绝不修改源码。

---

## 能力总览

本 skill 通过 `aiCheck-skill` 命令行工具提供 1 个能力，使用 bash 工具调用：

| 命令 | 用途 | 输出 |
|------|------|------|
| `ai-img-check` | 视觉检查，取 prompt → 看对话图 → 输出差异 JSON → 生成 HTML 标注图 | htmlPath + totalDiffs + overallLevel + score |

---

## 命令调用方式

本 skill 的可执行入口位于 skill 目录下的 `bin/aiCheck-skill.js`。

**调用方式**（按优先级尝试）：

1. 如果 `aiCheck-skill` 已注册到 PATH：
   ```bash
   aiCheck-skill <command> [options]
   ```

2. 如果 `command not found`，使用 node 直接执行 skill 目录下的入口：
   ```bash
   node <skill目录>/bin/aiCheck-skill.js <command> [options]
   ```

**首次使用前**，如果依赖未安装，需先在 skill 目录执行 `npm install --omit=dev`。

---

## 主线：视觉检查

用户已把**设计稿截图**和**开发侧截图**两张图片传入对话，agent 直接看图做视觉比对。无需采集节点树 JSON。

三步操作：

0. **确认图片角色（必须最先做）**：检查用户在对话中是否已明确指出哪张是设计稿、哪张是开发实现。
   - 用户已明确指出（如"第一张是设计稿，第二张是开发"）→ 直接进入步骤 1
   - 用户**没有明确指出** → **必须问清楚**："请确认哪张是设计稿、哪张是开发实现？"，拿到明确答复后才能继续。**禁止猜测图片角色**
1. `ai-img-check --mode prompt` → 取回 system prompt
2. 看对话中的两张截图 + prompt → 输出简短总结 + 差异 JSON（含归一化坐标）→ 把 JSON 写入文件 → 调 `ai-img-check --mode build --diff-file <json>` 生成 HTML 模板 → **把图片填入模板的占位符位置** → 生成最终带图标注视图 HTML → 告诉用户用浏览器打开

```
用户意图：图图对比 / 视觉检查 / 对比图片
  │
  └── 用户已在对话中传入两张截图
      ├── 步骤 0: 用户是否已明确指出哪张是设计稿、哪张是开发实现？
      │   ├── 是 → 直接进入步骤 1
      │   └── 否 → 必须问清楚，拿到明确答复后才能继续（禁止猜测）
      ├── 步骤 1: ai-img-check --mode prompt                              取 prompt
      ├── 步骤 2: 看对话中的两张图 + prompt → 输出简短总结 + 差异 JSON → 写入文件（如 diff.json）
      ├── ai-img-check --mode build --diff-file diff.json
      │   → 返回 { templatePath, designPlaceholder, devPlaceholder, ... }
      └── 读模板 → 把图片填入 designPlaceholder / devPlaceholder 位置 → 保存最终 HTML → 告诉用户浏览器打开
```

全程不调 server `/img/checker`，不占 server VLM 额度。

---

## 命令详细参数

> **通用参数**：所有命令都支持 `--cwd <项目目录>`（可选），用于指定报告的保存位置。**默认使用当前工作目录，无需向用户询问**。仅在用户明确要求保存到其他目录时才需要传入。

### ai-img-check

三步操作：确认图片角色 → 取 prompt → 看图输出差异 JSON → 生成 HTML 模板。

#### 第 0 步：确认图片角色

- 检查用户在对话中是否已明确指出哪张是设计稿、哪张是开发实现
- 用户已明确指出 → 直接进入第 1 步
- 用户**没有明确指出** → **必须问清楚**："请确认哪张是设计稿、哪张是开发实现？"，拿到明确答复后才能继续。**禁止猜测图片角色**

#### 第 1 步：取 prompt（`--mode prompt`）

```bash
aiCheck-skill ai-img-check [--cwd <项目目录>] --mode prompt
```

- 前提：用户已确认图片角色（第 0 步完成）
- 返回 system prompt（针对对话场景优化，不依赖 server 运行）
- 图片已在对话上下文中，agent 直接看图，无需额外传参
- 输出：`{ mode:"prompt", prompt, hint }`
- **下一步**：看对话中的两张截图 + prompt，输出简短总结 + 差异 JSON（含归一化坐标），把 JSON 写入文件后调第 2 步

#### 第 2 步：生成 HTML 模板（`--mode build`）

```bash
aiCheck-skill ai-img-check [--cwd <项目目录>] --mode build --diff-file <diff.json>
```

- `--diff-file`：agent 输出的差异 JSON 文件（纯 JSON 或含 json 代码块的 Markdown 均可）
- 生成 HTML 模板文件，图片位置为占位符（`__DESIGN_IMAGE_BASE64__` / `__DEV_IMAGE_BASE64__`），红框/黄框/蓝框已叠在图片位置上 + 差异清单表格已填充
- **agent 需要把图片填入占位符位置**，生成最终带图标注视图 HTML
- 输出：`{ templatePath, totalDiffs, overallLevel, score, designPlaceholder, devPlaceholder }`
  - `templatePath`：HTML 模板文件路径
  - `designPlaceholder`：设计稿图片占位符（`__DESIGN_IMAGE_BASE64__`）
  - `devPlaceholder`：开发实现图片占位符（`__DEV_IMAGE_BASE64__`）
  - `totalDiffs`：差异总数
  - `overallLevel`：还原度等级（"高"/"中"/"低"）
  - `score`：还原度评分（0-100）

---

## 🔴 硬性规则：tool 失败处理策略

**任何 tool 调用失败时，必须遵守以下原则，禁止自行修复或绕过：**

### 总原则

1. **失败即止步**：tool 返回错误（非零退出码 / stderr 有 `✗` / `isError: true`）时，**立即停止当前串联流程**，不要假装成功继续往下走
2. **重试上限 2 次**：同一 tool 同一参数最多重试 2 次（含首次共 3 次调用）。超过后**停止重试**，向用户报告失败
3. **禁止改源码**：失败原因不在 skill 源码，**绝不修改 `bin/`、`src/`、`lib/` 下任何文件**（参见顶部硬性规则）
4. **禁止静默吞错**：不要忽略 stderr 错误信息继续执行，必须将错误原因如实告知用户
5. **向用户求助**：重试耗尽或无法自动恢复时，**停下来让用户决定下一步**，不要自行猜测原因反复尝试

### 各 tool 失败处理

| tool | 失败场景 | 处理方式 |
|---|---|---|
| `ai-img-check` | prompt 取回失败 / build 时 diff JSON 解析失败 / 图片读取失败 | 向用户提供：① 确认 diff JSON 格式正确 ② 确认图片可正常读取 ③ 重试一次 |

### 严格禁止的失败处理方式

- ❌ 失败后修改 skill 源码（改 `bin/aiCheck-skill.js`、改 `src/lib/` 或 `lib/` 下文件）
- ❌ 失败后修改 `SKILL.md` 或 `package.json`
- ❌ 失败后跳过该 tool，用空数据或假数据继续往下走
- ❌ 失败后无限重试（同一参数调用超过 3 次）
- ❌ 失败后不告知用户，自行更换参数反复尝试
- ❌ 忽略 stderr 错误信息，假装成功

---

## ai-img-check 结果呈现规则

拿到 build 结果后，按以下格式展示给用户：

1. 展示**整体还原度**：等级（高/中/低）+ 评分（0-100）+ diff 总数
2. 读 templatePath 模板文件，把图片填入 designPlaceholder / devPlaceholder 占位符位置，保存为最终带图标注视图 HTML
3. 告诉用户**用浏览器打开最终 HTML** 查看带红框标注的对比图
4. 简要口述前几条重点差异（从 agent 自己输出的简短总结中提取，不要复述全部）
5. 如果没有差异（totalDiffs=0），直接说 **"视觉检查未发现明显还原差异，还原度良好"**

---

## 决策检查清单

执行命令前逐项确认：

- [ ] 用户是否已明确指出哪张是设计稿、哪张是开发实现？没明确指出 → 必须问清楚，禁止猜测。确认后再取 prompt → 看图输出差异 JSON → build 生成 HTML 模板 → 填入图片 → 告诉用户打开。
