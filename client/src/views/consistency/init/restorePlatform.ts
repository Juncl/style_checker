import { PLATFORMS, DEFAULT_PLATFORM } from '../../../api/index'

type PlatformKey = 'hmPhone' | 'hmWatch' | 'web'

const CACHE_KEY = 'cachePlatform'

/**
 * 从 localStorage 读取上次选择的平台
 * 不存在或值不合法时回退到默认平台
 */
export function restorePlatform(): PlatformKey {
  const cached = localStorage.getItem(CACHE_KEY)
  if (cached && (PLATFORMS as string[]).includes(cached)) {
    return cached as PlatformKey
  }
  return DEFAULT_PLATFORM
}

/**
 * 将用户选择的平台写入 localStorage
 */
export function savePlatform(platform: PlatformKey): void {
  localStorage.setItem(CACHE_KEY, platform)
}
