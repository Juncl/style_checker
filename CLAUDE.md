# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🔴 硬性规则：中文交互

**所有对话、代码注释、思考过程均必须使用中文。无论用户以何种语言提问，AI 的回答、分析、思维过程都必须用中文显示。**

- 用户问题可以是任何语言 → AI 立刻转换为中文回答
- 代码注释（若生成）用中文
- 思考过程（thinking tags）用中文
- 错误提示、日志输出的人类可读部分用中文

---

## 🔴 硬性规则：Git 权限控制

**AI 对 git 只有「只读」权限。除 `git status`、`git diff`、`git log` 等只读查看命令外，AI 绝对不允许执行任何会改变 git 状态的命令（包括但不限于提交、暂存、回退）。**

- ✅ 允许：`git status`、`git diff`、`git log`、`git show` 等**只读**操作
- ✅ 允许：读取 git 文件变化，为用户提供 **提交备注建议**
- ❌ 禁止：执行 `git add`、`git commit`、`git push` 等提交命令
- ❌ 禁止：执行 `git stash`（含 `git stash pop/-u`）、`git reset`、`git checkout --`、`git restore`、`git rm`、`git mv` 等**任何暂存或修改工作区/索引状态**的命令
- ❌ 禁止：使用 `git push --force` 或其他强制操作

> ⚠️ 即便只是「临时暂存一下用于对比、跑完再恢复」也**不允许**。需要对比改动前后效果时，AI 只能用 `git diff` 读取差异，由用户自行决定是否暂存/切换。

**用户需要提交时的流程**：
1. AI 读取当前改动（`git status`、`git diff`）
2. AI 分析改动内容，给出简洁的提交备注建议（一句话，说明修改目的）
3. 用户自己执行 `git add` 和 `git commit`，使用 AI 建议的备注

---

## 🔴 硬性规则：端口管理

**工程的三个端口禁止 AI 操作**：
- 服务端：端口 **3012**（`server`）
- mock 服务：端口 **3001**（`mock`）
- 客户端：端口 **5173**（`client`）

**禁止操作**：
- ❌ AI 不允许启动占用这两个端口的终端或进程
- ❌ AI 不允许关闭或杀死占用这两个端口的进程（包括 node、vite 等）
- ❌ AI 不允许在后台启动服务

**允许操作**：
- ✅ 查询端口占用情况（`netstat`、`lsof` 等只读命令）
- ✅ 告知用户当前状态，由用户手动启动/关闭
- ✅ 提供启动命令建议（用户自行执行）

---

## 🔴 硬性规则：验证集保护

**`matchTest/matchCase/` 目录下所有 case 文件夹中的 `matchValidation.json` 均为人工标注的验证集，AI 绝对不允许修改。**

- ❌ 禁止：写入、覆盖、删除任何 `matchTest/matchCase/case*/matchValidation.json`
- ❌ 禁止：通过任何工具（Write、Edit、Bash 等）对上述文件做任何变更
- ✅ 允许：读取上述文件用于分析和比对
- ✅ 允许：由用户自行编辑维护验证集内容

---

## 🔴 硬性规则：Mock / Client / Server 三方完全独立

**`mock/`、`client/`、`server/` 是根目录下三个平级的独立服务，互不干扰，不得混用代码。**

| 路径 | 实现位置 | 端口 |
|---|---|---|
| mock 接口（如 `/mock/design`） | `mock/routes/` → Express 路由，数据文件放 `mock/db/` | 3001 |
| 真实业务接口（如 `/api/check/*`） | `server/src/routes/` → Express 路由 | 3012 |
| 前端页面 | `client/` → Vite dev server | 5173 |

client 调 mock：`fetch('/mock/...')` → Vite proxy（已有 `/mock → 3001`）→ mock 服务，**不需要改 vite.config.ts**

### 职责边界（核心原则）

| 服务 | 负责内容 |
|---|---|
| **server** | 纯算法：案例管理、节点解析、节点匹配、样式比对、输出对比结果 |
| **mock** | 非算法：登录鉴权、打点埋点、传送码解析、系统数据管理、交付物查询等 |

两者**没有交集**，client 是唯一同时调用两者的一方。如果某个需求不属于"节点解析/匹配/比对"范畴，默认归 mock 负责。

> ⚠️ **AI 提醒义务**：若用户要求在 server 中实现登录、打点、传送码、系统配置等非算法功能，或在 mock 中实现节点解析/匹配逻辑，AI 必须主动提醒用户该需求违背了职责边界原则。

- ❌ 禁止：在 `client/` 目录下新建 mock 文件夹或写 mock 数据
- ❌ 禁止：在 `server/src/routes/` 里写 mock 路由
- ❌ 禁止：在 `vite.config.ts` 里写 `configureServer` mock 中间件
- ❌ 禁止：为 mock 接口添加 `/api → 3012` 的 Vite proxy 规则

---

## 🟢 Mock 数据库操作指南

### mock 数据库是什么

mock 服务（端口 3001）使用**本地 JSON 文件**作为数据库，存放在 `mock/db/` 目录下。其中**用户运行时产生的数据**（交付件、页面、版本）有三个核心文件：

| 文件 | 对应数据 | 说明 |
|---|---|---|
| `mock/db/consistency_check_deliverables.json` | 交付件列表 | 每次对比存档时自动追加 |
| `mock/db/consistency_check_pages.json` | 页面列表 | 每次对比存档时自动追加 |
| `mock/db/consistency_check_versions.json` | 版本列表 | 每次对比存档时自动追加 |
| `mock/db/results/{deliverableId}/{pageId}/` | 原始 JSON 存档 | 存档时写入，按交付件/页面分目录 |

**以下文件是静态配置，与用户数据无关，任何时候都不能修改：**

