<template>
  <div class="deliverable-dropdown" ref="dropdownRef">
    <div class="deliverable-trigger" @click.stop="toggleOpen">
      <span class="deliverable-trigger-sep">/</span>
      <span class="deliverable-trigger-text">{{ selected?.name ?? placeholder }}</span>
      <el-icon class="deliverable-trigger-arrow" :class="{ 'is-open': open }"><ArrowDown /></el-icon>
    </div>
    <Teleport to="body">
      <div v-show="open" ref="panelRef" class="deliverable-panel" :style="panelStyle">
        <div v-if="showAddButton" class="deliverable-add-btn" @click="onAdd">
          <el-icon class="deliverable-add-icon"><Plus /></el-icon>
          <span>{{ addButtonText }}</span>
        </div>
        <div v-if="showAddButton" class="deliverable-separator"></div>
        <div v-if="!items.length" class="deliverable-empty">{{ emptyText }}</div>
        <div
          v-for="item in items"
          :key="item.id"
          class="deliverable-item"
          :class="{ 'is-selected': selected?.id === item.id }"
          @click="onSelect(item)"
        >{{ item.name }}</div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { ArrowDown, Plus } from '@element-plus/icons-vue'

const props = defineProps({
  items:          { type: Array,   default: () => [] },
  selected:       { type: Object,  default: null },
  placeholder:    { type: String,  default: '选择' },
  emptyText:      { type: String,  default: '暂无数据' },
  showAddButton:  { type: Boolean, default: false },
  addButtonText:  { type: String,  default: '新增页面' },
})
const emit = defineEmits(['select', 'add'])

const open        = ref(false)
const dropdownRef = ref(null)
const panelRef    = ref(null)
const panelStyle  = ref({})

function updatePanelPosition() {
  if (!dropdownRef.value) return
  const rect = dropdownRef.value.getBoundingClientRect()
  panelStyle.value = {
    top:  `${rect.bottom + 8}px`,
    left: `${rect.left}px`,
  }
}

function toggleOpen() {
  open.value = !open.value
  if (open.value) nextTick(updatePanelPosition)
}

function onSelect(item) {
  if (item.id === props.selected?.id) {
    open.value = false
    return
  }
  emit('select', item)
  open.value = false
}

function onAdd() {
  emit('add')
  open.value = false
}

function onDocumentClick(e) {
  if (!open.value) return
  if (dropdownRef.value?.contains(e.target)) return
  if (panelRef.value?.contains(e.target)) return
  open.value = false
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))
</script>

<style scoped>
.deliverable-dropdown {
  position: relative;
  display: flex;
  align-items: center;
}

.deliverable-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
}

.deliverable-trigger-sep {
  font-size: 14px;
  color: var(--octo-text-placeholder);
}

.deliverable-trigger-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--octo-text-primary);
  white-space: nowrap;
}

.deliverable-trigger-arrow {
  font-size: 14px;
  color: var(--octo-text-secondary, #555);
  transition: transform 200ms ease;
}
.deliverable-trigger-arrow.is-open {
  transform: rotate(180deg);
}
</style>

<style>
.deliverable-panel {
  position: fixed;
  z-index: 9999;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
  max-width: 280px;
  max-height: 360px;
  overflow-y: auto;
}

.deliverable-item {
  height: 38px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 14px;
  color: #191919;
  cursor: pointer;
  display: flex;
  align-items: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 150ms ease;
  flex-shrink: 0;
}
.deliverable-item:hover {
  background: rgba(25, 25, 25, 0.05);
}
.deliverable-item.is-selected {
  background: #E6F2FD;
  color: #0067D1;
}

.deliverable-empty {
  padding: 8px;
  font-size: 12px;
  color: #888;
  text-align: center;
}

.deliverable-add-btn {
  height: 38px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px dashed #C9C9C9;
  font-size: 14px;
  color: #191919;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  white-space: nowrap;
  background: rgba(25, 25, 25, 0.05);
  transition: background 150ms ease;
}
.deliverable-add-btn:hover {
  background: rgba(25, 25, 25, 0.08);
}

.deliverable-add-icon {
  font-size: 14px;
  color: #191919;
  flex-shrink: 0;
}

.deliverable-separator {
  height: 1px;
  background: rgba(223, 223, 223, 1);
  margin: 2px 0;
}
</style>
