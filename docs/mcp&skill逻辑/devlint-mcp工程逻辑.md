# devlint-mcp 工程逻辑

## 一、工程定位

devlint-mcp 是一个 **MCP（Model Context Protocol）服务器**，作为 AI 编码助手（opencode）与 style_checker server 之间的桥梁。

它提供四类能力，封装为四个 MCP 工具：

| 工具 | 职责 | 输出 |
|---|---|---|
| `collect_arkui` | 启动本地 ArkUI Inspector 采集程序，采集鸿蒙 ArkUI 节点树 + 截图（仅 Windows） | `arkui_<时间戳>.json` + `arkui_<时间戳>.png` 文件路径 |
| `collect_web` | 通过 puppeteer 打开网页，采集 DOM 树结构 + 计算样式 + 截图 | `web_<w>x<h>_<时间戳>.json` + `.png` 文件路径 |
| `collect_design` | 通过传送码/URL 采集 Pixso 设计稿节点树数据 + 截图 | `design_<时间戳>.json` + `.png` 文件路径 |
| `ui_style_check` | 读取本地设计稿/开发侧文件，调用 server 完成检查 | 前 10 个问题节点 preview + 完整报告 md 路径 |

采集工具之间互相独立，任一侧采集中断不阻塞另一侧；采集结果统一落盘到 `.devlint/` 目录，路径直接传给 `ui_style_check` 完成端到端检查。

```
                          ┌─────────────────────────────────────────────────────────────┐
                          │                        devlint-mcp                            │
用户 ──对话──▶ AI(opencode) │                                                              │
                      │    │  ┌─collect_arkui─┐  ┌─collect_web───┐  ┌─collect_design─────┐ │
                      │    │  │ 启动 exe 采集  │  │ puppeteer 采集│  │ Pixso 采集(内网真实)│ │
                      │    │  │ arkui.json/png │  │ web.json/png  │  │ design.json/png     │ │
                      │    │  │ （仅 Windows） │  │               │  │                     │ │
                      │    │  └───────┬───────┘  └───────┬───────┘  └──────────┬──────────┘ │
        stdio JSON-RPC│    │          │                  │                     │            │
                      ▼    │          │         ┌─ui_style_check─┐              │            │
                  devlint-mcp│         └────────▶│ 读文件→multipart│◀────────────┘            │
                          │    │                   │ →HTTP POST server│                       │
                          │    │                   └────────┬─────────┘                       │
                          │    │                            ▼                                  │
                          │    │                      server(3012)                             │
                          │    │                      解析/匹配/比对                           │
                          │    │                            │                                │
                          │    │                      ◀── JSON 结果 ──┘                        │
                          │    │        extractSummary + generateReport                        │
                          └────│── preview(10) + reportPath ◀───────────────────────────────│
                               └─────────────────────────────────────────────────────────────┘
```

**核心价值**：
- 文件内容由 MCP 进程内部读取并转为 multipart 上传，**不经过 AI 上下文**，避免大 JSON 占用 token
- 采集的文件直接落盘到 `.devlint/` 目录，路径回传给 AI，无需 AI 处理文件内容
- 完整差异报告落盘为 md 文件，AI 仅拿前 10 个问题节点的 preview，避免上下文爆炸

---

## 二、目录结构

```
devlint-mcp/
├── index.js                              # 入口：创建 stdio transport 并连接
├── package.json                          # 依赖：@modelcontextprotocol/sdk + puppeteer-core + zod
├── lib/
│   ├── server.js                         # MCP 服务器创建 + 工具注册（核心，4 个工具）
│   ├── config.js                         # 环境配置（常量定义，含 DIR_NAME）
│   ├── utils/                            # 公共工具函数
│   │   ├── tools.js                      # Chrome 路径查找 / fileToBlob / 时间戳 / 登录态克隆
│   │   ├── summary.js                    # 从 server 完整结果中提取精简摘要（返回给 AI）
│   │   └── report.js                     # 生成完整 Markdown 报告（落盘供后续读取）
│   └── collectData/                      # 数据采集模块
│       ├── getArkui/                     # 鸿蒙 ArkUI 开发侧采集
│       │   └── getArkui.js               #   启动 exe + 轮询等待输出 + 移动到 .devlint/
│       ├── getWebDom/                    # Web 开发侧 DOM 采集
│       │   ├── getWebDom.js              #   采集逻辑（浏览器内执行函数 + 落盘）
│       │   └── puppeteer.js              #   puppeteer 通道层（无头/有头双模式 + 登录态克隆 + 登录页降级）
│       └── getPixData/                   # Pixso 设计侧采集
│           └── getPixData.js             #   采集逻辑（外网占位，内网真实实现）
├── script/
│   └── export_arkui.exe                  # ArkUI Inspector 采集程序（collect_arkui 调用，部署时替换）
└── node_modules/
```

