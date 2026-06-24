// 间距对比允许的误差范围（vp）
// 两侧间距差值 <= 此值时视为一致，不报差异
export const SPACE_ERR_RANGE = 3

export const MATCH_TYPE_PASS = {
  'text-锚点':     { pass: 'Pass 1',     desc: '全文本加权匹配，高置信对形成强锚点，驱动后续拓扑' },
  'text-数字槽':   { pass: 'Pass 2.1',   desc: '动态数字槽位：数值可不同，按位置/样式一致性对齐' },
  'text-时间槽':   { pass: 'Pass 2.2',   desc: '动态时间/星期槽位：内容不同，按序列位置对应' },
  'text-同行':     { pass: 'Pass 2.3',   desc: '同行文本节点按 x 序对齐，高分对补充为拓扑锚点' },
  'text-长文':     { pass: 'Pass 2.4',   desc: '长文本（>12字）位置(0.60)+样式(0.35)+内容(0.05) 兜底' },
  'text-角色':     { pass: 'Pass 2.5',   desc: '标题/副标题/正文等语义角色匹配，score ≥ 0.85 接受' },
  'text-con-包含': { pass: 'Pass 3.1.1', desc: '锚点拓扑：节点包住锚点（视觉祖先），双向包含一致性验证' },
  'text-con-方向x':{ pass: 'Pass 3.1.2', desc: '锚点拓扑：锚点左右最近邻，Gale-Shapley 稳定匹配' },
  'text-con-方向y':{ pass: 'Pass 3.1.2', desc: '锚点拓扑：锚点上下守门带，边缘间距守门 + 六维评分' },
  'text-con-自由': { pass: 'Pass 3.2',   desc: '锚点拓扑：放宽方向，扩展强锚点组后三维加权取最优' },
  'text-con-列表': { pass: 'Pass 3.5',   desc: '同行同类横向列表，rawType 相同，按 x 升序锁定' },
  'text-区域优选': { pass: 'Pass 4',     desc: '区域内剩余文本最优二分匹配，score ≥ 0.58 接受' },
  'text-区域兜底': { pass: 'Pass 4',     desc: '跨区域剩余文本全局兜底，score ≥ 0.60 接受' },
  'con-交叠':      { pass: 'Pass 5.3',   desc: '容器节点 IoU 匹配，无装饰 > 0.60，有装饰 > 0.40' },
  'con-视觉':      { pass: 'Pass 6',     desc: '视觉节点（图标/图片/形状）IoU > 0.55' },
}
