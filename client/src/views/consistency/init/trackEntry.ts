import router from '../../../router'
import { reportTrack } from '../../../api/api'

/**
 * 入口埋点
 * URL 同时携带 deliverableId / pageId / versionId 时触发打点
 */
export async function trackEntry(): Promise<void> {
  const query = router.currentRoute.value.query
  const deliverableId = query.deliverableId as string | undefined
  const pageId        = query.pageId        as string | undefined
  const versionId     = query.versionId     as string | undefined

  if (!deliverableId || !pageId || !versionId) return

  await reportTrack({ deliverableId, pageId, versionId })
}
