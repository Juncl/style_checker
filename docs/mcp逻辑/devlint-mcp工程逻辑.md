# devlint-mcp 工程逻辑

## 一、工程定位

devlint-mcp 是一个 **MCP（Model Context Protocol）服务器**，作为 AI 编码助手（opencode）与 style_checker server 之间的桥梁。

它提供三类能力，封装为三个 MCP 工具：

| 工具 | 职责 | 输出 |
|---|---|---|
| `collect_web` | 通过 puppeteer 打开网页，采集 DOM 树结构 + 计算样式 + 截图 | `web.json` + `web.png` 文件路径 |
| `collect_design` | 通过传送码/URL 采集 Pixso 设计稿节点树数据 + 截图 | `design.json` + `design.png` 文件路径 |
| `ui_style_check` | 读取本地设计稿/开发侧文件，调用 server 完成检查 | 精简后的差异报告 JSON |

三者可串联使用：`collect_web` / `collect_design` 采集的文件路径直接传给 `ui_style_check`，完成一次端到端检查。

```
                          ┌──────────────────────────────────────────────────┐
                          │                  devlint-mcp                      │
用户 ──对话──▶ AI(opencode) │                                                   │
                      │    │  ┌─ collect_web ──┐  ┌─ collect_design ────────┐ │
                      │    │  │ puppeteer 采集  │  │ Pixso 采集（内网真实）  │ │
                      │    │  │ web.json/png    │  │ design.json/png         │ │
                      │    │  └───────┬────────┘  └──────────┬──────────────┘ │
        stdio JSON-RPC│    │          │                      │                │
                      ▼    │          │     ┌─ ui_style_check ──┐             │
                  devlint-mcp│         └────▶│ 读文件→multipart   │             │
                          │    │               │ →HTTP POST server │             │
                          │    │               └────────┬──────────┘             │
                          │    │                        ▼                        │
                          │    │                  server(3012)                   │
                          │    │                  解析/匹配/比对                  │
                          │    │                        │                        │
                          │    │                  ◀── JSON 结果 ──┘              │
                          │    │                  extractSummary                 │
                          └────│── 精简摘要 ◀─────────────────────────────────│
                               └───────────────────────────────────────────────┘
```

**核心价值**：
- 文件内容由 MCP 进程内部读取并转为 multipart 上传，**不经过 AI 上下文**，避免大 JSON 占用 token
- 采集的文件直接落盘到 `.devlint/` 目录，路径回传给 AI，无需 AI 处理文件内容

---

## 二、目录结构

```
devlint-mcp/
├── index.js                              # 入口：创建 stdio transport 并连接
├── package.json                          # 依赖：@modelcontextprotocol/sdk + puppeteer-core + zod
├── lib/
│   ├── server.js                         # MCP 服务器创建 + 工具注册（核心）
│   ├── config.js                         # 环境配置（常量定义，含 DIR_NAME）
│   └── utils/                            # 公共工具函数
│       ├── tools.js                      # getChromePath / fileToBlob / timestamp
│       └── summary.js                    # 从 server 完整结果中提取精简摘要
│   └── collectData/                      # 数据采集模块
│       ├── getWebDom/                    # Web 开发侧 DOM 采集
│       │   ├── getWebDom.js              #   采集逻辑（浏览器内执行函数 + 落盘）
│       │   └── puppeteer.js              #   puppeteer 通道层（launch/Connect 双模式）
│       └── getPixData/                   # Pixso 设计侧采集
│           └── getPixData.js             #   采集逻辑（外网占位，内网真实实现）
└── node_modules/
```

技术栈：ESM（`"type": "module"`）、MCP SDK、zod（参数校验）、puppeteer-core（浏览器自动化）。

### `utils/tools.js` — 公共工具函数

| 函数 | 职责 |
|---|---|
| `getChromePath()` | 跨平台查找 Chrome 可执行路径（env `CHROME_PATH` > 自动查找 > null） |
| `fileToBlob(filePath, fallbackType)` | 读取文件为 Blob，按扩展名设置 MIME 类型（.png/.jpg/.json） |
| `timestamp()` | 生成 `月日时分秒` 时间戳，用于采集文件命名 |

> 这些函数被 `puppeteer.js`、`getWebDom.js`、`getPixData.js`、`server.js` 共同复用。