| 文件 | 说明 |
|---|---|
| `mock/db/team.json` | 团队数据（静态） |
| `mock/db/son_team.json` | 子项目数据（静态） |
| `mock/db/deliverables.json` | 旧字段兼容数据（静态） |
| `mock/db/getImageJson/` | 传送码对应设计稿数据（静态），含 `design.json` / `design.png`（code 111，hmPhone）和 `design_web_case1.json` / `design_web_case1.png`（code 113，web） |

---

### "清空数据库"的含义

当用户说**"清空数据库"**，意思是：**清除所有用户运行时产生的交付件、页面、版本数据**，回到初始空白状态。

具体操作如下（只操作这几项，其余一律不动）：

**① 清空三个核心 JSON 文件（写入空数组）：**

```bash
echo '[]' > mock/db/consistency_check_deliverables.json
echo '[]' > mock/db/consistency_check_pages.json
echo '[]' > mock/db/consistency_check_versions.json
```

**② 删除 results 下所有数字命名的子目录：**

```bash
# 只删除数字命名的目录（即 deliverableId 目录）
find mock/db/results -mindepth 1 -maxdepth 1 -type d | xargs rm -rf
```

> ⚠️ AI 执行这两步之前必须先询问用户确认，因为这是不可逆操作。
> ⚠️ 上述 `find` 命令不会影响 `mock/db/getImageJson/`，该目录与 `results/` 平级、不在其下。

---

### mock 路由文件位置

所有 mock 接口实现在 `mock/routes/` 目录下：

| 路由文件 | 负责接口 |
|---|---|
| `consistencyCheckDeliverables.js` | 交付件增删查 |
| `consistencyCheckPages.js` | 页面增删查、版本管理 |
| `deliverable.js` | 旧版交付件兼容接口 |
| `team.js` | 团队 / 子项目查询 |
| `design.js` | 设计稿 / 传送码相关 |
| `index.js` | 路由注册入口 |

client 调用 mock 接口路径以 `/mock/` 开头，经 Vite proxy 转发到 3001 端口，**不需要修改 `vite.config.ts`**。

---

## 🔴 硬性规则：内外网双环境架构

**本项目同时存在两套运行环境：当前开发环境（外网/mock）和内网部署环境。两套环境共用同一份代码，通过"替换指定文件"切换行为，AI 必须理解这一架构，不得破坏隔离边界。**

### 背景

- 内网环境无法直接访问，代码以"送进去替换文件"的方式接入
- 内网有一套同名文件的真实实现（鉴权、打点、传送码解析等）
- 当前环境这些文件均为**空逻辑或 mock 实现**，内网时整体替换

### 两类特殊目录（禁止在此写真实业务逻辑）

| 目录 | 当前状态 | 内网时 |
|---|---|---|
| `client/src/views/consistency/init/inner/` | 空函数占位 | 替换为内网真实实现 |
| `client/src/views/utils-inner/` | mock 实现 | 替换为内网真实实现 |

**`inner/` 目录下的文件清单及职责：**

```
init/inner/
  checkAuth.ts       — 登录鉴权（当前：空函数）
  mountPixso.ts      — Pixso SDK 初始化（当前：空函数）
  detectIframe.ts    — iframe 环境检测（当前：空函数）
  loadDeliverable.ts — 交付物加载（当前：return null）

utils-inner/
  getJsonImage.ts    — 传送码解析（当前：fetch /mock/design）
```

### API 地址切换

`client/src/api/adminEnv.ts` 是**唯一**的环境切换点：

```ts
export const ADMIN_BASE_URL = '/mock'         // 当前：外网 mock
// export const ADMIN_BASE_URL = window.location.origin  // 内网：同源自动适配
```

### AI 行为规范

- ✅ 新增后台管理接口：在 `client/src/api/api.ts` 追加，调用 `Api`（来自 `request.ts`），**必须携带请求头 `uiplusToken`**（`{ uiplusToken: localStorage.getItem('uiplusToken') }`）——mock 不校验，但内网后台依赖此字段鉴权，缺失会报权限错误
- ✅ 新增工具函数：若涉及内网功能（传送码、鉴权等），放入对应 `inner/` 或 `utils-inner/`，写空逻辑 + 注释说明
- ❌ 禁止：在 `inner/` 或 `utils-inner/` 的文件里写依赖外网/mock 的真实逻辑
- ❌ 禁止：把内网功能（鉴权、打点、传送码）写到 `inner/` 之外的普通文件里
- ❌ 禁止：修改 `adminEnv.ts` 的注释结构（保持两行可切换的格式）

> ⚠️ **AI 提醒义务**：若用户要求实现鉴权、打点、传送码解析、交付物加载等功能，AI 必须主动提示"该功能属于内网实现，当前环境写空逻辑 + 注释，内网替换文件时再实现"。

---

## 🔴 硬性规则：ConsistencyView.vue 的 Pixso 渲染占位 div

**`client/src/views/consistency/ConsistencyView.vue` 第 63–77 行的 `#pixso_render` div 必须永久保留在原位，不得删除、移动或修改。**

```html
<div
  id="pixso_render"
  style="
    position:fixed;
    left:0;
    bottom:0;
    width: 100px;
    height: 100px;
    z-index:10000;
    background-color: red;
    opacity: 0;
    pointer-events: none;
  "
  v-show="true">
</div>
```

- 用途：Pixso 渲染截图时依赖此 div 作为页面占位锚点
- 视觉上不可见（`opacity: 0`、`pointer-events: none`）
- ❌ 禁止：删除此 div
- ❌ 禁止：移动此 div 到其他位置
- ❌ 禁止：修改 `id="pixso_render"` 或 `style` 内的任何属性

---

## 🔴 硬性规则：UI 设计规范遵守（Octo Design System）

**所有 `client` 目录下的 UI 改造必须严格遵守 Octo Design System 规范，不得近似、不得例外。**

这是一项长期的、跨越多个迭代的承诺：每次修改 UI 组件或样式时，都必须对标 Octo 规范，确保视觉一致性和可用性。

