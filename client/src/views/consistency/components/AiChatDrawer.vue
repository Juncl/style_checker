<template>
  <div :class="['ai-side-panel', { 'ai-side-panel--open': open }]">
      <!-- 消息列表 -->
      <div ref="messagesEl" class="ai-messages">
        <div v-if="messages.length === 0 && !streaming" class="ai-empty">
          <div class="ai-empty-icon">
            <img :src="octoAi" width="120" height="120" />
          </div>
          <p class="ai-empty-title">一致性检查</p>
          <div class="ai-empty-desc">
            <p>模糊比对：上传开发图 + 设计图</p>
            <p>精准检查：上传 JSON + 设计图链接/传送码</p>
            <p class="ai-empty-link" @click="openGuide">查看指南</p>
          </div>
        </div>

        <div
          v-for="(msg, i) in messages"
          :key="i"
          :class="['ai-msg', `ai-msg--${msg.role}`]"
        >
          <!-- 带图片的用户消息 -->
          <div v-if="msg.images && msg.images.length" class="ai-msg-img-bubble">
            <div class="ai-msg-img-files">
              <div v-for="(imgSrc, j) in msg.images" :key="j" class="ai-msg-img-file">
                <img :src="imgSrc" class="ai-msg-img-file-thumb" />
                <span class="ai-msg-img-file-name">{{ getImageFileName(j, imgSrc) }}</span>
              </div>
            </div>
            <div v-if="msg.content" class="ai-msg-img-text">{{ msg.content }}</div>
          </div>
          <!-- assistant 消息 -->
          <template v-else-if="msg.role === 'assistant'">
            <div
              v-if="msg.thinkContent"
              class="ai-think-block"
              :class="{ 'ai-think-block--collapsed': msg.thinkCollapsed }"
            >
              <button class="ai-think-header" @click="msg.thinkCollapsed = !msg.thinkCollapsed">
                <svg viewBox="0 0 12 12" width="10" height="10" fill="none" class="ai-think-chevron">
                  <path d="M2 4L6 8L10 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span>思考过程</span>
              </button>
              <div class="ai-think-body">{{ msg.thinkContent }}</div>
            </div>
            <div class="ai-msg-bubble ai-msg-md" v-html="renderMd(msg.content)" />
          </template>
          <!-- 普通用户消息 -->
          <div v-else class="ai-msg-bubble">{{ msg.content }}</div>
        </div>

        <div v-if="streaming" class="ai-msg ai-msg--assistant">
          <div
            v-if="streamingThink"
            class="ai-think-block"
            :class="{ 'ai-think-block--collapsed': streamingThinkCollapsed }"
          >
            <button class="ai-think-header" @click="streamingThinkCollapsed = !streamingThinkCollapsed">
              <svg viewBox="0 0 12 12" width="10" height="10" fill="none" class="ai-think-chevron">
                <path d="M2 4L6 8L10 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>思考过程</span>
            </button>
            <div ref="thinkBodyEl" class="ai-think-body" @scroll.passive="onThinkScroll">{{ streamingThink }}</div>
          </div>
          <div class="ai-msg-bubble ai-msg-streaming">
            <template v-if="streamingMain">{{ streamingMain }}</template>
            <span v-else class="ai-thinking-status">
              <img :src="aiThinking" class="ai-thinking-icon" width="22" height="22" alt="" />
              <span class="ai-thinking-text">思考中...</span>
            </span>
          </div>
        </div>
      </div>


      <!-- 容器 31823：精准检查提示（AI 对话完毕、/img/checker/diff 解析完成后出现） -->
      <div v-if="showPrecisionTip" class="ai-precision-tip">
        <div class="ai-precision-tip-title">
          <svg class="ai-precision-tip-icon" viewBox="0 0 24 24" width="14" height="14" fill="none">
            <circle cx="12" cy="12" r="10" fill="currentColor"/>
            <path d="M12 6.5V13" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
            <circle cx="12" cy="16.5" r="1" fill="#fff"/>
          </svg>
          <span class="ai-precision-tip-title-text">精准检查提示</span>
        </div>
        <p class="ai-precision-tip-desc">图片对比结果仅作为参考，如需精准参数对比，请上传【JSON文件】和【设计稿传送码/链接】</p>
        <p class="ai-precision-tip-link" @click="resetAll">需要精准检查</p>
      </div>

      <!-- 输入区 -->
      <div class="ai-input-wrap">
      <div class="ai-input-area">
        <div class="ai-upload-btns">
          <template v-for="(slot, i) in imgSlots" :key="i">
            <button
              class="ai-upload-btn"
              :class="{ 'ai-upload-btn--filled': !!slot }"
              :title="i === 0 ? '上传开发截图' : '上传设计稿'"
              @click="triggerUpload(i)"
            >
              <template v-if="slot">
                <img :src="slot.preview" class="ai-upload-preview" />
                <button class="ai-upload-clear" @click.stop="removeImg(i)" title="删除图片">
                  <img :src="clearImg" width="12" height="12" />
                </button>
              </template>
              <template v-else>
                <svg viewBox="0 0 12 12" width="14" height="14" fill="none">
                  <path d="M6 1.5V10.5M1.5 6H10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                </svg>
                <span class="ai-upload-label">{{ i === 0 ? '开发' : '设计' }}</span>
              </template>
            </button>
            <span v-if="i === 0" class="ai-switch-icon">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
                <path d="M1 5.68915L14.9992 5.68915L11.1043 1.83325M15 10.3333L1 10.3333L4.89497 14.1892" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="0.9"/>
              </svg>
            </span>
          </template>
        </div>

        <textarea
          ref="inputEl"
          v-model="inputText"
          class="ai-textarea"
          :placeholder="'开发/设计框内支持图&图对比，及上传Json文件和传送码'"
          rows="3"
          :disabled="streaming"
          @keydown="onKeydown"
        />
        <button
          class="ai-send-btn"
          :disabled="!canSend"
          @click="sendMessage"
          title="发送"
        >
          <img src="@/assets/svg/send.svg" width="36" height="36" class="ai-send-icon" />
        </button>
      </div>
      </div>

      <!-- 隐藏的 file input -->
      <input ref="fileInput0" type="file" accept="image/*" style="display:none" @change="e => onFileChange(0, e)" />
      <input ref="fileInput1" type="file" accept="image/*" style="display:none" @change="e => onFileChange(1, e)" />
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch, onUnmounted } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import clearImg from '@/assets/svg/clear-img.svg'
import octoAi from '@/assets/svg/octo-ai.svg'
import aiThinking from '@/assets/svg/ai-thinking.svg'

