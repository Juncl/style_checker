---
name: ArkUI版本对比
description: 鸿蒙 ArkUI 版本间 UI 对比能力。采集或读取同一页面两个版本（如 26.8 与 26.9 版本）的 ArkUI Inspector 数据，对比输出节点匹配、样式差异清单（JSON）和可视化 HTML 报告。当用户提到版本对比、版本间差异、升级前后对比、ArkUI 版本 diff 等场景时加载本 skill。
---

## 🔴 硬性规则：禁止修改 skill 源码

**skill 的所有文件（`bin/`、`lib/`、`src/`、`SKILL.md`、`package.json` 等）均为只读，绝对不允许修改。**

- ❌ 禁止：tool 失败时尝试"修复"skill 源码
- ❌ 禁止：新增/删除/重命名 skill 目录下的文件
- ❌ 禁止：编辑 `SKILL.md` 内容
- ❌ 禁止：修改 `package.json` 依赖或版本号

**tool 失败时的正确处理**：读取 stderr 错误信息，向用户说明原因并提供恢复选项；如确认是 skill 本身的 bug，告知用户联系维护者，不要自己动手改源码。

---

## 能力总览

本 skill 通过 `arkui-version-diff` 命令行工具提供 2 个能力，使用 bash 工具调用：

| 命令 | 用途 | 输出 |
|------|------|------|
| `collect-arkui` | 采集一版 ArkUI 数据（仅 Windows），`--label base\|target` 区分新旧版本 | baseJsonPath/baseImagePath 或 targetJsonPath/targetImagePath |
| `version-diff` | 对比两个版本的 ArkUI 数据，输出差异清单 | 摘要 JSON（stdout）+ 完整结果 JSON 文件 + 可视化 HTML 报告文件 |

---

## 命令调用方式

1. 如果 `arkui-version-diff` 已注册到 PATH：
   ```bash
   arkui-version-diff <command> [options]
   ```
2. 如果 `command not found`，使用 node 直接执行 skill 目录下的入口：
   ```bash
   node <skill目录>/bin/arkui-version-diff.js <command> [options]
   ```

---

## 主线：ArkUI 版本对比

需要**两个版本**的数据，缺一不可：

**① 旧版本（base）**：本地 arkui JSON 文件路径（附截图 png 更佳）；或在 Windows 上连接鸿蒙设备采集
**② 新版本（target）**：同上
**③ 两份数据需来自相同设备与分辨率的同一个页面**（画布不一致会对比失败）

```
用户意图：版本对比 / 版本间差异 / 升级前后对比
  │
  ├── base（旧版本）数据来源
  │   ├── 本地 .json 文件 → 直接作为 --base-json（附 --base-image）
  │   └── Windows + 鸿蒙设备 → collect-arkui --label base
  │
  ├── target（新版本）数据来源
  │   ├── 本地 .json 文件 → 直接作为 --target-json（附 --target-image）
  │   └── Windows + 鸿蒙设备 → collect-arkui --label target
  │       （⚠️ 采集 target 前提醒用户：设备需已切换/升级到新版本页面）
  │
  └── 两版就绪 → 执行 version-diff（自动串联，无需用户再次确认）
```

**两侧数据相互独立**：一侧中断不阻塞另一侧，中断后向用户提供恢复选项（重新采集 / 手动提供文件路径）。

### 🔵 用户未提供任何数据时的引导

当用户只说"帮我做版本对比"但**没有提供任何数据**时，**不要直接执行任何命令**，先向用户列出上述 ①②③ 清单，等两个数据都就绪后再执行。**如果用户只提供了一个版本，继续追问缺失的那个。**

---

## 命令详细参数

> **通用参数**：所有命令都支持 `--cwd <项目目录>`（可选），指定结果文件的保存位置，默认当前工作目录，**无需向用户询问**。

### collect-arkui

```bash
arkui-version-diff collect-arkui [--cwd <项目目录>] --label base|target [--timeout 60000]
```

- `--label`: 采集的是哪一版（**必填**）：`base`（旧版本）/ `target`（新版本）
- `--timeout`: 采集超时时间（ms），默认 60000
- 仅 Windows 可用
- 输出：`{ "label": "base", "baseJsonPath": "...", "baseImagePath": "..." }`

