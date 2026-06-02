/**
 * 交付物加载
 * 内网实现：URL 携带 deliverableId 时，从后台拉取预存的检查结果和图片，直接渲染报告页
 * 返回 null 表示无需处理，走正常上传页流程
 * 返回结构：{ result, designImgSrc, arkuiImgSrc }
 */
export async function loadDeliverable() {
  return null
}
