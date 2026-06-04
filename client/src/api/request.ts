import axios from 'axios'

class Request {
  http = axios.create({ timeout: 60000 })

  async get(url, _responseType, headers) {
    const ret = await this.http.get(url, { headers })
    return ret.data
  }

  async post(url: string, params?: unknown, timeout?: number, headers?: Record<string, string>) {
    return this.http.post(url, params, { timeout, headers })
  }
}

export const Api = new Request()
