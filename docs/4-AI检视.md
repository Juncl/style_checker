# AI 检视

> 实验功能：当前 AI 检视为实验性功能，不影响主流程。

通过 server 代理调用大模型 VLM API，对设计稿与开发实现截图进行视觉样式差异分析。API Key 不暴露给前端。

> 前端实现详情见 [docs/前端逻辑/AI图图对比.md](前端逻辑/AI图图对比.md)

---

## 架构

```
Server (3012)                              VLM API
POST /api/img/checker  ──→  注入系统 Prompt →  POST VLM_API_URL
              toGLMMessages() 格式转换（仅外网）
              透传 SSE 流 ───────────────────────→ 响应流式返回
```

- API Key 存储在 `server/src/config/constants.js`（`VLM_CONFIG`）
- 流式（SSE）和非流式均支持；AI 检视功能固定使用流式
- 系统 Prompt **有图片时注入**，纯文字追问（无图）直接透传，不注入 Prompt
- VLM 模型由 `VLM_CONFIG[DEV_ENV].model` 决定

---

## 系统 Prompt（`server/src/AIChecker/systemPrompts.js`）

常量名：`IMG_CHECKER_SYSTEM_PROMPT`

**角色定位**：资深 UI 设计师 + 设计还原检查引擎。站在设计师视角审视开发实现，逐元素找出还原差异，针对每处差异明确告诉开发"设计要什么、你做成了什么、该改成什么"。

### 工作流程（Prompt 要求 VLM 模拟）

1. **全量元素扫描**：分别枚举两张图的所有可见元素（文本/图标/图片/按钮/容器/分割线/背景块等）
2. **节点匹配**：文本优先（内容+位置）→ 容器/图标其次（位置+尺寸+形状）→ 拓扑兜底
3. **逐属性样式比对**：仅对匹配对做属性差异比对

### 比对属性集合

| 类别 | 属性 | `property` 枚举值 |
|---|---|---|
| 文本类 | 字号 | `fontSize` |
| 文本类 | 字重 | `fontWeight` |
| 文本类 | 字色 | `fontColor` |
| 容器/视觉类 | 填充 | `backgroundColor` |
| 容器/视觉类 | 圆角 | `borderRadius` |
| 容器/视觉类 | 描边颜色 | `borderColor` |
| 容器/视觉类 | 描边宽度 | `borderWidth` |
| 容器/视觉类 | 不透明度 | `opacity` |
| 容器/视觉类 | 模糊 | `blur` |
| 容器/视觉类 | 阴影 | `shadow` |
| 布局类 | 内边距 | `padding` |
| 布局类 | 间距 | `itemSpacing` |

**不比对**：文本内容、行高、字间距、对齐方式、字体类型。

### 差异分级规则（与算法对齐）

- **基本零容差**：任何肉眼可辨的差异都要报，不因"差得不多"放过。
- **明显 vs 轻微只看匹配置信度，不看差异大小**：
  - 有把握是同一元素（内容相同、位置吻合）→ **明显差异**（`severity=error`）
  - 靠位置/拓扑兜底猜配、不确定 → **轻微差异**（`severity=warning`）

### 输出格式（Markdown 表格）

```markdown
## 总体还原度
**[高 / 中 / 低]**（还原度评分：NN/100）

## 元素匹配概览
| 设计稿元素 | 实现元素 | 匹配对 | 缺失 | 多余 |
|---|---|---|---|---|
| 数字 | 数字 | 数字 | 数字 | 数字 |

## 全量差异清单

### 🔴 明显差异
| # | 元素 | 属性 | 设计侧 | 开发做成 | 修改建议 |
|---|---|---|---|---|---|
| 1 | 元素描述（文字用『』括起） | 属性标签 | 设计要的值 | 开发实现的值 | 简短目标值/动作 |

### 🟡 轻微差异
| # | 元素 | 属性 | 设计侧 | 开发做成 | 修改建议 |
|---|---|---|---|---|---|

### ⚪ 缺失 / 多余元素
| # | 类型 | 元素 | 位置 | 说明 |
|---|---|---|---|---|---|
```

