/**
 * devlint-mcp 配置文件
 */

const CHECK_ENV = 'outer'
// const CHECK_ENV = 'inner'
const CHECK_URL = {
  outer:  'http://localhost:3012/api',
  inner:  'http://xxx.aaa.com/devlint/api'
}

export const config = {
  CHECK_SERVER_URL: CHECK_URL[CHECK_ENV],
  DIR_NAME: '.devlint'
}
