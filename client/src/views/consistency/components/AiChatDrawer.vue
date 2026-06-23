<template>
  <div :class="['ai-side-panel', { 'ai-side-panel--open': open }]">
      <!-- 消息列表 -->
      <div ref="messagesEl" class="ai-messages">
        <div v-if="messages.length === 0 && !streaming" class="ai-empty">
          <div class="ai-empty-icon">
            <img src="@/assets/svg/octo-logo.svg" width="44" height="44" />
          </div>
          <p class="ai-empty-title">AI 检视助手</p>
          <p class="ai-empty-hint">上传设计稿与实现截图，AI 将自动对比分析差异</p>
        </div>

        <div
          v-for="(msg, i) in messages"
          :key="i"
          :class="['ai-msg', `ai-msg--${msg.role}`]"
        >
          <!-- 带图片的用户消息 -->
          <div v-if="msg.images && msg.images.length" class="ai-msg-with-imgs">
            <div class="ai-msg-thumbs">
              <div v-for="(imgSrc, j) in msg.images" :key="j" class="ai-msg-thumb-wrap">
                <img :src="imgSrc" class="ai-msg-thumb" :alt="j === 0 ? '设计稿' : '实现图'" />
                <span class="ai-msg-thumb-label">{{ j === 0 ? '设计稿' : '实现图' }}</span>
              </div>
            </div>
            <div v-if="msg.content" class="ai-msg-bubble ai-msg-bubble--user">{{ msg.content }}</div>
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
              <span v-if="!thinkDone" class="ai-think-badge">思考中</span>
            </button>
            <div ref="thinkBodyEl" class="ai-think-body" @scroll.passive="onThinkScroll">{{ streamingThink }}</div>
          </div>
          <div class="ai-msg-bubble ai-msg-streaming">
            <template v-if="streamingMain">{{ streamingMain }}</template>
            <span v-else class="ai-typing"><i></i><i></i><i></i></span>
          </div>
        </div>
      </div>


      <!-- 输入区 -->
      <div class="ai-input-wrap">
      <div class="ai-input-area">
        <div class="ai-upload-btns">
          <template v-for="(slot, i) in imgSlots" :key="i">
            <button
              class="ai-upload-btn"
              :class="{ 'ai-upload-btn--filled': !!slot }"
              :title="i === 0 ? '上传设计稿图片' : '上传实现截图'"
              @click="triggerUpload(i)"
            >
              <template v-if="slot">
                <img :src="slot.preview" class="ai-upload-preview" />
              </template>
              <template v-else>
                <svg viewBox="0 0 12 12" width="14" height="14" fill="none">
                  <path d="M6 1.5V10.5M1.5 6H10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                </svg>
                <span class="ai-upload-label">{{ i === 0 ? '设计稿' : '实现图' }}</span>
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
          :placeholder="placeholder"
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

marked.setOptions({ breaks: true })

const props = defineProps({
  open: { type: Boolean, default: false },
})
defineEmits(['close'])

function renderMd(content) {
  return DOMPurify.sanitize(marked.parse(content || ''))
}

// ── 请求中止 ─────────────────────────────────────────────────────────────────

let currentAbortController = null

function abortCurrentRequest() {
  if (currentAbortController) {
    currentAbortController.abort()
    currentAbortController = null
  }
}

watch(() => props.open, (val) => {
  if (!val) abortCurrentRequest()
})

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

const placeholder = computed(() => {
  if (!hasHistory.value) return hasBothImgs.value ? '补充说明（可选），Enter 发送…' : '请先上传设计稿和实现图'
  return hasBothImgs.value ? '补充说明（可选），Enter 发送…' : '继续追问（Enter 发送）…'
})

function clearMessages() {
  if (streaming.value) return
  messages.value = []
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

async function sendMessage() {
  if (streaming.value) return
  // 首轮：必须有两张图；追问：有图或有文字即可
  if (!hasHistory.value && !hasBothImgs.value) return
  const text    = inputText.value.trim()
  const hasImgs = hasBothImgs.value
  if (hasHistory.value && !hasImgs && !text) return

  const currentImgSrcs = hasImgs ? imgSlots.value.map(s => s.preview) : []

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
          ...m.images.map(src => ({ type: 'image_url', image_url: { url: src } })),
          { type: 'input_text', text: m.content },
        ],
      }
    }
    return { role: m.role, content: [{ type: 'input_text', text: m.content }] }
  })

  // 有图：携带图片 + 文字（注入 prompt 由后端决定）
  // 无图：纯文字追问（后端不注入 prompt）
  const currentContent = hasImgs
    ? [
        ...currentImgSrcs.map(src => ({ type: 'image_url', image_url: { url: src } })),
        { type: 'input_text', text: text || '请对比两张图' },
      ]
    : [{ type: 'input_text', text }]

  const apiMessages = [
    ...historyText,
    { role: 'user', content: currentContent },
  ]

  currentAbortController = new AbortController()

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
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      messages.value.push({ role: 'assistant', content: `⚠️ 请求失败：${e.message}` })
    }
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
  gap: 8px; padding: 32px 20px; text-align: center;
}
.ai-empty-icon   { opacity: 0.9; }
.ai-empty-title  { font-size: 32px; font-weight: 700; color: rgba(0, 0, 0, 0.90); margin: 0; }
.ai-empty-hint   { font-size: 14px; font-weight: 500; color: rgba(0, 0, 0, 0.60); line-height: 22px; margin: 0; }

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
.ai-think-badge {
  margin-left: auto;
  font-size: 10px; color: #999999;
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 5px; border-radius: 3px;
}
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
  word-break: break-word; white-space: pre-wrap;
}
.ai-msg--user .ai-msg-bubble, .ai-msg-bubble--user {
  background: rgba(10, 89, 247, 0.08); color: rgba(0, 0, 0, 0.9);
  border-bottom-right-radius: 2px;
}
.ai-msg--assistant .ai-msg-bubble {
  background: transparent; color: rgba(25, 25, 25, 1);
}

