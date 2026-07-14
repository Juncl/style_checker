// ================================================================
// 🔴 内网部署替换点 — 只改此文件
// ================================================================

// 后台管理服务（mock / 内网后台）
export const ADMIN_BASE_URL = '/mock'                    // 当前：mock 模式
// export const ADMIN_BASE_URL = window.location.origin  // 内网部署：同源自动适配

// 算法服务（server / 内网 devlint）
export const SERVER_BASE_URL = '/devlint/api'                                       // 当前：Vite proxy → localhost:3012
// export const SERVER_BASE_URL = `${window.location.origin}/devlint/api`           // 内网部署：3012 端口同源访问

// AI 图片对比服务（img/checker），内网时可单独指向 beta 环境
export const AI_CHECKER_BASE_URL = '/devlint/api'                                   // 当前：与 SERVER_BASE_URL 一致
// export const AI_CHECKER_BASE_URL = 'https://xxx-beta.aaa.com/devlint/api'        // 内网：AI 对比走 beta 环境
