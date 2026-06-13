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
          <p class="ai-empty-hint">描述你的问题，AI 将协助分析设计还原差异</p>
        </div>

        <div
          v-for="(msg, i) in messages"
          :key="i"
          :class="['ai-msg', `ai-msg--${msg.role}`]"
        >
          <div class="ai-msg-bubble">{{ msg.content }}</div>
        </div>

        <div v-if="streaming" class="ai-msg ai-msg--assistant">
          <div class="ai-msg-bubble ai-msg-streaming">
            <template v-if="streamingContent">{{ streamingContent }}</template>
            <span v-else class="ai-typing">
              <i></i><i></i><i></i>
            </span>
          </div>
        </div>
      </div>

      <!-- 输入区 -->
      <div class="ai-input-area">
        <textarea
          ref="inputEl"
          v-model="inputText"
          class="ai-textarea"
          placeholder="输入消息… Enter 发送，Shift+Enter 换行"
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
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, nextTick, watch } from 'vue'

defineProps({
  open: { type: Boolean, default: false },
})
defineEmits(['close'])

const messages        = ref([])
const inputText       = ref('')
const streaming       = ref(false)
const streamingContent = ref('')
const messagesEl      = ref(null)

const canSend = computed(() => inputText.value.trim() !== '' && !streaming.value)

function clearMessages() {
  if (streaming.value) return
  messages.value = []
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight
    }
  })
}

watch(streamingContent, scrollToBottom)

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (canSend.value) sendMessage()
  }
}

async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || streaming.value) return

  messages.value.push({ role: 'user', content: text })
  inputText.value = ''
  scrollToBottom()

  streaming.value = true
  streamingContent.value = ''

  const historyMsgs = messages.value.map(m => ({ role: m.role, content: m.content }))

  try {
    const response = await fetch('/devlint/api/img/checker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'GLM-4.5-Air', messages: historyMsgs, stream: true }),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(errText || `HTTP ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

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
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content ?? ''
          streamingContent.value += delta
        } catch { /* 跳过无效帧 */ }
      }
    }

    messages.value.push({ role: 'assistant', content: streamingContent.value })
  } catch (e) {
    messages.value.push({ role: 'assistant', content: `⚠️ 请求失败：${e.message}` })
  } finally {
    streaming.value = false
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

.ai-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ai-spark-icon { flex-shrink: 0; }

.ai-drawer-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--octo-text-primary, #191919);
  white-space: nowrap;
}

.ai-header-actions {
  display: flex;
  gap: 2px;
}

.ai-action-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #777777;
  transition: background 150ms ease, color 150ms ease;
  flex-shrink: 0;
}
.ai-action-btn:hover {
  background: #efefef;
  color: #191919;
}

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
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px 20px;
  text-align: center;
}

.ai-empty-icon { opacity: 0.9; }

.ai-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--octo-text-primary, #191919);
  margin: 0;
}

.ai-empty-hint {
  font-size: 11px;
  color: #999999;
  line-height: 1.6;
  margin: 0;
}

.ai-msg {
  display: flex;
  max-width: 88%;
}

.ai-msg--user    { align-self: flex-end; }
.ai-msg--assistant { align-self: flex-start; }

.ai-msg-bubble {
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.65;
  word-break: break-word;
  white-space: pre-wrap;
}

.ai-msg--user .ai-msg-bubble {
  background: #0067D1;
  color: #ffffff;
  border-bottom-right-radius: 3px;
}

.ai-msg--assistant .ai-msg-bubble {
  background: #f0f4f8;
  color: #191919;
  border-bottom-left-radius: 3px;
}

/* 流式打字点 */
.ai-typing {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  height: 16px;
}
.ai-typing i {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #999;
  animation: ai-bounce 1.2s infinite;
  font-style: normal;
}
.ai-typing i:nth-child(2) { animation-delay: 0.2s; }
.ai-typing i:nth-child(3) { animation-delay: 0.4s; }
@keyframes ai-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.7; }
  30% { transform: translateY(-4px); opacity: 1; }
}

/* ── 输入区 ── */
.ai-input-area {
  flex-shrink: 0;
  padding: 10px;
  border-top: 1px solid var(--octo-border-separator, #e8eaed);
  background: #fafbfc;
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.ai-textarea {
  flex: 1;
  min-width: 0;
  resize: none;
  border: 1px solid #D1D5DC;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: #191919;
  outline: none;
  background: #ffffff;
  transition: border-color 150ms ease, box-shadow 150ms ease;
  font-family: inherit;
}
.ai-textarea:focus {
  border-color: #0067D1;
  box-shadow: 0 0 0 2px rgba(0, 103, 209, 0.15);
}
.ai-textarea:disabled {
  background: #f5f5f5;
  color: #bfbfbf;
  cursor: not-allowed;
}
.ai-textarea::placeholder { color: #aaaaaa; }

.ai-send-btn {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border: none;
  border-radius: 6px;
  background: #0067D1;
  color: #ffffff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 150ms ease;
}
.ai-send-btn:hover:not(:disabled) { background: #005aba; }
.ai-send-btn:disabled {
  background: #D1D5DC;
  cursor: not-allowed;
}
</style>
