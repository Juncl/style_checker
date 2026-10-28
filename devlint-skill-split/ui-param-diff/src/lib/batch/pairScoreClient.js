import { config } from '../config.js'
import { fileToBlob } from '../utils/tools.js'

export async function callPairScore({ designJsonPath, devJsonPath, designImagePath, devImagePath, platform }) {
  const form = new FormData()
  form.append('platform', platform)
  form.append('designJson', fileToBlob(designJsonPath), 'design.json')
  form.append('arkuiJson', fileToBlob(devJsonPath), 'arkui.json')
  if (designImagePath) form.append('designImage', fileToBlob(designImagePath, 'image/png'), 'design.png')
  if (devImagePath) form.append('arkuiImage', fileToBlob(devImagePath, 'image/png'), 'arkui.png')

  const res = await fetch(`${config.CHECK_SERVER_URL}/check/pair-score`, {
    method: 'POST',
    body: form,
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`配对度计算失败 (${res.status}): ${errText}`)
  }

  return res.json()
}
