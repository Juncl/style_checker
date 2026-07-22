import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const configPath = join(__dirname, '..', 'config.json')

const raw = JSON.parse(readFileSync(configPath, 'utf-8'))

const envKey = raw.env || 'outer'
const envConfig = raw[envKey]

if (!envConfig) {
  throw new Error(`config.json 中未找到 env="${envKey}" 对应的配置块`)
}

export const config = {
  /** 当前环境标识：outer | inner */
  env: envKey,
  /**
   * 检查引擎 server 地址，对应 client 的 SERVER_BASE_URL
   * fetch 时拼接：`${checkServerUrl}/check/upload`
   */
  checkServerUrl: envConfig.checkServerUrl,
}
