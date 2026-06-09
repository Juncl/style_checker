/**
 * 就地规整中间树：消除"父子尺寸位置完全一致 + 无视觉装饰"的冗余包装层。
 *
 * 输入节点形状（建树阶段需保证字段命名一致）：
 *   {
 *     rect: { x, y, w, h },   // 同侧解析后的数值（开发侧 vp，设计侧 dp），严格相等比较
 *     type,                    // 小写字符串：'text' / 'container' / ...
 *     children: [],
 *     style: {
 *       backgroundColor,       // 字符串；透明 / '#00xxxxxx' / 'transparent' / 空 均视为无背景
 *       borderRadius,          // number | string | { topLeft, topRight, bottomLeft, bottomRight }
 *       shadow,                // { radius, ... }
 *       blur, backdropBlur,    // number
 *       border,                // { width, ... } 或 number
 *     },
 *   }
 *
 * 折叠规则（两种方向）：
 *
 * 正向（原）：child 同时满足以下全部条件时，删除 child 本身，把它的 children
 * （即原 node 的孙子）原位接到 node.children：
 *   1. child 非叶子（child.children.length > 0）
 *   2. child.type !== 'text'
 *   3. 父子 x/y/w/h 严格相等
 *   4. child 无视觉装饰（纯包裹层）
 *
 * 反向（新增）：child 为纯包裹层，其直系子节点中有同 rect + 有视觉装饰 + 非文本时，
 * 同样删除 child，把它的 children 提升到 node.children（"删父保子"）：
 *   1. child 非叶子
 *   2. child.type !== 'text'
 *   3. child 无视觉装饰（纯包裹层）
 *   4. child 的某个非文本子节点与 child 同 rect 且有视觉装饰
 *
 * 注意：opacity=0 / visibility=hidden / 越界等的子树应在建树阶段就剪掉，本函数不再处理。
 *
 * @param {object} root 根节点（就地修改）
 * @returns 同一 root 引用
 */
export function normalizeTree(root) {
  if (!root) return root

  function fix(node) {
    if (!node) return
    if (!Array.isArray(node.children)) node.children = []

    let i = 0
    while (i < node.children.length) {
      const child = node.children[i]

      // 正向：child 自身同 rect + 纯包裹层 → 删 child 保 node 直连孙子
      const collapsible =
        child &&
        Array.isArray(child.children) && child.children.length > 0 &&
        child.type !== 'text' &&
        sameBox(node, child) &&
        isPureWrapper(child)

      if (collapsible) {
        node.children.splice(i, 1, ...child.children)
        continue
      }

      // 反向：child 是纯包裹层，但其下属有同 rect 带视觉的子节点 → 删 child 保孙子（删父保子）
      const reverseCollapsible =
        child &&
        Array.isArray(child.children) && child.children.length > 0 &&
        child.type !== 'text' &&
        isPureWrapper(child) &&
        hasVisualSameRectChild(child)

      if (reverseCollapsible) {
        node.children.splice(i, 1, ...child.children)
        continue
      }

      fix(child)
      i++
    }
  }

  fix(root)
  return root
}

// 检查 node 是否存在一个非文本子节点，与其同 rect 且有视觉装饰
function hasVisualSameRectChild(node) {
  if (!Array.isArray(node.children)) return false
  for (const c of node.children) {
    if (c.type === 'text') continue
    if (sameBox(node, c) && !isPureWrapper(c)) return true
  }
  return false
}

function sameBox(a, b) {
  return a.rect.x === b.rect.x && a.rect.y === b.rect.y && a.rect.w === b.rect.w && a.rect.h === b.rect.h
}

function isPureWrapper(n) {
  const s = n.style || {}
  return isTransparentBg(s.backgroundColor) &&
    !hasRadius(s.borderRadius) &&
    !hasShadow(s.shadow) &&
    !hasBlur(s) &&
    !hasBorder(s.border)
}

function isTransparentBg(bg) {
  if (bg == null || bg === '') return true
  if (typeof bg !== 'string') return false
  const s = bg.trim().toLowerCase()
  if (!s || s === 'transparent' || s === 'none') return true
  if (s.startsWith('#00')) return true
  const m = s.match(/^rgba?\(([^)]+)\)$/)
  if (m) {
    const parts = m[1].split(',').map(p => p.trim())
    if (parts.length === 4 && parseFloat(parts[3]) === 0) return true
  }
  return false
}

function hasRadius(br) {
  if (br == null) return false
  if (typeof br === 'number') return br > 0
  if (typeof br === 'string') return parseFloat(br) > 0
  if (typeof br === 'object') return Object.values(br).some(v => parseFloat(v) > 0)
  return false
}

function hasShadow(sh) {
  return !!sh && typeof sh === 'object' && parseFloat(sh.radius) > 0
}

function hasBlur(n) {
  return parseFloat(n.blur) > 0 || parseFloat(n.backdropBlur) > 0
}

function hasBorder(b) {
  if (!b) return false
  if (typeof b === 'object') return parseFloat(b.width) > 0
  return parseFloat(b) > 0
}