---

## 三、启动流程

### 入口 `index.js`

```js
const transport = new StdioServerTransport()   // stdio 传输
const mcp = createMcpServer()                   // 创建 MCP 实例 + 注册工具
await mcp.connect(transport)                    // 连接，等待 AI 通过 stdin/stdout 调用
```

- 始终使用 **stdio 模式**，由 opencode 作为子进程启动
- AI 客户端通过 stdin 发送 JSON-RPC 请求，MCP 通过 stdout 返回结果

---

## 四、配置管理

### `config.js` — 常量定义，内外网双环境

```js
const CHECK_ENV = 'outer'
// const CHECK_ENV = 'inner'
const CHECK_URL = {
  outer:  'http://localhost:3012/api',
  inner:  'http://xxx.aaa.com/devlint/api'
}

export const config = {
  CHECK_SERVER_URL: CHECK_URL[CHECK_ENV],
  DIR_NAME: '.devlint'
}
```

| 配置项 | 说明 |
|---|---|
| `CHECK_SERVER_URL` | server 端 API 基地址，fetch 时拼接 `/check/upload` |
| `DIR_NAME` | 采集数据存放目录名，采集模块在 `process.cwd()/.devlint/` 下落盘 |
| `CHECK_ENV` | 内外网切换常量，改注释行即可（`outer` ↔ `inner`），代码零改动 |

> 注意：当前配置通过 `config.js` 中的常量管理，不再读取外部 `config.json` 文件。

---

## 五、工具注册（`server.js`）

共注册 3 个工具。

### 5.1 `ui_style_check` — UI 一致性检查

**参数定义**（zod 校验）：

| 参数 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `designJsonPath` | 是 | string | 设计稿 JSON 文件路径（Figma/Pixso 导出的 data 结构） |
| `devJsonPath` | 是 | string | 开发侧 JSON 文件路径（arkui.json / web.json，或 `collect_web` 返回的路径） |
| `platform` | 否 | enum | `hmPhone`（默认）/ `hmWatch` / `web` |
| `designImagePath` | 否 | string | 设计稿截图路径（png/jpg） |
| `devImagePath` | 否 | string | 开发侧截图路径（png/jpg，或 `collect_web` 返回的路径） |

**description** 指导 AI：
- 何时触发（用户说"UI 还原度检查""设计稿对比"等关键词时）
- 与 `collect_web` 的协作（URL → 先采集；本地文件 → 直接传入）
- 参数含义、输出格式、输出指引

**工具执行流程（handler）**：

```
1. 校验文件存在
   遍历所有传入路径，existsSync 检查，不存在则返回 isError

2. 读取文件为 Blob
   fileToBlob()（来自 utils/tools.js）根据扩展名设置 MIME 类型：
     .png → image/png
     .jpg/.jpeg → image/jpeg
     其他 → application/json

3. 构建 FormData（multipart 表单）
   form.append('platform', platform)
   form.append('designJson', blob, 'design.json')
   form.append('arkuiJson',  blob, 'arkui.json')
   form.append('designImage', blob, 'design.png')   ← 可选
   form.append('arkuiImage',  blob, 'arkui.png')    ← 可选

4. 发起 HTTP 请求
   POST `${config.CHECK_SERVER_URL}/check/upload`
   → http://localhost:3012/api/check/upload（外网）

5. 处理响应
   res.json() 拿到 server 完整 runCheck 结果

6. 提取摘要
   extractSummary(result) 精简为面向开发者的差异报告

7. 返回
   JSON.stringify(summary) 作为 text content 返回给 AI
```

### 5.2 `collect_web` — Web 页面数据采集

**参数定义**（zod 校验）：

| 参数 | 必填 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| `url` | 是 | string | — | 目标页面地址 |
| `width` | 否 | number | 1920 | 视口宽度 |
| `height` | 否 | number | 1080 | 视口高度 |
| `deviceScaleFactor` | 否 | number | 2 | 截图质量倍率（1x/2x/3x） |
| `browserWSEndpoint` | 否 | string | — | 连接已打开的 Chrome；传 `"connect"` 自动从 localhost:9222 获取 |

