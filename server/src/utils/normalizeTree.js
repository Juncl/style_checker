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
 * 折叠规则：child 同时满足以下全部条件时，删除 child 本身，把它的 children
 * （即原 node 的孙子）原位接到 node.children：
 *   1. child 非叶子（child.children.length > 0）
 *   2. child.type !== 'text'
 *   3. 父子 x/y/w/h 严格相等
 *   4. 无视觉装饰：背景透明 + 无圆角 + 无阴影 + 无模糊(blur/backdropBlur) + 无边框
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
      const collapsible =
        child &&
        Array.isArray(child.children) && child.children.length > 0 &&
        child.type !== 'text' &&
        sameBox(node, child) &&
        isPureWrapper(child)

      if (collapsible) {
        node.children.splice(i, 1, ...child.children)
        // 不递增 i：新顶上来的孙子要再做一遍同样检查，处理多层嵌套包裹
        continue
      }
      fix(child)
      i++
    }
  }

  fix(root)
  return root
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
