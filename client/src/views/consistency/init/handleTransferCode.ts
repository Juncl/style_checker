import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { ref } from 'vue'
import { removeUrlParams } from '../../utils/urlParams'

/** 外部跳转携带的传送码，DesignUploadCard 监听此值回填输入框 */
export const transferCode = ref('')

/**
 * 第 7 步：检测 URL 中是否携带 url 和 randomCode 参数，若存在则：
 *   1. 取出 randomCode 值，通过 transferCode 响应式变量传递给 DesignUploadCard
 *   2. 清除 URL 上的两个参数（保留 debugger 等其他参数）
 */
export async function handleTransferCode(route: RouteLocationNormalizedLoaded): Promise<void> {
  const query = route.query as Record<string, string>
  const { url, randomCode } = query
  if (!url || !randomCode) return

  transferCode.value = String(randomCode)
  removeUrlParams(['url', 'randomCode'])
}