**"修改建议"列约束**：只给最终正确答案，简短目标值或动作（如"改为 18px""改为 #0067D1""圆角统一为 8px""去掉模糊"），禁止整句长分析或解释原因。

---

## 后台处理逻辑

文件：`server/src/routes/check.js`、`server/src/AIChecker/imgCheck.js`

```
POST /api/img/checker
  ↓
handleImgCheck({ model, messages, stream, ...rest })
  ├─ 有图片时 → 注入系统 Prompt：
  │    messages 头部插入 { role: 'system', content: [{ type: 'text', text: IMG_CHECKER_SYSTEM_PROMPT }] }
  │    纯文字追问（无图片）→ 不注入 Prompt，直接透传
  ├─ toGLMMessages()（仅 DEV_ENV === 'OUT' 时）：转换 content 格式适配 GLM
  │    system content 转为纯字符串；input_text → text；image_url 展开
  └─ callAI({ model, messages, stream })：axios POST 到 VLM_API_URL，Bearer token 鉴权
  ↓
stream 模式：
  result（axios stream）直接 pipe(res)，实时透传 SSE 帧给调用方
  ↓
（流结束，无后处理）
```

### 请求中断

路由层通过 `AbortController` 监听客户端断开（`req.on('close')`）：
- 调用方断开连接时，终止对 VLM API 的调用并销毁 stream
- 防止已断开连接的请求继续消耗 token

### 关键函数

| 函数 | 位置 | 职责 |
|---|---|---|
| `handleImgCheck()` | `server/src/AIChecker/imgCheck.js` | 注入 Prompt、格式转换、调用 VLM |
| `messagesHaveImage()` | `server/src/AIChecker/imgCheck.js` | 检测 messages 中是否有图片，决定是否注入 Prompt |
| `callAI()` | `server/src/AIChecker/imgCheck.js` | axios HTTP 请求，Bearer token 鉴权 |
| `toGLMMessages()` | `server/src/AIChecker/imgCheck.js` | 外网环境 messages 格式转换（input_text→text，image_url 展开，system→纯字符串） |
| `markdownToDiffReport()` | `server/src/AIChecker/imgCheck.js` | Markdown 报告 → diff JSON（已实现，暂未接入路由） |
| `IMG_CHECKER_SYSTEM_PROMPT` | `server/src/AIChecker/systemPrompts.js` | 系统 Prompt 常量 |

---

## `markdownToDiffReport(markdown)` 说明

把 VLM 输出的 Markdown 报告解析为与 server 算法（`routes/check.js` 的 diffs 结构）一致的 JSON，供后续接入 diff 报告栏使用。

**返回结构：**
```js
{
  markdown: string,          // 去掉 <think> 后的干净文本
  overallLevel: '高'|'中'|'低'|null,
  score: number|null,        // 还原度评分
  stats: {
    designNodes, arkuiNodes, matchedPairs,
    unmatchedDesign, unmatchedArkui,
    errorCount, warningCount, infoCount, score
  },
  diffs: [
    {
      property: 'fontSize'|'fontWeight'|..., // 中文标签 → property key
      designValue: string,    // 设计侧值
      arkuiValue: string,     // 开发做成的值
      severity: 'error'|'warning',  // 明显→error，轻微→warning
      suggestion: string,     // 简短修改建议（目标值/动作）
      description: string,    // 同 suggestion（兼容 diff 报告 description 字段）
      nodeType: null,
      textContent: string|null,  // 从『』中提取的文本内容
      designName: string,     // 元素描述（设计侧）
      arkuiName: string,      // 元素描述（开发侧）
      matchType: 'ai-visual',
      confidence: 'high'|'low',  // error→high，warning→low
      iou: null,
      topologyScore: null,
      regionScore: null,
      source: 'ai',
    }
  ],
  unmatchedDesignNodes: [{ id:null, name, type:null, textContent, rect:null }],  // 缺失
  unmatchedArkuiNodes:  [{ id:null, name, type:null, textContent, rect:null }],  // 多余
}
```

