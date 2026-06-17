import axios from 'axios'
import { IMG_CHECKER_SYSTEM_PROMPT } from './systemPrompts.js'
import { DEV_ENV, VLM_CONFIG } from '../config/constants.js'

const { model: DEFAULT_MODEL, url: VLM_API_URL, apikey: VLM_AUTH } = VLM_CONFIG[DEV_ENV]

export async function handleImgCheck({ model = DEFAULT_MODEL, messages, stream, ...rest }) {
  if (!messages) {
    const err = new Error('缺少参数！')
    err.statusCode = 400
    throw err
  }

  if (!messages[0] || messages[0].role !== 'system') {
    messages = [{ role: 'system', content: [{ type: 'input_text', text: IMG_CHECKER_SYSTEM_PROMPT }] }, ...messages]
  }

  const finalMessages = DEV_ENV === 'OUT' ? toGLMMessages(messages) : messages
  return callAI({ model, messages: finalMessages, stream, ...rest })
}

async function callAI({ model, messages, stream, ...rest }) {
  const response = await axios.request({
    method: 'post',
    maxBodyLength: Infinity,
    url: VLM_API_URL,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': VLM_AUTH,
    },
    data: JSON.stringify({ model, messages, stream, ...rest }),
    responseType: stream ? 'stream' : 'json',
  })
  return response.data
}

// 将前端 messages 格式转换为 GLM 标准格式（仅外网使用）
function toGLMMessages(messages) {
  return messages.map(msg => {
    if (typeof msg.content === 'string') return msg

    if (msg.role === 'system') {
      // GLM 要求 system content 为纯字符串
      return { ...msg, content: msg.content.map(c => c.text ?? '').join('') }
    }

    return {
      ...msg,
      content: msg.content.map(c => {
        if (c.type === 'input_text') {
          return { type: 'text', text: c.text }
        }
        if (c.type === 'image_url') {
          const url = c.image_url?.url ?? c.image_url ?? c.url
          return { type: 'image_url', image_url: { url } }
        }
        return c
      }),
    }
  })
}