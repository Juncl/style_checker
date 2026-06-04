import { http } from './requestOut'
import { SERVER_BASE_URL } from './adminEnv'
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
  `${SERVER_BASE_URL}/cases/${caseId}/image/${type}?platform=${encodeURIComponent(platform)}`

export const convertDumpToJson = (dumpFile: File): Promise<unknown> => {
  const form = new FormData()
  form.append('dumpFile', dumpFile)
  return http.post('/check/dump-to-json', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}

export interface ParsedPreview {
  nodes: unknown[]
  canvas: { w: number; h: number; resolution?: number }
}

export const parseDevUpload = (
  arkuiJsonFile: File,
  arkuiImageFile: File | null = null,
  platform: string = DEFAULT_PLATFORM,
): Promise<ParsedPreview> => {
  const resolvedPlatform: PlatformKey =
    KEY_BY_ZH[platform] ??
    (PLATFORMS.includes(platform as PlatformKey) ? (platform as PlatformKey) : DEFAULT_PLATFORM)
  const form = new FormData()
  form.append('arkuiJson', arkuiJsonFile)
  if (arkuiImageFile) form.append('arkuiImage', arkuiImageFile)
  form.append('platform', resolvedPlatform)
  return http.post('/parse/dev', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}

export const parseDesignUpload = (
  designJsonFile: File,
  designImageFile: File | null = null,
  platform: string = DEFAULT_PLATFORM,
): Promise<ParsedPreview> => {
  const resolvedPlatform: PlatformKey =
    KEY_BY_ZH[platform] ??
    (PLATFORMS.includes(platform as PlatformKey) ? (platform as PlatformKey) : DEFAULT_PLATFORM)
  const form = new FormData()
  form.append('designJson', designJsonFile)
  if (designImageFile) form.append('designImage', designImageFile)
  form.append('platform', resolvedPlatform)
  return http.post('/parse/design', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}