技术栈：ESM（`"type": "module"`）、MCP SDK、zod（参数校验）、puppeteer-core（浏览器自动化）。

### `utils/tools.js` — 公共工具函数

| 函数 | 职责 |
|---|---|
| `getChromePath()` | 跨平台查找 Chrome 可执行路径（env `CHROME_PATH` > 自动查找 > null） |
| `fileToBlob(filePath, fallbackType)` | 读取文件为 Blob，按扩展名设置 MIME 类型（.png/.jpg/.json） |
| `timestamp()` | 生成 `月日时分秒` 时间戳，用于采集文件命名 |
| `getChromeUserDataDir()` | 跨平台查找用户日常 Chrome User Data 目录（用于复用登录态） |
| `cloneChromeProfile(srcUserDataDir)` | 复制用户 Chrome profile 的登录态文件（Cookies/Login Data/localStorage/sessionStorage）到临时目录，用副本启动浏览器既复用登录态又不影响日常 Chrome |
| `cleanupTempProfile(dir)` | 清理 cloneChromeProfile 创建的临时 profile 目录 |

> 前三个函数被 `puppeteer.js`、`getWebDom.js`、`getArkui.js`、`server.js` 共同复用；后三个专供 Web 采集的登录态复用机制使用。

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

共注册 4 个工具，注册顺序：`ui_style_check` → `collect_arkui` → `collect_web` → `collect_design`。

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
- 何时触发（用户说"UI 一致性检查""设计稿对比"等关键词时）
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

6. 提取摘要 + 生成完整报告
   extractSummary(result) → 精简摘要（仅 error 级差异，以设计侧节点维度组织）
   generateReport(result) → 完整 Markdown 报告（error + warning，以开发侧节点维度组织）
                           落盘到 process.cwd()/.devlint/octo_uxlint_result.md

7. 返回（控制上下文体积）
   截取 summary.nodes 前 10 个作为 preview
   - nodes > 10 → 追加"共 N 个问题节点，仅展示前 10 个，完整报告见 reportPath"
   - nodes ≤ 10 → 追加"完整报告见 reportPath"
   后续修改代码时，AI 直接读 reportPath 指向的 md 文件获取完整清单
```

### 5.2 `collect_arkui` — 鸿蒙 ArkUI 开发侧数据采集

**参数定义**（zod 校验）：

| 参数 | 必填 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| `timeout` | 否 | number | 60000 | 采集超时时间（ms），从启动采集程序开始计时，超时未检测到导出文件则报错 |

**description** 指导 AI：
- 何时触发（用户说"采集鸿蒙""采集 arkui""采集 hm""采集鸿蒙开发侧数据"等关键词时）
- **平台限制**：只能在 Windows 上执行（依赖 ArkUI Inspector 导出工具），非 Windows 直接失败
- 采集中断不阻塞设计侧采集（见下方「采集中断处理」）
- 输出 `devJsonPath` / `devImagePath`，可直接传给 `ui_style_check`（platform 设为 hmPhone）

**工具执行流程（handler）**：

```
1. 调用 collectArkui({ timeout })
   内部流程（见 6.2 节）：
   a. 平台校验（非 win32 直接 throw）
   b. 定位 script/export_arkui.exe
   c. 快照 script 目录现有 json/图片文件名（区分新旧）
   d. spawn 启动 exe（cmd /c start，等同双击，detached 独立进程）
   e. 轮询等待新 json + 图片文件出现且写入稳定（连续 2 次大小不变）
   f. 重命名为规范名 arkui_<时间戳>.<ext> 后移动到 .devlint/
   g. finally 中 taskkill 关闭 exe 进程（避免残留）

2. 返回
   { devJsonPath, devImagePath } 作为 JSON 返回给 AI
   devImagePath 可能为 null（部分场景无截图）
