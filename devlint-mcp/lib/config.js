/**
 * octo-uxlint-mcp 配置文件
 */

const CHECK_ENV = 'outer';
// const CHECK_ENV = 'inner_beta';
// const CHECK_ENV = 'inner_pro';

const CHECK_URL = {
  outer: 'http://localhost:3012/api',
  inner_beta: 'https://octo-beta.hdesign.huawei.com/devlint/api', // UI一致性检查的接口
  inner_pro: 'https://octo.hdesign.huawei.com/devlint/api'
}
const TRACK_URL = {
  outer: 'http://localhost:3001/report/interaction',  // 打点服务
  inner_beta: 'https://beta.ucd.huawei.com/record/logger/interaction',
  inner_pro: 'https://ucd.huawei.com/record/logger/interaction'
}
const SPEC_URL = {
  outer: 'http://localhost:3001/mock/spec',   // 规范库 base（与 inner 等价，拼后缀）
  inner_beta: 'http://7.192.170.117:3100',
  inner_pro: 'http://7.192.170.117:3100'
}

export const config = {
  CHECK_SERVER_URL: CHECK_URL[CHECK_ENV],
  TRACK_URL: TRACK_URL[CHECK_ENV],
  SPEC_URL: SPEC_URL[CHECK_ENV],
  DIR_NAME: '.octo-uxlint'
}
