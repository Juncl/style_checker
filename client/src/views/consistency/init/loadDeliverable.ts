import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { getConsistencyCheckDeliverables, getPagesByDeliverableId, getResultsByPageId } from '../../../api/api.ts'

export type LoadedDeliverable = {
  deliverableList: any[]
  deliverableItem: any | null
  pageList: any[]
  currentPage: any
  versionList: any[]
  currentVersion: any
  deviceType: string
  urlVersionId: string
}

export async function loadDeliverable(route: RouteLocationNormalizedLoaded): Promise<LoadedDeliverable | null> {
  const urlDeliverableId = route.query.deliverableId as string
  const urlPageId        = route.query.pageId as string
  const urlVersionId     = route.query.versionId as string

  if (!urlDeliverableId || !urlPageId || !urlVersionId) return null

  const [deliverableList, pageList] = await Promise.all([
    getConsistencyCheckDeliverables(),
    getPagesByDeliverableId(urlDeliverableId),
  ])

  const sortedDeliverableList = (deliverableList ?? []).sort((a: any, b: any) => (b.createTime ?? 0) - (a.createTime ?? 0))

  if (!Array.isArray(pageList) || pageList.length === 0) {
    throw Object.assign(new Error('找不到该交付件的页面数据'), { clearUrl: true })
  }

  const currentPage = pageList.find((p: any) => String(p.id) === String(urlPageId))
  if (!currentPage) {
    throw new Error(`找不到页面 ${urlPageId}`)
  }

  const versionResult = await getResultsByPageId(urlPageId, 1, 999)
  const versionList   = Array.isArray(versionResult?.list) ? versionResult.list : []

  if (versionList.length === 0) {
    throw new Error('该页面暂无版本记录')
  }

  const currentVersion = versionList.find((v: any) => String(v.id) === String(urlVersionId))
  if (!currentVersion) {
    throw new Error(`找不到版本 ${urlVersionId}`)
  }

  return {
    deliverableList: sortedDeliverableList,
    deliverableItem: sortedDeliverableList.find((d: any) => String(d.id) === String(urlDeliverableId)) ?? null,
    pageList:        pageList.slice().sort((a: any, b: any) => (b.createTime ?? 0) - (a.createTime ?? 0)),
    currentPage,
    versionList,
    currentVersion,
    deviceType:    currentPage.deviceType ?? 'hmPhone',
    urlVersionId,
  }
}
