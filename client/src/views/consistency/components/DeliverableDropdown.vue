<template>
  <div class="deliverable-dropdown" ref="dropdownRef">
    <div class="deliverable-trigger" @click.stop="toggleOpen">
      <span class="deliverable-trigger-sep">/</span>
      <span class="deliverable-trigger-text" :title="selected?.name ?? placeholder">{{ selected?.name ?? placeholder }}</span>
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
          :class="{
            'is-selected': String(selected?.id) === String(item.id),
            'is-editing': allowEdit && editingId === item.id,
          }"
          @click="onSelect(item)"
        >
          <img v-if="item.devBase64Data" :src="item.devBase64Data" class="deliverable-thumb" />

          <!-- 编辑模式 -->
          <template v-if="allowEdit && editingId === item.id">
            <input
              :ref="el => { if (el) editInputEl = el }"
              v-model="editingName"
              class="deliverable-item-input"
              @click.stop
              @keydown.enter.prevent="onConfirmEdit(item)"
              @keydown.esc.prevent="cancelEdit"
            />
            <span
              class="deliverable-action-btn"
              :class="{ 'is-disabled': !editingName.trim() || editingName === item.name }"
              @click.stop="onConfirmEdit(item)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 7.5L5.5 11L12 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </template>

          <!-- 正常模式 -->
          <template v-else>
            <span class="deliverable-item-name" :title="item.name">{{ item.name }}</span>
            <span
              class="deliverable-action-btn deliverable-edit-trigger"
              @click.stop="onEditClick(item)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9.5 2L12 4.5M2 12L2.5 9.5L9.5 2L12 4.5L4.5 11.5L2 12Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </template>
        </div>
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
  allowEdit:      { type: Boolean, default: false },
})
const emit = defineEmits(['select', 'add', 'edit-item'])

const open        = ref(false)
const dropdownRef = ref(null)
const panelRef    = ref(null)
const panelStyle  = ref({})

const editingId   = ref(null)
const editingName = ref('')
const editInputEl = ref(null)

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
  else editingId.value = null
}

function onSelect(item) {
  if (props.allowEdit && editingId.value === item.id) return
  if (String(item.id) === String(props.selected?.id)) {
    open.value = false
    editingId.value = null
    return
  }
  emit('select', item)
  open.value = false
  editingId.value = null
}

function onAdd() {
  emit('add')
  open.value = false
}

function onEditClick(item) {
  editingId.value = item.id
  editingName.value = item.name
  nextTick(() => {
    editInputEl.value?.focus()
    editInputEl.value?.select()
  })
}

function onConfirmEdit(item) {
  const name = editingName.value.trim()
  if (!name || name === item.name) return
  emit('edit-item', { item, newName: name })
  editingId.value = null
}

function cancelEdit() {
  editingId.value = null
}

function onDocumentClick(e) {
  if (!open.value) return
  if (dropdownRef.value?.contains(e.target)) return
  if (panelRef.value?.contains(e.target)) return
  editingId.value = null
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
  min-width: 0;
}

.deliverable-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
  min-width: 0;
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
  overflow: hidden;
  text-overflow: ellipsis;
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
  gap: 8px;
  transition: background 150ms ease;
  flex-shrink: 0;
}

.deliverable-item.is-editing {
  cursor: default;
}

.deliverable-thumb {
  width: 20px;
  height: 28px;
  border-radius: 3px;
  object-fit: cover;
  flex-shrink: 0;
  background: #f0f0f0;
}

.deliverable-item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deliverable-item:hover {
  background: rgba(25, 25, 25, 0.05);
}
.deliverable-item.is-selected {
  background: #E6F2FD;
  color: #0067D1;
}

/* 编辑 input */
.deliverable-item-input {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 6px;
  border: 1px solid #0067D1;
  border-radius: 4px;
  font-size: 12px;
  color: #191919;
  outline: none;
  background: #fff;
  box-shadow: 0 0 0 2px rgba(0, 103, 209, 0.2);
}

/* 通用 action 按钮（编辑触发 / 对勾确认） */
.deliverable-action-btn {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #777777;
  flex-shrink: 0;
  transition: color 150ms ease, background-color 150ms ease;
}
.deliverable-action-btn:not(.is-disabled):hover {
  color: var(--octo-primary, #0067D1);
  background: #E6F2FD;
}
.deliverable-action-btn.is-disabled {
  color: #BFBFBF;
  cursor: not-allowed;
}

/* 编辑触发 icon：平时隐藏，hover item 时出现 */
.deliverable-edit-trigger {
  opacity: 0;
  margin-left: auto;
  transition: opacity 150ms ease, color 150ms ease, background-color 150ms ease;
}
.deliverable-item:hover .deliverable-edit-trigger {
  opacity: 1;
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
  flex-shrink: 0;
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
  flex-shrink: 0;
}
</style>
