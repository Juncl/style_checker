# AI 图图对比（前端实现）

> 通过 server 代理调用大模型 VLM API，对设计稿与开发实现截图进行视觉样式差异分析。前端无需直接暴露 API Key。

## 组件关系

```
ConsistencyView.vue
  └── AiChatDrawer.vue          （AI 检视侧边栏，本文件所述）
```

## 开启方式

左上角切换按钮始终可见，点击后左侧滑出 AI 检视侧边栏（`AiChatDrawer.vue`），同时挤压中间 `center-panel`。无 debugger 模式限制。

## 侧边栏功能（`AiChatDrawer.vue`）

| 区域 | 功能 |
|---|---|
| 输入区左侧两个按钮 | 分别上传「设计稿」和「实现图」两张截图（`accept="image/*"`），旋转角度做出错落效果 |
| 图片缩略图 | 上传后按钮内显示缩略图，带"设计稿/实现图"标注 |
| 双向箭头图标 | 两个上传按钮中间的 `⇄` 符号，暗示两张图的对比关系 |
| 文本输入框 | placeholder 根据状态动态变化（见下表）；Enter 发送，Shift+Enter 换行 |
| 发送按钮 | 条件见下方 `canSend` 逻辑；使用 send.svg 图标 |
| 消息列表 | 支持用户消息（含图片缩略图）、assistant Markdown 消息、Think 折叠块 |
| 流式渲染 | 打字中显示三个跳动圆点动画；思考过程中显示"思考中"角标 |

### placeholder 动态文本

| 状态 | placeholder 内容 |
|---|---|
| 首轮，未上传两图 | `请先上传设计稿和实现图` |
| 首轮，已上传两图 | `补充说明（可选），Enter 发送…` |
| 追问（已有历史），已上传两图 | `补充说明（可选），Enter 发送…` |
| 追问（已有历史），无图 | `继续追问（Enter 发送）…` |

## 发送条件（`canSend`）

实际实现比早期版本更复杂，支持**追问模式**：

```js
const canSend = computed(() => {
  if (streaming.value) return false
  // 首轮（无历史）：必须有两张图
  if (!hasHistory.value) return hasBothImgs.value
  // 追问（有历史）：有图 OR 有文字均可
  return hasBothImgs.value || inputText.value.trim().length > 0
})
```

- **首轮**：两张图必须都上传，文字可选
- **追问**：可以带新图 + 文字，也可以纯文字追问（不传图）
- 流式中（`streaming=true`）禁用发送

## 数据流

### 发送流程（`sendMessage()`）

```
用户点击发送 / 按 Enter
  ↓
1. 构建用户消息体 → push 到 messages[]（含图片 base64 缩略图）
2. 清空输入框和图片槽位
3. 设置 streaming=true，初始化所有流式状态
  ↓
4. 构建 apiMessages：
   a) 历史消息（messages 中除最后一条之外的）→ historyMsgs
   b) 在 historyMsgs 中，找到最后一条带图的 user 消息 → 保留其图片 base64
   c) 其余历史消息 → 只保留文字（`input_text`），图片不传
   d) 当前消息（本次上传的图 + 文字）
  ↓
5. fetch('/devlint/api/img/checker', { stream: true })
   → Vite proxy 转发到 server 的 POST /api/img/checker
  ↓
6. 读取 SSE 流式响应帧（见下方）
7. 流结束后 → push assistant 消息到 messages[]，清空流式状态
```

### 图片历史管理策略

VLM API 无状态，每轮都需重传全部历史。图片 base64 体积大，若每轮都带全部历史图片，token 消耗随对话轮次线性膨胀。因此：

- **最近一次带图的 user 消息** → 保留其图片 base64
- **更早的带图轮次** → 图片丢弃，仅保留文字内容
- **纯文字追问轮次** → 无图片，仅传文字

### SSE 帧解析

流式响应中有两种处理通道：

**通道 1：独立 `reasoning` 字段**
```json
{"choices":[{"delta":{"reasoning_content":"..."}}]}
{"choices":[{"delta":{"reasoning":"..."}}]}
```
→ 直接累积到 `streamingThink`（思考过程，可折叠显示）

**通道 2：content 中的 `<think>` 标签**
```
<think>这是思考过程...</think>这是正文Markdown...
```
→ 通过 `rawBuffer` 累积，`parseThinkBuffer()` 实时拆分：
- `</think>` 出现前 → 所有内容归入 `streamingThink`
- `</think>` 出现后 → 思考归入 `streamingThink`，后续归入 `streamingMain`

### Think 块 UI 行为

