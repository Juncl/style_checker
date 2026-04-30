<template>
  <div class="node-tree">
    <!-- 工具栏 -->
    <div class="tree-toolbar">
      <el-input
        v-model="search"
        size="small"
        placeholder="搜索节点名称/文本..."
        clearable
        class="tree-search"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <label class="matched-toggle">
        <input type="checkbox" v-model="matchedOnly" />
        <span>仅匹配</span>
      </label>
    </div>

    <!-- 统计条 -->
    <div class="tree-stats">
      <span>共 {{ totalCount }} 个节点</span>
      <span class="matched-count">{{ matchedCount }} 已匹配</span>
      <span v-if="lockedCount > 0" class="locked-count">{{ lockedCount }} 已锁定</span>
    </div>

    <!-- 节点列表 -->
    <div class="tree-list" ref="listRef">
      <template v-if="displayNodes.length === 0">
        <div class="tree-empty">无匹配节点</div>
      </template>

      <div
        v-for="node in displayNodes"
        :key="node.id"
        :class="[
          'tree-node',
          node.type,
          {
            matched:   node.matched,
            unmatched: !node.matched,
            selected:  selectedNodeId === node.id,
            locked:    lockedIds.has(node.id),
          }
        ]"
        :style="{ paddingLeft: `${8 + node.depth * 14}px` }"
        :title="!node.matched ? '未匹配（无对应 ArkUI 节点）' : lockedIds.has(node.id) ? '已锁定（图片侧不可点击，树中仍可选中）' : ''"
        @click="onNodeClick(node)"
      >
        <!-- 缩进 -->
        <span class="depth-indent" v-if="node.depth > 0">
          <span v-for="i in node.depth" :key="i" class="indent-bar" />
        </span>

        <!-- 类型徽标 -->
        <span :class="['type-chip', node.type]">{{ typeLabel(node.type) }}</span>

        <!-- 节点标签 -->
        <span class="node-label">
          <span class="node-primary">{{ node.textContent || node.name }}</span>
          <span v-if="node.textContent && node.name !== node.textContent" class="node-secondary">
            {{ node.name }}
          </span>
        </span>

        <!-- 右侧操作区 -->
        <span class="node-actions" @click.stop>
          <!-- 锁定按钮（仅匹配节点） -->
          <button
            v-if="lockable && node.matched"
            :class="['lock-btn', { active: lockedIds.has(node.id) }]"
            :title="lockedIds.has(node.id) ? '解除锁定' : '锁定（图片侧不可点击）'"
            @click.stop="$emit('toggle-lock', node.id)"
          >
            <svg v-if="lockedIds.has(node.id)" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <path d="M11 7V5a3 3 0 0 0-6 0v2H4v7h8V7h-1zm-4-2a1 1 0 0 1 2 0v2H7V5zm1 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
            </svg>
            <svg v-else viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <path d="M11 7V5a3 3 0 0 0-6 0v2H4v7h8V7h-1zm-2-2v2H7V5a1 1 0 0 1 2 0zm0 6a1 1 0 1 1-2 0 1 1 0 0 1 2 0z" opacity=".4"/>
              <path d="M11 2a3 3 0 0 1 3 3v2h-2V5a1 1 0 0 0-2 0v2H4v7h8V9h2v5H2V7h3V5a3 3 0 0 1 3-3h3z" opacity=".4"/>
            </svg>
          </button>

          <!-- 未匹配指示 -->
          <span v-else class="unmatched-dot" />
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'

const props = defineProps({
  nodes:          { type: Array,  default: () => [] },
  selectedDesignId: { type: String, default: null },
  selectedId:     { type: String, default: null },
  lockedIds:      { type: Object, default: () => new Set() }, // Set<string>
  lockable:       { type: Boolean, default: true },
})
const emit = defineEmits(['select', 'toggle-lock'])

const search      = ref('')
const matchedOnly = ref(false)
const listRef     = ref(null)
const selectedNodeId = computed(() => props.selectedId || props.selectedDesignId)