```

**采集中断处理**（description 中向 AI 强调的设计原则）：
- `collect_arkui` 与 `collect_design` 互相独立，arkui 侧采集中断不阻塞设计侧采集
- 若 `collect_arkui` 返回错误（非 Windows、exe 启动失败、等待文件超时等），仍应继续执行 `collect_design`，然后向用户提供恢复选项
- 用户也可手动提供 `arkui.json` / `arkui.png` 文件路径，跳过 `collect_arkui` 直接调用 `ui_style_check`

### 5.3 `collect_web` — Web 页面数据采集

**参数定义**（zod 校验）：

| 参数 | 必填 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| `url` | 是 | string | — | 目标页面地址 |
| `width` | 否 | number | 1920 | 视口宽度 |
| `height` | 否 | number | 1080 | 视口高度 |
| `deviceScaleFactor` | 否 | number | 2 | 截图质量倍率（1x/2x/3x） |
| `headless` | 否 | boolean | true | 是否无头模式；传 false 直接走有头模式 |

> ⚠️ 参数已从旧的 `browserWSEndpoint`（connect 模式）改为 `headless`（无头/有头模式），不再支持连接已打开 Chrome 的 connect 模式。

**description** 指导 AI：
- 何时触发（用户说"采集网页""采集 web 页面""抓取网页 DOM"等关键词时）
- 采集流程：headless=true（默认）→ 无头模式克隆用户 Chrome profile 复用登录态，失败自动降级有头；headless=false → 直接有头模式弹窗让用户操作
- 采集中断不阻塞设计侧采集（见下方「采集中断处理」）
- 输出 `devJsonPath` / `devImagePath`，可直接传给 `ui_style_check`（platform 设为 web）

**工具执行流程（handler）**：

```
1. 组装采集选项
   viewport: { width, height, deviceScaleFactor }
   headless: params.headless（默认 true）

2. 调用 collectWebDom(url, collectOptions)
   内部走 puppeteer.run() 完整流程（见 6.3 节）

3. 返回
   { devJsonPath, devImagePath } 作为 JSON 返回给 AI
```

**LOGIN_TIMEOUT 错误处理**（handler 中特殊分支）：
- 有头模式等待用户登录超过 120 秒 → 抛出 `err.code === 'LOGIN_TIMEOUT'`
- handler 捕获后返回结构化的恢复选项说明（非普通错误文本），指导 AI：
  - 选项1：重新调用 `collect_web`，在有头窗口中尽快完成登录
  - 选项2：用户手动导出 `web.json` / `web.png`，提供路径直接调用 `ui_style_check`
  - 无论选哪个，都应先继续完成设计侧（`collect_design`）采集

**采集中断处理**：
- `collect_web` 与 `collect_design` 互相独立，web 侧采集中断不阻塞设计侧采集
- 登录超时中断时，提示用户重新调用 `collect_web` 或手动提供文件路径

### 5.4 `collect_design` — 设计侧数据采集

**参数定义**（zod 校验）：

| 参数 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `code` | 否 | string | 传送码，如 "111"，通过传送码服务解析为 Pixso 页面地址 |
| `url` | 否 | string | 设计稿 URL 地址 |
| `filePath` | 是 | string | 当前打开的工程目录地址（必填，但当前采集逻辑未使用，采集结果统一落盘到 `.devlint/`） |

> `code` 和 `url` 至少传一个，同时传时 **code 优先**。

**description** 指导 AI：
- 何时触发（用户说"采集设计稿""采集 Pixso 设计稿""传送码采集"等关键词时）
- 输出 `designJsonPath` / `designImagePath`，可直接传给 `ui_style_check`
- `collect_design → ui_style_check` 是固定串联流程

**工具执行流程（handler）**：

```
1. 参数校验
   code 和 url 至少传一个，否则返回 isError

2. 调用 collectDesign(code, url, filePath)
   外网：返回 devlint/design_<时间戳>.json / .png 的全路径（占位，不实际采集）
   内网：替换 getPixData.js 实现真实 Pixso 采集逻辑

3. 返回
   collectDesign 直接返回 MCP content 格式（{ content: [{ type:'text', text: JSON.stringify({designJsonPath, designImagePath}) }] }）
   handler 用 await 确保内部 throw 被 catch 捕获返回 isError
