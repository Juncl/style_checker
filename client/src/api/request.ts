import axios from 'axios'
import { ADMIN_BASE_URL } from './adminEnv'

class Request {
  http = axios.create({ baseURL: ADMIN_BASE_URL })

  async get(url, _responseType, headers) {
    const ret = await this.http.get(url, { headers })
    return ret.data
  }

  async post(url, data) {
    const ret = await this.http.post(url, data)
    return ret.data
  }
}

export const Api = new Request()
