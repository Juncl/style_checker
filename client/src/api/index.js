import axios from 'axios'

const http = axios.create({ baseURL: '/api' })

// 平台 key
export const PLATFORMS = ['hmPhone', 'hmWatch', 'web']
export const DEFAULT_PLATFORM = 'hmPhone'

// 中文 deviceType ↔ platform key
const ZH_BY_KEY = { hmPhone: '鸿蒙-手机', hmWatch: '鸿蒙-手表', web: 'web网页' }
const KEY_BY_ZH = { '鸿蒙-手机': 'hmPhone', '鸿蒙-手表': 'hmWatch', 'web网页': 'web' }

export const platformToZh = (key) => ZH_BY_KEY[key] || ZH_BY_KEY[DEFAULT_PLATFORM]
export const zhToPlatform = (zh) => KEY_BY_ZH[zh] || DEFAULT_PLATFORM

export const fetchCases = (platform = DEFAULT_PLATFORM) =>
  http.get('/cases', { params: { platform } }).then(r => r.data.cases)

export const checkCase = (caseId, platform = DEFAULT_PLATFORM) =>
  http.post(`/check/case/${caseId}`, null, { params: { platform } }).then(r => r.data)

export const checkUpload = (designJsonFile, arkuiJsonFile, designImageFile = null, arkuiImageFile = null, deviceType = '鸿蒙-手机') => {
  const platform = KEY_BY_ZH[deviceType] || (PLATFORMS.includes(deviceType) ? deviceType : DEFAULT_PLATFORM)
  const form = new FormData()
  form.append('designJson', designJsonFile)
  form.append('arkuiJson',  arkuiJsonFile)
  if (designImageFile) form.append('designImage', designImageFile)
  if (arkuiImageFile) form.append('arkuiImage', arkuiImageFile)
  form.append('deviceType', deviceType)
  form.append('platform', platform)
  return http.post('/check/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    params: { platform },
  }).then(r => r.data)
}

export const imageUrl = (caseId, type, platform = DEFAULT_PLATFORM) =>
  `/api/cases/${caseId}/image/${type}?platform=${encodeURIComponent(platform)}`
