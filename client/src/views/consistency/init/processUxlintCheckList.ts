import {
  getTeamList, getSonListByTeamId,
  addConsistencyCheckDeliverable, addConsistencyCheckPage,
  getResultsByPageId, getPagesByDeliverableId, getConsistencyCheckDeliverables,
} from '../../../api/api'
import { formatDateTime } from '../../utils/tools'

export type UxlintCheckItem = {
  arkFileUrl: string
  id: number
  imageUrl: string
  name: string
}

export type UxlintCheckListResult = {
  deliverableId: string
  deliverableList: any[]
  pageList: any[]
  lastPage: any
  lastVersion: any
}

function replaceOrigin(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, window.location.origin)
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(replaceOrigin(url))
  if (!res.ok) throw new Error(`[uxlint] fetch 失败: ${url}`)
  return res.text()
}

async function fetchBase64(url: string): Promise<string> {
  const res = await fetch(replaceOrigin(url))
  if (!res.ok) throw new Error(`[uxlint] fetch 失败: ${url}`)
  const blob = await res.blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export async function processUxlintCheckList(list: UxlintCheckItem[]): Promise<UxlintCheckListResult> {
  const now = formatDateTime(new Date())

  // 获取 teamId / subTeamId
  const teams = await getTeamList()
  const teamId = Array.isArray(teams) ? teams[0]?.teamId : null
  if (!teamId) throw new Error('[uxlint] 获取团队信息失败')

  const sonTeams = await getSonListByTeamId(teamId)
  const subTeamId = Array.isArray(sonTeams) ? sonTeams[0]?.teamId : null
  if (!subTeamId) throw new Error('[uxlint] 获取子团队信息失败')

  // 创建交付件
  const deliverableId = await addConsistencyCheckDeliverable(String(subTeamId), now)
  if (!deliverableId) throw new Error('[uxlint] 创建交付件失败')

  let lastPage: any = null
  let lastVersion: any = null

  // 串行创建每个页面
  for (const item of list) {
    const [devJson, devBase64] = await Promise.all([
      fetchText(item.arkFileUrl),
      fetchBase64(item.imageUrl),
    ])

    const pageId = await addConsistencyCheckPage({
      deliverableId:         String(deliverableId),
      name:                  item.name,
      deviceType:            'hmPhone',
      versionName:           now,
      devImageBase64Data:    devBase64,
      devJson,
      designImageBase64Data: null,
      designJson:            null,
      problems:              [],
      nodeMatchs:            [],
    })

    if (!pageId) throw new Error(`[uxlint] 创建页面 ${item.name} 失败`)

    const pageResult = await getResultsByPageId(pageId, 1, 999)
    const versionList = Array.isArray(pageResult?.list) ? pageResult.list : []

    lastPage = { id: String(pageId), name: item.name, deviceType: 'hmPhone' }
    lastVersion = versionList[0] ?? null
  }

  const [deliverableList, pageList] = await Promise.all([
    getConsistencyCheckDeliverables(),
    getPagesByDeliverableId(String(deliverableId)),
  ])

  return {
    deliverableId: String(deliverableId),
    deliverableList: (deliverableList ?? []).sort((a: any, b: any) => (b.createTime ?? 0) - (a.createTime ?? 0)),
    pageList: (pageList ?? []).sort((a: any, b: any) => (b.createTime ?? 0) - (a.createTime ?? 0)),
    lastPage,
    lastVersion,
  }
}