/* ── Markdown 渲染 ── */
.ai-msg-md { max-width: 100%; overflow-x: auto; }
.ai-msg-md :deep(h1), .ai-msg-md :deep(h2) {
  font-size: 13px; font-weight: 700; color: #191919;
  margin: 6px 0 2px; padding-bottom: 3px; border-bottom: 1px solid #e0e4ea;
}
.ai-msg-md :deep(h3) { font-size: 12px; font-weight: 600; color: #333; margin: 4px 0 2px; }
.ai-msg-md :deep(p)  { margin: 2px 0; line-height: 1.65; }
.ai-msg-md :deep(strong) { font-weight: 600; color: #191919; }
.ai-msg-md :deep(ul), .ai-msg-md :deep(ol) { padding-left: 16px; margin: 2px 0; }
.ai-msg-md :deep(li) { margin: 1px 0; line-height: 1.6; }
.ai-msg-md :deep(table) {
  width: 100%; border-collapse: collapse; font-size: 11px;
  margin: 6px 0; display: block; overflow-x: auto;
}
.ai-msg-md :deep(th) {
  background: #e6f2fd; color: #0067D1; font-weight: 600;
  padding: 5px 8px; border: 1px solid #c8dff7; white-space: nowrap; text-align: left;
}
.ai-msg-md :deep(td) { padding: 4px 8px; border: 1px solid #dde3ea; vertical-align: top; line-height: 1.5; }
.ai-msg-md :deep(tr:nth-child(even) td) { background: #f8fafc; }
.ai-msg-md :deep(code) {
  background: #e8ecf0; border-radius: 3px; padding: 1px 4px; font-size: 11px; font-family: monospace;
}
.ai-msg-md :deep(pre) { background: #e8ecf0; border-radius: 6px; padding: 8px 10px; overflow-x: auto; margin: 6px 0; }
.ai-msg-md :deep(pre code) { background: none; padding: 0; }

/* 带图片的用户消息 */
.ai-msg-with-imgs { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.ai-msg-thumbs   { display: flex; gap: 6px; }
.ai-msg-thumb-wrap { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.ai-msg-thumb {
  width: 72px; height: 72px; object-fit: cover;
  border-radius: 8px; border: 1px solid rgba(0,0,0,0.08);
}
.ai-msg-thumb-label {
  font-size: 10px; color: #777777;
  background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: 3px;
}

/* 流式打字点 */
.ai-typing { display: inline-flex; gap: 4px; align-items: center; height: 16px; }
.ai-typing i {
  display: inline-block; width: 5px; height: 5px;
  border-radius: 50%; background: #999;
  animation: ai-bounce 1.2s infinite; font-style: normal;
}
.ai-typing i:nth-child(2) { animation-delay: 0.2s; }
.ai-typing i:nth-child(3) { animation-delay: 0.4s; }
@keyframes ai-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.7; }
  30% { transform: translateY(-4px); opacity: 1; }
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
  width: 52px; height: 64px; padding: 0;
  border: 0.5px solid rgba(223, 223, 223, 1);
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.04);
  color: rgba(0, 0, 0, 0.40);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease;
}
.ai-upload-btn:nth-child(1) { transform: rotate(-4deg); }
.ai-upload-btn:nth-child(2) { transform: rotate(3deg); }
.ai-upload-btn:hover { background: rgba(0, 0, 0, 0.07); border-color: rgba(0, 103, 209, 0.4); }
.ai-upload-btn--filled { background: rgba(82, 196, 26, 0.06); }

.ai-upload-label { font-size: 8px; color: rgba(0, 0, 0, 0.40); line-height: 1; font-weight: 400; }
.ai-upload-preview { width: 100%; height: 100%; object-fit: cover; border-radius: 1px; display: block; }
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
