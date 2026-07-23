# devlint-mcp 工程逻辑

## 一、工程定位

devlint-mcp 是一个 **MCP（Model Context Protocol）服务器**，作为 AI 编码助手（opencode）与 style_checker server 之间的桥梁。

它将「UI 还原度检查」能力封装为一个 MCP 工具 `ui_style_check`，让 AI 能直接读取本地设计稿/开发侧文件、调用 server 完成检查，并拿到精简后的差异报告返回给用户。

```
用户 ──对话──▶ AI(opencode) ──stdio──▶ devlint-mcp ──HTTP──▶ server(3012) ──▶ 解析/匹配/比对
                     ▲                      │
                     └──── JSON 摘要 ◀──────┘
```

**核心价值**：文件内容由 MCP 进程内部读取并转为 multipart 上传，**不经过 AI 上下文**，避免大 JSON 占用 token。

---

## 二、目录结构

```
devlint-mcp/
├── index.js          # 入口：创建 stdio transport 并连接
├── package.json      # 依赖：@modelcontextprotocol/sdk + zod
├── config.json       # 内外网环境配置（outer / inner）
├── lib/
│   ├── server.js     # MCP 服务器创建 + 工具注册（核心）
│   ├── config.js     # 读取 config.json，导出环境配置
│   └── summary.js    # 从 server 完整结果中提取精简摘要
└── node_modules/
```

技术栈：ESM（`"type": "module"`）、MCP SDK、zod（参数校验）。

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

### `config.json` — 内外网双环境

```json
{
  "env": "outer",
  "outer": { "checkServerUrl": "http://localhost:3012/api" },
  "inner": { "checkServerUrl": "http://xxx.aaa.com/devlint/api" }
}
```

### `config.js` — 配置读取

- 读取 `config.json`，根据 `env` 字段选择对应配置块
- 导出 `{ env, checkServerUrl }`
- 切换内外网只需改 `env` 字段值（`outer` ↔ `inner`）
- `checkServerUrl` 对应 server 端的 API 基地址，fetch 时拼接 `/check/upload`

---

## 五、工具注册（`server.js`）

### 注册的工具：`ui_style_check`

**参数定义**（zod 校验）：

| 参数 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `designJsonPath` | 是 | string | 设计稿 JSON 文件路径（Figma/Pixso 导出的 data 结构） |
| `devJsonPath` | 是 | string | 开发侧 JSON 文件路径（arkui.json / web.json） |
| `platform` | 否 | enum | `hmPhone`（默认）/ `hmWatch` / `web` |
| `designImagePath` | 否 | string | 设计稿截图路径（png/jpg） |
| `devImagePath` | 否 | string | 开发侧截图路径（png/jpg） |

**description**：一大段中文说明，指导 AI：
- 何时触发（用户说"UI 还原度检查""设计稿对比"等关键词时）
- 参数含义
- 输出格式（以设计侧节点为维度，每个节点含 issues 列表）
- 输出指引（如何把结果格式化为修改指令展示给用户）

### 工具执行流程（handler）

```
1. 校验文件存在
   遍历所有传入路径，existsSync 检查，不存在则返回 isError

2. 读取文件为 Blob
   fileToBlob() 根据扩展名设置 MIME 类型：
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
   POST `${checkServerUrl}/check/upload`
   → http://localhost:3012/api/check/upload（外网）

5. 处理响应
   res.json() 拿到 server 完整 runCheck 结果

6. 提取摘要
   extractSummary(result) 精简为面向开发者的差异报告

7. 返回
   JSON.stringify(summary) 作为 text content 返回给 AI
```

---

## 六、结果提取（`summary.js`）

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

## 七、下游 server 接口

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

## 八、完整调用链路

```
用户: "帮我检查这个页面的 UI 还原度"
  │
  ▼
AI(opencode) 识别意图，调用 MCP 工具 ui_style_check
  │  参数: designJsonPath, devJsonPath, platform, [designImagePath], [devImagePath]
  │
  ▼  (stdio JSON-RPC)
devlint-mcp / server.js handler
  │  1. existsSync 校验文件
  │  2. readFileSync → Blob
  │  3. 构建 FormData
  │  4. fetch POST http://localhost:3012/api/check/upload
  │
  ▼  (HTTP multipart)
server / routes/check.js → runCheck()
  │  解析 → 匹配 → 比对 → 评分
  │  返回完整 JSON 结果
  │
  ▼  (HTTP response)
devlint-mcp / summary.js → extractSummary()
  │  过滤 error → 按设计节点分组 → 构建 componentChain → 排序
  │  返回精简摘要 JSON
  │
  ▼  (stdio JSON-RPC response)
AI 拿到摘要，按修改指令格式展示给用户
```

---

## 九、关键设计点总结

| 设计点 | 说明 |
|---|---|
| **文件不经 AI 上下文** | MCP 进程内部 `readFileSync` 读取文件并转 Blob 上传，文件内容不占用 AI token |
| **只返回 error 级差异** | summary 过滤掉 warning，让 AI 聚焦需精准修改的问题 |
| **内外网切换** | 只改 `config.json` 的 `env` 字段，代码零改动 |
| **stdio 传输** | 由 opencode 作为子进程启动，通过 stdin/stdout 通信 |
| **组件层级链** | 通过 path 数组还原祖先链，帮开发者定位代码 |
| **画布坐标排序** | 按 y→x 排序，报告顺序与页面视觉顺序一致 |
