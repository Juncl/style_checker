export async function getJsonImage(params) {
  try {
    const res = await fetch('/mock/design', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: params.url })
    })
    return await res.json()
  } catch {
    return { valid: false, errorMsg: '网络请求失败，请检查 mock 服务是否启动' }
  }
}