```

---

## 六、数据采集模块（`collectData/`）

### 6.1 架构：三类采集模块

devlint-mcp 的 `collectData/` 下有三个采集模块，各自独立：

| 模块 | 文件 | 职责 |
|---|---|---|
| **getArkui** | `getArkui.js` | 鸿蒙 ArkUI 采集：启动 exe → 轮询等待输出 → 移动到 .devlint/（仅 Windows） |
| **getWebDom** | `getWebDom.js` + `puppeteer.js` | Web DOM 采集：puppeteer 打开网页 → 注入采集函数 → 截图 |
| **getPixData** | `getPixData.js` | Pixso 设计侧采集：外网占位，内网替换为真实实现 |

Web 采集模块内部进一步分离：

| 文件 | 职责 |
|---|---|
| `puppeteer.js` | **通道层**：浏览器生命周期（无头 launch / 有头 launch）、登录态克隆、CDP 设备仿真、登录页检测 + 有头降级、截图、`page.evaluate` 注入执行 |
| `getWebDom.js` | **采集逻辑**：在浏览器上下文中执行的 `exportDOMTree` 函数 + 结果落盘 |

Web 通道层 `run()` 统一流程：

```
headless=true（默认）
  → launch 无头浏览器（克隆用户 Chrome profile 复用登录态）
  → CDP 设备仿真（emulateDevice）
  → 导航到 URL（page.goto）
  → 等待 URL 重定向稳定（连续 3 秒不变，最多 20 秒）
  → 登录页检测（detectLoginPage：发生重定向 → 判为登录页）
  → 采集 DOM + 截图
  → 失败（导航超时/证书/网络错误/登录页）→ 自动降级有头模式

headless=false 或降级触发
  → launch 有头浏览器（空白 profile，弹窗等用户操作）
  → 导航到 URL（失败不抛错，等用户手动操作）
  → 等待 URL 重定向稳定
  → 若不在目标页面 → 等待用户手动操作（最多 120 秒，超时抛 LOGIN_TIMEOUT）
  → 用户到达目标页面后 → CDP 仿真 → 采集 DOM + 截图
  → 返回 { domData, screenshotBuffer }
```

### 6.2 `getArkui/` — 鸿蒙 ArkUI 采集

#### 采集机制

模拟用户双击 `export_arkui.exe` 的完整过程：

```
1. 平台校验（platform() !== 'win32' → throw）
2. 定位 exe：devlint-mcp/script/export_arkui.exe（路径写死，部署时替换文件即可）
3. 快照 script 目录现有 json/图片文件名（区分新旧，避免误移历史文件）
4. spawn 启动 exe
   - 通过 cmd /c start 启动（等同双击，提供完整 shell 上下文）
   - detached 独立进程，cmd 立即退出，exe 成为独立进程
   - child.pid 仅指向 cmd，进程清理改为按映像名 taskkill
5. 轮询等待新文件出现且写入稳定
   - 每秒扫描 script 目录，对比快照找出新增的 .json / .png / .jpg
   - 文件大小连续 2 次不变（STABLE_THRESHOLD）才视为写入完成，避免读到半成品
   - json 和图片各自独立判定稳定性，两个都稳定 → 完成
   - 超时：json 必须有，图片可选（部分场景无截图）
6. 移动文件到 .devlint/ 目录
   - 重命名为规范名：arkui_<时间戳>.json / arkui_<时间戳>.<ext>
   - renameSync 失败时降级为 cpSync + rmSync（应对跨盘符场景）
7. finally：taskkill /IM export_arkui.exe /F 关闭 exe 进程（无论成功/超时/失败）
```

#### 关键常量

| 常量 | 值 | 说明 |
|---|---|---|
| `DEFAULT_TIMEOUT` | 60000 | 默认采集超时 60 秒 |
| `POLL_INTERVAL` | 1000 | 轮询间隔 1 秒 |
| `STABLE_THRESHOLD` | 2 | 文件大小连续稳定次数阈值（判定写入完成） |
| `IMAGE_EXTS` | .png/.jpg/.jpeg | 支持的图片扩展名 |

#### 启动失败竞争

exe 启动失败（文件损坏/无权限）时 `child.on('error')` 会触发，与文件轮询形成竞争：

```js
const exeError = new Promise((_, reject) => {
  child.on('error', err => reject(new Error(`采集程序启动失败: ${err.message}`)))
})
const output = await Promise.race([waitForOutput(existing, timeout), exeError])
```

### 6.3 `getWebDom/` — Web DOM 采集

#### 采集逻辑（`getWebDom.js` → `exportDOMTree`）

采集逻辑迁移自 **Octo-DomExport 谷歌插件** 的 `mainExportInContent` + `getElementData` 函数，适配 puppeteer `page.evaluate` 执行环境（去掉 Blob 下载，直接 return 数据）。

| 步骤 | 说明 |
|---|---|
| DPI 修正 | 创建测试元素测量 1px border 实际渲染值，计算 `fixRatio` 修正系统 DPR 缩放导致的像素偏差 |
| 递归遍历 | `getElementData(node, offsetX, offsetY)` 递归遍历 DOM 树 |
| 过滤隐藏元素 | `display:none` / `visibility:hidden` → 跳过 |
| 可视区域判断 | 元素与视口相交才采集（`rect.bottom >= 0 && rect.top <= vHeight` 等），body 不受此限制 |
| 文本/容器判定 | 有直接文本子节点（`textContent.length > 0`）→ `type: 'text'`；否则 → `type: tagName` |
| 样式提取 | 公共字段：display/position/padding/margin/opacity/textAlign/backgroundColor/borderRadius/borderWidth/borderStyle/borderColor/boxShadow/textShadow；有 filter/backdropFilter → blur；文本额外：content/fontSize/fontFamily/fontWeight/fontColor |
| iframe 处理 | 同域递归（传入 iframe 坐标偏移）；跨域标记 `info: 'Cross-origin iframe - Access Denied'` |
| 根节点构造 | 生成 `viewport` 根节点（id=3），`children` 为 `document.body` 的采集结果（id 从 5 递增） |

**颜色格式**：所有颜色统一转为 `#AARRGGBB`（8 位，前两位 alpha），与 server 侧解析格式对齐。borderColor 在 borderWidth 为 0 时不采集。