marked.setOptions({ breaks: true })

const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'report-ready', 'reset-report', 'loading-start', 'loading-end'])

function fixTableFormat(md) {
  return md
    .replace(/(\|[^\n]+\|)\n{2,}(\|[-\s|:]+\|)/g, '$1\n$2')
    .replace(/(\|[-\s|:]+\|)\n{2,}(\|[^\n]+\|)/g, '$1\n$2')
}

function renderMd(content) {
  return DOMPurify.sanitize(marked.parse(fixTableFormat(content || '')))
}

// ── 请求中止 ─────────────────────────────────────────────────────────────────

let currentAbortController = null

function abortCurrentRequest() {
  if (currentAbortController) {
    currentAbortController.abort()
    currentAbortController = null
    emit('loading-end')
  }
}

onUnmounted(() => {
  abortCurrentRequest()
})

// ── 消息状态 ─────────────────────────────────────────────────────────────────

const messages                = ref([])
const inputText               = ref('')
const streaming               = ref(false)
const streamingMain           = ref('')
const streamingThink          = ref('')
const rawBuffer               = ref('')
const thinkDone               = ref(false)
const streamingThinkCollapsed = ref(false)
const messagesEl              = ref(null)
const thinkBodyEl             = ref(null)
const fileInput0              = ref(null)
const fileInput1              = ref(null)

