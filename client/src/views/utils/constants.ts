export const CASE_NAMES_BY_PLATFORM: Record<string, Record<string, string>> = {
  hmPhone: {
    case1: '主题购买页面',
    case2: '音乐APP的页面',
    case3: '查看照片页面',
    case4: '运动健康页面',
    case5: '地图导航页面',
    case6: '路线导航浮层页面',
    case7: '90日天气页面',
    case8: '生活服务数据页面',
  },
  hmWatch: {},
  web: {},
}

export const DEBUG_COLORS: string[] = [
  '#2f6fed', '#17a36f', '#d68b00', '#8b5cf6', '#0ea5e9', '#ef4444',
  '#14b8a6', '#f97316', '#22c55e', '#a855f7', '#e11d48', '#2563eb',
]

export const GUIDE_LINKS = {
  terminal: 'https://www.baidu.com',
  web:      'https://www.google.com',
}

export const FILE_SLOTS = [
  { key: 'designJson',  label: 'design.json', required: true,  match: (f: File) => /design/i.test(f.name) && f.name.endsWith('.json') },
  { key: 'arkuiJson',   label: 'arkui.json',  required: true,  match: (f: File) => /arkui/i.test(f.name)  && (f.name.endsWith('.json') || f.name.endsWith('.dump')) },
  { key: 'designImage', label: 'design 图片', required: false, match: (f: File) => /design/i.test(f.name) && f.type.startsWith('image/') },
  { key: 'arkuiImage',  label: 'arkui 图片',  required: true,  match: (f: File) => /arkui/i.test(f.name)  && f.type.startsWith('image/') },
]
