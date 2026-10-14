import { Api } from './request'
import { ADMIN_BASE_URL } from './adminEnv'

// 根据版本记录中的 jsonUrl（如 //reviewTool/2026/...）fetch 原始 JSON 内容
// 内网：window.location.origin/main//reviewTool/...，mock：/mock/main//reviewTool/...
export const fetchVersionJson = async (jsonUrl: string): Promise<unknown> => {
  const url = `${ADMIN_BASE_URL}/main${jsonUrl}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetchVersionJson failed: ${res.status}`)
  return res.json()
}

// uiplusToken：内网鉴权 token，外网 mock 模式下无效但保留字段
const uiplusToken = localStorage.getItem("uiplusToken")

// 检查响应体 success:false，抛业务错误
function checkSuccess(body: any) {
  if (body && body.success === false) {
    throw Object.assign(new Error(body.errorMessage || '数据错误'), { _type: 'business' })
  }
}

// catch 中统一包装错误：已标记的直接抛，axios 异常包装为 http，其他包装为 unknown
function wrapApiError(error: any) {
  if (error?._type) throw error
  const status = error?.response?.status
  if (status || error?.isAxiosError) {
    throw Object.assign(new Error(status ? `请求失败 (${status})` : (error?.message || '网络错误')), { _type: 'http' })
  }
  console.log('error: ', error)
  throw Object.assign(new Error('数据错误'), { _type: 'unknown' })
}

// 查询当前用户的交付件列表
// GET /main/rest.root/reviewTool/consistencyCheck/getConsistencyCheckDeliverables
// 返回：交付件数组（content）
export const getConsistencyCheckDeliverables = async () => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/reviewTool/consistencyCheck/getConsistencyCheckDeliverables`
    const ret = await Api.get(url, "json", { uiplusToken })
    checkSuccess(ret)
    return ret.content
  } catch (error) {
    wrapApiError(error)
  }
}

// 获取当前用户所属的团队列表
// GET /main/rest.root/workspace/team/getMyTeam
// 返回：[{ teamId }]
export const getTeamList = async () => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/workspace/team/getMyTeam`
    const ret = await Api.get(url, "json", { uiplusToken })
    checkSuccess(ret)
    return ret.content
  } catch (error) {
    wrapApiError(error)
  }
}

// 根据团队 ID 获取子项目列表
// GET /main/rest.root/workspace/team/getMySonTeam?id={teamId}
// 返回：[{ teamId, parentTeam }]，其中 teamId 即 addConsistencyCheckDeliverable 的入参
export const getSonListByTeamId = async (teamId: number | string) => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/workspace/team/getMySonTeam?id=${teamId}`
    const ret = await Api.get(url, "json", { uiplusToken })
    checkSuccess(ret)
    return ret.content
  } catch (error) {
    wrapApiError(error)
  }
}

// 根据交付件 ID 查询页面列表
// GET /main/rest.root/reviewTool/consistencyCheck/getPagesByDeliverableId?deliverableId={id}
// 返回：页面数组（content）
export const getPagesByDeliverableId = async (deliverableId: string) => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/reviewTool/consistencyCheck/getPagesByDeliverableId?deliverableId=${deliverableId}`
    const ret = await Api.get(url, "json", { uiplusToken })
    checkSuccess(ret)
    return ret.content
  } catch (error) {
    wrapApiError(error)
  }
}

// 新增页面（同时创建首个版本，包含本次对比结果）
// POST /main/rest.root/reviewTool/consistencyCheck/addConsistencyCheckPage
// 参数：deliverableId、name、deviceType、versionName、devImageBase64Data、devJson、designImageBase64Data、designJson、problems
// 返回：新建页面 ID（content）
export const addConsistencyCheckPage = async (params: Record<string, unknown>) => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/reviewTool/consistencyCheck/addConsistencyCheckPage`
    const ret = await Api.post(url, params, 60000, { uiplusToken })
    checkSuccess(ret.data)
    return ret.data.content
  } catch (error) {
    wrapApiError(error)
  }
}

// 更新页面名称
// POST /main/rest.root/reviewTool/consistencyCheck/updateConsistencyCheckPage
// 返回：成功 true
export const updateConsistencyCheckPage = async (params: { pageId: number; name: string; deviceType: string }) => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/reviewTool/consistencyCheck/updateConsistencyCheckPage`
    const ret = await Api.post(url, params, 60000, { uiplusToken })
    checkSuccess(ret.data)
    return true
  } catch (error) {
    wrapApiError(error)
  }
}

// 更新问题项状态（标记/取消"非问题"）
// POST /main/rest.root/reviewTool/consistencyCheck/updateConsistencyCheckProblem
// 返回：成功 true
export const updateConsistencyCheckProblem = async (params: Record<string, unknown>) => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/reviewTool/consistencyCheck/updateConsistencyCheckProblem`
    const ret = await Api.post(url, params, 60000, { uiplusToken })
    checkSuccess(ret.data)
    return true
  } catch (error) {
    wrapApiError(error)
  }
}

// 根据页面 ID 查询版本列表（分页）
// GET /main/rest.root/reviewTool/consistencyCheck/getResultsByPageId?pageId=&pageNum=&pageSize=
// 返回：{ list: Version[], totalCount: number }
export const getResultsByPageId = async (pageId: number | string, pageNum: number, pageSize: number) => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/reviewTool/consistencyCheck/getResultsByPageId?pageId=${pageId}&pageNum=${pageNum}&pageSize=${pageSize}`
    const ret = await Api.get(url, "json", { uiplusToken })
    checkSuccess(ret)
    return ret.content
  } catch (error) {
    wrapApiError(error)
  }
}

// 新增交付件
// POST /main/rest.root/reviewTool/consistencyCheck/addConsistencyCheckDeliverable
// 参数：teamId（团队/项目 ID）、name（交付件名称）
// 返回：新建交付件 ID（content）
export const addConsistencyCheckDeliverable = async (teamId: string, name: string) => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/reviewTool/consistencyCheck/addConsistencyCheckDeliverable`
    const ret = await Api.post(url, new URLSearchParams({ teamId, name }), 60000, { uiplusToken })
    checkSuccess(ret.data)
    return ret.data.content
  } catch (error) {
    wrapApiError(error)
  }
}