- 流式进行中：Think 块默认展开，右上角显示"思考中"角标
- 流结束后：600ms 延迟自动折叠
- 用户手动展开后滚动到底部，持续跟踪新内容
- 用户若手动向上滚动过 → 不再自动滚动（即"跟随模式"暂停）

### Markdown 渲染

使用 `marked` + `DOMPurify` 渲染 assistant 消息中的 Markdown 内容，支持：
- 标题（h1/h2 带下划线分隔）
- 表格（蓝色表头，斑马纹行）
- 代码块（等宽字体，灰色背景）
- 列表、加粗等标准 Markdown 语法

## API 调用方式

```js
fetch('/devlint/api/img/checker', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: apiMessages, stream: true }),
  signal: currentAbortController.signal,
})
```

- **路径**：`/devlint/api/img/checker` 经过 Vite proxy（`vite.config.ts`）转发到 server 的 `http://localhost:3012/api/img/checker`
- **proxy 规则**：`/devlint/api` → `http://localhost:3012`，去除 `/devlint` 前缀
- **流模式**：固定传 `stream: true`
- **中断支持**：通过 `AbortController` 支持取消请求（侧边栏关闭或组件卸载时）

## 消息数据格式

### 带图片的消息（首轮 / 追加新图）

```json
{
  "role": "user",
  "content": [
    { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } },
    { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } },
    { "type": "input_text", "text": "补充说明或留空" }
  ]
}
```

### 纯文字消息（追问，无图）

```json
{
  "role": "user",
  "content": [
    { "type": "input_text", "text": "追问内容..." }
  ]
}
```

### 历史消息（无图的轮次）

```json
{
  "role": "assistant",
  "content": [{ "type": "input_text", "text": "之前的 Markdown 回答..." }]
}
```

### 历史消息（最近一次带图的 user 消息，保留图片）

```json
{
  "role": "user",
  "content": [
    { "type": "image_url", "image_url": { "url": "data:image/..." } },
    { "type": "image_url", "image_url": { "url": "data:image/..." } },
    { "type": "input_text", "text": "请对比两张图" }
  ]
}
```

## Vite Proxy 配置

```ts
// client/vite.config.ts
'/devlint/api': {
  target: 'http://localhost:3012',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/devlint/, ''),
}
```

- 前端统一用 `/devlint/api` 前缀调用（与业务 API 一致）
- server 侧路由挂载在 `/api/` 下，完整路径为 `/api/img/checker`
- 内网部署时 `SERVER_BASE_URL` 切换为 `${window.location.origin}/devlint/api`（同源访问）

## 样式设计

### 布局

- 侧边栏宽度：374px（展开时），0（收起时）
- 过渡动画：`width 220ms cubic-bezier` + `box-shadow 220ms ease`
- 消息列表：`flex: 1`，`padding: 24px`，`gap: 20px`
- 消息气泡 92% 最大宽度，用户靠右、助手靠左

### 输入区

- 外层渐变光晕（`conic-gradient` 8 色 + `blur(8px)` + `opacity 0.5`）
- 内层角度渐变描边（1.2px，`mask-composite: exclude` 实现镂空）
- 上传按钮带旋转角度（设计稿 -4deg，实现图 3deg）
- 发送按钮圆形，`hover` 时 `opacity 0.85`

### 消息气泡

| 角色 | 背景 | 圆角 |
|---|---|---|
| user | `rgba(10,89,247,0.08)` | 16px，右下 2px |
| assistant | 透明 | 16px |

### Think 折叠块

- 左侧 2px 灰色竖线作为视觉标识
- 标题行含 chevron 图标（`200ms ease` 旋转动画）
- 内容区 `max-height: 220px`，折叠时 `max-height: 0` + `opacity: 0`
- "思考中"角标：10px 字号，灰色背景

### 空态

- 居中显示 octo-logo.svg（44×44）
- 标题"AI 检视助手"，32px，font-weight 700
- 提示文字"上传设计稿与实现截图，AI 将自动对比分析差异"，14px，60% 透明度

## 注意事项

1. **AI 结果仅在侧边栏对话框内展示**，不会自动合并进 diff 报告栏
2. `markdownToDiffReport()`（server 侧）已实现 Markdown → diff JSON 转换，供后续接入使用，前端暂未消费
3. 消息列表不自动滚动到底部（需手动跟随），流式过程中通过 `watch(streamingMain, scrollToBottom)` 实现自动滚动
4. 文件选择后通过 `FileReader.readAsDataURL()` 转为 base64，存入 `imgSlots` 响应式数组
5. 侧边栏关闭时自动 `abort` 正在进行的流式请求
