import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFileSync, existsSync } from 'fs'
import { extname } from 'path'
import { extractSummary } from './summary.js'
import { config } from './config.js'

/**
 * 读取文件为 Blob，支持 JSON 和图片
 */
function fileToBlob(filePath, fallbackType = 'application/json') {
  const buf = readFileSync(filePath)
  const ext = extname(filePath).toLowerCase()
  const type =
    ext === '.png' ? 'image/png' :
    ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
    fallbackType
  return new Blob([buf], { type })
}

/**
 * 创建一个 McpServer 实例，注册所有工具
 */
export function createMcpServer() {
  const mcp = new McpServer({
    name: 'devlint-mcp',
    version: '1.0.0',
  })

  mcp.tool(
    'ui_style_check',
    [
      'UI 一致性检查工具。对比设计稿与开发实现，找出开发侧与设计稿的差异，列出开发需要修改的点。',
      '',
      '【触发场景】',
      '当用户说以下任何一种时触发：UI 还原度检查、一致性检查、设计稿对比、找开发对比设计的差异、',
      '检查 UI 实现、样式对比、设计走查、比对设计图和代码、检查 UI 还原、前端走查、视觉还原。',
      '用户只需提供文件路径，不需要明确说用这个工具。',
      '',
      '【参数说明】',
      '- designJsonPath: 设计稿 JSON 文件路径（Figma/Pixso 导出的 data 结构）',
      '- devJsonPath: 开发侧 JSON 文件路径（arkui.json 或 web.json）',
      '- platform: 平台类型，hmPhone（鸿蒙手机，默认）/ hmWatch（鸿蒙手表）/ web（Web 网页）',
      '- designImagePath: 设计稿截图路径（可选，png/jpg）',
      '- devImagePath: 开发侧截图路径（可选，png/jpg）',
      '文件路径由用户提供，工具内部读取文件，文件内容不占用 AI 上下文。',
      '',
      '【输出格式】',
      '返回 JSON，以设计侧节点为维度组织。每个节点含：',
      '- designName: 设计侧节点名（Figma 图层名）',
      '- devClassName: 开发侧节点名（web 平台为 className，ArkUI 平台为组件类型如 Text/Column）',
      '- textContent: 节点文本内容',
      '- nodeType: 节点类型（text / container）',
      '- designRect: 设计稿中的坐标 {x, y, w, h}，用于定位节点位置',
      '- componentChain: 组件层级链（如 Navigation > NavBar > TitleBar > Text("会员中心")），帮助开发者定位代码',
      '- issues: 需修改的差异列表，每条含：',
      '  - property: 属性名（如 fontSize、fontColor、borderRadius 等）',
      '  - description: 中文描述（如"字号"、"颜色"）',
      '  - expected: 设计稿的值（正确值）',
      '  - actual: 开发侧的值（需改的值）',
      '',
      '【输出指引】',
      '拿到结果后，按修改指令格式展示给用户，帮助开发者快速定位并修改代码：',
      '1. 每个设计节点作为一个分组',
      '2. 展示 componentChain（组件层级链），帮助开发者找到对应代码位置',
      '3. web 平台额外标注 devClassName（className），arkui 平台用 componentChain 定位',
      '4. 标注节点在页面中的相对位置（用 designRect 概括，如"位于页面顶部"）',
      '5. 每条差异以修改指令格式输出：「属性」期望 expected，当前为 actual，需修改',
      '6. 不要展示评分、匹配覆盖率、检查耗时等统计信息',
      '7. 不要展示节点 ID、原始 path 数组等内部技术信息',
      '8. 如果没有差异，直接说"开发侧与设计稿一致，无需修改"',
    ].join('\n'),
    {
      designJsonPath: z
        .string()
        .describe('设计稿 JSON 文件路径'),
      devJsonPath: z
        .string()
        .describe('开发侧 JSON 文件路径（arkui.json 或 web.json）'),
      platform: z
        .enum(['hmPhone', 'hmWatch', 'web'])
        .default('hmPhone')
        .describe('平台类型'),
      designImagePath: z
        .string()
        .optional()
        .describe('设计稿截图路径（png/jpg）'),
      devImagePath: z
        .string()
        .optional()
        .describe('开发侧截图路径（png/jpg）'),
    },
    async (params) => {
      try {
        // 校验文件存在
        for (const [label, path] of [
          ['设计稿 JSON', params.designJsonPath],
          ['开发侧 JSON', params.devJsonPath],
          ...(params.designImagePath ? [['设计稿截图', params.designImagePath] ] : []),
          ...(params.devImagePath ? [['开发侧截图', params.devImagePath] ] : []),
        ]) {
          if (!existsSync(path)) {
            return {
              content: [{ type: 'text', text: `${label}文件不存在: ${path}` }],
              isError: true,
            }
          }
        }

        // MCP 内部读文件，不经过 AI 上下文
        const form = new FormData()
        form.append('platform', params.platform)
        form.append('designJson', fileToBlob(params.designJsonPath), 'design.json')
        form.append('arkuiJson', fileToBlob(params.devJsonPath), 'arkui.json')
        if (params.designImagePath) {
          form.append('designImage', fileToBlob(params.designImagePath), 'design.png')
        }
        if (params.devImagePath) {
          form.append('arkuiImage', fileToBlob(params.devImagePath), 'arkui.png')
        }

        const res = await fetch(`${config.checkServerUrl}/check/upload`, {
          method: 'POST',
          body: form,
        })

        if (!res.ok) {
          const errText = await res.text()
          return {
            content: [{ type: 'text', text: `检查请求失败 (${res.status}): ${errText}` }],
            isError: true,
          }
        }

        const result = await res.json()
        const summary = extractSummary(result)

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
          ],
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `检查过程出错: ${err.message}\n\n请确认 server 是否运行在 ${config.checkServerUrl}`,
            },
          ],
          isError: true,
        }
      }
    },
  )

  return mcp
}
