<template>
  <transition name="history-slide">
    <div v-if="visible" class="history-panel">
      <button class="history-close" @click.stop="$emit('close')">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
      <div class="history-list">
        <div v-if="!items.length" class="history-empty">暂无历史记录</div>
        <div
          v-for="(item, index) in items"
          :key="item.id"
          :class="['history-item', { 'is-active': String(item.id) === String(workingVersionId) }]"
          @click="handleView(item)"
        >
          <div class="timeline-col">
            <div class="timeline-seg" :class="{ 'tl-hidden': index === 0 }"></div>
            <div class="timeline-dot">
              <svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none">
                <path d="M8.97161 0.939172C8.73828 0.705839 8.4505 0.589172 8.10828 0.589172L3.62828 0.589172C3.28995 0.589172 2.97689 0.674728 2.68911 0.845839C2.39745 1.02084 2.16606 1.25223 1.99495 1.54001C1.82384 1.82778 1.73828 2.14084 1.73828 2.47917L1.73828 11.5208C1.73828 11.8669 1.82384 12.1839 1.99495 12.4717C2.16606 12.7633 2.39745 12.9928 2.68911 13.16C2.97689 13.3272 3.28995 13.4108 3.62828 13.4108L10.3599 13.4108C10.7061 13.4108 11.023 13.3272 11.3108 13.16C11.6024 12.9928 11.8338 12.7633 12.0049 12.4717C12.1761 12.1839 12.2616 11.8669 12.2616 11.5208L12.2616 4.73084C12.2616 4.39639 12.1411 4.10667 11.8999 3.86167L8.97161 0.939172ZM9.02995 4.22917C8.90939 4.22917 8.80634 4.18445 8.72078 4.09501C8.63911 4.00556 8.59828 3.90056 8.59828 3.78001L8.59828 1.80834L11.0191 4.22917L9.02995 4.22917ZM3.62828 12.5417C3.34828 12.5417 3.10717 12.4425 2.90495 12.2442C2.70273 12.042 2.60161 11.8008 2.60161 11.5208L2.60161 2.47917C2.60161 2.19917 2.70273 1.95806 2.90495 1.75584C3.10717 1.55751 3.34828 1.45834 3.62828 1.45834L7.71162 1.45834L7.71162 3.78001C7.71162 4.02112 7.76995 4.24278 7.88662 4.44501C8.00328 4.64723 8.16273 4.80667 8.36495 4.92334C8.56717 5.04001 8.78884 5.09834 9.02995 5.09834L11.3808 5.09834L11.3808 11.5208C11.3808 11.8008 11.2816 12.042 11.0833 12.2442C10.8811 12.4425 10.6399 12.5417 10.3599 12.5417L3.62828 12.5417ZM6.71995 7.00001C6.8405 7.00001 6.9455 6.95723 7.03495 6.87167C7.12439 6.79 7.16911 6.68889 7.16911 6.56834C7.16911 6.44389 7.12439 6.33889 7.03495 6.25334C6.9455 6.16389 6.8405 6.11917 6.71995 6.11917L4.38078 6.11917C4.268 6.11917 4.16884 6.16389 4.08328 6.25334C3.99384 6.33889 3.94911 6.44389 3.94911 6.56834C3.94911 6.68889 3.99384 6.79 4.08328 6.87167C4.16884 6.95723 4.268 7.00001 4.38078 7.00001L6.71995 7.00001ZM4.38078 8.61001C4.268 8.61001 4.16884 8.65278 4.08328 8.73834C3.99384 8.82001 3.94911 8.92112 3.94911 9.04167C3.94911 9.16612 3.99384 9.26917 4.08328 9.35084C4.16884 9.43639 4.268 9.47917 4.38078 9.47917L9.61912 9.47917C9.73967 9.47917 9.84273 9.43639 9.92828 9.35084C10.0099 9.26917 10.0508 9.16612 10.0508 9.04167C10.0508 8.92112 10.0099 8.82001 9.92828 8.73834C9.84273 8.65278 9.73967 8.61001 9.61912 8.61001L4.38078 8.61001Z" fill="currentColor" fill-rule="nonzero" />
              </svg>
            </div>
            <div class="timeline-seg" :class="{ 'tl-hidden': index === items.length - 1 }"></div>
          </div>
          <div class="item-content">
            <span class="item-time">{{ formatTime(item.createTime) }}</span>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
const props = defineProps({
  visible:          { type: Boolean,            default: false },
  items:            { type: Array,              default: () => [] },
  workingVersionId: { type: [Number, String],   default: null },
})

const emit = defineEmits(['close', 'view'])

function formatTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function handleView(item) {
  if (String(item.id) === String(props.workingVersionId)) {
    emit('close')
    return
  }
  emit('view', item)
}
</script>

<style scoped>
.history-panel {
  position: fixed;
  top: calc(var(--octo-top-nav-height, 56px) + var(--octo-tabbar-height, 56px));
  right: 0;
  width: 336px;
  height: calc(100vh - var(--octo-top-nav-height, 56px) - var(--octo-tabbar-height, 56px));
  background: var(--octo-surface-page);
  border-left: 1px solid var(--octo-border-default);
  display: flex;
  flex-direction: column;
  z-index: 200;
  overflow: hidden;
}

.history-close {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--octo-text-secondary);
  border-radius: 4px;
  transition: background 150ms ease, color 150ms ease;
  z-index: 1;
}
.history-close:hover {
  background: var(--octo-surface-hover);
  color: var(--octo-text-primary);
}

.history-slide-enter-active,
.history-slide-leave-active {
  transition: transform 250ms ease;
}
.history-slide-enter-from,
.history-slide-leave-to {
  transform: translateX(100%);
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px;
}

.history-empty {
  padding: 24px 0;
  text-align: center;
  font-size: 13px;
  color: var(--octo-text-secondary);
}

/* ── 每条记录 ── */
.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  min-height: 48px;
}

.item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 8px;
  border-radius: 8px;
  transition: background 150ms ease;
}
.history-item:hover .item-content {
  background: rgba(25, 25, 25, 0.05);
}
.history-item:active .item-content {
  background: #E6F2FD;
}

/* ── 时间轴列 ── */
.timeline-col {
  width: 24px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  align-self: stretch;
}

.timeline-seg {
  width: 1px;
  flex: 1;
  min-height: 12px;
  background: #DFDFDF;
}
.tl-hidden {
  visibility: hidden;
}

.timeline-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: transparent;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #BFBFBF;
  transition: background 150ms ease, color 150ms ease;
}
.is-active .timeline-dot,
.history-item:active .timeline-dot {
  background: #0067D1;
  color: #ffffff;
}
.item-time {
  font-size: 12px;
  line-height: 20px;
  color: #777;
  white-space: nowrap;
}
.is-active .item-time,
.history-item:active .item-time {
  color: #0067D1;
}
</style>
