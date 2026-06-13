<template>
  <transition name="ai-drawer">
    <div v-show="open" class="ai-chat-drawer">
      <!-- 头部 -->
      <div class="ai-drawer-header">
        <div class="ai-header-left">
          <svg class="ai-spark-icon" viewBox="0 0 16 16" width="15" height="15" fill="none">
            <path d="M8 1.5L9.8 6.2H14.5L10.5 8.8L12.2 13.5L8 10.8L3.8 13.5L5.5 8.8L1.5 6.2H6.2L8 1.5Z" fill="#0067D1" opacity="0.9"/>
          </svg>
          <span class="ai-drawer-title">AI 检视助手</span>
        </div>
        <div class="ai-header-actions">
          <button class="ai-action-btn" title="清空对话" @click="clearMessages">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
              <path d="M3 4H13M5 4V3H11V4M5.5 7V12M10.5 7V12M4 4L5 13H11L12 4H4Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="ai-action-btn" title="关闭" @click="$emit('close')">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
              <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- 消息列表 -->
      <div ref="messagesEl" class="ai-messages">
        <div v-if="messages.length === 0 && !streaming" class="ai-empty">
          <div class="ai-empty-icon">
            <svg viewBox="0 0 48 48" width="44" height="44" fill="none">
              <circle cx="24" cy="24" r="22" fill="#E6F2FD"/>
              <path d="M24 10L27 19H37L29.5 24.5L32.5 33.5L24 28L15.5 33.5L18.5 24.5L11 19H21L24 10Z" fill="#0067D1" opacity="0.85"/>
            </svg>
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
              <div
                v-for="(imgSrc, j) in msg.images"
                :key="j"
                class="ai-msg-thumb-wrap"
              >
                <img :src="imgSrc" class="ai-msg-thumb" :alt="j === 0 ? '设计稿' : '实现图'" />
                <span class="ai-msg-thumb-label">{{ j === 0 ? '设计稿' : '实现图' }}</span>
              </div>
            </div>
            <div v-if="msg.content" class="ai-msg-bubble ai-msg-bubble--user">{{ msg.content }}</div>
          </div>
          <!-- 普通消息 -->
          <div v-else class="ai-msg-bubble">{{ msg.content }}</div>
        </div>

        <div v-if="streaming" class="ai-msg ai-msg--assistant">
          <div class="ai-msg-bubble ai-msg-streaming">
            <template v-if="streamingContent">{{ streamingContent }}</template>
            <span v-else class="ai-typing"><i></i><i></i><i></i></span>
          </div>
        </div>
      </div>

      <!-- 图片预览区（有图时出现） -->
      <div v-if="imgSlots.some(s => s)" class="ai-img-previews">
        <div
          v-for="(slot, i) in imgSlots"
          :key="i"
          class="ai-img-preview-item"
          :class="{ 'ai-img-preview-item--empty': !slot }"
        >
          <template v-if="slot">
            <img :src="slot.preview" class="ai-img-preview-thumb" />
            <div class="ai-img-preview-label">{{ i === 0 ? '设计稿' : '实现图' }}</div>
            <button class="ai-img-preview-remove" @click="removeImg(i)" title="移除">
              <svg viewBox="0 0 10 10" width="8" height="8" fill="none">
                <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
            </button>
          </template>
        </div>
      </div>

      <!-- 输入区 -->
      <div class="ai-input-area">
        <!-- 图片上传按钮 -->
        <div class="ai-upload-btns">
          <button
            v-for="(slot, i) in imgSlots"
            :key="i"
            class="ai-upload-btn"
            :class="{ 'ai-upload-btn--filled': !!slot }"
            :title="i === 0 ? '上传设计稿图片' : '上传实现截图'"
            @click="triggerUpload(i)"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
              <rect x="1.5" y="3.5" width="13" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
              <circle cx="6" cy="8" r="1.5" stroke="currentColor" stroke-width="1.1"/>
              <path d="M9 10L11 7.5L13 10" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M8 3.5V1.5M6.5 2H9.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
            </svg>
            <span>{{ i === 0 ? '设计稿' : '实现图' }}</span>
          </button>
        </div>

        <textarea
          ref="inputEl"
          v-model="inputText"
          class="ai-textarea"
          :placeholder="imgSlots.some(s => s) ? '补充说明（可选）…' : '输入消息… Enter 发送，Shift+Enter 换行'"
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
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
            <path d="M13.5 2.5L1.5 7L7 9L9 14.5L13.5 2.5Z" fill="currentColor"/>
          </svg>
        </button>
      </div>

      <!-- 隐藏的 file input -->
      <input ref="fileInput0" type="file" accept="image/*" style="display:none" @change="e => onFileChange(0, e)" />
      <input ref="fileInput1" type="file" accept="image/*" style="display:none" @change="e => onFileChange(1, e)" />
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, nextTick, watch } from 'vue'