**description** 指导 AI：
- 何时触发（用户说"采集网页""采集 web 页面""抓取网页 DOM"等关键词时）
- 两种浏览器模式：不传 `browserWSEndpoint` → 无头模式；传入 → connect 模式（连接用户已登录的 Chrome）
- 输出 `devJsonPath` / `devImagePath`，可直接传给 `ui_style_check`

**工具执行流程（handler）**：

```
1. 组装采集选项
   viewport: { width, height, deviceScaleFactor }
   browserWSEndpoint:
     - 传 "connect" → useConnect: true（自动从 9222 获取 WS 地址）
     - 传 ws://... → browserWSEndpoint 直接使用
     - 不传 → launch 无头模式

2. 调用 collectWebDom(url, collectOptions)
   内部走 puppeteer.run() 完整流程（见第六章）

3. 返回
   { devJsonPath, devImagePath } 作为 JSON 返回给 AI
```

### 5.3 `collect_design` — 设计侧数据采集

**参数定义**（zod 校验）：

| 参数 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `code` | 否 | string | 传送码，如 "111"，通过传送码服务解析为 Pixso 页面地址 |
| `url` | 否 | string | 设计稿 URL 地址 |
| `filePath` | string | 当前打开的工程目录地址（必填，但当前采集逻辑未使用，采集结果统一落盘到 `.devlint/`） |

> `code` 和 `url` 至少传一个，同时传时 url 优先。

**description** 指导 AI：
- 何时触发（用户说"采集设计稿""采集 Pixso 设计稿""传送码采集"等关键词时）
- 输出 `designJsonPath` / `designImagePath`，可直接传给 `ui_style_check`
- `collect_design → ui_style_check` 是固定串联流程

**工具执行流程（handler）**：

```
1. 参数校验
   code 和 url 至少传一个，否则返回 isError

2. 调用 collectDesign(code, url, filePath)
   外网：返回 .devlint/design.json / .devlint/design.png 的全路径（占位，不实际采集）
   内网：替换 getPixData.js 实现真实 Pixso 采集逻辑

3. 返回
   { designJsonPath, designImagePath } 作为 JSON 返回给 AI
```

> 注意：handler 中对 `collectDesign` 的调用使用 `await`，确保内部 `throw` 能被 catch 捕获并返回 `isError`。

---

## 六、数据采集模块（`collectData/`）

### 6.1 架构：通道层 + 采集逻辑分离

Web 采集模块由两个文件组成，职责分离：

| 文件 | 职责 |
|---|---|
| `puppeteer.js` | **通道层**：浏览器生命周期管理（launch/Connect）、页面导航、CDP 设备仿真、截图、`page.evaluate` 注入执行 |
| `getWebDom.js` | **采集逻辑**：在浏览器上下文中执行的 `COLLECT_FN` 函数 + 结果落盘 |

Pixso 采集模块（`getPixData/`）当前只有一个文件 `getPixData.js`，外网为占位返回，内网替换为真实采集逻辑。

通道层 `run()` 统一流程：

```
获取浏览器（launch 或 connect）
  → CDP 设备仿真（emulateDevice）
  → 导航到 URL（page.goto）
  → 等待渲染（默认 3000ms）
  → 执行采集函数（evalInPage → page.evaluate(COLLECT_FN)）
  → 截图（CDP Page.captureScreenshot）
  → 关闭/断开浏览器
  → 返回 { domData, screenshotBuffer }
```

### 6.2 `getWebDom/` — Web DOM 采集

#### 采集逻辑（`getWebDom.js` → `COLLECT_FN`）

采集逻辑迁移自 **Octo-DomExport 谷歌插件** 的 `mainExportInContent` + `getElementData` 函数，适配 puppeteer `page.evaluate` 执行环境（去掉 Blob 下载，直接 return 数据）。