**输出字段结构**（与现有 case 数据完全一致）：

```json
{
  "id": 3,
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
1. 调用 run(url, { collectFn: exportDOMTree, ...options }) 获取 { domData, screenshotBuffer }
2. 在 process.cwd()/.devlint/ 目录下创建文件
3. 文件名带尺寸+时间戳：web_{w}x{h}_{月日时分秒}.json / .png
4. 返回 { devJsonPath, devImagePath }
```

#### 通道层（`puppeteer.js`）— 无头/有头双模式 + 登录态克隆 + 登录页降级

**核心函数**：

| 函数 | 职责 |
|---|---|
| `launch(options)` | 启动浏览器；默认无头模式克隆用户 Chrome profile（`cloneChromeProfile` 复制 Cookies/Login Data/Local Storage/Session Storage），找不到 profile 退化为空白 profile |
| `openPage(browser, url, options)` | 新建页面 + 设置视口 + 导航 |
| `emulateDevice(page, options)` | CDP `Emulation.setDeviceMetricsOverride`（`mobile:true`/`forceViewport:true`/`dontSetVisibleSize:false`），返回 CDP session |
| `evalInPage(page, fn, ...args)` | `page.evaluate` 注入采集函数 |
| `screenshot(client)` | CDP `Page.captureScreenshot`（`fromSurface:true`/`captureBeyondViewport:false`），返回 PNG Buffer |
| `close(browser, tempProfileDir)` | `browser.close()` + `cleanupTempProfile` 清理临时 profile |
| `detectLoginPage(page, originalUrl)` | 检测是否被重定向到登录页（origin 或 pathname 变化即判为登录页） |
| `runHeadedWithProfile(url, options)` | 有头模式降级方案 |
| `run(url, options)` | 通道层入口，统一调度无头/有头 |

**双模式对比**：

| 模式 | 触发条件 | 行为 | 适用场景 |
|---|---|---|---|
| **无头**（默认） | `headless=true`（默认） | 克隆用户 Chrome profile 复用登录态，无头采集；失败（导航超时/证书/网络错误/检测到登录页）自动降级有头 | 公开页面或已克隆登录态的需登录页面 |
| **有头** | `headless=false` 或无头降级触发 | 空白 profile 弹出浏览器窗口，用户手动操作（登录/跳过证书）后自动采集；超时 120 秒抛 `LOGIN_TIMEOUT` | 无头采集失败、需用户手动登录的页面 |

**登录态克隆机制**（`cloneChromeProfile`）：
- 复制用户日常 Chrome 的 Default profile 登录态文件到临时目录
- 单文件：`Local State`（根级）、`Cookies`/`Login Data`/`Login Data For Account`/`Web Data`/`Preferences`/`History`（Default 级）
- 目录（递归复制）：`Local Storage`（localStorage LevelDB）、`Session Storage`（sessionStorage LevelDB）
- 不复制 IndexedDB（可能几 GB，性能开销大，鉴权场景极少依赖）
- 用副本启动浏览器，既复用登录态又不影响用户日常 Chrome，采集完 `cleanupTempProfile` 清理