defineProps({
  open: { type: Boolean, default: false },
})
defineEmits(['close'])

const messages         = ref([])
const inputText        = ref('')
const streaming        = ref(false)
const streamingContent = ref('')
const messagesEl       = ref(null)
const fileInput0       = ref(null)
const fileInput1       = ref(null)

// imgSlots[0] = 设计稿, imgSlots[1] = 实现图，各为 { preview: dataURL } | null
const imgSlots = ref([null, null])

// 有图片时即使无文字也可发送；无图片时需有文字
const canSend = computed(() =>
  !streaming.value && (imgSlots.value.some(s => s) || inputText.value.trim() !== '')
)

function clearMessages() {
  if (streaming.value) return
  messages.value = []
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  })
}

watch(streamingContent, scrollToBottom)

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
  const text    = inputText.value.trim()
  const hasImgs = imgSlots.value.some(s => s)
  if (!hasImgs && !text) return
  if (streaming.value) return

  // 发送前记录当前图片（后面会清空 imgSlots）
  const currentImgSrcs = imgSlots.value.filter(s => s).map(s => s.preview)

  // 显示用消息（文字 + 缩略图）
  messages.value.push({
    role: 'user',
    content: text || (hasImgs ? '请对比两张图，分析设计还原差异' : ''),
    images: currentImgSrcs.length ? currentImgSrcs : undefined,
  })
  inputText.value  = ''
  imgSlots.value   = [null, null]
  scrollToBottom()

  streaming.value        = true
  streamingContent.value = ''

  // 构建 API messages：历史文字 + 当前多模态
  const historyText = messages.value.slice(0, -1).map(m => ({
    role: m.role,
    content: m.content,
  }))

  // 当前 user message：有图片则构建多模态 content
  const currentContent = hasImgs
    ? [
        ...currentImgSrcs.map(src => ({ type: 'image_url', image_url: { url: src } })),
        { type: 'text', text: text || '请对比两张图，分析设计还原差异' },
      ]
    : text

  const apiMessages = [
    ...historyText,
    { role: 'user', content: currentContent },
  ]

  try {
    const response = await fetch('/devlint/api/img/checker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'GLM-4.5-Air',  // 后台检测到图片时会自动覆盖为 glm-4.6v
        messages: apiMessages,
        stream: true,
      }),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(errText || `HTTP ${response.status}`)
    }

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
          const delta = json.choices?.[0]?.delta?.content ?? ''
          streamingContent.value += delta
        } catch { /* 跳过无效帧 */ }
      }
    }

    messages.value.push({ role: 'assistant', content: streamingContent.value })
  } catch (e) {
    messages.value.push({ role: 'assistant', content: `⚠️ 请求失败：${e.message}` })
  } finally {
    streaming.value        = false
    streamingContent.value = ''
    scrollToBottom()
  }
}
</script>