| 步骤 | 说明 |
|---|---|
| DPI 修正 | 创建测试元素测量 1px border 实际渲染值，计算 `fixRatio` 修正系统 DPR 缩放导致的像素偏差 |
| 递归遍历 | `getElementData(node, offsetX, offsetY)` 递归遍历 DOM 树 |
| 过滤隐藏元素 | `display:none` / `visibility:hidden` → 跳过 |
| 可视区域判断 | 元素与视口相交才采集（`rect.bottom > 0 && rect.top < vh` 等） |
| 文本/容器判定 | 叶子元素（无子元素）且有文本内容 → `type: 'text'`；否则 → `type: tagName` |
| 样式提取 | 公共字段：display/position/padding/margin/opacity/textAlign；文本额外：fontSize/fontFamily/fontWeight/fontColor；容器额外：backgroundColor/borderRadius/border/boxShadow/blur |
| iframe 处理 | 同域递归（传入 iframe 坐标偏移）；跨域标记 `info: 'Cross-origin iframe - Access Denied'` |
| 根节点构造 | 生成 `viewport` 根节点，`children` 为 `document.body` 的子元素采集结果 |

**颜色格式**：所有颜色统一转为 `#AARRGGBB`（8 位，前两位 alpha），与 server 侧解析格式对齐。

**输出字段结构**（与现有 case 数据完全一致）：

```json
{
  "id": 1,
  "deviceType": "web",
  "name": "viewport",
  "type": "container",
  "rect": { "w": 1920, "h": 1080, "x": 0, "y": 0 },
  "size": { "w": 1920, "h": 1080, "x": 0, "y": 0 },
  "children": [ /* ... */ ]
}
```

#### 落盘逻辑（`collectWebDom()`）

```
1. 调用 run(url, { collectFn: COLLECT_FN, ...options }) 获取 { domData, screenshotBuffer }
2. 在 process.cwd()/.devlint/ 目录下创建文件
3. 文件名带尺寸+时间戳：web_{w}x{h}_{月日时分秒}.json / .png
4. 返回 { devJsonPath, devImagePath }
```

#### 通道层（`puppeteer.js`）— 双模式

| 模式 | 触发条件 | 行为 | 适用场景 |
|---|---|---|---|
| **launch**（默认） | 不传 `browserWSEndpoint` 且 `useConnect !== true` | puppeteer 自建无头浏览器实例，采集完 `browser.close()` 关闭 | 无登录限制的页面 |
| **connect** | 传了 `browserWSEndpoint` 或 `useConnect === true` | 连接用户已打开的 Chrome，采集完 `browser.disconnect()` 仅断开连接 | 需登录的页面 |

**Chrome 路径查找**（`getChromePath()`，来自 `utils/tools.js`）：
- 优先级：环境变量 `CHROME_PATH` > 跨平台自动查找 > null
- darwin: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- win32: `Program Files` / `Program Files(x86)` / `LOCALAPPDATA` 下的 Chrome
- linux: `/usr/bin/google-chrome` 等常见路径
- 找不到则抛错提示用户配置 `CHROME_PATH`

