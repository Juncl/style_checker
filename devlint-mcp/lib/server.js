import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFileSync, existsSync } from 'fs'
import { extname } from 'path'
import { extractSummary } from './summary.js'
import { config } from './config.js'
import { collectWebDom } from './collectData/getWebDom/getWebDom.js'

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
      '',
      '【与 collect_web 的协作】',
      '开发侧的文件路径有两种来源：',
      '1. 用户直接提供本地文件路径 → 直接传入 devJsonPath / devImagePath',
      '2. 用户提供的是网页 URL → 先调用 collect_web 工具采集，拿到返回的 devJsonPath / devImagePath 后再传入',
      '当用户的描述中包含 URL 或"采集网页""读取网页"等表述时，必须先调 collect_web，再调本工具。',
      '',
      '【参数说明】',
      '- designJsonPath: 设计稿 JSON 文件路径（Figma/Pixso 导出的 data 结构）',
      '- devJsonPath: 开发侧 JSON 文件路径（用户提供的本地文件，或 collect_web 返回的 devJsonPath）',
      '- platform: 平台类型，hmPhone（鸿蒙手机，默认）/ hmWatch（鸿蒙手表）/ web（Web 网页）',
      '- designImagePath: 设计稿截图路径（可选，png/jpg）',
      '- devImagePath: 开发侧截图路径（可选，来自用户或 collect_web 返回的 devImagePath）',
      '工具内部读取文件，文件内容不占用 AI 上下文。',
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

        const res = await fetch(`${config.CHECK_SERVER_URL}/check/upload`, {
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
              text: `检查过程出错: ${err.message}\n\n请确认 server 是否运行在 ${config.CHECK_SERVER_URL}`,
            },
          ],
          isError: true,
        }
      }
    },
  )

  // ── collect_web：Web 开发侧数据采集 ──────────────────────────────────────────
  mcp.tool(
    'collect_web',
    [
      'Web 页面数据采集工具。通过 puppeteer 打开网页，采集 DOM 树结构 + 计算样式 + 截图，',
      '生成 web.json 和 web.png 保存到本地，返回文件路径。',
      '',
      '【触发场景】',
      '当用户说以下任何一种时触发：采集网页、采集 web 页面、抓取网页 DOM、采集开发侧数据、',
      '导出 web 页面数据、获取网页截图、采集前端页面。',
      '采集结果可直接用于 ui_style_check 进行 UI 还原度检查。',
      '',
      '【参数说明】',
      '- url: 目标页面地址（必填）',
      '- width: 视口宽度，默认 1920',
      '- height: 视口高度，默认 1080',
      '- deviceScaleFactor: 截图质量倍率，默认 1（1x/2x/3x）',
      '- browserWSEndpoint: 连接已打开的 Chrome（可选），用于需登录的页面',
      '  · 不传 → 默认无头模式，适合无登录限制的页面',
      '  · 传入 → connect 模式，连接用户已打开并登录的 Chrome 浏览器',
      '  · 用户需先启动 Chrome 并登录：',
      '    /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222',
      '  · 传入值示例：ws://localhost:9222/devtools/browser/xxxx 或直接传 "connect" 自动获取',
      '',
      '【输出格式】',
      '返回 JSON，包含：',
      '- devJsonPath: 采集的 DOM 树 JSON 文件路径',
      '- devImagePath: 截图 PNG 文件路径',
      '',
      '【使用指引】',
      '采集完成后，将返回值直接传给 ui_style_check 工具进行 UI 还原度检查：',
      '  collect_web 返回的 devJsonPath  → ui_style_check 的 devJsonPath 参数',
      '  collect_web 返回的 devImagePath → ui_style_check 的 devImagePath 参数',
      '同时设 platform 为 web，配合用户提供的设计稿路径（designJsonPath / designImagePath）完成检查。',
      '即：collect_web → ui_style_check 是固定串联流程，采集完应自动调用 ui_style_check。',
    ].join('\n'),
    {
      url: z
        .string()
        .describe('目标页面地址'),
      width: z
        .number()
        .default(1920)
        .describe('视口宽度，默认 1920'),
      height: z
        .number()
        .default(1080)
        .describe('视口高度，默认 1080'),
      deviceScaleFactor: z
        .number()
        .default(1)
        .describe('截图质量倍率，默认 1（1x/2x/3x）'),
      browserWSEndpoint: z
        .string()
        .optional()
        .describe('连接已打开的 Chrome（connect 模式），用于需登录的页面。传 "connect" 自动从 localhost:9222 获取'),
    },
    async (params) => {
      try {
        const collectOptions = {
          viewport: {
            width: params.width,
            height: params.height,
            deviceScaleFactor: params.deviceScaleFactor,
          },
        }

        if (params.browserWSEndpoint) {
          if (params.browserWSEndpoint === 'connect') {
            collectOptions.useConnect = true
          } else {
            collectOptions.browserWSEndpoint = params.browserWSEndpoint
          }
        }

        const { devJsonPath, devImagePath } = await collectWebDom(params.url, collectOptions)

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ devJsonPath, devImagePath }, null, 2),
            },
          ],
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `采集过程出错: ${err.message}`,
            },
          ],
          isError: true,
        }
      }
    },
  )

  return mcp
}