**URL 重定向稳定等待**（无头和有头模式共用）：
- 导航后轮询 `page.url()`，连续 3 秒不变才算稳定，最多等 20 秒
- 等待期间允许页面完成客户端重定向（如登录后跳转）

**有头模式用户操作等待**：
- URL 稳定后若仍不在目标页面（被重定向到登录页/证书页等），进入用户操作等待
- 每 2 秒检查一次，连续 3 次（6 秒）URL 都和目标一致才算用户操作完成
- 超时 `HEADED_LOGIN_TIMEOUT`（120 秒）抛 `err.code = 'LOGIN_TIMEOUT'`，由 handler 捕获返回结构化恢复选项

**Chrome 路径查找**（`getChromePath()`，来自 `utils/tools.js`）：
- 优先级：环境变量 `CHROME_PATH` > 跨平台自动查找 > null
- darwin: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- win32: `Program Files` / `Program Files(x86)` / `LOCALAPPDATA` 下的 Chrome
- linux: `/usr/bin/google-chrome` 等常见路径
- 找不到则抛错提示用户配置 `CHROME_PATH`

**关键常量**：

| 常量 | 值 | 说明 |
|---|---|---|
| `DEFAULT_VIEWPORT` | 1920×1080, dpr=2 | 默认视口尺寸 + 截图倍率 |
| `DEFAULT_RENDER_WAIT` | 8000 | 默认渲染等待时间（ms） |
| `HEADED_LOGIN_TIMEOUT` | 120000 | 有头模式等待用户操作最大时长（ms） |

### 6.4 `getPixData/` — Pixso 设计侧采集

#### 外网状态（当前）

`getPixData.js` 为占位实现：
- 校验 Chrome 路径是否存在（`getChromePath()`）
- 拼接 `process.cwd()/devlint/design_<时间戳>.json` / `.png` 路径返回
- **不实际采集**，仅返回路径供流程串联测试
- 返回 MCP content 格式（`{ content: [{ type:'text', text: JSON.stringify({designJsonPath, designImagePath}) }] }`），由 handler 直接 return

> ⚠️ 注意：外网占位代码中路径用的是 `./devlint/`（无点前缀），与 config.DIR_NAME (`.devlint`) 及其他模块的落盘目录不一致，属待修问题。内网替换时应统一使用 `join(process.cwd(), config.DIR_NAME)`。

#### 内网状态

内网部署时替换 `getPixData.js` 为真实实现：
- 通过传送码（`code`）或 URL 解析 Pixso 页面地址
- 采集 Pixso 节点树数据 + 截图
- 落盘到 `process.cwd()/.devlint/design_<时间戳>.json` / `.png`
- 返回全路径

> `filePath` 参数当前未使用，采集结果统一落盘到 `.devlint/` 目录（与 `collect_web` 一致）。

---

## 七、结果提取（`utils/summary.js` + `utils/report.js`）

server 返回的完整结果包含大量内部信息（评分、统计、所有节点、匹配对等）。devlint-mcp 用两个模块分别处理：

| 模块 | 输出 | 维度 | 范围 | 用途 |
|---|---|---|---|---|
| `summary.js` → `extractSummary()` | JSON（返回给 AI） | **设计侧节点** | 仅 error | AI 上下文中的 preview |
| `report.js` → `generateReport()` | Markdown（落盘） | **开发侧节点** | error + warning | 完整报告供后续读取 |

### 7.1 `extractSummary(result)` — 精简摘要（返回给 AI）

#### 处理步骤

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
      "nodeName": "会员中心",
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

> `nodeName` = `textContent || arkuiName`（文本节点用文本内容，非文本节点用组件名）。

#### 设计原则

| 原则 | 说明 |
|---|---|
| 只含 error | 跳过 warning（模糊比对），让 AI 聚焦精准问题 |
| 不含评分 | 不返回 score、匹配覆盖率、检查耗时等统计信息 |
| 不含内部技术信息 | 不暴露节点 ID、原始 path 数组等 |
| 面向开发者 | 提供 componentChain 帮助定位代码，designRect 帮助定位页面位置 |

### 7.2 `generateReport(result, dir)` — 完整 Markdown 报告（落盘）

#### 职责

生成完整 Markdown 报告，写入 `process.cwd()/.devlint/octo_uxlint_result.md`，供 AI 后续读取完整问题清单（`ui_style_check` 返回的 reportPath 指向此文件）。

#### 与 extractSummary 的差异