let userScrolledThink = false

const showPrecisionTip = ref(false)
const imgSlots    = ref([null, null])
const hasBothImgs = computed(() => imgSlots.value.every(s => s))
// 是否已有对话历史（至少有一条 assistant 回复，说明第一轮已完成）
const hasHistory  = computed(() => messages.value.some(m => m.role === 'assistant'))

// 发送条件：
//   无历史（首轮）→ 必须有两张图
//   有历史（追问）→ 有图 OR 有文字均可
const canSend = computed(() => {
  if (streaming.value) return false
  if (!hasHistory.value) return hasBothImgs.value
  return hasBothImgs.value || inputText.value.trim().length > 0
})

function clearMessages() {
  if (streaming.value) return
  messages.value = []
}

function getImageFileName(index, dataUrl) {
  const prefix = index === 0 ? '开发截图' : '设计截图'
  const match = dataUrl.match(/^data:image\/(\w+);/)
  const ext = match ? `.${match[1]}` : '.png'
  return prefix + ext
}

// 「需要精准检查」：清除对话历史与 AI 报告，关闭报告页并收起对话面板
function resetAll() {
  abortCurrentRequest()
  streaming.value        = false
  messages.value         = []
  inputText.value        = ''
  imgSlots.value         = [null, null]
  showPrecisionTip.value = false
  emit('reset-report')
  emit('close')
}

async function scheduleDiffParse(markdown, savedImgs) {
  try {
    const diffResp = await fetch('/devlint/api/img/checker/diff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown }),
    })
    const diffData = await diffResp.json()
    emit('report-ready', {
      ...diffData,
      devImg: savedImgs[0],
      designImg: savedImgs[1],
    })
    showPrecisionTip.value = true
  } catch { /* 解析失败不影响聊天功能 */ }
  emit('loading-end')
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  })
}

function onThinkScroll() {
  const el = thinkBodyEl.value
  if (!el) return
  userScrolledThink = el.scrollTop + el.clientHeight < el.scrollHeight - 10
}

