/**
 * spec-server —— design-checker 规范库服务（独立部署，端口 3021）
 *
 * 职责：设计规范文档（任意可读文本格式）的存储与分发，纯数据管道，不解析规范内容。
 * 规范主库：spec-server/specFiles/（index.json = 领域总表，数组，version 为 semver 字符串；
 *           <领域key>/ 子目录 = 该领域规范文件，层级不限）
 *
 * 只读接口（无鉴权，skill 经 bin/design-checker.mjs --list-specs / --sync-spec 消费）：
 *   GET /specs                          领域清单 [{key, name, description, version, updatedAt, fileCount}]
 *   GET /specs/:domain                  单领域 meta + 文件清单 [{path, lines, bytes}]
 *   GET /specs/:domain/file?path=xxx    单文件原文 {path, content}
 *   GET /specs/:domain/archive          整包下载 {version, meta, files:[{path, content}]}（--sync-spec 全量拉取用）
 *
 * 管理接口（写操作；设置了 SPEC_ADMIN_TOKEN 环境变量时需 Header x-admin-token）：
 *   POST   /admin/specs                  新建领域        {key, name, description?}
 *   PUT    /admin/specs/:domain/meta     更新领域 meta   {name?, description?}
 *   POST   /admin/specs/:domain/files    上传/覆盖文件   {files: [{path, content}]}（批量 JSON，自动建多级目录）
 *   DELETE /admin/specs/:domain/files    删除文件       {paths: [...]}
 *   DELETE /admin/specs/:domain          删除整个领域
 *   任一写操作成功自动提升 meta.version（= Date.now()），skill 缓存靠 version 判断新鲜度。
 *
 * 上传示例（curl）：
 *   curl -X POST http://localhost:3021/admin/specs/ict_pc_3.1.1/files \
 *     -H 'Content-Type: application/json' \
 *     -d '{"files":[{"path":"button.md","content":"# 按钮\n按钮高度 32px"}]}'
 *
 * 约束：单文件 ≤ 2MB、单次批量 ≤ 20MB；README.md / index.json 为保留文件名；
 *       路径仅允许字母数字点下划线连字符正斜杠（防路径穿越）。
 */

import express from 'express'
import { SPECS_ROOT } from './utils/specStore.js'
import specsRouter from './routes/specs.js'
import adminRouter from './routes/admin.js'

const app = express()
const PORT = Number(process.env.SPEC_SERVER_PORT) || 3021

app.use(express.json({ limit: '25mb' }))

app.get('/health', (req, res) => res.json({ ok: true, service: 'spec-server' }))
app.use('/specs', specsRouter)
app.use('/admin', adminRouter)

app.use((req, res) => res.status(404).json({ error: `无此接口: ${req.method} ${req.path}` }))
app.use((err, req, res, next) => {
  console.error(`[spec-server] ${err.stack || err.message}`)
  res.status(500).json({ error: err.message || '服务内部错误' })
})

app.listen(PORT, () => {
  console.log(`spec-server 运行于 http://localhost:${PORT}`)
  console.log(`规范主库: ${SPECS_ROOT}`)
  console.log(`管理鉴权: ${process.env.SPEC_ADMIN_TOKEN ? '已启用（Header x-admin-token）' : '未启用（未设置 SPEC_ADMIN_TOKEN，放行）'}`)
})
