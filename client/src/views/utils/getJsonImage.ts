export interface GetJsonImageResult {
  valid: boolean
  designJson?: object
  designImageUrl?: string
  errorMsg?: string
}

export async function getJsonImage(params: { url: string }): Promise<GetJsonImageResult> {
  // mock 实现：模拟网络延迟后返回假数据
  await new Promise(resolve => setTimeout(resolve, 500))

  if (!params.url || params.url.length < 3) {
    return { valid: false, errorMsg: '传送码不合规，请检查输入' }
  }

  return {
    valid: true,
    designJson: {
      name: 'mock-design',
      version: '1.0',
      canvas: { width: 390, height: 844 },
    },
    designImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  }
}
