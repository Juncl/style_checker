import { Api } from './request'
import { ADMIN_BASE_URL } from './adminEnv'

const uiplusToken = localStorage.getItem("uiplusToken")

export const geConsistencyCheckDeliverables = async () => {
  try {
    const url = `${ADMIN_BASE_URL}/main/rest.root/reviewTool/consistencyCheck/getConsistencyCheckDeliverables`
    const ret = await Api.get<{ content: unknown }>(url, "json", { uiplusToken })
    return ret.content
  } catch (error) {
    console.log("error: ", error)
    return null
  }
}
