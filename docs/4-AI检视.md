# AI 检视

> 通过 server 代理调用智谱（GLM）等大模型 API，前端无需直接暴露 API Key，也无需处理跨域问题。

## 架构

```
前端 (client)                    Server (3012)                    智谱 API
  POST /api/img/checker  ───→  callAI()  ───→  POST https://open.bigmodel.cn/api/paas/v4/chat/completions
       ↕                       ↕
  请求/响应                 Bearer token
                          拼接（API Key 在 server 端）
```

- API Key 存储在 `server/src/AIChecker/imgCheck.js`，前端不可见
- 支持流式（SSE）和非流式两种模式

## 接口说明

### `POST /api/img/checker`

**请求体（JSON）：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | 是 | 模型代号，如 `glm-4.7-flash`、`glm-5v-turbo` 等 |
| `messages` | array | 是 | 对话消息列表，与智谱 API 格式一致 |
| `stream` | boolean | 否 | 是否启用流式输出（SSE），默认 `false` |
| 其他参数 | — | 否 | `temperature`、`top_p`、`max_tokens` 等，透传给智谱 |

**messages 格式示例（纯文本）：**

```json
[
  { "role": "system", "content": "你是一个有用的助手" },
  { "role": "user", "content": "hi!" }
]
```

**messages 格式示例（视觉模型，传图）：**

```json
[
  {
    "role": "user",
    "content": [
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } },
      { "type": "text", "text": "请检查这张图片的样式问题" }
    ]
  }
]
```

**请求示例（非流式）：**

```bash
curl -X POST http://localhost:3012/api/img/checker \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "glm-4.7-flash",
    "messages": [{"role": "user", "content": "hi!"}]
  }'
```

**请求示例（流式）：**

```bash
curl -X POST http://localhost:3012/api/img/checker \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "glm-4.7-flash",
    "messages": [{"role": "user", "content": "hi!"}],
    "stream": true
  }'
```

**响应（非流式）：**

智谱 API 原始 JSON 响应，包含 `choices[].message.content`、`usage` 等字段。

**响应（流式）：**

`text/event-stream`，每行 `data: {...}` 格式，以 `data: [DONE]` 结束。

## 实现位置

| 文件 | 职责 |
|---|---|
| `server/src/AIChecker/imgCheck.js` | `callAI()` 函数，发起 HTTP 请求到智谱 API |
| `server/src/routes/check.js:487-522` | `POST /api/img/checker` 路由处理，参数校验、流式透传 |

## 切换模型

`model` 参数由前端传入，server 透传不做校验。支持智谱开放平台的所有模型：

- 文本：`glm-4.7-flash`、`glm-4.5-flash`、`glm-5.1` 等
- 视觉：`glm-5v-turbo`、`glm-4.6v`、`glm-4v-flash` 等

后续如需切换为其他厂商的 API，只需修改 `server/src/AIChecker/imgCheck.js` 中的 `callAI()` 实现，接口签名保持 `{ model, messages, stream, ...rest }` 不变即可。