function scrollThinkToBottom() {
  if (userScrolledThink) return
  nextTick(() => {
    const el = thinkBodyEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(streamingMain, scrollToBottom)
watch(streamingThink, () => {
  scrollToBottom()
  scrollThinkToBottom()
})

watch(thinkDone, (val) => {
  if (val) {
    userScrolledThink = false
    setTimeout(() => { streamingThinkCollapsed.value = true }, 600)
  }
})

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (canSend.value) sendMessage()
  }
}

function triggerUpload(i) {
  const el = i === 0 ? fileInput0.value : fileInput1.value
  if (el) { el.value = ''; el.click() }
}

function onFileChange(i, e) {
  const file = e.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = ev => {
    const slots = [...imgSlots.value]
    slots[i] = { preview: ev.target.result }
    imgSlots.value = slots
  }
  reader.readAsDataURL(file)
}

function removeImg(i) {
  const slots = [...imgSlots.value]
  slots[i] = null
  imgSlots.value = slots
}

function openGuide() {
  window.open('https://octo.hdesign.huawei.com/helpCenter/projectType/121/495/1271')
}

async function sendMessage() {
  if (streaming.value) return
  // 首轮：必须有两张图；追问：有图或有文字即可
  if (!hasHistory.value && !hasBothImgs.value) return
  const text    = inputText.value.trim()
  const hasImgs = hasBothImgs.value
  if (hasHistory.value && !hasImgs && !text) return

  const currentImgSrcs = hasImgs ? imgSlots.value.map(s => s.preview) : []
  const savedImgs      = [...currentImgSrcs]

  messages.value.push({
    role: 'user',
    content: hasImgs ? (text || '请对比两张图') : text,
    images: hasImgs ? currentImgSrcs : undefined,
  })
  inputText.value = ''
  imgSlots.value  = [null, null]
  scrollToBottom()

  streaming.value               = true
  streamingMain.value           = ''
  streamingThink.value          = ''
  rawBuffer.value               = ''
  thinkDone.value               = false
  streamingThinkCollapsed.value = false

  // 历史消息：只有最近一条带图的 user 消息保留图片，更早的图片轮次只传文字。
  // 原因：VLM API 无状态，每轮都重传全部历史；图片 base64 很大，若每轮都带
  // 所有历史图片，token 消耗会随对话轮次线性膨胀。只保留最近一次图片已足够
  // 给模型建立视觉上下文，更早的图片轮次退化为文字即可。
  const historyMsgs = messages.value.slice(0, -1)
  const lastImgIdx  = historyMsgs.reduce((acc, m, i) => (m.images?.length ? i : acc), -1)
  const historyText = historyMsgs.map((m, i) => {
    if (m.role === 'user' && i === lastImgIdx) {
      return {
        role: m.role,
        content: [
          { type: 'input_text', text: m.content },
          { type: 'text', text: '图片1: 开发实现图' },
          { type: 'image_url', image_url: { url: m.images[0] } },
          { type: 'text', text: '图片2: 设计基准图' },
          { type: 'image_url', image_url: { url: m.images[1] } },
        ],
      }
    }
    return { role: m.role, content: [{ type: 'input_text', text: m.content }] }
  })

  // 有图：携带图片 + 文字（注入 prompt 由后端决定）
  // 无图：纯文字追问（后端不注入 prompt）
    const currentContent = hasImgs
    ? [
        { type: 'input_text', text: text || '请对比两张图' },
        { type: 'text', text: '图片1: 开发实现图' },
        { type: 'image_url', image_url: { url: currentImgSrcs[0] } },
        { type: 'text', text: '图片2: 设计基准图' },
        { type: 'image_url', image_url: { url: currentImgSrcs[1] } },
      ]
    : [{ type: 'input_text', text }]

  const apiMessages = [
    ...historyText,
    { role: 'user', content: currentContent },
  ]

  currentAbortController = new AbortController()

  if (hasImgs) emit('loading-start')

  try {
    const response = await fetch('/devlint/api/img/checker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: apiMessages, stream: true }),
      signal: currentAbortController.signal,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(errText || `HTTP ${response.status}`)
    }

    const contentType = response.headers.get('Content-Type') || ''

    if (contentType.includes('application/json')) {
      const json = await response.json()
      const msg  = json.choices?.[0]?.message
      messages.value.push({
        role: 'assistant',
        content: msg?.content || '',
        thinkContent: msg?.reasoning || null,
        thinkCollapsed: true,
      })
    } else {
      const reader  = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer    = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const json  = JSON.parse(data)
            const delta = json.choices?.[0]?.delta
            if (delta?.reasoning_content || delta?.reasoning) {
              streamingThink.value += (delta.reasoning ?? delta.reasoning_content)
            }
            if (delta?.content) {
              if (streamingThink.value && rawBuffer.value === '') {
                if (!thinkDone.value) thinkDone.value = true
                streamingMain.value += delta.content
              } else {
                rawBuffer.value += delta.content
                parseThinkBuffer()
              }
            }
          } catch { /* 跳过无效帧 */ }
        }
      }

      messages.value.push({
        role: 'assistant',
        content: streamingMain.value,
        thinkContent: streamingThink.value || null,
        thinkCollapsed: true,
      })

      // 流式结束后，将完整 Markdown 发到 server 转成 diff JSON
      const markdown = streamingMain.value
      if (savedImgs.length === 2 && markdown) {
        await scheduleDiffParse(markdown, savedImgs)
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      messages.value.push({ role: 'assistant', content: `⚠️ 请求失败：${e.message}` })
    }
    emit('loading-end')
  } finally {
    currentAbortController        = null
    streaming.value               = false
    streamingMain.value           = ''
    streamingThink.value          = ''
    rawBuffer.value               = ''
    thinkDone.value               = false
    scrollToBottom()
  }
}