### version-diff

```bash
arkui-version-diff version-diff [--cwd <项目目录>] \
  --base-json <path> \
  --target-json <path> \
  [--base-image <path>] \
  [--target-image <path>]
```

- `--base-json` / `--target-json`: 两版本 arkui JSON / dump 文件路径（必填）
- `--base-image` / `--target-image`: 两版本截图路径（可选，推荐）
- 输出（stdout JSON）：
  ```json
  {
    "base": "<旧版本文件名>",
    "target": "<新版本文件名>",
    "stats": { "matchedPairs": 48, "errorCount": 1, "warningCount": 0, "score": 96 },
    "diffPreview": [ { "severity": "error", "property": "fontSize", "baseValue": "16", "targetValue": "20" } ],
    "resultPath": "<完整结果JSON路径>",
    "htmlReportPath": "<可视化HTML报告路径>"
  }
  ```
- `diffPreview` 最多 10 条，完整清单见 `resultPath`
- 工具内部读取文件，**文件内容不占用 AI 上下文**

---

## 采集 → 对比串联规则

| 采集命令返回字段 | version-diff 参数 |
|---|---|
| `baseJsonPath` | `--base-json` |
| `baseImagePath` | `--base-image` |
| `targetJsonPath` | `--target-json` |
| `targetImagePath` | `--target-image` |

---

## 🔴 硬性规则：tool 失败处理策略

1. **失败即止步**：tool 返回错误（非零退出码 / stderr 有 `✗`）时，立即停止当前流程，不要假装成功继续往下走
2. **重试上限 2 次**：同一 tool 同一参数最多重试 2 次，超过后停止并向用户报告
3. **禁止改源码 / 禁止静默吞错**：绝不修改 skill 源码，不忽略 stderr 错误
4. **向用户求助**：重试耗尽或无法自动恢复时，停下来让用户决定下一步

| 失败场景 | 处理方式 |
|---|---|
| `collect-arkui` 非 Windows | 向用户提供：① Windows 环境重试 ② 手动提供 arkui.json / arkui.png 路径跳过采集（报错文案中的 `ui_style_check` 为同源引擎历史措辞，实际对应 `version-diff`） |
| `collect-arkui` 采集程序缺失/超时 | 向用户提供：① 重新采集 ② 手动提供文件路径跳过采集 |
| `version-diff` 服务不可达 | 向用户确认检查服务是否已启动，重试一次 |
| `version-diff` 文件不存在 | 向用户确认路径是否正确 |
| 画布不一致 | 告知用户两版本需用相同设备与分辨率导出，请用户重新导出 |

---

## version-diff 结果呈现规则

1. 先简述**版本对比统计**：匹配节点对数、差异 error/warning 数、版本一致度评分（score，0-100）
2. 若存在**未匹配节点**（unmatchedBase / unmatchedTarget），单独提示：旧版本中消失的节点、新版本中新增的节点
3. 每条差异以**修改说明**格式输出：「属性」旧版本（base）为 X，新版本（target）为 Y；标注节点名称或文本内容帮助定位
4. **不要展示**节点 ID、原始 path 数组等内部技术信息
5. 没有差异时直接说 **"两个版本 UI 一致，无样式变化"**
6. 完整差异清单见 **resultPath** 指向的 JSON 文件
7. 可视化报告见 **htmlReportPath** 指向的 HTML 文件，浏览器打开可查看交互式差异列表（筛选/折叠/精准-模糊切换）；报告中"设计侧"即 base（旧版本）、"开发侧"即 target（新版本）

---

## 环境要求

- Node.js ≥ 18（无第三方依赖）
- `collect-arkui` 仅 **Windows** 可用（依赖 ArkUI Inspector 导出工具）
- `version-diff` 需检查服务已启动

---

## 决策检查清单

- [ ] base（旧版本）数据来源是什么？（本地文件 / Windows 设备采集）
- [ ] target（新版本）数据来源是什么？（本地文件 / Windows 设备采集）
- [ ] 两版数据是否都已就绪？（未就绪先采集，采集完自动串联）
- [ ] 采集 target 前设备是否已切换到新版本页面？