**connect 模式**：未指定 `browserWSEndpoint` 时自动从 `localhost:9222/json/version` 获取 WebSocket 调试地址。用户需先启动 Chrome：
```
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

**CDP 设备仿真**（`emulateDevice`）：用 Chrome DevTools Protocol 精确控制设备参数（对齐插件行为），关键参数 `mobile: true`（激活独立渲染层，截图边界清晰）、`forceViewport: true`。

**截图**：通过 CDP `Page.captureScreenshot`（`fromSurface: true`），尺寸与 `emulateDevice` 设定的视口 + `deviceScaleFactor` 一致。

### 6.3 `getPixData/` — Pixso 设计侧采集

#### 外网状态（当前）

`getPixData.js` 为占位实现：
- 校验 Chrome 路径是否存在（`getChromePath()`）
- 拼接 `process.cwd()/.devlint/design_{月日时分秒}.json` / `.png` 全路径返回
- **不实际采集**，仅返回路径供流程串联测试

#### 内网状态

内网部署时替换 `getPixData.js` 为真实实现：
- 通过传送码（`code`）或 URL 解析 Pixso 页面地址
- 采集 Pixso 节点树数据 + 截图
- 落盘到 `process.cwd()/.devlint/design_{月日时分秒}.json` / `.png`
- 返回全路径

> `filePath` 参数当前未使用，采集结果统一落盘到 `.devlint/` 目录（与 `collect_web` 一致）。

---

## 七、结果提取（`utils/summary.js`）

### `extractSummary(result)` 的职责

server 返回的完整结果包含大量内部信息（评分、统计、所有节点、匹配对等）。`extractSummary` 将其精简为**以设计侧节点为维度的修改报告**。

### 处理步骤

1. **构建查找映射**
   - `arkuiByPath`：path 字符串 → arkui 节点（用于还原组件层级链）
   - `designByPath`：path 字符串 → design 节点
   - `designRectMap`：design 节点 id → rect（用于排序和定位）

2. **过滤 + 分组**
   - 只取 `severity === 'error'` 的差异（**跳过 warning 模糊比对**）
   - 按 `designNodeId` 分组，每个设计侧节点聚合为一个报告条目

3. **构建组件层级链 `componentChain`**
   - 通过 arkui 节点的 `path` 数组（如 `[0,0,0,0,1,0]`）逐级查找祖先
   - 拼接格式：`Navigation > NavBar > TitleBar > Text("会员中心")`
   - 文本内容超过 15 字符自动截断
   - 帮助开发者快速定位代码位置

4. **排序**
   - 按设计侧节点在画布上的位置排序：y 优先，再 x（从上到下、从左到右）

5. **输出结构**

```json
{
  "platform": "hmPhone",
  "nodes": [
    {
      "designName": "标题文字",
      "devClassName": "Text",
      "textContent": "会员中心",
      "nodeType": "text",
      "designRect": { "x": 24, "y": 60, "w": 120, "h": 28 },
      "componentChain": "Navigation > NavBar > TitleBar > Text(\"会员中心\")",
      "issues": [
        {
          "property": "fontSize",
          "description": "字号",
          "expected": 16,
          "actual": 14
        }
      ]
    }
  ]
}
```

### 设计原则

| 原则 | 说明 |
|---|---|
| 只含 error | 跳过 warning（模糊比对），让 AI 聚焦精准问题 |
| 不含评分 | 不返回 score、匹配覆盖率、检查耗时等统计信息 |
| 不含内部技术信息 | 不暴露节点 ID、原始 path 数组等 |
| 面向开发者 | 提供 componentChain 帮助定位代码，designRect 帮助定位页面位置 |

---

## 八、下游 server 接口

MCP 调用的 server 端接口：`POST /api/check/upload`

### 接口行为

1. 接收 multipart 文件上传（designJson、arkuiJson、designImage、arkuiImage）
2. 解析 platform（从 form 字段读取）
3. 解析 JSON 文件内容
4. 调用 `runCheck()` 执行完整流程：
   - **解析**：`parseDesign()` + `parseArkui()`/`parseWeb()` → UnifiedNode[]
   - **匹配**：`matchNodes()` 多 Pass 算法 → pairs
   - **比对**：`compareAll()` + `compareSpatialRelations()` → diffs
   - **评分**：`score = 100 - penalty*10 - coveragePenalty - lowConfidencePenalty`
5. 返回完整结果（diffs、allDesignNodes、allArkuiNodes、pairs、stats 等）

### runCheck 返回的主要字段（summary.js 依赖的）

| 字段 | 用途 |
|---|---|
| `diffs[]` | 差异列表，含 severity / property / designValue / arkuiValue / designNodeId / arkuiNodeId 等 |
| `allDesignNodes[]` | 所有设计侧节点（含 path、name、textContent） |
| `allArkuiNodes[]` | 所有开发侧节点（含 path、name、textContent） |
| `pairs[]` | 匹配对（含 design.id → design.rect 映射） |
| `platform` | 平台标识 |

---

## 九、完整调用链路

### 场景一：用户提供本地文件

```
用户: "帮我检查这个页面的 UI 还原度"（提供本地 JSON/图片路径）
  │
  ▼
AI(opencode) 调用 MCP 工具 ui_style_check
  │  参数: designJsonPath, devJsonPath, platform, [designImagePath], [devImagePath]
  │
  ▼  (stdio JSON-RPC)
devlint-mcp / server.js handler
  │  1. existsSync 校验文件
  │  2. fileToBlob() 读取文件为 Blob
  │  3. 构建 FormData
  │  4. fetch POST http://localhost:3012/api/check/upload
  │
  ▼  (HTTP multipart)
server / routes/check.js → runCheck()
  │  解析 → 匹配 → 比对 → 评分
  │  返回完整 JSON 结果
  │
  ▼  (HTTP response)
devlint-mcp / utils/summary.js → extractSummary()
  │  过滤 error → 按设计节点分组 → 构建 componentChain → 排序
  │  返回精简摘要 JSON
  │
  ▼  (stdio JSON-RPC response)