| 差异点 | extractSummary | generateReport |
|---|---|---|
| 分组维度 | 设计侧节点（`designNodeId`） | **开发侧节点**（`arkuiNodeId`） |
| 差异范围 | 仅 error | **error + warning** |
| 输出格式 | JSON 对象 | Markdown 文件 |
| 位置描述 | 仅 `designRect` 坐标 | 语义化位置描述（"页面顶部（左侧），坐标 (24,60)，尺寸 120×28"） |
| 修改建议 | 无 | 每条差异附带修改建议（"将 fontSize 从 14 改为 16"） |
| 排序基准 | 设计侧节点 rect | 开发侧节点 rect |

> 以开发侧节点为维度：因为修改的是开发代码，以开发侧节点为主维度更便于定位代码。

#### 处理步骤

1. **构建查找映射**：`arkuiByPath`（path → node）、`arkuiById`（id → node）、`designRectMap`（design id → rect）
2. **分组**：按 `arkuiNodeId` 分组，每个开发侧节点聚合为一个报告条目
3. **构建 componentChain**（同 extractSummary 逻辑）
4. **位置描述** `describePosition(rect)`：y < 100 → "页面顶部"；y > 600 → "页面底部"；x < 100 → "左侧"；x+w > 1820 → "右侧"
5. **排序**：按开发侧节点 rect 的 y→x 排序
6. **统计**：error 数、warning 数
7. **生成 Markdown**：报告头（平台/问题节点数/差异项总数/生成时间）→ 逐节点表格（属性/描述/设计值/开发值/修改建议）
8. **落盘**：`writeFileSync` 写入 `.devlint/octo_uxlint_result.md`，返回路径

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

### runCheck 返回的主要字段（summary.js + report.js 依赖的）

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
用户: "帮我检查这个页面的 UI 一致性"（提供本地 JSON/图片路径）
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
devlint-mcp
  │  extractSummary(result) → 精简摘要（仅 error，设计侧节点维度）
  │  generateReport(result) → 完整 md 报告（error+warning，开发侧节点维度）→ 落盘
  │  截取前 10 个节点作为 preview + reportPath
  │
  ▼  (stdio JSON-RPC response)
AI 拿到 preview(10) + reportPath，按修改指令格式展示给用户
  │  后续修改代码时直接读 reportPath 指向的 md 文件
```

### 场景二：鸿蒙 ArkUI 采集（collect_arkui → ui_style_check 串联）

```
用户: "采集鸿蒙页面并检查 UI 一致性"（在 Windows 环境，提供设计稿路径）
  │
  ▼
AI(opencode) 第一步：调用 MCP 工具 collect_arkui
  │  参数: [timeout]
  │
  ▼  (stdio JSON-RPC)
devlint-mcp / server.js handler
  │  调用 collectArkui({ timeout })
  │    → 平台校验（win32）→ 定位 exe → 快照目录 → spawn 启动 exe
  │    → 轮询等待 arkui.json + 图片出现且稳定 → 移动到 .devlint/
  │    → finally: taskkill 关闭 exe
  │    → 落盘到 .devlint/arkui_<时间戳>.json / .png
  │  返回 { devJsonPath, devImagePath }
  │
  ▼  (stdio JSON-RPC response)
AI 拿到文件路径
  │
  ▼
AI(opencode) 第二步：调用 MCP 工具 ui_style_check
  │  参数: designJsonPath(用户提供), devJsonPath(collect_arkui返回),
  │         platform: 'hmPhone', designImagePath(用户提供), devImagePath(collect_arkui返回)
  │
  ▼  （后续流程同场景一）
```

> 非 Windows 环境 collect_arkui 直接失败，提示用户手动导出 arkui.json/arkui.png 提供路径。

### 场景三：Web 网页采集（collect_web → ui_style_check 串联）

```
用户: "采集这个网页并检查 UI 一致性"（提供 URL + 设计稿路径）
  │
  ▼
AI(opencode) 第一步：调用 MCP 工具 collect_web
  │  参数: url, [width], [height], [deviceScaleFactor], [headless]
  │
  ▼  (stdio JSON-RPC)
devlint-mcp / server.js handler
  │  调用 collectWebDom(url, options)
  │    → puppeteer.run()
  │      headless=true（默认）: 克隆 Chrome profile → 无头导航 → 登录页检测
  │        失败/登录页 → 自动降级有头模式（弹窗等用户操作，最多 120 秒）
  │      headless=false: 直接有头模式
  │    → CDP 仿真 → 采集 DOM → 截图
  │    → 落盘到 .devlint/web_{w}x{h}_{时间戳}.json / .png
  │  返回 { devJsonPath, devImagePath }
  │  （若 LOGIN_TIMEOUT → 返回结构化恢复选项，非普通错误）
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

