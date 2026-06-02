import { checkAuth } from './inner/checkAuth'
import { mountPixso } from './inner/mountPixso'
import { detectIframe } from './inner/detectIframe'
import { trackEntry } from './inner/trackEntry'
import { loadDeliverable } from './inner/loadDeliverable'
import { restorePlatform } from './restorePlatform'

type PlatformKey = 'hmPhone' | 'hmWatch' | 'web'

type DeliverableData = {
  result: unknown
  designImgSrc: string
  arkuiImgSrc: string
} | null

/**
 * 应用初始化入口，在 App.vue 的 onMounted 中调用
 * 严格串行，顺序为：
 *   1. checkAuth       — 登录校验
 *   2. mountPixso      — 挂载 Pixso 渲染器
 *   3. detectIframe    — iframe 环境检测
 *   4. restorePlatform — 读取平台缓存，返回给调用方
 *   5. trackEntry      — 入口埋点（URL 含三参数时打点）
 *   6. loadDeliverable — URL 含 deliverableId 时拉取预存结果，直接渲染报告页
 */
export async function initApp(): Promise<{ platform: PlatformKey; deliverable: DeliverableData }> {
  await checkAuth()
  mountPixso()
  detectIframe()
  const platform = restorePlatform()
  await trackEntry()
  const deliverable = await loadDeliverable()
  return { platform, deliverable }
}
