// Shared rectangle math for matcher passes. Keeping this tiny makes scoring code easier to audit.
export function yDistance(r1, r2) {
  const cy1 = r1.y + r1.h / 2
  const cy2 = r2.y + r2.h / 2
  return Math.abs(cy1 - cy2)
}

export function xDistance(r1, r2) {
  const cx1 = r1.x + r1.w / 2
  const cx2 = r2.x + r2.w / 2
  return Math.abs(cx1 - cx2)
}

export function centerDistance(a, b) {
  const ac = rectCenter(a)
  const bc = rectCenter(b)
  return Math.hypot(ac.x - bc.x, ac.y - bc.y)
}

export function rectCenter(r) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

export function centerY(r) {
  return r.y + r.h / 2
}

export function sizeRatio(a, b) {
  if (!a || !b) return 0
  return Math.min(a, b) / Math.max(a, b)
}

export function computeIoU(a, b) {
  const ax2 = a.x + a.w, ay2 = a.y + a.h
  const bx2 = b.x + b.w, by2 = b.y + b.h

  const interX1 = Math.max(a.x, b.x)
  const interY1 = Math.max(a.y, b.y)
  const interX2 = Math.min(ax2, bx2)
  const interY2 = Math.min(ay2, by2)

  if (interX2 <= interX1 || interY2 <= interY1) return 0

  const inter = (interX2 - interX1) * (interY2 - interY1)
  const areaA = a.w * a.h
  const areaB = b.w * b.h
  const union = areaA + areaB - inter

  return union <= 0 ? 0 : inter / union
}

export function rectIntersectionArea(a, b) {
  const interX1 = Math.max(a.x, b.x)
  const interY1 = Math.max(a.y, b.y)
  const interX2 = Math.min(a.x + a.w, b.x + b.w)
  const interY2 = Math.min(a.y + a.h, b.y + b.h)
  if (interX2 <= interX1 || interY2 <= interY1) return 0
  return (interX2 - interX1) * (interY2 - interY1)
}

export function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
}

export function unionNormRect(rects) {
  const x1 = Math.min(...rects.map(r => r.x))
  const y1 = Math.min(...rects.map(r => r.y))
  const x2 = Math.max(...rects.map(r => r.x + r.w))
  const y2 = Math.max(...rects.map(r => r.y + r.h))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export function rectArea(rect) {
  return Math.max(0, rect?.w || 0) * Math.max(0, rect?.h || 0)
}

export function rectContainsCenter(container, rect) {
  const c = rectCenter(rect)
  return pointInRect(c.x, c.y, container)
}