AI 拿到摘要，按修改指令格式展示给用户
```

### 场景二：用户提供网页 URL（collect_web → ui_style_check 串联）

```
用户: "采集这个网页并检查 UI 还原度"（提供 URL + 设计稿路径）
  │
  ▼
AI(opencode) 第一步：调用 MCP 工具 collect_web
  │  参数: url, [width], [height], [deviceScaleFactor], [browserWSEndpoint]
  │
  ▼  (stdio JSON-RPC)
devlint-mcp / server.js handler
  │  调用 collectWebDom(url, options)
  │    → puppeteer.run() → launch/Connect 浏览器 → CDP 仿真 → 导航 → 采集 DOM → 截图
  │    → 落盘到 .devlint/web_{w}x{h}_{月日时分秒}.json / .png
  │  返回 { devJsonPath, devImagePath }
  │
  ▼  (stdio JSON-RPC response)
AI 拿到文件路径
  │
  ▼
AI(opencode) 第二步：调用 MCP 工具 ui_style_check
  │  参数: designJsonPath(用户提供), devJsonPath(collect_web返回),
  │         platform: 'web', designImagePath(用户提供), devImagePath(collect_web返回)
  │
  ▼  （后续流程同场景一）
```

### 场景三：用户采集设计稿（collect_design → ui_style_check 串联）

```
用户: "采集这个设计稿"（提供传送码/URL + 开发侧文件路径）
  │
  ▼
AI(opencode) 第一步：调用 MCP 工具 collect_design
  │  参数: code, [url], filePath
  │
  ▼  (stdio JSON-RPC)
devlint-mcp / server.js handler
  │  调用 collectDesign(code, url, filePath)
  │    外网：返回 .devlint/design_{月日时分秒}.json / .png 全路径（占位）
  │    内网：真实采集 Pixso 节点树 + 截图，落盘到 .devlint/
  │  返回 { designJsonPath, designImagePath }
  │
  ▼  (stdio JSON-RPC response)
AI 拿到文件路径
  │
  ▼
AI(opencode) 第二步：调用 MCP 工具 ui_style_check
  │  参数: designJsonPath(collect_design返回), devJsonPath(用户提供),
  │         platform, designImagePath(collect_design返回), devImagePath(用户提供)
  │
  ▼  （后续流程同场景一）
```

---

## 十、关键设计点总结

| 设计点 | 说明 |
|---|---|
| **文件不经 AI 上下文** | MCP 进程内部 `fileToBlob` 读取文件并转 Blob 上传，文件内容不占用 AI token |
| **采集与检查解耦** | `collect_web` / `collect_design` 只负责采集落盘返回路径，`ui_style_check` 只负责读文件检查，两者通过文件路径串联 |
| **通道层与采集逻辑分离** | `puppeteer.js` 管浏览器生命周期，`getWebDom.js` 管采集逻辑，新增采集类型只需写新的采集函数 |
| **公共工具函数复用** | `getChromePath` / `fileToBlob` / `timestamp` 抽到 `utils/tools.js`，被多个模块复用 |
| **双浏览器模式** | launch（无头，自建自毁）适合公开页面；connect（连接已登录 Chrome）适合需登录页面 |
| **只返回 error 级差异** | summary 过滤掉 warning，让 AI 聚焦需精准修改的问题 |
| **内外网切换** | 只改 `config.js` 的 `CHECK_ENV` 常量，代码零改动 |
| **内外网采集逻辑隔离** | `getPixData.js` 外网占位返回路径，内网替换为真实 Pixso 采集实现 |
| **stdio 传输** | 由 opencode 作为子进程启动，通过 stdin/stdout 通信 |
| **组件层级链** | 通过 path 数组还原祖先链，帮开发者定位代码 |
| **画布坐标排序** | 按 y→x 排序，报告顺序与页面视觉顺序一致 |
| **采集文件命名** | web 采集带尺寸+时间戳 `web_{w}x{h}_{月日时分秒}`；设计采集带时间戳 `design_{月日时分秒}` |
| **await 确保 catch 生效** | `collect_design` handler 中 `await collectDesign(...)`，确保内部 throw 被 catch 捕获返回 isError |
