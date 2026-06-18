/**
 * 测试 GLM 接口——直接调后台 /api/img/checker（stream 模式）
 * cd server && node scripts/testGLM.js
 * cd server && node scripts/testGLM.js --image /path/to/img1.png --image2 /path/to/img2.png
 */
import axios from 'axios'
import { readFileSync, existsSync } from 'fs'

const SERVER_URL = 'http://localhost:3012/api/img/checker'

function readImg(p) {
  const ext  = p.split('.').pop().toLowerCase()
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
  const b64  = readFileSync(p).toString('base64')
  console.log(`图片：${p}  大小：${(b64.length / 1024).toFixed(1)} KB (base64)`)
  return `data:${mime};base64,${b64}`
}

const img1Path = process.argv[process.argv.indexOf('--image')  + 1] || null
const img2Path = process.argv[process.argv.indexOf('--image2') + 1] || null

let userContent
if (img1Path && existsSync(img1Path)) {
  const parts = [{ type: 'image_url', image_url: { url: readImg(img1Path) } }]
  if (img2Path && existsSync(img2Path)) {
    parts.push({ type: 'image_url', image_url: { url: readImg(img2Path) } })
  }
  parts.push({ type: 'input_text', text: '请对比两张图，分析设计还原差异。' })
  userContent = parts
} else {
  userContent = [{ type: 'input_text', text: '你好，请用一句话回复我。' }]
}

const apiMessages = [
  { role: 'user', content: userContent },
]

console.log('── 请求后台接口 ──────────────────────────')
console.log('URL:', SERVER_URL)
console.log('带图片：', !!img1Path)
console.log('──────────────────────────────────────────')
console.log('发送请求（stream 模式）...\n')

const start = Date.now()
let firstChunkTime = null

try {
  const response = await axios.request({
    method: 'post',
    url: SERVER_URL,
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ messages: apiMessages, stream: true }),
    responseType: 'stream',
    maxBodyLength: Infinity,
    timeout: 300000,
  })

  await new Promise((resolve, reject) => {
    let buffer = ''
    response.data.on('data', chunk => {
      if (!firstChunkTime) {
        firstChunkTime = Date.now()
        console.log(`⚡ 首个 chunk 到达，耗时 ${((firstChunkTime - start) / 1000).toFixed(2)}s\n`)
      }
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') { process.stdout.write('\n'); continue }
        try {
          const json = JSON.parse(data)
          const content = json.choices?.[0]?.delta?.content
          if (content) process.stdout.write(content)
        } catch {}
      }
    })
    response.data.on('end', resolve)
    response.data.on('error', reject)
  })

  const elapsed = ((Date.now() - start) / 1000).toFixed(2)
  console.log(`\n✅ 完成，总耗时 ${elapsed}s`)
} catch (err) {
  const elapsed = ((Date.now() - start) / 1000).toFixed(2)
  console.log(`\n❌ 失败，耗时 ${elapsed}s`)
  if (err.response) {
    console.log('HTTP 状态:', err.response.status)
    const chunks = []
    for await (const chunk of err.response.data) chunks.push(chunk)
    console.log('响应体:', Buffer.concat(chunks).toString())
  } else {
    console.log('错误:', err.message)
  }
}