function comparePaths(a, b) {
  const pa = normalizePath(a)
  const pb = normalizePath(b)
  const len = Math.min(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return pa.length - pb.length
}

function normalizePath(path) {
  return Array.isArray(path) ? path : []
}

const sortedNodes = computed(() =>
  [...props.nodes]
    .sort((a, b) => comparePaths(a.path, b.path) || (a.paintIndex ?? 0) - (b.paintIndex ?? 0))
    .map(n => ({ ...n, depth: Math.max(0, normalizePath(n.path).length - 1) }))
)

const totalCount  = computed(() => props.nodes.length)
const matchedCount = computed(() => props.nodes.filter(n => n.matched).length)
const lockedCount  = computed(() => props.lockedIds.size)

const displayNodes = computed(() => {
  const q = search.value.trim().toLowerCase()
  let list = sortedNodes.value
  if (matchedOnly.value) list = list.filter(n => n.matched)
  if (q) list = list.filter(n =>
    String(n.name || '').toLowerCase().includes(q) ||
    (n.textContent || '').toLowerCase().includes(q)
  )
  return list
})

function typeLabel(type) {
  if (type === 'text')      return 'T'
  if (type === 'container') return 'C'
  if (type === 'image')     return 'I'
  return '·'
}

function onNodeClick(node) {
  emit('select', node.id)
}

watch(selectedNodeId, async (id) => {
  if (!id || !listRef.value) return
  await nextTick()
  const el = listRef.value.querySelector('.tree-node.selected')
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})
</script>

<style scoped>
.node-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.tree-toolbar {
  padding: 8px 10px 6px;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.tree-search { flex: 1; }

.matched-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #606266;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.matched-toggle input { cursor: pointer; }

.tree-stats {
  display: flex;
  gap: 8px;
  padding: 4px 12px;
  font-size: 10.5px;
  color: #909399;
  background: #fafafa;
  border-bottom: 1px solid #f0f0f0;
  flex-shrink: 0;
}
.matched-count { color: #409eff; }
.locked-count  { color: #f56c6c; margin-left: auto; }

.tree-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.tree-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 80px;
  font-size: 12px;
  color: #c0c4cc;
}

/* ── 节点行 ── */
.tree-node {
  display: flex;
  align-items: center;
  gap: 5px;
  padding-top: 3px;
  padding-bottom: 3px;
  padding-right: 6px;
  font-size: 11.5px;
  line-height: 1.5;
  border-radius: 4px;
  margin: 1px 4px;
  transition: background .1s;
  min-width: 0;
}

.tree-node.matched {
  cursor: pointer;
  color: #303133;
}
.tree-node.matched:hover { background: #f0f7ff; }
.tree-node.matched:hover .lock-btn { opacity: 1; }
.tree-node.matched.selected { background: #ecf5ff; }

/* 锁定节点：树中仍可点击，但文字变色提示状态 */
.tree-node.matched.locked {
  color: #909399;
  background: #fdf6f6;
}
.tree-node.matched.locked:hover { background: #fef0f0; }
.tree-node.matched.locked:hover .lock-btn { opacity: 1; }

.tree-node.unmatched {
  cursor: pointer;
  color: #86909c;
}
.tree-node.unmatched:hover { background: #f7f9fc; }

/* 锁定状态始终显示锁定按钮 */
.tree-node.locked .lock-btn { opacity: 1 !important; }

.depth-indent { display: flex; flex-shrink: 0; }
.indent-bar   { display: inline-block; width: 14px; flex-shrink: 0; }

/* ── 类型徽标 ── */
.type-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}
.type-chip.text      { background: #eef4ff; color: #0a59f7; }
.type-chip.container { background: #f0f0ff; color: #8b5cf6; }
.type-chip.image     { background: #f0fff4; color: #22c55e; }
.type-chip.other     { background: #f5f5f5; color: #909399; }

/* ── 节点标签 ── */
.node-label {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}
.node-primary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.node-secondary {
  font-size: 10px;
  color: #c0c4cc;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60px;
}

/* ── 右侧操作区 ── */
.node-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: auto;
  padding-left: 4px;
}

/* 锁定按钮 */
.lock-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  border-radius: 3px;
  cursor: pointer;
  opacity: 0;
  color: #c0c4cc;
  transition: opacity .15s, color .15s, background .15s;
  padding: 0;
}
.lock-btn:hover { background: #f5f7fa; color: #606266; }
.lock-btn.active {
  opacity: 1 !important;
  color: #f56c6c;
}
.lock-btn.active:hover { background: #fef0f0; color: #f56c6c; }

.unmatched-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #e4e7ed;
  flex-shrink: 0;
}
</style>
