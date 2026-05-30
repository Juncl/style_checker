import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'

export const http = axios.create({ baseURL: '/devlint/api' })

export function request<T = unknown>(config: AxiosRequestConfig): Promise<T> {
  return http.request<T, AxiosResponse<T>>(config).then(r => r.data)
}

export function get<T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> {
  return request<T>({ method: 'GET', url, params })
}

export function post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return request<T>({ method: 'POST', url, data, ...config })
}
