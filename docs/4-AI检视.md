# AI 检视

> ⚠️ **实验功能**：当前 AI 检视为实验性功能，仅在 debugger 模式下可用，不影响主流程。

通过 server 代理调用智谱（GLM）大模型 API，对设计稿与开发实现截图进行视觉样式差异分析。前端无需直接暴露 API Key，也无需处理跨域问题。

---

## 架构

```
前端 AiChatDrawer          Server (3012)                    智谱 API
  POST /api/img/checker  ──→  检测图片                ──→  POST https://open.bigmodel.cn/...
  （流式接收文字帧）            有图片：切 glm-4.6v
                               注入系统 Prompt
                               透传 SSE 流
                             流结束后：
                               提取 JSON diffs
                               额外发一帧 ai-diffs  ──→  前端 emit 给 ConsistencyView
                                                          合并进 result.diffs
```

- API Key 存储在 `server/src/AIChecker/imgCheck.js`，前端不可见
- 流式（SSE）和非流式均支持；AI 检视功能固定使用流式

---

## 前端入口

### 开启方式

URL 加 `?debugger=1` 进入 debugger 模式，左上角开发侧图标（HarmonyOS 图标）变为可点击状态（pointer cursor + hover 半透明），点击后左侧滑出 AI 检视侧边栏，同时挤压中间 `center-panel`。

非 debugger 模式下点击图标无任何反应。

### 侧边栏功能

侧边栏（`AiChatDrawer.vue`）提供以下操作：

| 区域 | 功能 |
|---|---|
| 输入区左侧两个按钮 | 分别上传"设计稿"和"实现图"两张截图（`accept="image/*"`） |
| 图片预览区 | 上传后在输入框上方展示缩略图，底部标注"设计稿/实现图"，右上角可删除 |
| 文本输入框 | 有图时 placeholder 变为"补充说明（可选）"，无图时为普通对话输入 |
| 发送按钮 | 有图即可发送（文字可选），Enter 发送，Shift+Enter 换行 |
| 清空按钮 | 清空所有对话历史 |
| 关闭按钮 | 收起侧边栏，恢复 center-panel 宽度 |

### 两种使用场景

**场景 A：上传两图进行视觉对比分析**

1. 点击"设计稿"按钮上传设计稿截图
2. 点击"实现图"按钮上传开发实现截图
3. 可选填补充说明（留空时自动使用默认提示语"请对比两张图，分析设计还原差异"）
4. 点击发送

后台自动切换为 `glm-4.6v` 视觉模型，注入系统 Prompt，AI 流式输出分析报告。
流结束后，后台提取 JSON diffs，通过额外 SSE 帧发给前端，自动合并进 diff 栏的"模糊对比"tab。

**场景 B：纯文字对话**

不上传图片，直接输入问题，使用 `GLM-4.5-Air` 文本模型进行对话。

---

## 系统 Prompt（视觉对比模式）

有图片时，后台自动在 messages 头部注入以下系统 Prompt（`IMG_CHECKER_SYSTEM_PROMPT`，定义在 `server/src/routes/check.js`）：

**检查范围（与 styleComparator.js 对齐）：**

| 属性 | property 枚举值 |
|---|---|
| 字号 | `fontSize` |
| 字重（粗细） | `fontWeight` |
| 字色 | `fontColor` |
| 填充色/背景色（含渐变） | `backgroundColor` |
| 圆角（四角分别检查） | `borderRadius` |
| 描边宽度 | `borderWidth` |
| 描边颜色 | `borderColor` |
| 透明度 | `opacity` |
| 模糊（高斯/背景） | `blur` |
| 投影 | `shadow` |

**不检查**：文本内容、行高、字间距、对齐方式、字体类型。

**数值精度原则**：能识别的精确值（颜色 #RRGGBB、字号 px、圆角 px、描边 px）写精确值；无法量化的用感知描述；不得臆造数值。

**输出格式**：AI 先输出文字报告（总体还原度 + 全量差异清单），最后在末尾额外输出一个固定结构的 JSON 代码块：

```json
{
  "diffs": [
    {
      "property": "枚举值",
      "elementDesc": "元素的自然语言描述（位置+名称）",
      "designValue": "设计稿中的值",
      "implValue": "实现中的值",
      "description": "一句话差异说明"
    }
  ]
}
```

---

## 后台处理逻辑

文件：`server/src/routes/check.js`

