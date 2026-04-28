import axios from 'axios'

const http = axios.create({ baseURL: '/api' })

export const fetchCases = () => http.get('/cases').then(r => r.data.cases)

export const checkCase = (caseId) =>
  http.post(`/check/case/${caseId}`).then(r => r.data)

export const checkUpload = (designJsonFile, arkuiJsonFile, designImageFile = null, arkuiImageFile = null) => {
  const form = new FormData()
  form.append('designJson', designJsonFile)
  form.append('arkuiJson',  arkuiJsonFile)
  if (designImageFile) form.append('designImage', designImageFile)
  if (arkuiImageFile) form.append('arkuiImage', arkuiImageFile)
  return http.post('/check/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}

export const imageUrl = (caseId, type) => `/api/cases/${caseId}/image/${type}`
