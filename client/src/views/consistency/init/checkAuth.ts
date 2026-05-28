import { post } from '../../../api/request'

const TOKEN_KEY = 'uiplusToken'

/**
 * 登录校验
 * 检查 localStorage 中是否存在 uiplusToken；
 * 不存在时调用登录接口获取 token 并写入 localStorage。
 * 登录接口后续逻辑预留空函数，当前返回 false 表示未实现。
 */
export async function checkAuth(): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) return

  await doLogin()
}

/**
 * 执行登录接口
 * 预留函数，后续在此补充真实登录逻辑（参数、接口地址、token 写入等）
 */
async function doLogin(): Promise<void> {
  // TODO: 调用登录接口，示例：
  // const res = await post<{ token: string }>('/auth/login', { ... })
  // localStorage.setItem(TOKEN_KEY, res.token)
  void post
}
