import axios from 'axios'

type PlatformKey = 'hmPhone' | 'hmWatch' | 'web'

const http = axios.create({ baseURL: '/api' })

export const PLATFORMS: PlatformKey[] = ['hmPhone', 'hmWatch', 'web']
export const DEFAULT_PLATFORM: PlatformKey = 'hmPhone'

const ZH_BY_KEY: Record<PlatformKey, string> = {
  hmPhone: '鸿蒙-手机',
  hmWatch: '鸿蒙-手表',
  web: 'web网页',
}
const KEY_BY_ZH: Record<string, PlatformKey> = {
  '鸿蒙-手机': 'hmPhone',
  '鸿蒙-手表': 'hmWatch',
  'web网页': 'web',
}

export const platformToZh = (key: PlatformKey): string =>
  ZH_BY_KEY[key] ?? ZH_BY_KEY[DEFAULT_PLATFORM]

export const zhToPlatform = (zh: string): PlatformKey =>
  KEY_BY_ZH[zh] ?? DEFAULT_PLATFORM

export const fetchCases = (platform: PlatformKey = DEFAULT_PLATFORM): Promise<{ id: string }[]> =>
  http.get('/cases', { params: { platform } }).then(r => r.data.cases)

export const checkCase = (caseId: string, platform: PlatformKey = DEFAULT_PLATFORM): Promise<unknown> =>
  http.post(`/check/case/${caseId}`, null, { params: { platform } }).then(r => r.data)

export const checkUpload = (
  designJsonFile: File,
  arkuiJsonFile: File,
  designImageFile: File | null = null,
  arkuiImageFile: File | null = null,
  deviceType: string = '鸿蒙-手机',
): Promise<unknown> => {
  const platform: PlatformKey =
    KEY_BY_ZH[deviceType] ??
    (PLATFORMS.includes(deviceType as PlatformKey) ? (deviceType as PlatformKey) : DEFAULT_PLATFORM)
  const form = new FormData()
  form.append('designJson', designJsonFile)
  form.append('arkuiJson', arkuiJsonFile)
  if (designImageFile) form.append('designImage', designImageFile)
  if (arkuiImageFile) form.append('arkuiImage', arkuiImageFile)
  form.append('deviceType', deviceType)
  form.append('platform', platform)
  return http.post('/check/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    params: { platform },
  }).then(r => r.data)
}

export const imageUrl = (caseId: string, type: string, platform: PlatformKey = DEFAULT_PLATFORM): string =>
  `/api/cases/${caseId}/image/${type}?platform=${encodeURIComponent(platform)}`
