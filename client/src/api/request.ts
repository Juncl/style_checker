import axios from 'axios'

/** 包装业务错误（success:false）和 HTTP 错误，统一带 _type 标记向上抛 */
function wrapError(message: string, type: 'business' | 'http', code?: number) {
  return Object.assign(new Error(message), { _type: type, _code: code })
}

class Request {
  http = axios.create({ timeout: 60000 })

  async get(url, _responseType, headers) {
    try {
      const ret = await this.http.get(url, { headers })
      const body = ret.data
      if (body && body.success === false) {
        throw wrapError(body.errorMessage || '数据错误', 'business', body.errorCode)
      }
      return body
    } catch (error) {
      if (error?._type) throw error
      const status = error?.response?.status
      const msg = status ? `请求失败 (${status})` : (error?.message || '网络错误')
      throw wrapError(msg, 'http', status)
    }
  }

  async post(url: string, params?: unknown, timeout?: number, headers?: Record<string, string>) {
    try {
      const ret = await this.http.post(url, params, { timeout, headers })
      const body = ret.data
      if (body && body.success === false) {
        throw wrapError(body.errorMessage || '数据错误', 'business', body.errorCode)
      }
      return ret
    } catch (error) {
      if (error?._type) throw error
      const status = error?.response?.status
      const msg = status ? `请求失败 (${status})` : (error?.message || '网络错误')
      throw wrapError(msg, 'http', status)
    }
  }
}

export const Api = new Request()