<style scoped>
.ai-chat-drawer {
  width: 320px;
  min-width: 320px;
  flex-shrink: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-right: 1px solid var(--octo-border-separator, #e8eaed);
  overflow: hidden;
}

/* ── 滑入/挤压动画 ── */
.ai-drawer-enter-active,
.ai-drawer-leave-active {
  transition: width 280ms cubic-bezier(0.4, 0, 0.2, 1),
              min-width 280ms cubic-bezier(0.4, 0, 0.2, 1),
              opacity 200ms ease;
  overflow: hidden;
}
.ai-drawer-enter-from,
.ai-drawer-leave-to {
  width: 0 !important;
  min-width: 0 !important;
  opacity: 0;
}
.ai-drawer-enter-to,
.ai-drawer-leave-from {
  width: 320px;
  min-width: 320px;
  opacity: 1;
}

/* ── 头部 ── */
.ai-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 44px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--octo-border-separator, #e8eaed);
  background: #fafbfc;
}
.ai-header-left { display: flex; align-items: center; gap: 6px; }
.ai-spark-icon  { flex-shrink: 0; }
.ai-drawer-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--octo-text-primary, #191919);
  white-space: nowrap;
}
.ai-header-actions { display: flex; gap: 2px; }
.ai-action-btn {
  width: 24px; height: 24px;
  border: none; background: transparent;
  cursor: pointer; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  color: #777777;
  transition: background 150ms ease, color 150ms ease;
  flex-shrink: 0;
}
.ai-action-btn:hover { background: #efefef; color: #191919; }

/* ── 消息列表 ── */
.ai-messages {
  flex: 1;
  overflow-y: auto;
  padding: 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scroll-behavior: smooth;
}

.ai-empty {
  flex: 1;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 10px; padding: 32px 20px; text-align: center;
}
.ai-empty-icon   { opacity: 0.9; }
.ai-empty-title  { font-size: 13px; font-weight: 600; color: var(--octo-text-primary, #191919); margin: 0; }
.ai-empty-hint   { font-size: 11px; color: #999999; line-height: 1.6; margin: 0; }

.ai-msg          { display: flex; max-width: 92%; }
.ai-msg--user    { align-self: flex-end; flex-direction: column; align-items: flex-end; }
.ai-msg--assistant { align-self: flex-start; }

.ai-msg-bubble {
  padding: 8px 12px; border-radius: 10px;
  font-size: 12px; line-height: 1.65;
  word-break: break-word; white-space: pre-wrap;
}
.ai-msg--user .ai-msg-bubble, .ai-msg-bubble--user {
  background: #0067D1; color: #ffffff;
  border-bottom-right-radius: 3px;
}
.ai-msg--assistant .ai-msg-bubble {
  background: #f0f4f8; color: #191919;
  border-bottom-left-radius: 3px;
}

/* 带图片的用户消息 */
.ai-msg-with-imgs {
  display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
}
.ai-msg-thumbs {
  display: flex; gap: 6px;
}
.ai-msg-thumb-wrap {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
}
.ai-msg-thumb {
  width: 72px; height: 72px;
  object-fit: cover; border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.3);
}
.ai-msg-thumb-label {
  font-size: 10px; color: rgba(255,255,255,0.75);
  background: #0067D1; padding: 1px 5px; border-radius: 3px;
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

/* ── 图片预览区 ── */
.ai-img-previews {
  flex-shrink: 0;
  display: flex; gap: 8px;
  padding: 8px 10px 0;
}
.ai-img-preview-item {
  position: relative;
  width: 72px; height: 72px;
  border-radius: 6px;
  overflow: visible;
  flex-shrink: 0;
}
.ai-img-preview-thumb {
  width: 72px; height: 72px;
  object-fit: cover; border-radius: 6px;
  border: 1px solid #D1D5DC;
  display: block;
}
.ai-img-preview-label {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  font-size: 10px; text-align: center;
  background: rgba(0,0,0,0.45); color: #fff;
  border-radius: 0 0 6px 6px;
  padding: 2px 0;
  pointer-events: none;
}
.ai-img-preview-remove {
  position: absolute; top: -6px; right: -6px;
  width: 16px; height: 16px;
  border: none; border-radius: 50%;
  background: #ff4d4f; color: #fff;
  cursor: pointer; display: flex;
  align-items: center; justify-content: center;
  transition: background 150ms ease;
  padding: 0;
}
.ai-img-preview-remove:hover { background: #d9363e; }

/* ── 输入区 ── */
.ai-input-area {
  flex-shrink: 0;
  padding: 8px 10px 10px;
  border-top: 1px solid var(--octo-border-separator, #e8eaed);
  background: #fafbfc;
  display: flex; flex-wrap: wrap; gap: 6px;
  align-items: flex-end;
}

.ai-upload-btns {
  display: flex; flex-direction: column; gap: 4px;
  flex-shrink: 0;
}

.ai-upload-btn {
  display: flex; align-items: center; gap: 4px;
  height: 26px; padding: 0 8px;
  border: 1px solid #D1D5DC; border-radius: 4px;
  background: #fff; color: #555;
  font-size: 11px; cursor: pointer;
  white-space: nowrap;
  transition: border-color 150ms ease, color 150ms ease, background 150ms ease;
}
.ai-upload-btn:hover {
  border-color: #0067D1; color: #0067D1; background: #e6f2fd;
}
.ai-upload-btn--filled {
  border-color: #52C41A; color: #389e0d; background: #f6ffed;
}
.ai-upload-btn--filled:hover { border-color: #389e0d; }

.ai-textarea {
  flex: 1; min-width: 0; resize: none;
  border: 1px solid #D1D5DC; border-radius: 6px;
  padding: 7px 10px;
  font-size: 12px; line-height: 1.5; color: #191919;
  outline: none; background: #ffffff;
  transition: border-color 150ms ease, box-shadow 150ms ease;
  font-family: inherit;
}
.ai-textarea:focus {
  border-color: #0067D1;
  box-shadow: 0 0 0 2px rgba(0, 103, 209, 0.15);
}
.ai-textarea:disabled { background: #f5f5f5; color: #bfbfbf; cursor: not-allowed; }
.ai-textarea::placeholder { color: #aaaaaa; }

.ai-send-btn {
  width: 32px; height: 32px; flex-shrink: 0;
  border: none; border-radius: 6px;
  background: #0067D1; color: #ffffff;
  cursor: pointer; display: flex;
  align-items: center; justify-content: center;
  transition: background 150ms ease;
}
.ai-send-btn:hover:not(:disabled) { background: #005aba; }
.ai-send-btn:disabled { background: #D1D5DC; cursor: not-allowed; }
</style>
