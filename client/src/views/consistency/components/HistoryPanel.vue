<template>
  <transition name="history-slide">
    <div v-if="visible" class="history-panel" @click="activeMoreId = null">
      <div class="history-header">
        <span class="history-title">历史报告</span>
        <button class="history-close" @click.stop="$emit('close')">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <div class="history-list">
        <div v-if="!items.length" class="history-empty">暂无历史记录</div>
        <div
          v-for="item in items"
          :key="item.id"
          :class="['history-item', { 'is-active': String(item.id) === String(workingVersionId) }]"
          @mouseenter="hoveredId = item.id"
          @mouseleave="hoveredId = null"
          @click="handleView(item)"
        >
          <div class="history-item-body">
            <span class="history-item-time">{{ formatTime(item.createTime) }}</span>
            <el-tag
              :type="problemTagType(item.problems?.length ?? 0)"
              class="score-tag"
              effect="plain"
            >{{ item.problems?.length ?? 0 }} 个问题</el-tag>
          </div>
          <!-- more-op 按钮（含 more-menu 子层），暂时隐藏 -->
          <button
            v-show="false"
            class="more-btn"
            @click.stop="toggleMore(item.id)"
          >
            <img src="@/assets/svg/more-op.svg" width="16" height="16" />
            <transition name="more-pop">
              <div v-if="activeMoreId === item.id" class="more-menu" @click.stop>
                <button class="more-menu-item" @click.stop="handleView(item)">查看</button>
              </div>
            </transition>
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  visible:          { type: Boolean,            default: false },
  items:            { type: Array,              default: () => [] },
  workingVersionId: { type: [Number, String],   default: null },
})

const emit = defineEmits(['close', 'view'])

const hoveredId    = ref(null)
const activeMoreId = ref(null)

function formatTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function problemTagType(count) {
  if (count === 0) return 'success'
  if (count <= 5)  return 'warning'
  return 'danger'
}

function toggleMore(id) {
  activeMoreId.value = activeMoreId.value === id ? null : id
}

function handleView(item) {
  activeMoreId.value = null
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

.history-slide-enter-active,
.history-slide-leave-active {
  transition: transform 250ms ease;
}
.history-slide-enter-from,
.history-slide-leave-to {
  transform: translateX(100%);
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  height: 48px;
  border-bottom: 1px solid var(--octo-border-default);
  flex-shrink: 0;
}

.history-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--octo-text-primary);
}

.history-close {
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
}

.history-close:hover {
  background: var(--octo-surface-hover);
  color: var(--octo-text-primary);
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.history-empty {
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--octo-text-secondary);
}

.history-item {
  position: relative;
  display: flex;
  align-items: center;
  padding: 12px 16px;
  padding-right: 44px;
  cursor: pointer;
  transition: background 150ms ease;
}

.history-item:hover {
  background: var(--octo-surface-hover);
}

.history-item.is-active {
  background: var(--octo-primary-subtle);
}

.history-item.is-active .history-item-time {
  color: var(--octo-primary);
  font-weight: 500;
}

.history-item-body {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.history-item-time {
  font-size: 13px;
  color: var(--octo-text-primary);
  white-space: nowrap;
}

.score-tag {
  font-size: 10px !important;
  height: 22px !important;
  line-height: 18px !important;
  padding: 2px 8px !important;
  flex-shrink: 0;
}

/* more-op 按钮：绝对定位在右侧，内部含 more-menu */
.more-btn {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: 4px;
  transition: background 150ms ease;
}

.more-btn:hover {
  background: rgba(0, 0, 0, 0.06);
}

/* more-menu 在 more-btn 的左下角弹出 */
.more-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 10;
  background: var(--octo-surface-page);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 4px;
  min-width: 80px;
}

.more-menu-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: var(--octo-text-primary);
  border-radius: 4px;
  transition: background 150ms ease;
  white-space: nowrap;
}

.more-menu-item:hover {
  background: var(--octo-surface-hover);
}

.more-pop-enter-active,
.more-pop-leave-active {
  transition: opacity 100ms ease, transform 100ms ease;
}
.more-pop-enter-from,
.more-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.97);
}
</style>
