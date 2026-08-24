import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { existsSync } from 'fs'
import { extractSummary, generateReport } from './utils/report.js'
import { fileToBlob } from './utils/tools.js'
import { resetSession, getUserInfo } from './utils/session.js'
import { trackCheckComplete, trackSpecCheckComplete } from './utils/track.js'
import { config } from './config.js'
import { collectWebDom } from './collectData/getWebDom/getWebDom.js'
import { collectArkui } from './collectData/getArkui/getArkui.js'
import { collectDesign } from './collectData/getPixData/getPixData.js'
import { uxCheck } from './collectData/uxCheckOut/index.js'
import { fetchSpecList } from './collectData/uxCheckOut/fetchSpecList.js'
import { resolveSpec } from './collectData/uxCheckOut/resolveSpec.js'

/**
 * 创建一个 McpServer 实例，注册所有工具
 */
export function createMcpServer() {
  const mcp = new McpServer({
    name: 'octo-uxlint-mcp',
    version: '1.0.0',
  })

  mcp.tool(
    'ui_style_check',
    [
      'UI 一致性检查工具。对比设计稿与开发实现，找出开发侧与设计稿的差异，列出开发需要修改的点。',
      '',
      '【触发场景】',
      '当用户说以下任何一种时触发：UI 一致性检查、UX 一致性检查、一致性检查、设计稿对比、找开发对比设计的差异、',
      '检查 UI 实现、样式对比、设计走查、比对设计图和代码、检查 UI 还原、前端走查。',
      '',
      '【调用前：数据来源判断】',
      '本工具需要开发侧和设计侧两份数据，调用前需根据用户提供的内容判断如何获取：',
      '',
      '开发侧数据：',
      '1. 用户提供本地文件路径 → 直接作为 devJsonPath / devImagePath 传入',
      '2. 用户提供网页 URL → 先调用 collect_web 采集，拿到返回的 devJsonPath / devImagePath 后再传入',
      '3. 用户未提供任何开发侧数据 → 提示用户："请提供开发侧数据（本地文件路径或网页 URL）"',
      '',
      '设计侧数据：',
      '1. 用户提供本地文件路径 → 直接作为 designJsonPath / designImagePath 传入',
      '2. 用户提供传送码或设计稿 URL → 先调用 collect_design 采集，拿到返回的 designJsonPath / designImagePath 后再传入',
      '3. 用户未提供任何设计侧数据 → 提示用户："请提供设计侧数据（本地文件路径、传送码或设计稿 URL）"',
      '',
      '只有当两侧数据都就绪后，才调用本工具。判断依据：用户描述中包含 http/https 开头的网址视为 URL；',
      '纯数字或短字符串视为传送码；以 / 或盘符开头的视为本地文件路径。',
      '',
      '【参数说明】',
      '- designJsonPath: 设计稿 JSON 文件路径（本地路径，或 collect_design 返回的 designJsonPath）',
      '- devJsonPath: 开发侧 JSON 文件路径（本地路径，或 collect_web 返回的 devJsonPath）',
      '- platform: 平台类型，hmPhone（鸿蒙手机，默认）/ hmWatch（鸿蒙手表）/ web（Web 网页）',
      '- designImagePath: 设计稿截图路径（可选，本地路径或 collect_design 返回的 designImagePath）',
      '- devImagePath: 开发侧截图路径（可选，本地路径或 collect_web 返回的 devImagePath）',
      '工具内部读取文件，文件内容不占用 AI 上下文。',
      '',
      '【输出格式】',
      '返回 JSON，以设计侧节点为维度组织（最多展示部分节点，完整结果在 reportPath 指向的 md 文件中）。每个节点含：',
      '- nodeName: 开发侧节点名（文本节点用文本内容，非文本节点用 className/组件类型）',
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
      '- totalNodes: 问题节点总数',
      '- reportPath: 完整报告 md 文件路径，后续修改代码时读此文件',
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
      '9. 完整问题清单见 reportPath 指向的 md 文件，后续修改代码时直接读该 md 文件',
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
          ...(params.designImagePath ? [['设计稿截图', params.designImagePath]] : []),
          ...(params.devImagePath ? [['开发侧截图', params.devImagePath]] : []),
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

        // 生成完整 md 报告
        const reportPath = generateReport(result)

        // 打点：上报检查完成事件（fire-and-forget 不阻塞）
        try {
          trackCheckComplete({
            account: getUserInfo()?.account || '',
            platform: result.platform,
            stats: result.stats,
            diffCount: (result.diffs || []).length,
          })
        } catch {}

        // 本轮检查会话结束，下次采集工具调用时开启新的会话文件夹
        resetSession()

        // 返回给 agent 的只截取前 10 个节点，避免上下文过长
        const MAX_PREVIEW = 10
        const preview = {
          platform: summary.platform,
          nodes: summary.nodes.slice(0, MAX_PREVIEW),
        }

        const tail = summary.nodes.length > MAX_PREVIEW
          ? `\n\n（共 ${summary.nodes.length} 个问题节点，仅展示前 ${MAX_PREVIEW} 个，完整报告见 ${reportPath}）`
          : `\n\n完整报告见 ${reportPath}`

        return {
          content: [
            { type: 'text', text: JSON.stringify(preview, null, 2) + tail },
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

  // ── collect_arkui：hm arkui 开发侧数据采集 ──
  mcp.tool(
    'collect_arkui',
    [
      '鸿蒙 ArkUI 开发侧数据采集工具。启动本地 ArkUI Inspector 采集程序，采集 ArkUI 节点树 + 截图，',
      '生成 arkui.json 和 arkui.png 保存到本地，返回文件路径。',
      '',
      '【触发场景】',
      '当用户说以下任何一种时触发：采集鸿蒙、采集 arkui、采集 hm、采集鸿蒙开发侧数据、',
      '导出 arkui 数据、arkui 截图、采集开发侧数据（鸿蒙场景）。',
      '采集结果可直接用于 ui_style_check 进行 UI 一致性检查。',
      '',
      '【平台限制】',
      'ArkUI 采集只能在 Windows 电脑上执行（依赖 ArkUI Inspector 导出工具）。',
      '非 Windows 环境调用会直接失败，此时需提示用户：',
      '  · 在 Windows 环境运行，或',
      '  · 用户手动导出 arkui.json / arkui.png 文件，提供本地路径直接调用 ui_style_check',
      '',
      '【参数说明】',
      '- timeout: 采集超时时间（ms），默认 60000（60 秒）',
      '  · 从启动采集程序开始计时，超时未检测到导出文件则报错',
      '  · 若用户采集过程较慢（需在设备上多步操作），可适当调大此值',
      '',
      '【输出格式】',
      '返回 JSON，包含：',
      '- devJsonPath: 采集的 ArkUI 节点树 JSON 文件路径',
      '- devImagePath: 截图 PNG/JPG 文件路径（部分场景可能无截图，此时为 null）',
      '',
      '【使用指引】',
      '采集完成后，将返回值直接传给 ui_style_check 工具进行 UI 一致性检查：',
      '  collect_arkui 返回的 devJsonPath  → ui_style_check 的 devJsonPath 参数',
      '  collect_arkui 返回的 devImagePath → ui_style_check 的 devImagePath 参数',
      '同时设 platform 为 hmPhone（默认），配合用户提供的设计稿路径（designJsonPath / designImagePath）完成检查。',
      '即：collect_arkui → ui_style_check 是固定串联流程，采集完应自动调用 ui_style_check。',
      '',
      '【采集中断处理】',
      'collect_arkui 与 collect_design 互相独立，arkui 侧采集中断不阻塞设计侧采集：',
      '- 若 collect_arkui 返回错误（非 Windows 平台、采集程序启动失败、等待文件超时等），',
      '  仍应继续执行 collect_design 完成设计侧采集，然后根据错误提示向用户提供恢复选项，',
      '  待用户补齐 arkui 侧数据后再调用 ui_style_check。',
      '- 等待文件超时时，可提示用户确认采集程序是否正常运行、是否已导出数据后重新调用 collect_arkui。',
      '- 用户也可手动提供 arkui.json / arkui.png 文件路径，跳过 collect_arkui 直接调用 ui_style_check。',
    ].join('\n'),
    {
      timeout: z
        .number()
        .default(60000)
        .describe('采集超时时间（ms），默认 60000'),
    },
    async (params) => {
      try {
        const { devJsonPath, devImagePath } = await collectArkui({
          timeout: params.timeout,
        })

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

  // ── collect_web：Web 开发侧数据采集 ──
  mcp.tool(
    'collect_web',
    [
      'Web 页面数据采集工具。通过 puppeteer 打开网页或本地 HTML 文件，采集 DOM 树结构 + 计算样式 + 截图，',
      '生成 web.json 和 web.png 保存到本地，返回文件路径。',
      '',
      '【触发场景】',
      '当用户说以下任何一种时触发：采集网页、采集 web 页面、抓取网页 DOM、采集开发侧数据、',
      '导出 web 页面数据、获取网页截图、采集前端页面、采集本地 HTML 文件。',
      '采集结果可直接用于 ui_style_check 进行 UI 一致性检查。',
      '',
      '【参数说明】',
      '- url: 目标页面地址（必填），支持两种格式：',
      '  · Web 页面 URL（http:// 或 https:// 开头）→ puppeteer 打开网页采集',
      '  · 本地 HTML 文件路径（如 /path/to/page.html）→ 自动转 file:// 协议打开本地文件采集',
      '- width: 视口宽度，默认 1920',
      '- height: 视口高度，默认 1080',
      '- deviceScaleFactor: 截图质量倍率，默认 2（1x/2x/3x）',
      '- headless: 是否无头模式，默认 true',
      '  · true（默认）→ 无头采集，失败自动降级有头',
      '  · false → 直接有头模式，弹出浏览器窗口让用户操作',
      '',
      '【采集流程】',
      '1. headless=true（默认）：无头模式克隆用户 Chrome profile，已内置 --ignore-certificate-errors',
      '   无头采集失败（导航超时、证书拦截、网络错误、检测到登录页等）→ 自动降级有头模式',
      '2. headless=false：直接有头模式，弹出浏览器窗口，用户手动操作（登录、跳过证书等）后自动采集',
      '',
      '【输出格式】',
      '返回 JSON，包含：',
      '- devJsonPath: 采集的 DOM 树 JSON 文件路径',
      '- devImagePath: 截图 PNG 文件路径',
      '',
      '【使用指引】',
      '采集完成后，将返回值直接传给 ui_style_check 工具进行 UI 一致性检查：',
      '  collect_web 返回的 devJsonPath  → ui_style_check 的 devJsonPath 参数',
      '  collect_web 返回的 devImagePath → ui_style_check 的 devImagePath 参数',
      '同时设 platform 为 web，配合用户提供的设计稿路径（designJsonPath / designImagePath）完成检查。',
      '即：collect_web → ui_style_check 是固定串联流程，采集完应自动调用 ui_style_check。',
      '',
      '【采集中断处理】',
      'collect_web 与 collect_design 互相独立，web 侧采集中断不阻塞设计侧采集：',
      '- 若 collect_web 返回错误（如登录超时、网络超时等），仍应继续执行 collect_design 完成设计侧采集，',
      '  然后根据错误提示向用户提供恢复选项，待用户补齐 web 侧数据后再调用 ui_style_check。',
      '- 登录超时中断时，可提示用户重新调用 collect_web，在有头窗口中完成登录后采集。',
      '- 用户也可手动提供 web.json / web.png 文件路径，跳过 collect_web 直接调用 ui_style_check。',
    ].join('\n'),
    {
      url: z
        .string()
        .describe('目标页面地址：Web URL（http/https 开头）或本地 HTML 文件路径'),
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
        .default(2)
        .describe('截图质量倍率，默认 2（1x/2x/3x）'),
      headless: z
        .boolean()
        .default(true)
        .describe('是否无头模式，默认 true（无头），传 false 直接走有头模式'),
    },
    async (params) => {
      try {
        const collectOptions = {
          viewport: {
            width: params.width,
            height: params.height,
            deviceScaleFactor: params.deviceScaleFactor,
          },
          headless: params.headless,
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
        // 登录超时：有头窗口等待用户登录超时
        if (err.code === 'LOGIN_TIMEOUT') {
          return {
            content: [
              {
                type: 'text',
                text: [
                  '【Web 采集中断 - 登录超时】',
                  `原因：${err.message}`,
                  '',
                  '当前 Web 侧数据采集因等待登录超时而中断，但设计侧采集不受影响，可继续执行 collect_design。',
                  '',
                  '请向用户说明中断原因，并提供以下选项让用户选择如何继续：',
                  '',
                  '选项1：重新采集',
                  '  重新调用 collect_web，在弹出的有头浏览器窗口中尽快完成登录（120秒内）。',
                  '',
                  '选项2：手动提供 Web 开发侧数据文件',
                  '  用户自行导出 web.json（DOM 树 JSON）和 web.png（页面截图），提供本地文件路径，',
                  '  直接作为 devJsonPath / devImagePath 传给 ui_style_check，跳过 collect_web 采集。',
                  '',
                  '注意：无论用户选择哪个选项，都应先继续完成设计侧（collect_design）的采集，',
                  '两侧采集相互独立，不要因 web 侧中断而停止设计侧采集。',
                ].join('\n'),
              },
            ],
            isError: true,
          }
        }
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


  // ── collect_design：设计侧数据采集 ──
  mcp.tool(
    'collect_design',
    [
      '设计稿数据采集工具。通过传送码或设计稿 URL，采集 Pixso 设计稿的节点树数据 + 截图，',
      '生成 design.json 和 design.png 保存到指定工程目录，返回文件路径。',
      '',
      '【触发场景】',
      '当用户说以下任何一种时触发：采集设计稿、采集 Pixso 设计稿、获取设计稿数据、',
      '采集设计侧数据、导出设计稿、设计稿截图、传送码采集。',
      '采集结果可直接用于 ui_style_check 进行 UI 一致性检查。',
      '',
      '【参数说明】',
      '- code: 传送码，如 "111"，通过传送码服务解析为 Pixso 页面地址',
      '- url: 设计稿 URL 地址',
      '  · code 和 url 至少传一个，同时传时 code 优先',
      '',
      '【输出格式】',
      '返回 JSON，包含：',
      '- designJsonPath: 采集的设计稿 JSON 文件路径',
      '- designImagePath: 截图 PNG 文件路径',
      '',
      '【使用指引】',
      '采集完成后，将返回值直接传给 ui_style_check 工具进行 UI 一致性检查：',
      '  collect_design 返回的 designJsonPath → ui_style_check 的 designJsonPath 参数',
      '  collect_design 返回的 designImagePath → ui_style_check 的 designImagePath 参数',
      '同时配合开发侧数据（用户提供或 collect_web 采集）完成检查。',
      '即：collect_design → ui_style_check 是固定串联流程，采集完应自动调用 ui_style_check。',
    ].join('\n'),
    {
      code: z
        .string()
        .optional()
        .describe('传送码'),
      url: z
        .string()
        .optional()
        .describe('设计稿 URL 地址'),
    },
    async args => {
      try {
        const { code, url } = args || {};
        // 参数校验：code 和 url 至少传一个
        if (!code && !url) {
          return {
            content: [{ type: 'text', text: `传送码和 URL 至少需要提供一个` }],
            isError: true
          }
        }

        return await collectDesign(code, url);

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

  // ── list_design_specs：规范名称模糊匹配 ──
  mcp.tool(
    'list_design_specs',
    [
      '设计规范列表查询与模糊匹配工具。根据用户给出的规范名称和场景名称（都可能是模糊的），',
      '在规则库中分两阶段匹配，返回规范对应的规则文件路径列表。',
      '',
      '【触发场景】',
      '当用户要进行设计规范检查（design_spec_check）时，先调用本工具匹配规范，',
      '拿到 filePaths 后再传给 design_spec_check。',
      '',
      '【参数说明】',
      '- standardName: 规范名或分类名（可选，模糊匹配）',
      '  · 用户给的可能是规范名（如 "Octo-1.1.0"）、分类名（如 "ICT 领域组件库"）、',
      '    或模糊文本（如 "octo"、"ict"）',
      '- sceneName: 场景名（可选，模糊匹配）',
      '  · 如 "Web端_深色"、"Web端_浅色"、"移动端" 等',
      '  · 用户给的是 standardName + sceneName 组合时（如 "Octo Web端深色"），请拆分后分别传入',
      '',
      '【输出格式】',
      '返回 JSON，三种情况：',
      '',
      '1. 唯一匹配（matched=true）：',
      '   { matched: true, standardId, standardName, sceneName?, filePaths: ["路径1", ...] }',
      '   → 将 filePaths 直接传给 design_spec_check 的 specFilePaths 参数',
      '',
      '2. 需要选规范（matched=false, stage="standard"）：',
      '   { matched: false, stage: "standard", message, candidates: [{standardId, standardName, categoryName}, ...] }',
      '   → 展示候选给用户，选定后用完整 standardName 重新调用本工具',
      '',
      '3. 已确定规范但需要选场景（matched=false, stage="scene"）：',
      '   { matched: false, stage: "scene", standardId, standardName, message, candidates: [{sceneId, sceneName, sceneCategory}, ...] }',
      '   → 展示场景候选给用户，选定后用 standardName + sceneName 重新调用本工具',
      '',
      '【使用指引】',
      '- 用户说"检查 octo" → 调 list_design_specs(standardName="octo")',
      '  · matched=true → 直接拿 filePaths 调 design_spec_check',
      '  · stage="standard" → 展示规范候选，用户选定后重新调用',
      '  · stage="scene" → 展示场景候选，用户选定后用 standardName + sceneName 重新调用',
      '- 用户说"检查 octo web端深色" → 调 list_design_specs(standardName="octo", sceneName="web端深色")',
      '- 用户没给任何名称 → 调 list_design_specs() 获取全量规范列表',
      '- 本工具与 design_spec_check 是固定串联流程：list_design_specs → design_spec_check',
    ].join('\n'),
    {
      standardName: z
        .string()
        .optional()
        .describe('规范名或分类名（模糊匹配，如 "octo"、"ICT 领域组件库" 等）'),
      sceneName: z
        .string()
        .optional()
        .describe('场景名（模糊匹配，如 "Web端_深色"、"移动端" 等）'),
    },
    async (params) => {
      try {
        const specData = await fetchSpecList()
        const result = resolveSpec(specData, params.standardName, params.sceneName)

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `查询规范列表出错: ${err.message}`,
            },
          ],
          isError: true,
        }
      }
    },
  )

  // ── design_spec_check：设计规范一致性检查 ──
  mcp.tool(
    'design_spec_check',
    [
      '设计规范一致性检查工具。检查 HTML 页面或 Web 链接是否符合指定的设计规范，',
      '采集页面 document.body，对照规范规则输出不一致的问题清单和修改建议。',
      '',
      '【触发场景】',
      '当用户说以下任何一种时触发：设计规范检查、规范一致性检查、检查是否符合规范、',
      '检查设计规范、规范走查、检查页面是否符合 Octo 规范、代码规范检查。',
      '',
      '【调用前：必须先匹配规范】',
      '本工具的 specFilePaths 参数需要精确的规则文件路径列表，来自 list_design_specs 工具的返回值。',
      '调用流程：',
      '  1. 先调 list_design_specs(standardName, sceneName) 进行模糊匹配',
      '  2. 拿到 matched=true 的 filePaths 后，传入本工具的 specFilePaths 参数',
      '  3. 如果 list_design_specs 返回 matched=false，展示候选给用户，选定后重新匹配',
      '',
      '【参数说明】',
      '- source: 检查目标，支持两种格式：',
      '  · 本地 HTML 文件路径（如 /path/to/page.html）',
      '  · Web 页面 URL（如 https://example.com/page）',
      '- specFilePaths: 规范规则文件路径数组（来自 list_design_specs 返回的 filePaths）',
      '',
      '【输出格式】',
      '返回报告 JSON，包含问题列表和统计信息，结构由检查方法决定。',
    ].join('\n'),
    {
      source: z
        .string()
        .describe('检查目标：本地 HTML 文件路径或 Web 页面 URL'),
      specFilePaths: z
        .array(z.string())
        .describe('规范规则文件路径数组（来自 list_design_specs 返回的 filePaths）'),
    },
    async (params) => {
      try {
        const report = await uxCheck(
          params.source,
          params.specFilePaths,
        )

        // 打点：上报规范检查完成事件（fire-and-forget 不阻塞）
        try {
          trackSpecCheckComplete({
            account: getUserInfo()?.account || '',
            specFilePaths: params.specFilePaths,
            stats: report?.stats,
            issueCount: (report?.issues || []).length,
          })
        } catch {}

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(report, null, 2),
            },
          ],
        }
      } catch (err) {
        if (err.code === 'LOGIN_TIMEOUT') {
          return {
            content: [
              {
                type: 'text',
                text: [
                  '【规范检查中断 - 登录超时】',
                  `原因：${err.message}`,
                  '',
                  '当前页面需要登录才能访问，采集因等待登录超时而中断。',
                  '',
                  '请向用户说明中断原因，并提供以下选项让用户选择如何继续：',
                  '',
                  '选项1：重新检查',
                  '  重新调用 design_spec_check，在弹出的有头浏览器窗口中尽快完成登录（120秒内）。',
                  '',
                  '选项2：手动提供本地 HTML 文件',
                  '  用户自行在浏览器中打开页面，另存为 HTML 文件后提供本地路径，直接调用 design_spec_check 检查本地文件。',
                ].join('\n'),
              },
            ],
            isError: true,
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: `检查过程出错: ${err.message}`,
            },
          ],
          isError: true,
        }
      }
    },
  )



  return mcp
}
