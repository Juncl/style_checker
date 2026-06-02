import axios from 'axios'

class Request {
  http = axios.create({ timeout: 60000 })

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
