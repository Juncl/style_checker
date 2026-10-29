---
name: ui-pixel-diff
description: UI图图对比能力。支持对比两张截图（设计稿与开发实现），输出差异清单报告（Markdown 或 Markdown+HTML）。当用户提到图图对比、视觉检查、对比图片等场景时加载本 skill。
---

## 🔴 硬性规则：禁止修改 skill 源码

**skill 的所有文件（`bin/`、`src/`、`lib/`、`SKILL.md`、`package.json` 等）均为只读。** tool 失败时绝不修改源码，只能重新调用、调整参数或向用户求助。

---

## 命令调用方式

入口位于 skill 目录下 `bin/ui-pixel-diff.js`。

1. 已注册到 PATH：`ui-pixel-diff <command> [options]`
2. 未注册：`node <skill目录>/bin/ui-pixel-diff.js <command> [options]`

首次使用前如依赖未安装，需在 skill 目录执行 `npm install --omit=dev`。

通用参数 `--cwd <项目目录>` 可选，默认当前工作目录，无需向用户询问。

---

## 主线流程

### 用户未提供截图时的引导

用户没传截图也没给文件路径时，**不要执行任何命令**，提示用户提供以下任一形式：

- **方式一**：对话中上传两张截图（设计稿 + 开发实现，png/jpg）
- **方式二**：提供两张图片的本地文件路径

无论哪种方式，用户都需指明哪张是设计稿、哪张是开发实现。确认后进入三步操作：

- 对话上传截图 → **上下文模式**（只生成 MD）
- 提供文件路径 → **文件路径模式**（生成 MD + HTML）

### 三步操作

**步骤 0：确认图片角色（必须最先做）**

用户已明确指出哪张是设计稿、哪张是开发实现 → 进入步骤 1。否则**必须问清楚，禁止猜测**。用户提供文件路径时记录路径，步骤 2 使用。

**步骤 1：取 prompt**

```bash
ui-pixel-diff ai-img-check [--cwd <目录>] --mode prompt
```

stdout 输出 system prompt 全文，agent 当作 system prompt 使用。

**步骤 2：看图 → 输出差异 JSON → 生成报告**

agent 看图 + prompt → 输出简短总结 + 差异 JSON → 写入文件（如 diff.json）→ 调 build：

- **上下文模式**：`--mode build --diff-file <diff.json>` → 生成 `.md`
- **文件路径模式**：`--mode build --diff-file <diff.json> --design-image <设计稿路径> --dev-image <开发实现路径>` → 生成 `.md` + `.html`

### 流程图

```
用户意图：图图对比 / 视觉检查 / 对比图片
  │
  ├── 对话中传入两张截图（上下文模式）
  │   ├── 0: 确认图片角色（未明确→必须问，禁止猜测）
  │   ├── 1: ai-img-check --mode prompt
  │   ├── 2: 看图 + prompt → 差异 JSON → 写 diff.json
  │   ├── ai-img-check --mode build --diff-file diff.json
  │   │   → ✓ 报告已生成: <path>.md
  │   └── 告诉用户打开 md 报告
  │
  └── 提供两张图片本地路径（文件路径模式）
      ├── 0: 确认图片角色 + 记录路径
      ├── 1: ai-img-check --mode prompt
      ├── 2: 看图 + prompt → 差异 JSON → 写 diff.json
      ├── ai-img-check --mode build --diff-file diff.json --design-image <设计稿> --dev-image <开发>
      │   → ✓ Markdown 报告已生成: <path>.md
      │     ✓ HTML 报告已生成: <path>.html
      └── 告诉用户打开 html 查看截图对比，md 供后续修改代码查阅
```

---

## 报告格式

### 上下文模式 → Markdown 报告

- 按开发侧节点分组，表格列：属性 | 描述 | 设计值 | 开发值 | 修改建议（与 devlint-mcp MD 格式一致）
- 落盘到 `.devlint/ai_img_check_<时间戳>.md`
- 纯本地生成，不占 VLM 额度

### 文件路径模式 → Markdown + HTML 报告

- **MD 报告**：同上下文模式格式
- **HTML 报告**：含截图对比 + 画布节点高亮 + 跨侧联动 + 差异清单 + 分组筛选
- HTML 生成失败不中断，MD 报告仍可用
- 也可只传一张图，报告只展示传入的那张
- 落盘到 `.devlint/ai_img_check_<时间戳>.md` 和 `.html`

### diff JSON 字段

AI 输出的 diffs 数组字段（英文键名）：

| 字段 | 说明 |
|---|---|
| `severity` | `error` / `warning` / `maybe_high` / `maybe_low` / `missing` / `extra` |
| `textContent` | 文本节点填文字内容，非文本节点填描述性名称 |
| `arkuiName` | 开发侧组件类型（Text/Button/Image/Column 等），无法判断时填空字符串 |
| `property` | 英文键名：`fontSize` / `fontWeight` / `fontColor` / `backgroundColor` / `borderRadius` / `borderColor` / `borderWidth` / `opacity` / `backdropBlur` / `shadow` / `padding` / `itemSpacing` / `size` / `position` / `missing` / `extra` / `other` |
| `designValue` | 设计稿的值 |
| `arkuiValue` | 开发侧的值 |
| `confidence` | `high` / `medium` / `low` |
| `designRect` | 归一化坐标 `{x,y,w,h}`（图片宽高=1），匹配对/缺失必填，多余为 `null` |
| `arkuiRect` | 归一化坐标 `{x,y,w,h}`，匹配对/多余必填，缺失为 `null` |

skill 内部自动从 `designRect`/`arkuiRect` 去重构建节点列表和匹配对映射，使 HTML 报告的画布节点高亮、跨侧联动、序号徽标等功能可用。

### stdout 输出

- 上下文模式：`✓ 报告已生成: <path>` + `还原度: <等级>（<分数> / 100），共 <N> 处差异`
- 文件路径模式：`✓ Markdown 报告已生成: <path>` + `✓ HTML 报告已生成: <path>` + 还原度摘要

---

## 结果呈现规则

1. 展示**整体还原度**：等级 + 评分 + 差异总数
2. 告诉用户**打开报告**：上下文模式给 md 路径；文件路径模式推荐 html（截图对比），md 供后续查阅
3. 简要口述前几条重点差异
4. 无差异时说 **"视觉检查未发现明显还原差异，还原度良好"**

---

## 🔴 tool 失败处理

1. **失败即止步**：非零退出码 / stderr 有 `✗` 时停止流程，不假装成功
2. **重试上限 2 次**（含首次共 3 次），超过后向用户报告
3. **禁止改源码**、禁止静默吞错、禁止用空数据继续

| 失败场景 | 处理 |
|---|---|
| prompt 取回失败 / diff JSON 解析失败 | 确认 JSON 格式正确，重试一次 |
| HTML 报告生成失败 | 重试一次 |

---

## 决策检查清单

- [ ] 用户已明确指出哪张是设计稿、哪张是开发实现？未明确→必须问，禁止猜测
- [ ] 用户提供了图片文件路径？有路径 → build 时传 `--design-image` / `--dev-image` 生成 MD+HTML；无路径 → 只生成 MD