```
POST /api/img/checker
  ↓
messagesHaveImage()  ──→  有图片？
                           是 → model = 'glm-4.6v'，messages 头部注入系统 Prompt
                           否 → 使用前端传入的 model（当前为 GLM-4.5-Air）
  ↓
callAI({ model, messages, stream, ...rest })
  ↓
stream 模式：
  逐帧透传给前端（前端实时渲染）
  同时缓存 fullContent（累积 delta）
  ↓
流结束后（仅有图片时）：
  extractAiDiffs(fullContent)
    └─ 正则提取 ```json 代码块
    └─ 解析 diffs[]，转换字段：
         arkuiValue  ← implValue
         confidence  = 'low'（AI 结果全部低置信）
         severity    = 'warning'
         designNodeId = null
         arkuiNodeId  = null
         _isAiDiff   = true
  ↓
res.write(`data: {"type":"ai-diffs","diffs":[...]}`)
res.end()
```

关键函数：

| 函数 | 位置 | 职责 |
|---|---|---|
| `callAI()` | `server/src/AIChecker/imgCheck.js` | 发起 HTTP 请求到智谱 API，Bearer token 鉴权 |
| `messagesHaveImage()` | `server/src/routes/check.js` | 检测 messages 是否携带 image_url |
| `extractAiDiffs()` | `server/src/routes/check.js` | 从完整 AI 输出提取 JSON 代码块并转换为内部 diff 格式 |
| `IMG_CHECKER_SYSTEM_PROMPT` | `server/src/routes/check.js` | 系统 Prompt 常量 |

---

## 前端数据流

文件：`client/src/views/consistency/components/AiChatDrawer.vue`  
文件：`client/src/views/consistency/ConsistencyView.vue`

```
AiChatDrawer.sendMessage()
  ↓
fetch('/devlint/api/img/checker', { stream: true })
  ↓
读取 SSE 帧：
  普通帧（choices[].delta.content） → 累积到 streamingContent → 对话框逐字渲染
  ai-diffs 帧（json.type === 'ai-diffs'） → emit('ai-diffs', json.diffs)
  ↓
ConsistencyView.onAiDiffs(diffs)
  └─ 过滤掉旧的 _isAiDiff 条目
  └─ 追加新 diffs 到 result.diffs
  └─ ReportPanel 模糊对比 tab 自动更新
```

**历史管理**：对话历史仅保留文字（不把图片 base64 存入历史），图片只在当次请求传递，避免多轮对话时重复传大体积 base64。

**diff 栏行为**：AI diffs 的 `designNodeId / arkuiNodeId` 均为 `null`，点击不会高亮画布节点，仅在 diff 列表中展示描述文字。`description` 字段前缀为 `[AI]`，可与算法 diff 区分。

---

## 接口说明

### `POST /api/img/checker`

**请求体（JSON）：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | 有图时可省略 | 文本模型代号，有图片时后台自动覆盖为 `glm-4.6v` |
| `messages` | array | 是 | 对话消息列表，与智谱 API 格式一致 |
| `stream` | boolean | 否 | 是否启用流式输出（SSE），默认 `false` |
| 其他参数 | — | 否 | `temperature`、`top_p`、`max_tokens` 等，透传给智谱 |

**纯文字消息格式：**

```json
[{ "role": "user", "content": "hi!" }]
```

**携带图片的消息格式（自动切 glm-4.6v）：**

```json
[
  {
    "role": "user",
    "content": [
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } },
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } },
      { "type": "text", "text": "补充说明或留空" }
    ]
  }
]
```

**流式响应帧类型：**

| 帧内容 | 触发时机 | 说明 |
|---|---|---|
| `{"choices":[{"delta":{"content":"..."}}]}` | 逐字生成时 | 标准 GLM SSE 帧，前端累积渲染 |
| `[DONE]` | AI 输出完毕 | 标准结束标志 |
| `{"type":"ai-diffs","diffs":[...]}` | 有图片且流结束后 | 后台额外发送，携带结构化 diff 数据 |

---

## 切换模型

| 场景 | 使用模型 | 来源 |
|---|---|---|
| 纯文字对话 | `GLM-4.5-Air` | 前端传入 |
| 携带图片的视觉分析 | `glm-4.6v` | 后台自动覆盖 |

后续如需切换为其他厂商的 API，只需修改 `server/src/AIChecker/imgCheck.js` 中的 `callAI()` 实现，接口签名 `{ model, messages, stream, ...rest }` 保持不变即可。
