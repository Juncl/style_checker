---
name: devlint-skill
description: UI 一致性检查与设计规范检查能力。支持采集鸿蒙 ArkUI 开发侧数据、采集 Web 页面 DOM 数据、采集 Pixso 设计稿数据、对比设计稿与开发实现输出差异修改清单、检查页面是否符合设计规范。当用户提到 UI 一致性检查、设计稿对比、采集开发侧/设计侧数据、设计规范检查等场景时加载本 skill。
---

## 能力总览

本 skill 通过 `devlint-skill` 命令行工具提供 5 个能力，使用 bash 工具调用：

| 命令 | 用途 | 输出 |
|------|------|------|
| `collect-arkui` | 采集鸿蒙 ArkUI 开发侧数据（仅 Windows） | devJsonPath, devImagePath |
| `collect-web` | 采集 Web 页面 DOM 树 + 截图 | devJsonPath, devImagePath |
| `collect-design` | 采集 Pixso 设计稿数据 + 截图 | designJsonPath, designImagePath |
| `ui-style-check` | 对比设计稿与开发实现，输出差异清单 | 问题节点 JSON + md 报告路径 |
| `design-spec-check` | 检查 HTML/URL 是否符合设计规范 | 问题清单 JSON |

---

## 命令调用方式

本 skill 的可执行入口位于 skill 目录下的 `bin/devlint-skill.js`。

**调用方式**（按优先级尝试）：

1. 如果 `devlint-skill` 已注册到 PATH：
   ```bash
   devlint-skill <command> --cwd <项目目录> [options]
   ```

2. 如果 `command not found`，使用 node 直接执行 skill 目录下的入口：
   ```bash
   node <skill目录>/bin/devlint-skill.js <command> --cwd <项目目录> [options]
   ```

**首次使用前**，如果依赖未安装，需先在 skill 目录执行 `npm install --omit=dev`。

---

## 两条主线

### 主线一：UI 一致性检查

需要**设计侧**和**开发侧**两份数据，两侧就绪后执行 `ui-style-check`。

```
用户意图：UI 一致性检查 / 设计稿对比 / 找差异
  │
  ├── 判断开发侧数据来源
  │   ├── 本地文件路径 → 直接作为 --dev-json / --dev-image
  │   ├── 网页 URL → 先执行 collect-web
  │   └── 鸿蒙设备 → 先执行 collect-arkui（仅 Windows）
  │
  ├── 判断设计侧数据来源
  │   ├── 本地文件路径 → 直接作为 --design-json / --design-image
  │   └── 传送码 / 设计稿 URL → 先执行 collect-design
  │
  └── 两侧就绪 → 执行 ui-style-check
```

**数据来源判断规则：**
- `http://` 或 `https://` 开头 → URL
- 纯数字或短字符串（如 `111`）→ 传送码
- `/` 或盘符（如 `C:\`）开头 → 本地文件路径

**两侧采集相互独立**：一侧中断不阻塞另一侧。中断后向用户提供恢复选项（重新采集 / 手动提供文件路径），待两侧都就绪后再执行 `ui-style-check`。

### 主线二：设计规范检查

```
用户意图：设计规范检查 / 规范走查 / 检查是否符合 Octo 规范
  │
  └── 执行 design-spec-check --source <HTML路径或URL> --spec <规范名>
```

---

## 命令详细参数

> **通用参数**：所有命令都支持 `--cwd <项目目录>`，用于指定采集结果和报告的保存位置。执行时务必传入当前项目目录，确保产物保存在项目下而非 skill 目录下。

### collect-arkui

```bash
devlint-skill collect-arkui --cwd <项目目录> [--timeout 60000]
```

- `--timeout`: 采集超时时间（ms），默认 60000
- 仅 Windows 可用
- 输出：`{"devJsonPath":"...","devImagePath":"..."}`

### collect-web

```bash
devlint-skill collect-web --cwd <项目目录> --url <url> [--width 1920] [--height 1080] [--scale-factor 2] [--headless true]
```

- `--url`: 目标页面地址（必填）
- `--width`: 视口宽度，默认 1920
- `--height`: 视口高度，默认 1080
- `--scale-factor`: 截图倍率，默认 2
- `--headless`: 无头模式，`true`（默认）或 `false`
- 输出：`{"devJsonPath":"...","devImagePath":"..."}`

### collect-design

```bash
devlint-skill collect-design --cwd <项目目录> --code <传送码> | --url <设计稿URL> --path <工程目录>
```

- `--code`: 传送码（如 `111`）
- `--url`: 设计稿 URL
- `--code` 和 `--url` 至少传一个，同时传时 code 优先
- `--path`: 工程目录地址（必填）
- 输出：`{"designJsonPath":"...","designImagePath":"..."}`

### ui-style-check

```bash
devlint-skill ui-style-check --cwd <项目目录> \
  --design-json <path> \
  --dev-json <path> \
  [--platform hmPhone|hmWatch|web] \
  [--design-image <path>] \
  [--dev-image <path>]
