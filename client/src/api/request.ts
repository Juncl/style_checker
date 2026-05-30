import axios, { type AxiosRequestConfig } from 'axios'

const mockHttp = axios.create({ baseURL: '/mock' })

export function get<T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> {
  return mockHttp.get<T>(url, { params }).then(r => r.data)
}

export function post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return mockHttp.post<T>(url, data, config).then(r => r.data)
}
