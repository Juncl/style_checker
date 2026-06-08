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

// 查询当前用户的交付件列表
// GET /main/rest.root/reviewTool/consistencyCheck/getConsistencyCheckDeliverables
// 返回：交付件数组（content），失败返回 null
export const getConsistencyCheckDeliverables = async () => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/reviewTool/consistencyCheck/getConsistencyCheckDeliverables`
    const ret = await Api.get(url, "json", { uiplusToken })
    return ret.content
  } catch (error) {
    console.log("error: ", error)
    return null
  }
}

// 获取当前用户所属的团队列表
// GET /main/rest.root/workspace/team/getMyTeam
// 返回：[{ teamId }]，失败返回 null
export const getTeamList = async () => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/workspace/team/getMyTeam`
    const ret = await Api.get(url, "json", { uiplusToken })
    return ret.content
  } catch (error) {
    console.log("error: ", error)
    return null
  }
}

// 根据团队 ID 获取子项目列表
// GET /main/rest.root/workspace/team/getMySonTeam?id={teamId}
// 返回：[{ teamId, parentTeam }]，其中 teamId 即 addConsistencyCheckDeliverable 的入参，失败返回 null
export const getSonListByTeamId = async (teamId: number | string) => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/workspace/team/getMySonTeam?id=${teamId}`
    const ret = await Api.get(url, "json", { uiplusToken })
    return ret.content
  } catch (error) {
    console.log("error: ", error)
    return null
  }
}

// 根据交付件 ID 查询页面列表
// GET /main/rest.root/reviewTool/consistencyCheck/getPagesByDeliverableId?deliverableId={id}
// 返回：页面数组（content），失败返回 null
export const getPagesByDeliverableId = async (deliverableId: string) => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/reviewTool/consistencyCheck/getPagesByDeliverableId?deliverableId=${deliverableId}`
    const ret = await Api.get(url, "json", { uiplusToken })
    return ret.content
  } catch (error) {
    console.log("error: ", error)
    return null
  }
}

// 新增页面（同时创建首个版本，包含本次对比结果）
// POST /main/rest.root/reviewTool/consistencyCheck/addConsistencyCheckPage
// 参数：deliverableId、name、deviceType、versionName、devImageBase64Data、devJson、designImageBase64Data、designJson、problems
// 返回：新建页面 ID（content），失败返回 null
export const addConsistencyCheckPage = async (params: Record<string, unknown>) => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/reviewTool/consistencyCheck/addConsistencyCheckPage`
    const ret = await Api.post(url, params, 60000, { uiplusToken })
    return ret.data.content
  } catch (error) {
    console.log("error: ", error)
    return null
  }
}

// 更新问题项状态（标记/取消"非问题"）
// POST /main/rest.root/reviewTool/consistencyCheck/updateConsistencyCheckProblem
// 返回：成功 true，失败抛出异常
export const updateConsistencyCheckProblem = async (params: Record<string, unknown>) => {
  const url = `${ADMIN_BASE_URL}/main/rest.root/reviewTool/consistencyCheck/updateConsistencyCheckProblem`
  const ret = await Api.post(url, params, 60000, { uiplusToken })
  if (!ret.data?.success) throw new Error(ret.data?.message || '更新失败')
  return true
}

// 根据页面 ID 查询版本列表（分页）
// GET /main/rest.root/reviewTool/consistencyCheck/getResultsByPageId?pageId=&pageNum=&pageSize=
// 返回：{ list: Version[], totalCount: number }，失败返回 null
export const getResultsByPageId = async (pageId: number | string, pageNum: number, pageSize: number) => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/reviewTool/consistencyCheck/getResultsByPageId?pageId=${pageId}&pageNum=${pageNum}&pageSize=${pageSize}`
    const ret = await Api.get(url, "json", { uiplusToken })
    return ret.content
  } catch (error) {
    console.log("error: ", error)
    return null
  }
}

// 新增交付件
// POST /main/rest.root/reviewTool/consistencyCheck/addConsistencyCheckDeliverable
// 参数：teamId（团队/项目 ID）、name（交付件名称）
// 返回：新建交付件 ID（content），失败返回 null
export const addConsistencyCheckDeliverable = async (teamId: string, name: string) => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/reviewTool/consistencyCheck/addConsistencyCheckDeliverable`
    const ret = await Api.post(url, new URLSearchParams({ teamId, name }), 60000, { uiplusToken })
    return ret.data.content
  } catch (error) {
    console.log("error: ", error)
    return null
  }
}
