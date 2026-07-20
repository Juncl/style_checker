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
  terminal: 'https://octo.hdesign.huawei.com/helpCenter/projectType/121/495/1231',
  web:      'https://octo.hdesign.huawei.com/helpCenter/projectType/121/495/1242',
}

export const TEXT_STYLE_OPTIONS = [
  { value: 'fontSize',      label: '字号' },
  { value: 'fontWeight',    label: '字重' },
  { value: 'fontColor',     label: '颜色' },
  { value: 'fontFamily',    label: '字体' },
  { value: 'shadow',        label: '阴影' },
  { value: 'blur',          label: '模糊' },
  { value: 'opacity',       label: '不透明度' },
  { value: 'other',         label: '其他' },
]

export const CONTAINER_STYLE_OPTIONS = [
  { value: 'backgroundColor', label: '填充' },
  { value: 'borderRadius',    label: '圆角' },
  { value: 'borderWidth',     label: '描边宽度' },
  { value: 'borderColor',     label: '描边颜色' },
  { value: 'shadow',          label: '阴影' },
  { value: 'blur',            label: '模糊' },
  { value: 'opacity',         label: '不透明度' },
  { value: 'other',           label: '其他' },
]