### 核心规范速查

| 类别 | 规范 |
|---|---|
| **颜色系统** | 使用 CSS 变量：`--octo-primary` (#0067D1)、`--octo-text-primary` (#191919)、`--octo-border-default` (#D1D5DC) 等，禁止硬编码色值 |
| **按钮高度** | 32px（标准）/ 24px（紧凑，仅当必要）；padding 4px 16px；圆角 4px；无 `size` 属性，用 class 绑定样式 |
| **输入框** | 高度 32px；字号 12px；placeholder 色 #777777；focus 光晕 rgba(0,103,209,0.2)；圆角 4px |
| **标签/Chip** | 高度 22px；padding 2px 8px；字号 **10px**；圆角 4px；语义色：success/warning/danger/info |
| **开关** | 尺寸 38×20px；圆角 9999px；滑块 16px；过渡 200ms ease |
| **圆角** | 4px（按钮/输入框）、8px（卡片/容器）、9999px（开关）；无其他自定义值 |
| **字号** | 14px（正文）、12px（输入框）、**10px（标签）**、16px（大标题） |
| **过渡** | 150ms ease（通常）、200ms ease（开关）；禁止无动画或过渡不流畅 |
| **语义色** | Success 绿 #52C41A / Warning 橙 #FAAD14 / Error 红 #FF4D4F / Info 蓝 #0067D1 |
| **disabled 态** | 背景 #F5F5F5；文字色 #BFBFBF；opacity 50%；禁用 pointer-events |

### 违规示例与修正

❌ **禁止**：
```vue
<el-button size="small" style="color: #0067D1">操作</el-button>
<el-tag size="large" effect="dark" style="background: #0067D1">标签</el-tag>
<el-input placeholder="输入内容" style="height: 28px" />
<div style="border-radius: 6px; color: #0067D1">容器</div>
```

✅ **应该**：
```vue
<el-button class="case-btn">操作</el-button>
<el-tag :type="tagType" class="score-tag" effect="plain">标签</el-tag>
<el-input class="octo-input" placeholder="输入内容" />
<div class="octo-card">容器</div>
```

对应 CSS：
```css
.case-btn {
  height: 32px !important;
  padding: 4px 16px !important;
  border-radius: 4px !important;
  transition: all 150ms ease !important;
}

.score-tag {
  font-size: 10px !important;
  padding: 2px 8px !important;
  height: 22px !important;
  line-height: 16px !important;
}

.octo-input :deep(input) {
  font-size: 12px;
  height: 32px;
}
.octo-input :deep(input::placeholder) {
  color: #777777;
}

.octo-card {
  border-radius: 8px;
  background: #FFFFFF;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}
```

---

## 🟡 工作流规则：代码修改与测试

**修改代码后，进入测试阶段前必须明确告知用户：**

- 明确说出"**代码已完成修改**"，列出修改的具体文件和内容
- 明确询问"**是否需要 AI 来测试这个改动？**"（给用户选择）
  - 用户可能更希望自己在 UI 侧测试，以获得更高效率且不浪费 token
  - 用户需要清楚地知道代码修改是否已经完成，以便自主决策是否需要 AI 测试
- **不要主动进行自动化测试**，除非用户明确要求

---

## 🟡 工作流规则：15 个 case 匹配结果对比优化

**触发**：当用户发出"**跑一下所有 15 个 case 的匹配结果**"这类指令时，AI **不要直接跑**，先按以下流程逐步与用户确认：

1. **先问用户**：是否需要和 `matchNewTemp` 基线做对比优化？
   - 否 → 按用户的实际意图处理（例如只想看当前结果）
   - 是 → 进入下面流程

2. **跑脚本到带时间后缀的新目录**（保留 `matchNewTemp` 基线不动）：
   ```bash
   cd server
   SUFFIX=$(date +%m-%d-%H-%M)
   SNAPSHOT_DIR=matchNewTemp-$SUFFIX COMPARE_BASE=matchNewTemp node scripts/snapshotPairs.js
   ```
   - 在 `test/matchNewTemp-MM-DD-HH-MM/`（与 `matchNewTemp` 同级，时间后缀=月-日-时-分）下生成 `hmPhone/` 文件夹
   - 15 个 case 结果存入该文件夹，并**自动生成 `hmPhone/summary.json`**：逐 case 列出准确率/召回率/多余对相对 `matchNewTemp` 的增减（delta），以及与验证集的剩余差距（配错 + 漏匹配）

3. **生成 `summary.md` 并展示给用户**：

   脚本跑完后，AI 读取新目录下的 15 个 case json 和对应验证集，在新目录根部（与 `hmPhone/` 同级）写入 `summary.md`，内容分两部分：

   **① 汇总表格**（每行一个 case）：

   | case | Pairs总数 | 验证集总数 | 准确数 | 配错数 | 缺失数 | 多余数 | 准确率 |
   |---|---|---|---|---|---|---|---|
   | case1 | … | … | … | … | … | … | …% |
   | … | | | | | | | |
   | 合计 | … | … | … | … | … | … | …% |

   **② 每个 case 的问题明细**（准确的配对不列出）：

   对每个 case，按以下结构列出三类问题对，每对标注 matchType（缺失对无 matchType，写 `—`）：

   ```
   ### case1

   **配错（N对）**
   | arkuiId | 实际 designId | 期望 designId | matchType |
   |---|---|---|---|
   | 2094 | 14:2212 | 14:2220 | anchor-topology |

   **缺失（N对）**
   | arkuiId | 期望 designId |
   |---|---|
   | 1718 | 60:315 |

   **多余（N对）**
   | arkuiId | 实际 designId | matchType |
   |---|---|---|
   | 3001 | 14:9999 | text-exact |
   ```

   - 配错：pairs 里有该 arkuiId，但 designId 与验证集不符
   - 缺失：验证集里有该 arkuiId，但 pairs 里没有匹配到（无 matchType）
   - 多余：pairs 里有，但该 arkuiId 不在验证集中

   生成完毕后，将 summary.md 内容直接展示给用户，等用户看完。

4. **再问用户**：是否保留此次优化？
   - 保留 → 用新目录这套覆盖 `matchNewTemp`（`cp` 文件操作，AI 可执行，**不涉及 git**）
   - 不保留 → `matchNewTemp` 保持不变，新目录留作记录或由用户自行删除

> ⚠️ 前提：server 必须已在 3012 端口运行；AI 跑脚本前先验连通，不通则让用户手动启动（AI 不代启）。

---

## 项目概述

HarmonyOS / Web UI 设计还原检查工具：将 Figma 设计稿与开发侧导出数据进行节点匹配和样式比对，输出差异报告和还原度评分。

支持三种平台（`server/src/config/platforms.js`）：

| platform | 设备 | 开发侧解析器 | designScale | 开发侧文件 |
|---|---|---|---|---|
| `hmPhone` | 鸿蒙手机 | ArkUI | 1 | `arkui.json` / `arkui.png`，或 `arkui.dump` / `arkui.jpeg`（dump 格式） |
| `hmWatch` | 鸿蒙手表 | ArkUI | 0.5 | `arkui.json` / `arkui.png` |
| `web` | Web 网页 | Web DOM | 1 | `web.json` / `web.png` |

`designScale`：hmWatch 的 design.json 数值为物理像素，需 ÷2 才能与 ArkUI vp 坐标对齐。

---

## 前端文档快速入口

理解或修改 `client/` 前端代码时的必读文档。

| 文档 | 说明 |
|---|---|
| **[docs/前端逻辑/前端架构.md](docs/前端逻辑/前端架构.md)** | 技术栈、目录结构、分层架构、组件树、初始化流程、数据流、API 层、常量说明、**画布缩放功能（Ctrl+滚轮）** |

---

## Octo 规范文档快速入口

改造 UI 时的必读文档。所有链接都指向设计师提供的 Octo Design System 源。

### 全局规范（必读）

- **[BASE.md](file:///D:\code_huawei\code_ai\Octo-Design-System-main\02-markdown文档\BASE.md)** — 颜色系统、字号、圆角、间距、阴影、过渡动画、all tokens
- **AI_REFERENCE.md**（本项目缓存）— 快速查阅版本（如需）

### 组件规范（按需查阅）

| 组件 | 规范文档 |
|---|---|
| **Button** | [component.button.md](file:///D:\code_huawei\code_ai\Octo-Design-System-main\02-markdown文档\components\component.button.md) — 32px/24px, padding, 三态颜色 |
| **Input** | [component.input.md](file:///D:\code_huawei\code_ai\Octo-Design-System-main\02-markdown文档\components\component.input.md) — 32px, 字号 12px, placeholder, focus |
| **Tag / Chip** | [component.tag-chip.md](file:///D:\code_huawei\code_ai\Octo-Design-System-main\02-markdown文档\components\component.tag-chip.md) — 22px, 字号 10px, 语义色 |
| **Switch** | [component.switch.md](file:///D:\code_huawei\code_ai\Octo-Design-System-main\02-markdown文档\components\component.switch.md) — 38×20px, 圆角 9999px, 200ms 过渡 |
| **Progress** | [component.progress.md](file:///D:\code_huawei\code_ai\Octo-Design-System-main\02-markdown文档\components\component.progress.md) — 4px 高轨道，标签行 |
| **其他组件** | [components/](file:///D:\code_huawei\code_ai\Octo-Design-System-main\02-markdown文档\components\) — Figma 节点链接、截图、完整规范 |

### React 参考实现

- **[03-开发组件/](file:///D:\code_huawei\code_ai\Octo-Design-System-main\03-开发组件\)** — Octo 官方 React 组件源码（虽然本项目用 Vue3，但设计逻辑和样式值完全适用）

---

## UI 改造检查清单

**每次修改 UI 前，必须逐项检查以下内容。代码已完成修改后，明确告知用户是否需要浏览器验证。**

### 颜色和变量

- [ ] 所有颜色（背景、文字、边框、阴影）都使用 CSS 变量（`--octo-*`）
- [ ] 没有硬编码的 hex 色值（#0067D1 应写成 `var(--octo-primary)`）
- [ ] disabled 态使用 `#F5F5F5` 背景 + `#BFBFBF` 文字色
- [ ] hover / active / focus 态的颜色符合规范（见 BASE.md）

### 尺寸和间距

- [ ] Button 高度 32px（无 `size="small"` 等属性，改用 class）
- [ ] Input 高度 32px；字号 12px
- [ ] Tag 高度 22px；padding 2px 8px；字号 **10px**
- [ ] Icon 尺寸 16px（drop-zone 20px）；无硬编码 color，用 CSS 变量或继承
- [ ] 所有圆角符合规范：4px（按钮/输入框）、8px（卡片）、9999px（开关）

### 交互和动画

- [ ] 所有有状态变化的组件都有过渡：`transition: all 150ms ease` 或 `200ms ease`（开关）
- [ ] focus 态有可视反馈：蓝色光晕 `rgba(0,103,209,0.2)` 或 border
- [ ] disabled 态 pointer-events 禁用，opacity 或颜色变浅

### 语义色系统

- [ ] 成功状态使用绿色（#52C41A）
- [ ] 警告状态使用橙色（#FAAD14）
- [ ] 错误状态使用红色（#FF4D4F）
- [ ] 信息/默认使用蓝色（#0067D1）
- [ ] Tag / 状态指示符的 type 属性与语义一致

### Element Plus 覆盖

- [ ] 所有 El 组件的 size 属性已移除（改用 class 绑定）
- [ ] 使用 `:deep()` 深入修改 El 组件内部样式（`.el-button`, `.el-tag`, `.el-input` 等）
- [ ] 没有遗留的 Element Plus 默认样式干扰（如蓝色焦点框、大按钮等）

### 浏览器验证（仅在用户明确要求时）

- [ ] 在浏览器中打开 http://localhost:5173（由用户手动启动）
- [ ] 黄金路径（golden path）功能正常
- [ ] 视觉效果与 Figma 规范截图接近
- [ ] 没有颜色跳跃、尺寸不符、文字模糊等缺陷
- [ ] 响应式布局（如有）在多种屏幕尺寸上都符合规范

---

## 常用命令

```bash
# 服务端（开发模式，支持热重载）
cd server && npm run dev

# 服务端（生产模式）
cd server && npm start      # 默认端口 3012

# 客户端
cd client && npm run dev    # Vite 开发服务器

# ── 调试脚本（scripts/ 目录，cd server 后运行）────────────────────────────────
#
# analyzePass1.js
#   作用：对指定 case 运行 Pass 1 文本匹配，输出可信匹配汇总；
#         指定节点 ID 时额外输出该节点对的五维子分数（content/color/size/weight/place）
#         和 Top 5 候选列表。
#   适用问题："Pass 1 为什么没匹配上"、"某节点对的 finalScore 是多少"、
#             "置信度为什么低/高"、"Pass 1 最终选了哪个候选"
#   需要用户提供：caseId（如 case2）；可选 hmId（ArkUI 节点 id）和 deId（Design 节点 id）
#
node scripts/analyzePass1.js <caseId>                      # 仅输出可信匹配汇总
node scripts/analyzePass1.js <caseId> <hmId> <deId>        # 输出指定节点对详情
# 示例：
node scripts/analyzePass1.js case2
node scripts/analyzePass1.js case2 5397:t 15:4674

# testTextSimilarity.js
#   作用：验证 textSimilar 函数对任意字符串对的计算过程，分解显示
#         editScore / semanticScore / prefixSuffixScore 三个维度及最终融合结果。
#   适用问题："两个字符串的相似度是多少"、"为什么内容分低"、"前后缀匹配有没有生效"
#   需要用户提供：两个待比较的字符串（不传则运行内置测试集）
#
node scripts/testTextSimilarity.js                         # 运行内置测试集
node scripts/testTextSimilarity.js "字符串1" "字符串2"      # 单组详细输出
# 示例：
node scripts/testTextSimilarity.js "会员管理" "会员中心"

# debugPass4.js
#   作用：对指定 case 重放 Pass 1-3.5 建立锚点，然后模拟 Pass 4 拓扑匹配全过程：
#         输出 candidateDesignNodes 排序列表和正式执行的匹配结果；
#         指定 deId 时额外输出该节点的锚点列表和 Top 10 arkui 候选得分（含 relDist）。
#   适用问题："Pass 4 为什么没匹配上"、"某节点的 relDist/score 是多少"、
#             "Pass 4 排序顺序是否合理"、"是被哪个 arkui 抢先匹配了"
#   需要用户提供：caseId（如 case6）；可选 deId（Design 节点 id）
#
node scripts/debugPass4.js <caseId>                        # 输出 Pass 4 全局执行结果
node scripts/debugPass4.js <caseId> <deId>                 # 额外输出指定节点的锚点和候选 Top10
# 示例：
node scripts/debugPass4.js case6
node scripts/debugPass4.js case6 52:86
```

## 调试脚本使用时机

当用户提问契合以下场景时，**优先建议使用对应脚本**（告知用户需要哪些输入）：

| 问题类型 | 优先使用 | 用户需提供 |
|---|---|---|
| "某节点为什么没在 Pass 1 匹配上？" | `analyzePass1.js` | caseId + hmId + deId |
| "Pass 1 给某节点对打了多少分？" | `analyzePass1.js` | caseId + hmId + deId |
| "某两个字符串的文本相似度是多少？" | `testTextSimilarity.js` | 两个字符串 |
| "内容分/prefixSuffix 有没有生效？" | `testTextSimilarity.js` | 两个字符串 |
| "某节点为什么没在 Pass 4 匹配上？" | `debugPass4.js` | caseId + deId |
| "Pass 4 的 relDist/score 是多少？" | `debugPass4.js` | caseId + deId |
| "Pass 4 排序/执行顺序是否合理？" | `debugPass4.js` | caseId |

API 端点（服务端运行后）：
- `GET  /api/cases` — 列出所有可用 case
- `POST /api/check/case/:caseId` — 分析指定内置 case
- `POST /api/check/upload` — 上传文件分析（multipart: designJson, arkuiJson, designImage, arkuiImage）

## 架构与数据流

```
case/
├── hmPhone/
│   ├── caseN/           # JSON 格式 case
│   │   ├── design.json
│   │   ├── arkui.json   # ArkUI Inspector JSON 导出
│   │   ├── design.png
│   │   └── arkui.png
│   └── caseN-dump/      # dump 格式 case（-dump 后缀区分）
│       ├── design.json
│       ├── arkui.dump   # ArkUI Inspector dump 文本导出
│       ├── design.png
│       └── arkui.jpeg
├── hmWatch/
│   └── caseN/           # 格式与 hmPhone JSON case 相同
└── web/
    └── caseN/           # Web DOM 树
        ├── design.json
        ├── web.json
        ├── design.png
        └── web.png
```

**dump 格式**：HarmonyOS ArkUI Inspector 的另一种导出格式（纯文本树），与 JSON 格式并列支持，由 `parseArkui` 根据 `typeof input` 自动识别，后续流水线完全共用。case 列表接口中 dump case 排在普通 case 之后。

**全流程（`server/src/routes/check.js` → `runCheck()`）：**

1. **解析**：`parseDesign()` 和 `parseArkui()` 走 5 步流水线（详见下文），输出已过滤的 `UnifiedNode[]`
2. **节点匹配**：`matchNodes()` 多 Pass 算法（见下文）
3. **样式比对**：`compareAll()` + `compareSpatialRelations()` 生成 `StyleDiff[]`
4. **评分**：`score = 100 - penalty*10 - coveragePenalty - lowConfidencePenalty`

> 像素可见性 / ~~OCR~~ / 后项杀前项 标注及不可见节点剔除已全部内化进解析流水线 step 3，`runCheck` 不再单独调用。**（OCR 阶段 2026-06 临时隐藏）**

## 解析流水线（5 步，两侧对称）

代码位置：
- ArkUI 开发侧 [`server/src/parsers/arkui/`](server/src/parsers/arkui/) — 入口 `index.js` 导出 `parseArkui(arkuiInput, { imageBuffer })`
  - `arkuiInput` 为 JSON 对象时走 `1-buildTree.js`；为字符串时走 `1-buildDumpTree.js`（dump 格式自动识别）
- Web 开发侧 [`server/src/parsers/web/`](server/src/parsers/web/) — 入口 `index.js` 导出 `parseWeb(webJson, { imageBuffer })`
- 设计侧 [`server/src/parsers/design/`](server/src/parsers/design/) — 入口 `index.js` 导出 `parseDesign(designJson, { imageBuffer })`
- 三侧中 ArkUI 侧是 `async`（ArkUI step 3 曾调用 Tesseract，OCR 已临时隐藏）

| step | 文件 | 职责 |
|---|---|---|
| 1 buildTree | `1-buildTree.js`（JSON）/ `1-buildDumpTree.js`（dump） | 原始结构 → UnifiedNode 树（保留 children）。**只做字段转换，不剔除任何节点**。设计侧由于原始数据是扁平 `data[]`，需按 `path` 重建树（孤儿丢弃）；同时接受 `arkuiCanvasWidthVp` 参数：计算 `scale = arkuiCanvasWidthVp / origCanvasWidth`，将所有节点 rect 等比缩放后写入 `rect`，原始 dp 坐标存入 `size` |
| 2 pruneTree | `2-pruneTree.js` | **硬剪枝**（整棵子树删：`visibility=Hidden` / `opacity=0` / 越界 / 超宽 / 零尺寸(`!w\|\|!h\|\|(w<2&&h<2)`，仅叶子节点) / 空文本）+ **SCB 系统层过滤**（`utils/filterSCBSystemLayer.js`：消除 `__Common__` 下 SCBSystemScene/SCBKeyboardPanel 等全屏系统叠加层，仅 ArkUI 侧执行）+ **软剪枝**（删自身保子：框架节点 / Span / Blank / 透明 layout 容器 / 极小节点 w/h ≤ 4（无条件）/ 全屏包裹层 normRect ≥ 0.999（无条件））。设计侧额外做语义折叠 + 背景节点同化 + BOOLEAN_OPERATION 后代清空；设计侧硬剪枝额外包含：**系统状态栏整组件**（name/componentData 含 StatusBar + 贴顶 + 矮条 + 含时间文本）；设计侧软剪枝额外包含：**GROUP 无视觉装饰时 unwrap** |
| 2.5 normalizeTree | `utils/normalizeTree.js`（共享） | 父子 `rect.x/y/w/h` **严格相等**且 child 非叶子非文本、`style` 无视觉装饰时，删 child 把孙子接上来 |
| 3 annotateTree | `3-annotateTree.js` | ArkUI 侧：`pruneOccludedSiblings('reverse')`（后项杀前项）→ 像素标注 → ~~OCR 标注~~ → unwrap。**（OCR 已临时隐藏）** 设计侧：`pruneOccludedSiblings('forward')`（前项杀后项）→ 像素标注 → unwrap。Web 侧：不做遮挡剪枝、不做 OCR |
| 4 flattenTree | `4-flattenTree.js` | 树 → 扁平 `UnifiedNode[]`（DFS 序），去掉所有内部字段（`children` / `_attrs` / `_raw` 等）。设计侧额外对扁平列表按 `rect` 做同 x/y/w/h 容器去重（仅保留视觉性最强或 path 最短的）。不包含 root 节点本身 |

### 全局决策（解析阶段）

- **`paintIndex` 概念已删除**：流水线不再赋此字段，下游 `?? 0` 兜底退化为按 DFS 序排序。
- **`pruneOccludedSiblings`（兄弟遮挡剪枝）已实装**：接收树根和方向参数，bottom-up 递归，对每层 children 直接删除被完全覆盖的节点，**不挂任何标注字段**。ArkUI step 3 用 `type='reverse'`（后项杀前项），设计侧 step 3 用 `type='forward'`（前项杀后项），两侧均先于像素标注运行。
- **设计侧不做 OCR**（按定项决策保持现状）。
- **`hiddenFrameworkAncestor` 字段不再被设置**：相关下游分支判断自动失效。
- **`isPipelineVisibleNode` 仍保留**：作为 step 3 内部判定函数继续使用，但不再由 `runCheck` 调用。

详细流程见 [docs/进入节点匹配前原始数据处理流程.md](docs/进入节点匹配前原始数据处理流程.md)。

## 节点类型系统

两侧节点都统一为 `{ type: 'text' | 'container', rawType: string }` 格式。

**Design 侧**（`parsers/design/1-buildTree.js`）：
- `TEXT` → `type: 'text'`；其余（FRAME、VECTOR、RECTANGLE、ELLIPSE 等）→ `type: 'container'`
- `rawType` 保留 Figma 原始类型的小写形式
- HM Symbol 文本节点（`fontFamily` 含 `hm symbol`）特殊处理：强制变 `container` + `rawType=symbolglyph`，字体色写入 `backgroundColor`

**ArkUI 侧**（`parsers/arkui/1-buildTree.js` 或 `1-buildDumpTree.js`，格式自动识别）：
- `Text` → `type: 'text'`；其余 → `type: 'container'`
- 框架节点（`Navigation`、`NavBar`、`Stack`、`Column`、`Row` 等无背景色时）在 step 2 软剪枝阶段被 unwrap（删自身保子）
- dump 格式额外框架节点（无 FrameRect）：`IfElse`、`ForEach`、`LazyForEach`、`TitleBar`、`ToolBar` 等，标记 `_frameworkType: true`，豁免 `no-rect` 硬剪枝
- **Image 节点的 `backgroundColor` 在 step 1 直接清空**：ArkUI Image 的 backgroundColor 是图片加载失败时的占位色，正常渲染时不显示，写入 style 会与设计侧产生误比对，因此在 `extractArkuiStyle` 末尾直接 `delete s.backgroundColor`。
- **style 属性按节点类型限定**：

  | 属性 | 适用类型 | 备注 |
  |---|---|---|
  | `fontSize` / `fontWeight` / `fontColor` / `fontFamily` / `lineHeight` / `letterSpacing` / `textAlign` | 仅 Text | 文字限定 |
  | `backgroundColor` / `borderRadius` / `border` / `padding` | 仅 Container | 容器限定 |
  | `itemSpacing` | 仅 Row/Column/Flex | 容器限定 |
  | `blur` / `shadow` / `opacity` / `width` / `height` | 公用 | — |
  | `margin` / `blendMode` | — | 非对比项，仅提取不参与比对 |

- **clip borderRadius 向下传播**：ArkUI 惯用 `clip=true + borderRadius` 的容器裁剪子节点实现圆角，Image 本身不设 borderRadius。`walk` DFS 时携带 `clipRadius` 上下文：节点满足 `clip=true` 且 borderRadius 非零时产生新上下文；递归时只传给与当前节点**同 rect**的子节点，不同 rect 忽略；`Image` 节点自身无圆角时从 `clipRadius` 继承。
- **Button / TextInput 文本拆分**：在 step 1 阶段为这两类节点凭空造一个虚拟 `Text` 子节点（id = 原id + `:t`），消除"开发侧文本+非文本混合 vs 设计侧分离节点"的不对称。
  - `Button`：`$attrs.label` 非空时拆分，文本居中
  - `TextInput`：`text` 优先、否则 placeholder，遵循 `textAlign`（缺省 start）
  - rect 估算：垂直居中 + 按字符宽度（中文=fontSize、其他=fontSize×0.55）水平对齐
  - 需要同时填 `_rectRaw`（vp × resolution），否则 step 2 会以 `no-rect` 剪掉

**关键分类函数**（`nodeVisibility.js`）：
- `isRenderableNonTextNode(node)`: `type=container` 且（有视觉装饰 OR `rawType` 在 `INTRINSIC_VISUAL_RAW_TYPES`）
  - `INTRINSIC_VISUAL_RAW_TYPES`: `image, button, search, vector, boolean_operation, circle, ellipse, rect, symbolglyph, searchfield`
- `isStructuralContainer(node)`: `type=container` 且 `!isRenderableNonTextNode`（纯布局容器）
- `hasVisualDecoration(node)`: style 中有 `backgroundColor / borderRadius / border / shadow / blur`

**重要**：`isStructuralContainer` 的节点在 `isAcceptablePair()` 中会被直接拒绝，无论 IoU 多高。这是"无视觉装饰的 FRAME 容器不参与输出匹配"的设计意图。

## 坐标系统

| 侧 | 单位 | 归一化 |
|---|---|---|
| Design | dp（Figma 像素），step 1 按 `scale = arkuiCanvasWidthVp / origCanvasWidth` 等比缩放后存入 `rect`；原始 dp 值保留在 `size` 字段 | `normRect.x = rect.x / canvasWidth`，`normRect.y = rect.y / canvasHeight`（其中 canvasWidth/Height 已是缩放后值）|
| ArkUI | 物理像素 px ÷ `$resolution` → vp | `normRect.x = vp.x / canvasWidthVp`，`normRect.y = vp.y / canvasHeightVp` |

匹配时大多数 IoU/相对位置计算使用 `normRect`（0-1 范围）。**例外**：Pass 4 拓扑匹配的关系向量和选锚距离改用 `rect` 绝对坐标（dp/vp）+ 各自对角线归一化，避免两侧画布高度不同时 normRect 产生的系统性偏差。

## 多 Pass 节点匹配（`nodeMatcher.js`）

按优先级从高到低依次尝试，每轮匹配成功后标记 `matchedDesignIds` 和 `usedArkui`（**注意：Pass 5容器IoU/Pass 6/Pass 6.5/Pass 7 不标记 usedArkui**，允许后续生成重复候选，由 `selectOneToOnePairs` 最终裁决）：

| Pass | matchType | 名称 | 说明 |
|---|---|---|---|
| 1 | `text-content` | 全文本加权匹配 | ArkUI 主序，所有文本节点综合得分（内容/位置/样式）；可信匹配（≥0.9）升为强锚点，驱动后续拓扑 |
| 2a/2b | `dynamic-text-slot` | 动态时间/星期槽位 | 时间/星期等动态文本，按序列位置对应 |
| 2c | `text-row-slot` | 同行文本对齐 | 同行文本节点按 x 序对齐，topologyScore ≥ 0.86 时补充为拓扑锚点 |
| 2d | `long-text-fallback` | 长文本位置-样式兜底 | ArkUI 侧字数 > 12，位置(0.60)+样式(0.35)+内容(0.05)，最近 3 锚点方向一票否决，score ≥ 0.55 接受 |
| 2.5 | `text-role` | 文本语义角色 | title/subtitle/body 等语义槽位对应，score ≥ 0.85 或强标题槽位命中时接受 |
| 3 | `anchor-topology-包含/方向/自由` | 强锚点周边拓扑 | 以强锚点为参照，分三轮：①包含容器、②左右最近邻、③上下守门带（Gale-Shapley 稳定匹配）；第二轮放宽方向自由配对（score ≥ 0.55） |
| 3.5 | `list-index` | 同行同类 list 顺序 | 两侧同行且 rawType 严格相同的横向列表（≥2个），按 x 升序锁定；不依赖 IoU，防溢出节点抢配 |
| 4 | `region-text-optimal` / `region-text-global-rescue` | 区域内文本全局最优 | 对拓扑/list 后剩余未匹配文本做区域内最优二分匹配；全局兜底阈值 0.60 |
| 5（文本） | `text-position` | 文本位置回退 | 中心点位置 + 语义内容 + 字号/字重/字色综合评分，score > 0.35 接受 |
| 5b | `numeric-slot` | 数字槽位 | mock 整数与实际整数位置/样式一致（styleScore ≥ 0.70），数值可不同 |
| 5（容器） | `container-iou` | 容器 IoU | `type=container` 节点 IoU > 0.60（无装饰）或 > 0.40（有装饰） |
| 6 | `container-geometry` | 视觉容器几何 | `isRenderableNonTextNode` 节点 IoU > 0.55 |
| 6.5 | `spatial-bracket` | 空间担保 | 被同行左右两对已匹配节点夹住、尺寸吻合（minRatio ≥ 0.5）的 container 节点 |
| 7 | `rescue-iou` | Rescue 兜底 | 任意兼容类型 IoU > 0.25，confidence=low |

`selectOneToOnePairs` 最终按 `confidence → matchType优先级 → topologyScore → iou` 排序，保证一对一。

**匹配方向**：固定 design-first（以 design 节点为主序遍历），`matchDirection` 参数与 `STYLE_CHECKER_MATCH_DIRECTION` 环境变量已失效。

## 样式比对容差（`styleComparator.js`）

```js
TOLERANCE = {
  fontSize:      0,    // 零容差；分级：≤2 → warning，>2 → error
  lineHeight:    0.5,
  letterSpacing: 0.5,
  borderRadius:  0,    // 零容差：任何角差都报 warning
  padding:       1.0,
  opacity:       0.02,
  blur:          0,    // 零容差：任何偏差都报
  shadowRadius:  0,    // 零容差：任何偏差都报
  shadowOffset:  0,    // 零容差：任何偏差都报
  colorDelta:    0,    // 欧氏颜色距离（0-442）；0 = 严格匹配，>40 → error
}
```

**填充色豁免规则（`diffBackgroundColor`）：**
- **硬豁免**：任一侧 `rawType ∈ { image, img, canvas }` → 无条件跳过，不参与填充对比（image/img：填充语义不同；canvas：背景色无展示意义）
- **软豁免（按侧）**：`rawType ∈ { button, path, divider, progress, swiperindicator, icon, video }` 且该侧无填充值 → 该侧不驱动填充对比
- **symbolglyph 规则**：开发侧 `rawType === 'symbolglyph'` 时，必须两侧均有非透明填充色才对比，否则忽略（HM Symbol 图标色由字体渲染决定，缺一侧属正常）
- **单侧缺失忽略**：不论纯色还是渐变色，任一侧无填充值或为透明色 → 直接忽略，不产生差异报告（不再报"填充：一侧缺失"或"一侧渐变一侧纯色"）
- **borderRadius 豁免**：开发侧 `rawType === 'circle'` 或设计侧 `rawType === 'ellipse'` 时跳过圆角对比；开发侧 `image` 且无圆角值时跳过（圆角由 clip 父节点裁剪实现）
- **borderColor 豁免**：设计侧 `border.color` 无值时跳过，不对比描边颜色
- **borderWidth** 容差：零容差（`> 0` 即报），`> 2` 升级为 error

## 语义折叠（`parsers/design/2-pruneTree.js` → `semanticCollapse`）

名称匹配 `icon / ic_ / 图标` 且尺寸 ≤ 48dp 的 FRAME/GROUP/VECTOR 节点，会被折叠为单个语义节点（`semanticAsset: true`），其子孙节点不再参与匹配。代表节点优先选取与 frame 等大（差 ≤1px）且有背景色的子孙节点。命名是插画且面积占画布 ≥55% 且含 ≥3 个文本后代时**不折叠**（避免把整页插画当成单图标）。

## 背景节点同化（`parsers/design/2-pruneTree.js` → `mergeFrameBackgroundRects`，步骤 2b.5）

在语义折叠之后、BOOLEAN_OPERATION 后代清空之前执行。针对 Figma 中常见的"背景 RECTANGLE/FRAME 与容器 FRAME 完全重叠"模式：

- 自顶向下遍历，仅处理 `rawType=FRAME` 的节点。
- 对每个 FRAME，**DFS 搜索其整个子树**（`absorbSameRectInSubtree`），寻找与该 FRAME 同 rect（x/y/w/h 各差 < 0.5）的后代节点。同层倒序遍历（index 靠后先处理，靠前覆盖靠后）：
  - **同 rect FRAME**：样式合并（有视觉装饰时）+ unwrap（提升 children），i 不变继续处理提升上来的节点，并继续 DFS；
  - **同 rect RECTANGLE**：样式合并（有视觉装饰时）+ 删除（RECTANGLE 无后代，停止该路径）；
  - **其他节点**：穿透，继续往下 DFS 其子节点。
- 同化完成后，对剩余子节点递归调用（子节点自身可能也是 FRAME）。

**典型场景**：FRAME A → GROUP B（同 rect）→ RECTANGLE C（同 rect，有圆角）。执行后：穿透 GROUP B，RECTANGLE C 的 borderRadius 合并到 A，C 被删除。A 从无装饰的结构容器变为有视觉装饰的可匹配节点。

## 区域分割（`regionContext.js`）

`segmentRegions()` 按 y 坐标将节点分组为"区域"，垂直间距 > 7.5% 画布高度时切割。区域用于限制候选池范围（`candidatePool()`），避免跨区域误配。

