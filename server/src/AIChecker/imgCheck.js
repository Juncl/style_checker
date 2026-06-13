const ZHIPU_API_KEY = 'ee9949a9ddea4f019772e2d3abbf15bf.DpNYbrsH5iYt85cT'
const GLM_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'

export async function callAI({ model, messages, stream, ...rest }) {
  const response = await fetch(GLM_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ZHIPU_API_KEY}`,
    },
    body: JSON.stringify({ model, messages, stream, ...rest }),
  })
  return response
}
