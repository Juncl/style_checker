import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { SERVER_BASE_URL } from './adminEnv'

export const http = axios.create({ baseURL: SERVER_BASE_URL })

export function request<T = unknown>(config: AxiosRequestConfig): Promise<T> {
  return http.request<T, AxiosResponse<T>>(config).then(r => r.data)
}
