/**
 * DOM 采集函数（设计规范检查专用）
 *
 * 与 getWebDom/exportDOMTree 的区别：
 * - 不做视口过滤（窗口外的节点也采集）
 * - 不需要 dpr 探测（规范检查不依赖像素精度）
 * - 保留完整的 DOM 树结构 + 计算样式提取
 *
 * 此函数通过 page.evaluate 注入浏览器执行，
 * 函数体内可直接访问 document / window，
 * 返回值必须可序列化。
 */

/**
 * 采集 document 下所有节点的结构 + 计算样式
 * @returns {Object} DOM 树 JSON
 */
export const collectDomTree = () => {
  let currentId = 5;

  const vWidth = window.innerWidth || document.documentElement.clientWidth;
  const vHeight = window.innerHeight || document.documentElement.clientHeight;

  /** 移除 CSS 值中的 px 单位，返回数值 */
  function removePxUnit(value) {
    if (!value || typeof value !== 'string') return value;
    const match = value.match(/^(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : value;
  }

  /** 将 RGB/RGBA/hex 颜色转换为 #RRGGBBAA 格式（hex 带 alpha 通道） */
  function toRgba(color) {
    if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return '#00000000';
    const rgbaMatch = color.match(/rgba?\(\s*([^)]+)\s*\)/i);
    if (rgbaMatch) {
      const parts = rgbaMatch[1].split(',').map(s => parseFloat(s.trim()));
      const r = Math.round(parts[0]);
      const g = Math.round(parts[1]);
      const b = Math.round(parts[2]);
      const a = parts.length === 4 ? Math.round(parts[3] * 255) : 255;
      const hex = n => n.toString(16).padStart(2, '0').toUpperCase();
      return `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}`;
    }
    const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
      let h = hexMatch[1];
      if (h.length === 3) h = h.split('').map(c => c + c).join('');
      return h.toUpperCase() + 'FF';
    }
    return '#00000000';
  }

  function getElementData(node, offsetX = 0, offsetY = 0) {
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const rawRect = node.getBoundingClientRect();
    const rect = {
      left: rawRect.left || 0,
      top: rawRect.top || 0,
      width: rawRect.width || 0,
      height: rawRect.height || 0,
      right: rawRect.right || (rawRect.left + rawRect.width) || 0,
      bottom: rawRect.bottom || (rawRect.top + rawRect.height) || 0,
    };
    const style = window.getComputedStyle(node);

    // 不过滤视口外的节点，只过滤 display:none / visibility:hidden
    if (style.display === 'none' || style.visibility === 'hidden') {
      return null;
    }

    const textContent = Array.from(node.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0)
      .map(n => n.textContent.trim())
      .join(' ');

    const isText = textContent.length > 0;
    const tagName = node.tagName.toLowerCase();
    const absoluteTop = Math.round(rect.top + offsetY);
    const absoluteLeft = Math.round(rect.left + offsetX);
    const id = currentId++;

    const data = {
      id,
      name: id,
      type: isText ? 'text' : tagName,
      className: node.className || '',
      rect: { w: rect.width, h: rect.height, x: absoluteLeft, y: absoluteTop },
      size: { w: rect.width, h: rect.height, x: absoluteLeft, y: absoluteTop },
      w: rect.width,
      h: rect.height,
      x: absoluteLeft,
      y: absoluteTop,
      display: style.display,
      position: style.position,
      padding: style.padding,
      margin: style.margin,
      opacity: Number(style.opacity),
      textAlign: style.textAlign,
      backgroundColor: toRgba(style.backgroundColor),
      borderRadius: style.borderRadius,
      borderWidth: Number(removePxUnit(style.borderWidth).toFixed(1)),
      borderStyle: style.borderStyle,
      borderColor: removePxUnit(style.borderWidth) > 0 ? toRgba(style.borderColor) : undefined,
      boxShadow: style.boxShadow && style.boxShadow !== 'none' ? style.boxShadow : undefined,
      textShadow: style.textShadow && style.textShadow !== 'none' ? style.textShadow : undefined,
    };

    if ((style.filter && style.filter !== 'none') || (style.backdropFilter && style.backdropFilter !== 'none')) {
      data.blur = {
        filter: style.filter !== 'none' ? style.filter : undefined,
        backdropFilter: style.backdropFilter !== 'none' ? style.backdropFilter : undefined,
      };
    }

    if (isText) {
      data.content = textContent;
      data.fontSize = removePxUnit(style.fontSize);
      data.fontFamily = style.fontFamily;
      data.fontWeight = Number(style.fontWeight);
      data.fontColor = toRgba(style.color);
    }

    // 处理子节点
    let children = Array.from(node.children);
    let childData = [];

    if (tagName === 'iframe') {
      try {
        const iframeDoc = node.contentDocument || node.contentWindow.document;
        if (iframeDoc && iframeDoc.body) {
          childData = Array.from(iframeDoc.body.children)
            .map(child => getElementData(child, absoluteLeft, absoluteTop))
            .filter(c => c !== null);
        }
      } catch {
        data.info = 'Cross-origin iframe - Access Denied';
      }
    } else {
      childData = children
        .map(child => getElementData(child, offsetX, offsetY))
        .filter(c => c !== null);
    }

    data.children = childData;
    return data;
  }

  const root = {
    id: 3,
    deviceType: 'web',
    name: 'viewport',
    type: 'container',
    rect: { w: vWidth, h: vHeight, x: 0, y: 0 },
    size: { w: vWidth, h: vHeight, x: 0, y: 0 },
    w: vWidth,
    h: vHeight,
    x: 0,
    y: 0,
    children: [getElementData(document.body)],
  };

  return root;
};
