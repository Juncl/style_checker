import router from '../../../router'
import { fetchDeliverable } from '../../../api/index'

/**
 * Step 6：URL 含 deliverableId 时，拉取预存检查结果和图片，直接渲染报告页
 * 返回 null 表示无需处理，走正常上传页流程
 */
export async function loadDeliverable() {
  const deliverableId = router.currentRoute.value.query.deliverableId as string | undefined
  if (!deliverableId) return null

  const data = await fetchDeliverable(deliverableId)

  const designImgSrc = data.designImageBase64
  const arkuiImgSrc  = data.arkuiImageBase64

  return {
    result:       data.result,
    designImgSrc,
    arkuiImgSrc,
  }
}
