#!/usr/bin/env node
/**
 * octo-uxlint-mcp 入口
 *
 * 配置通过 lib/config.js 管理，切换内外网只需改 ENV 常量：
 *   - outer：外网开发环境（server 在 localhost:3012）
 *   - inner：内网部署环境（server 同源访问）
 *
 * 始终使用 stdio 模式，由 opencode 作为子进程启动。
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from './lib/server.js'

const transport = new StdioServerTransport()
const mcp = createMcpServer()
await mcp.connect(transport)
