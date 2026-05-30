import { getDesignByCode, type DesignByCodeResult } from '../../api/api'

export type GetJsonImageResult = DesignByCodeResult

export async function getJsonImage(params: { url: string }): Promise<GetJsonImageResult> {
  try {
    return await getDesignByCode(params.url)
  } catch {
    return { valid: false, errorMsg: '网络请求失败，请检查 mock 服务是否启动' }
  }
}