function parseThinkBuffer() {
  const raw = rawBuffer.value
  const openIdx  = raw.indexOf('<think>')
  const closeIdx = raw.indexOf('</think>')

  if (openIdx === -1) {
    streamingMain.value = raw
    return
  }
  if (closeIdx === -1) {
    streamingThink.value = raw.substring(openIdx + 7)
    streamingMain.value  = ''
    return
  }
  streamingThink.value = raw.substring(openIdx + 7, closeIdx)
  streamingMain.value  = raw.substring(closeIdx + 8)
  if (!thinkDone.value) thinkDone.value = true
}
</script>

<style scoped>
/* ── 侧边面板主体（在布局流中占位，宽度过渡推挤画布） ── */
.ai-side-panel {
  flex-shrink: 0;
  width: 0;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  transition: width 220ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
              box-shadow 220ms ease;
}
.ai-side-panel--open {
  width: 374px;
  border-right: 1px solid var(--octo-border-separator, #e8eaed);
}


/* ── 消息列表 ── */
.ai-messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px 24px 40px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  scroll-behavior: smooth;
}

.ai-empty {
  flex: 1;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 6px; padding: 40px 0; text-align: center;
}
.ai-empty-icon   { opacity: 0.9; }
.ai-empty-title  { font-size: 32px; font-weight: 700; color: rgba(0, 0, 0, 0.90); margin: 0; }
.ai-empty-desc   { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.ai-empty-desc p { font-size: 14px; font-weight: 400; color: rgba(0, 0, 0, 0.60); line-height: 22px; margin: 0; }
.ai-empty-link   { color: var(--octo-primary) !important; cursor: pointer; }

.ai-msg          { display: flex; max-width: 92%; }
.ai-msg--user    { align-self: flex-end; flex-direction: column; align-items: flex-end; }
.ai-msg--assistant { align-self: flex-start; flex-direction: column; gap: 4px; }

/* ── Think 折叠块 ── */
.ai-think-block {
  width: 100%;
  border-radius: 6px;
  background: transparent;
  border-left: 2px solid #d1d5dc;
  overflow: hidden;
}
.ai-think-header {
  display: flex; align-items: center; gap: 5px;
  width: 100%; padding: 5px 9px;
  border: none; background: transparent;
  cursor: pointer; text-align: left;
  font-size: 12px; color: #777777;
  font-weight: 500;
  transition: background 150ms ease;
}
.ai-think-header:hover { background: rgba(0, 0, 0, 0.04); }
.ai-think-chevron {
  flex-shrink: 0; color: #777777;
  transition: transform 200ms ease;
}
.ai-think-block--collapsed .ai-think-chevron { transform: rotate(-90deg); }
.ai-think-body {
  padding: 0 10px 8px 10px;
  font-size: 12px; line-height: 21px;
  color: #191919;
  white-space: pre-wrap; word-break: break-word;
  max-height: 220px; overflow-y: auto;
  transition: max-height 200ms ease, padding 200ms ease, opacity 200ms ease;
  opacity: 1;
}
.ai-think-block--collapsed .ai-think-body {
  max-height: 0;
  padding-top: 0; padding-bottom: 0;
  opacity: 0;
  overflow: hidden;
}

.ai-msg-bubble {
  padding: 12px; border-radius: 16px;
  font-size: 14px; line-height: 22px;
  word-break: break-word;
}
.ai-msg--user .ai-msg-bubble, .ai-msg-bubble--user {
  background: rgba(10, 89, 247, 0.08); color: rgba(0, 0, 0, 0.9);
  border-bottom-right-radius: 2px;
}
.ai-msg--assistant .ai-msg-bubble {
  background: transparent; color: rgba(25, 25, 25, 1);
}

/* ── Markdown 渲染 ── */
.ai-msg-md :deep(h1),
.ai-msg-md :deep(h2) { font-size: 15px; margin: 14px 0 8px; }
.ai-msg-md :deep(h3) { font-size: 14px; margin: 6px 0 2px; }
.ai-msg-md :deep(p)  { margin: 2px 0; }
.ai-msg-md :deep(table) {
  width: 100%; border-collapse: collapse; font-size: 12px;
  margin: 6px 0;
}
.ai-msg-md :deep(th),
.ai-msg-md :deep(td) { padding: 4px 8px; border: 1px solid #dde3ea; vertical-align: top; }
.ai-msg-md :deep(th) { text-align: left; }
.ai-msg-md :deep(ul),
.ai-msg-md :deep(ol) { padding-left: 16px; margin: 2px 0; }
.ai-msg-md :deep(li) { margin: 1px 0; }
.ai-msg-md :deep(code) {
  background: #e8ecf0; border-radius: 3px; padding: 1px 4px; font-size: 12px; font-family: monospace;
}
.ai-msg-md :deep(pre) { background: #e8ecf0; border-radius: 6px; padding: 8px 10px; overflow-x: auto; margin: 6px 0; }
.ai-msg-md :deep(pre code) { background: none; padding: 0; }

/* 带图片的用户消息 */
.ai-msg-img-bubble {
  padding: 12px;
  border-radius: 16px;
  border-bottom-right-radius: 2px;
  background: rgba(10, 89, 247, 0.08);
  color: rgba(0, 0, 0, 0.9);
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 240px;
}
.ai-msg-img-text {
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
  color: rgba(25, 25, 25, 1);
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-msg-img-files {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 120px;
}
.ai-msg-img-file {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.9);
  position: relative;
}
.ai-msg-img-file-thumb {
  width: 24px;
  height: 30px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}
.ai-msg-img-file-name {
  flex: 1;
  font-size: 12px;
  font-weight: 400;
  line-height: 20px;
  color: rgba(0, 0, 0, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 流式思考中状态 */
.ai-thinking-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
}
.ai-thinking-icon {
  width: 22px; height: 22px;
  flex-shrink: 0;
}
.ai-thinking-text {
  font-size: 14px;
  line-height: 22px;
  color: rgba(0, 0, 0, 0.6);
}


/* ── 容器 31823：精准检查提示 ── */
.ai-precision-tip {
  flex-shrink: 0;
  margin: 0 24px 16px 24px;
  padding: 16px 16px 12px 16px;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: linear-gradient(90deg, #FFF4EC 0%, #FFFFFF 49.85%);
}
.ai-precision-tip-title {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  margin-bottom: 6px;
}
.ai-precision-tip-icon {
  flex-shrink: 0;
  color: #F4840C;
}
.ai-precision-tip-title-text {
  font-size: 14px;
  font-weight: 700;
  line-height: 22px;
  color: rgba(0, 0, 0, 0.9);
  white-space: nowrap;
}
.ai-precision-tip-desc {
  margin: 0;
  font-size: 13.7px;
  font-weight: 400;
  line-height: 22px;
  color: rgba(0, 0, 0, 0.9);
}
.ai-precision-tip-link {
  margin: 4px 0 0;
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
  color: var(--octo-primary, #0067D1);
  cursor: pointer;
}

/* ── 输入区 ── */
.ai-input-wrap {
  flex-shrink: 0;
  position: relative;
  margin: 0 24px 24px 24px;
}

/* 渐变光晕（在输入框下方扩散） */
.ai-input-wrap::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 16px;
  background: conic-gradient(
    from 0.5turn,
    rgba(246, 97, 23, 0.70) 0.6%,
    rgba(95, 45, 255, 0.70) 8.4%,
    rgba(61, 93, 255, 0.70) 21.8%,
    rgba(104, 138, 255, 0.70) 43.1%,
    rgba(28, 171, 111, 0.70) 54.2%,
    rgba(61, 93, 255, 0.70) 65.8%,
    rgba(61, 93, 255, 0.70) 87.4%,
    rgba(206, 7, 232, 0.70) 92.3%,
    rgba(246, 97, 23, 0.70) 100%
  );
  filter: blur(8px);
  opacity: 0.5;
  pointer-events: none;
}

.ai-input-area {
  flex-shrink: 0;
  padding: 16px 12px 8px 16px;
  background: #ffffff;
  display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-end;
  position: relative;
  border-radius: 16px;
}

/* 角度渐变描边（8色，opacity 0.70，1.2px） */
.ai-input-area::before {
  content: '';
  position: absolute;
  inset: 0;
  padding: 1.2px;
  border-radius: 16px;
  background: conic-gradient(
    from 0.5turn,
    rgba(246, 97, 23, 0.70) 0.6%,
    rgba(95, 45, 255, 0.70) 8.4%,
    rgba(61, 93, 255, 0.70) 21.8%,
    rgba(104, 138, 255, 0.70) 43.1%,
    rgba(28, 171, 111, 0.70) 54.2%,
    rgba(61, 93, 255, 0.70) 65.8%,
    rgba(61, 93, 255, 0.70) 87.4%,
    rgba(206, 7, 232, 0.70) 92.3%,
    rgba(246, 97, 23, 0.70) 100%
  );
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}

.ai-upload-btns {
  flex: 0 0 100%;
  display: flex;
  justify-content: flex-start;
  gap: 16px;
  padding-bottom: 4px;
}
.ai-upload-btn {
  position: relative;
  width: 48px; height: 60px; padding: 0;
  border: 0.5px solid rgba(223, 223, 223, 1);
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.04);
  color: rgba(0, 0, 0, 0.40);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease;
}
.ai-upload-btn:first-child { transform: rotate(-5deg); }
.ai-upload-btn:last-child  { transform: rotate(5deg); }
.ai-upload-btn:hover { background: rgba(0, 0, 0, 0.07); border-color: rgba(0, 103, 209, 0.4); }
.ai-upload-btn--filled { background: rgba(82, 196, 26, 0.06); }

.ai-upload-label { font-size: 8px; color: rgba(0, 0, 0, 0.40); line-height: 1; font-weight: 400; }
.ai-upload-preview { width: 100%; height: 100%; object-fit: cover; border-radius: 1px; display: block; }
.ai-upload-clear {
  position: absolute; top: -4px; right: -4px;
  width: 12px; height: 12px; padding: 0;
  border: none; background: transparent;
  cursor: pointer; display: flex;
  align-items: center; justify-content: center;
  transition: opacity 150ms ease;
}
.ai-upload-clear:hover { opacity: 0.7; }
.ai-switch-icon {
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  color: rgba(0, 0, 0, 0.60);
}

.ai-textarea {
  flex: 1; min-width: 0; resize: none;
  border: none; border-radius: 0;
  padding: 7px 10px 7px 0; font-size: 12px; line-height: 1.5; color: #191919;
  outline: none; background: transparent;
  font-family: inherit;
}
.ai-textarea:disabled { background: transparent; color: #bfbfbf; cursor: not-allowed; }
.ai-textarea::placeholder { color: rgba(0, 0, 0, 0.60); }

.ai-send-btn {
  flex-shrink: 0;
  border: none; border-radius: 50%;
  background: transparent;
  padding: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: opacity 150ms ease;
}
.ai-send-btn:hover:not(:disabled) { opacity: 0.85; }
.ai-send-btn:disabled { cursor: not-allowed; opacity: 0.4; }
.ai-send-icon { display: block; }
</style>
