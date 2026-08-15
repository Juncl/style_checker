/**
 * devlint-mcp 配置文件
 */

const CHECK_ENV = 'outer'
// const CHECK_ENV = 'inner'
const CHECK_URL = {
  outer:  'http://localhost:3012/api',
  inner:  'http://xxx.aaa.com/devlint/api'
}
const TRACK_URL = {
  outer:  'http://localhost:3001/report/interaction',  // 外网：mock 打点服务
  inner:  'http://xxx.aaa.com/devlint/report/interaction'
}
const SPEC_URL = {
  outer:  'http://localhost:3001/mock/spec/list',   // 外网：mock 规范库接口
  inner:  'http://xxx.aaa.com/devlint/spec/list'    // 内网：真实规范库接口
}

export const config = {
  CHECK_SERVER_URL: CHECK_URL[CHECK_ENV],
  TRACK_URL: TRACK_URL[CHECK_ENV],
  SPEC_URL: SPEC_URL[CHECK_ENV],
  DIR_NAME: '.devlint'
}
