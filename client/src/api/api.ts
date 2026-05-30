import { get, post } from './request'

export interface DesignByCodeResult {
  valid: boolean
  designJson?: object
  designImageUrl?: string
  errorMsg?: string
}

export function getDesignByCode(code: string): Promise<DesignByCodeResult> {
  return post<DesignByCodeResult>('/design', { code })
}

interface DeliverableResponse {
  result: unknown
  designImageBase64: string
  arkuiImageBase64: string
}

export function fetchDeliverable(deliverableId: string): Promise<DeliverableResponse> {
  return get<DeliverableResponse>(`/deliverable/${deliverableId}`)
}

export interface TrackParams {
  deliverableId: string
  pageId: string
  versionId: string
}

// 预留打点接口，后续补充真实接口地址和参数
export async function reportTrack(_params: TrackParams): Promise<void> {
  // TODO: 调用 mock 打点接口，例如：
  // await post('/track/entry', _params)
}