### 场景四：设计稿采集（collect_design → ui_style_check 串联）

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
  │    外网：返回 devlint/design_<时间戳>.json / .png 路径（占位）
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

### 采集中断恢复流程

当 `collect_arkui` 或 `collect_web` 采集中断时，AI 不应停止整个流程：

```
用户: "采集网页和设计稿并检查"
  │
  ▼
AI 并行/串行调用 collect_web + collect_design（两者互相独立）
  │
  ├─ collect_web 失败（LOGIN_TIMEOUT / 网络错误等）
  │    → 不阻塞 collect_design，继续执行设计侧采集
  │    → collect_design 成功后，向用户提供恢复选项：
  │       选项1: 重新调用 collect_web（有头窗口中完成登录）
  │       选项2: 用户手动导出 web.json/web.png 提供路径
  │
  └─ collect_design 成功
  │
  ▼
用户补齐 web 侧数据后 → 调用 ui_style_check 完成检查
```

---

## 十、关键设计点总结

| 设计点 | 说明 |
|---|---|
| **四工具架构** | `collect_arkui` / `collect_web` / `collect_design` 三个采集工具 + `ui_style_check` 检查工具，采集结果通过文件路径串联 |
| **文件不经 AI 上下文** | MCP 进程内部 `fileToBlob` 读取文件并转 Blob 上传，文件内容不占用 AI token |
| **采集与检查解耦** | 采集工具只负责采集落盘返回路径，`ui_style_check` 只负责读文件检查，通过文件路径串联 |
| **采集工具互相独立** | `collect_arkui` / `collect_web` / `collect_design` 互相独立，任一侧中断不阻塞其他侧采集 |
| **通道层与采集逻辑分离** | `puppeteer.js` 管浏览器生命周期，`getWebDom.js` 管采集逻辑，新增采集类型只需写新的采集函数 |
| **公共工具函数复用** | `getChromePath` / `fileToBlob` / `timestamp` / `cloneChromeProfile` 等抽到 `utils/tools.js`，被多个模块复用 |
| **无头/有头双模式 + 登录态克隆** | 无头模式默认克隆用户 Chrome profile（Cookies/localStorage/sessionStorage）复用登录态；失败/登录页自动降级有头模式弹窗等用户操作 |
| **LOGIN_TIMEOUT 错误处理** | 有头模式等待用户登录超时（120 秒）返回结构化恢复选项，指导 AI 提供重新采集/手动提供文件两种选择 |
| **preview + 完整报告落盘** | `extractSummary` 截取前 10 个 error 节点返回 AI（控制上下文），`generateReport` 生成完整 md（error+warning）落盘供后续读取 |
| **双维度报告** | summary 以设计侧节点维度（仅 error），report 以开发侧节点维度（error+warning），分别服务 AI 展示和代码修改 |
| **只返回 error 级差异（preview）** | summary 过滤掉 warning，让 AI 聚焦需精准修改的问题；完整 warning 见 reportPath |
| **exe 进程管理** | ArkUI 采集通过 `cmd /c start` 启动 exe（detached 独立进程），finally 中 `taskkill /IM` 按映像名关闭，避免残留 |
| **文件稳定性判定** | ArkUI 采集轮询时连续 2 次大小不变才视为写入完成，避免读到半成品文件 |
| **内外网切换** | 只改 `config.js` 的 `CHECK_ENV` 常量，代码零改动 |
| **内外网采集逻辑隔离** | `getPixData.js` 外网占位返回路径，内网替换为真实 Pixso 采集实现 |
| **stdio 传输** | 由 opencode 作为子进程启动，通过 stdin/stdout 通信 |
| **组件层级链** | 通过 path 数组还原祖先链，帮开发者定位代码 |
| **画布坐标排序** | 按 y→x 排序，报告顺序与页面视觉顺序一致 |
| **采集文件命名** | arkui 采集 `arkui_<时间戳>`；web 采集 `web_{w}x{h}_{时间戳}`；设计采集 `design_<时间戳>` |
| **await 确保 catch 生效** | `collect_design` handler 中 `await collectDesign(...)`，确保内部 throw 被 catch 捕获返回 isError |
