import axios from 'axios'

const VLM_API_URL = 'http://'
const VLM_AUTH = 'xxxx'

export async function callAI({ model, messages, stream, ...rest }) {
  const response = await axios.request({
    method: 'post',
    maxBodyLength: Infinity,
    url: VLM_API_URL,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': VLM_AUTH,
    },
    data: JSON.stringify({ model, message: messages, stream, ...rest }),
    responseType: stream ? 'stream' : 'json',
  })
  return response
}
