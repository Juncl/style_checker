import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { checkAuth } from './inner/checkAuth'
import { mountPixso } from './inner/mountPixso'
import { detectIframe } from './detectIframe'
import { handleTransferCode } from './handleTransferCode'
import { loadDeliverable, LoadedDeliverable } from './loadDeliverable'
import { restorePlatform } from './restorePlatform'
type PlatformKey = 'hmPhone' | 'hmWatch' | 'web'

/**
 * 应用初始化入口，在 ConsistencyView.vue 的 onMounted 中调用
 * 严格串行，顺序为：
 *   1. checkAuth          — 登录校验
 *   2. mountPixso         — 挂载 Pixso 渲染器
 *   3. detectIframe       — iframe 环境检测
 *   4. restorePlatform    — 读取平台缓存，返回给调用方
 *   5. loadDeliverable    — URL 含 deliverableId/pageId/versionId 时拉取预存结果
 *   6. handleTransferCode — URL 含 url + randomCode 时回填传送码并清除参数
 */
export async function initApp(route: RouteLocationNormalizedLoaded): Promise<{ platform: PlatformKey; deliverable: LoadedDeliverable; stopListenFn: (() => void) | null }> {
  await checkAuth()
  mountPixso()
  const stopListenFn = detectIframe()
  const platform = restorePlatform()
  const deliverable = await loadDeliverable(route)
  handleTransferCode(route)
  return { platform, deliverable, stopListenFn }
}