```

- `--design-json`: 设计稿 JSON 文件路径（必填）
- `--dev-json`: 开发侧 JSON 文件路径（必填）
- `--platform`: 平台类型，默认 hmPhone
- `--design-image`: 设计稿截图路径（可选）
- `--dev-image`: 开发侧截图路径（可选）
- 输出：`{"platform":"...","nodes":[...],"totalNodes":N,"reportPath":"..."}`
- 工具内部读取文件，**文件内容不占用 AI 上下文**

### design-spec-check

```bash
devlint-skill design-spec-check --cwd <项目目录> --source <HTML路径或URL> --spec <规范名>
```

- `--source`: 本地 HTML 文件路径 或 Web 页面 URL（必填）
- `--spec`: 规范名称，如 `Octo`（必填）
- 输出：问题清单 JSON

---

## 采集 → 检查串联规则

采集命令返回的路径**直接传给** `ui-style-check`：

| 采集命令返回字段 | ui-style-check 参数 |
|---|---|
| `devJsonPath` | `--dev-json` |
| `devImagePath` | `--dev-image` |
| `designJsonPath` | `--design-json` |
| `designImagePath` | `--design-image` |

采集完成后应**自动执行** `ui-style-check`，不需要用户再次确认。

### platform 设置

| 开发侧来源 | platform |
|---|---|
| collect-arkui | `hmPhone`（默认） |
| collect-web | `web` |
| 本地文件 | 根据文件名判断（arkui.json → hmPhone，web.json → web） |

---

## 采集中断恢复

### collect-arkui 失败

常见原因：非 Windows 平台、采集程序启动失败、等待超时。

处理：**继续执行设计侧采集**，然后向用户提供选项：
1. 在 Windows 环境重新运行
2. 手动提供 arkui.json / arkui.png 文件路径，跳过采集直接执行 `ui-style-check`

### collect-web 登录超时

处理：**继续执行设计侧采集**，然后向用户提供选项：
1. 重新执行 `collect-web --headless false`，在有头浏览器窗口中完成登录（120 秒内）
2. 手动提供 web.json / web.png 文件路径，跳过采集直接执行 `ui-style-check`

### collect-design 失败

向用户提供选项：
1. 检查传送码是否正确后重新采集
2. 手动提供 design.json / design.png 文件路径

---

## ui-style-check 结果呈现规则

拿到结果后，按以下格式展示给用户：

1. **每个设计节点作为一个分组**展示
2. 展示 **componentChain**（组件层级链），帮助开发者定位代码位置
3. web 平台额外标注 **devClassName**（className），arkui 平台用 componentChain 定位
4. 标注节点在页面中的**相对位置**（用 designRect 概括，如"位于页面顶部"）
5. 每条差异以**修改指令**格式输出：
   - 「属性」期望 expected，当前为 actual，需修改
6. **不要展示**评分、匹配覆盖率、检查耗时等统计信息
7. **不要展示**节点 ID、原始 path 数组等内部技术信息
8. 如果没有差异，直接说 **"开发侧与设计稿一致，无需修改"**
9. 完整问题清单见 **reportPath** 指向的 md 文件，后续修改代码时直接读该文件

---

## 环境要求

- `collect-arkui` 只能在 **Windows** 上执行（依赖 ArkUI Inspector 导出工具）
- `collect-web` 和 `collect-design` 需要 **Chrome 浏览器**（自动查找，或通过 `CHROME_PATH` 环境变量指定）
- 工具内部读取文件，**文件内容不占用 AI 上下文**

---

## 决策检查清单

执行命令前逐项确认：

- [ ] 用户意图是 UI 一致性检查还是设计规范检查？
- [ ] 开发侧数据来源是什么？（本地文件 / URL / 鸿蒙设备）
- [ ] 设计侧数据来源是什么？（本地文件 / 传送码 / URL）
- [ ] 两侧数据是否都已就绪？（未就绪先采集，采集完自动串联）
- [ ] platform 设置是否正确？
- [ ] 采集中断后是否继续了另一侧的采集？
