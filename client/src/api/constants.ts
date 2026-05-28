export type PlatformKey = 'hmPhone' | 'hmWatch' | 'web'

export const PLATFORMS: PlatformKey[] = ['hmPhone', 'hmWatch', 'web']
export const DEFAULT_PLATFORM: PlatformKey = 'hmPhone'

export const ZH_BY_KEY: Record<PlatformKey, string> = {
  hmPhone: '鸿蒙-手机',
  hmWatch: '鸿蒙-手表',
  web: 'web网页',
}

export const KEY_BY_ZH: Record<string, PlatformKey> = {
  '鸿蒙-手机': 'hmPhone',
  '鸿蒙-手表': 'hmWatch',
  'web网页': 'web',
}
