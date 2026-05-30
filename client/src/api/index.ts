import { http } from './requestOut'
import { type PlatformKey, PLATFORMS, DEFAULT_PLATFORM, ZH_BY_KEY, KEY_BY_ZH } from './constants'

export { PLATFORMS, DEFAULT_PLATFORM } from './constants'
export type { PlatformKey } from './constants'

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
  `/devlint/api/cases/${caseId}/image/${type}?platform=${encodeURIComponent(platform)}`