**属性标签映射表（中文 → property key）：**

| 中文标签（允许的变体） | property |
|---|---|
| 字号 | `fontSize` |
| 字重 | `fontWeight` |
| 字色 / 字体颜色 | `fontColor` |
| 填充 / 填充色 / 背景 / 背景色 | `backgroundColor` |
| 圆角 | `borderRadius` |
| 描边颜色 / 描边色 | `borderColor` |
| 描边宽度 / 描边 | `borderWidth` |
| 不透明度 / 透明度 | `opacity` |
| 模糊 | `blur` |
| 阴影 / 投影 | `shadow` |
| 内边距 | `padding` |
| 间距 | `itemSpacing` |

不在上表中的属性标签会被忽略（不进入 diffs 数组）。

---

## 接口说明

### `POST /api/img/checker`

路由：`check.js` 中 `router.post('/img/checker', ...)`，挂载在 `/api` 下。

**请求体（JSON）：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | 否 | VLM 模型代号，默认从 `VLM_CONFIG[DEV_ENV].model` 取 |
| `messages` | array | 是 | 对话消息列表 |
| `stream` | boolean | 否 | 是否流式输出（SSE），AI 检视固定传 `true` |
| 其他参数 | — | 否 | `temperature`、`top_p`、`max_tokens` 等，透传给 VLM |

**请求消息格式示例：**

```json
[
  {
    "role": "user",
    "content": [
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } },
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } },
      { "type": "input_text", "text": "补充说明或留空" }
    ]
  }
]
```

### 后台处理后的消息格式

后台有图片时会注入系统 Prompt：

```json
[
  {
    "role": "system",
    "content": [{ "type": "text", "text": "你是一个资深的UI设计师..." }]
  },
  {
    "role": "user",
    "content": [
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } },
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } },
      { "type": "input_text", "text": "补充说明或留空" }
    ]
  }
]
```

外网（`DEV_ENV === 'OUT'`）时，`toGLMMessages()` 将 `input_text` 转为 `text`，`image_url` 展开为 GLM 标准格式，`system` content 转为纯字符串。

### 流式响应帧

| 帧内容 | 触发时机 | 说明 |
|---|---|---|
| `{"choices":[{"delta":{"reasoning_content":"..."}}]}` | 模型推理时 | 独立思考字段 |
| `{"choices":[{"delta":{"reasoning":"..."}}]}` | 模型推理时 | 备选思考字段名 |
| `{"choices":[{"delta":{"content":"..."}}]}` | 逐字生成时 | Markdown 正文帧（可能含 `<think>` 标签） |
| `data: [DONE]` | AI 输出完毕 | 标准结束标志 |

`delta` 中可能同时出现 `reasoning_content` 和 `reasoning` 两种字段名；部分模型把思考过程放在 `content` 的 `<think>…</think>` 标签中而非独立字段。

---

## 环境配置

VLM 配置集中在 `server/src/config/constants.js` 的 `VLM_CONFIG`，按 `DEV_ENV` 区分内外网：

| 场景 | 模型/地址来源 |
|---|---|
| 外网（`DEV_ENV === 'OUT'`） | `VLM_CONFIG.OUT`：GLM 系列，`toGLMMessages()` 做格式转换 |
| 内网（`DEV_ENV !== 'OUT'`） | `VLM_CONFIG[DEV_ENV]`：内网 VLM，messages 格式直接透传 |

后续如需切换为其他厂商 API，只需修改 `server/src/AIChecker/imgCheck.js` 中的 `callAI()` 实现，接口签名 `{ model, messages, stream, ...rest }` 保持不变。
