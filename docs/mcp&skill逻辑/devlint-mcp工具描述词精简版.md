# devlint-mcp 工具描述词（精简版 v2）

> 来源：`devlint-mcp/lib/server.js` 中 4 个 `mcp.tool` 的 description。
> 用途：token 精简版，单行字符串形式（`\n` 为换行转义），可直接作为 `mcp.tool(name, description, ...)` 的 description 参数使用。
> 压缩原则：能力点全量保留（触发词、硬性规则、数据引导、参数、输出字段、串联流程、中断处理、展示指引），仅压缩句式与排版。

## 规模对照

| 工具 | 原始 | 第一轮 | 第二轮 | 第三轮 | 当前（含用户微调） | 单行字数 | 总压缩率 |
|---|---|---|---|---|---|---|---|
| ui_style_check | 2903 字 | 2045 字 | 1361 字 | 1121 字 | 1035 字 | 1045 字 | 64% |
| collect_arkui | 1322 字 | 932 字 | 595 字 | 595 字 | 595 字 | 601 字 | 55% |
| collect_web | 1726 字 | 1070 字 | 697 字 | 697 字 | 697 字 | 703 字 | 60% |
| collect_design | 854 字 | 540 字 | 378 字 | 378 字 | 378 字 | 383 字 | 56% |
| **合计** | 6805 字 | 4587 字 | 3031 字 | 2791 字 | 2705 字 | **2732 字** | **60%** |

> 注：除"单行字数"外均为语义字符数（换行计 1 字符）；"单行字数"为 `\n` 转义后的字面字符数（每个 `\n` 占 2 字符），即粘贴进代码的实际长度。

### 压缩轨迹

- **第一轮**：统一【】节结构、合并互补章节、压缩重复引导句式、去掉纯解释性文字
- **第二轮**：去掉段间空行、触发词同类合并（如"UI 一致性检查、UX 一致性检查"→"UI/UX 一致性检查"）、引导清单改紧凑单行、bullet 前缀 `- ` 改 `· `
- **第三轮**（仅 ui_style_check）：【输出】+【展示】合并为【结果】一节——删自解释字段（nodeName/devClassName/textContent/totalNodes 逐字段说明、componentChain 示例），保留行为契约（reportPath 改代码时读、htmlReportPath 转达用户、禁展示项、修改指令格式、无差异话术）
- **用户微调**（仅 ui_style_check）：触发词删 4 个长尾词（设计走查、前端走查、比对设计图和代码、找开发对比设计的差异）；硬性规则删"禁止其他 MCP 或 skill"（"只能用"已隐含排他）；删指南链接 MCP_GUIDE_URL；删"不占 AI 上下文"

---

## 一、ui_style_check

```text
UI 一致性检查：对比设计稿与开发实现，列出开发侧需修改的差异点。\n【触发】UI/UX 一致性检查、一致性检查、设计稿对比、样式对比、检查 UI 实现/还原。\n【硬性规则】数据采集只能用本工具的 collect_arkui / collect_web / collect_design；用户已有本地文件路径则直接传入，无需采集。\n【数据判断】需开发侧+设计侧两份数据，缺一不可，缺一侧先追问（"请提供开发侧数据（本地文件路径或网页 URL）"/"请提供设计侧数据（本地文件路径、传送码或设计稿 URL）"）：\n· 开发侧（其一）：本地路径（arkui.json/arkui.dump/web.json，附截图）直传；网页 URL→先 collect_web；已连鸿蒙设备（仅 Windows）→先 collect_arkui\n· 设计侧（其一）：本地路径（design.json，附截图）直传；传送码（如 "111"）或设计稿 URL→先 collect_design\n· platform：hmPhone（默认）/hmWatch/web\n· 识别：http(s) 开头=URL；纯数字/短字符串=传送码；/ 或盘符开头=本地路径\n· 无任何数据时不调用，先列清单引导用户逐项补充，两侧就绪后再调用。\n【参数】designJsonPath：设计稿 JSON 路径；devJsonPath：开发侧数据路径（arkui.json/arkui.dump/web.json，dump 自动识别）；platform：平台类型；designImagePath/devImagePath：两侧截图路径（可选）。文件由工具内部读取。\n【结果】返回 JSON，按设计侧节点组织（仅前 10 个，完整见 reportPath 的 md），每节点含 componentChain（组件层级链，用于定位代码）与 issues[]（property/expected/actual=属性名/设计稿值/开发侧值）。展示：每节点一组，componentChain+相对位置定位；每条差异按修改指令输出：「属性」期望 expected，当前为 actual，需修改；不展示评分/覆盖率/耗时/节点 ID/path；无差异则说"开发侧与设计稿一致，无需修改"；reportPath 的 md 为完整清单（后续改代码时读此文件），htmlReportPath 为可视化 HTML 报告，转达用户浏览器打开。
```

## 二、collect_arkui

```text
鸿蒙 ArkUI 开发侧数据采集：启动本地 ArkUI Inspector 采集程序，采集节点树+截图，生成 arkui.json/arkui.png 并返回路径，供 ui_style_check 使用。\n【触发】采集鸿蒙/arkui/hm/鸿蒙开发侧数据、导出 arkui 数据、arkui 截图、采集开发侧数据（鸿蒙场景）。\n【限制】仅 Windows（依赖 ArkUI Inspector 导出工具），非 Windows 调用直接失败；失败时提示用户换 Windows 环境，或手动导出 arkui.json/dump/截图后提供路径直调 ui_style_check。\n【参数】timeout：采集超时（ms），默认 60000；从启动采集程序计时，超时未检测到导出文件则报错；设备上多步操作时可调大。\n【输出】devJsonPath（节点树 JSON 路径）、devImagePath（截图路径，部分场景为 null）。\n【串联】采集完自动调 ui_style_check：返回值传同名参数，platform=hmPhone（默认），配合设计稿数据。\n【中断】与 collect_design 独立，本工具失败不阻塞设计侧：先继续 collect_design，再给恢复选项（确认采集程序正常/已导出后重调；或手动提供 arkui.json/arkui.dump/截图路径跳过）。
```

## 三、collect_web

```text
Web 页面数据采集：puppeteer 打开网页或本地 HTML，采集 DOM 树+计算样式+截图，生成 web.json/web.png 并返回路径，供 ui_style_check 使用。\n【触发】采集网页/web 页面/前端页面/本地 HTML 文件、抓取网页 DOM、导出 web 页面数据、获取网页截图、采集开发侧数据。\n【引导】无地址时不调用，先索要：页面地址（必填，线上 URL 或本地 HTML 路径）；视口尺寸（可选，默认 1920×1080）；需登录/手动操作传 headless=false。\n【参数】url（必填；URL 直接打开，本地路径自动转 file://）；width/height（视口，默认 1920/1080）；deviceScaleFactor（截图倍率，默认 2，可选 1x/2x/3x）；headless（默认 true 无头：克隆 Chrome profile+忽略证书错误，导航超时/证书拦截/登录页等失败自动降级有头；false：直接弹窗，手动操作后自动采集）。\n【输出】devJsonPath（DOM 树 JSON 路径）、devImagePath（截图 PNG 路径）。\n【串联】采集完自动调 ui_style_check：返回值传同名参数，platform=web，配合设计稿数据。\n【中断】与 collect_design 独立，本工具失败（登录/网络超时等）不阻塞设计侧：先完成 collect_design，再给恢复选项（登录超时→重调本工具，有头窗口 120 秒内登录；或手动提供 web.json/web.png 路径跳过）。
```

## 四、collect_design

```text
设计稿数据采集：通过传送码或设计稿 URL 采集节点树+截图，生成 design.json/design.png 并返回路径，供 ui_style_check 使用。\n【触发】采集设计稿、获取设计稿数据、采集设计侧数据、导出设计稿、设计稿截图、传送码采集。\n【引导】无传送码/URL 时不调用，先索要（二选一）：传送码（如 "111"，经传送码服务解析为设计稿地址）或设计稿 URL。\n【参数】code（传送码）/url（设计稿 URL），至少传一个，同传时 code 优先。\n【输出】designJsonPath（设计稿 JSON 路径）、designImagePath（截图 PNG 路径）。\n【串联】采集完自动调 ui_style_check：返回值传同名参数，配合开发侧数据（用户提供或 collect_arkui/collect_web 采集）。
```

---

## 能力保留核对表

| 能力点 | ui_style_check | collect_arkui | collect_web | collect_design |
|---|---|---|---|---|
| 触发词保留（ui_style_check 为核心集，4 个长尾词已删；其余三个工具全量） | ✅ | ✅ | ✅ | ✅ |
| 采集工具独占硬性规则（"只能用"隐含排他） | ✅ | — | — | — |
| 数据缺失引导 + 缺侧追问话术 | ✅ | — | ✅ | ✅ |
| 输入类型识别（URL / 传送码 / 本地路径） | ✅ | — | — | — |
| 参数与默认值全量说明 | ✅ | ✅ | ✅ | ✅ |
| 输出非自解释字段说明（componentChain / issues / reportPath / htmlReportPath） | ✅ | ✅ | ✅ | ✅ |
| 采集 → ui_style_check 固定串联 + 参数映射 | — | ✅ | ✅ | ✅ |
| 平台/环境限制及替代方案 | — | ✅（仅 Windows） | — | — |
| 两侧采集独立、失败恢复选项 | — | ✅ | ✅ | —（原文亦无） |
| 结果展示指引（分组/定位/修改指令/禁展示项/无差异话术） | ✅ | — | — | — |
| 使用指南链接（MCP_GUIDE_URL） | ❌（用户微调删除） | — | — | — |

## 压缩时牺牲的内容（不影响 AI 行为决策）

- **排版**：段间空行、编号列表 → 紧凑长句与 `·` bullet（语义等价，AI 遵循度可能略降）
- **触发词合并**："UI 一致性检查、UX 一致性检查" → "UI/UX 一致性检查" 等同类合并（触发语义保留）
- **解释性文字**：如"帮助开发者快速定位并修改代码"类纯说明
- **报告内部交互细节**：htmlReportPath 的"筛选/折叠/精准-模糊切换、结构与 client 预览态一致"（AI 只需转达路径）
- **次要展开**：collect_web 失败降级原因中"网络错误"并入"等"；nodeName 与 devClassName 的重复说明合并
- **自解释输出字段**（第三轮，仅 ui_style_check）：nodeName/devClassName/textContent/totalNodes 逐字段说明、componentChain 示例（Navigation > NavBar > Text("会员中心")）、"web 平台额外标注 devClassName"软性建议——AI 拿到返回 JSON 即可理解这些字段
- **用户微调**（仅 ui_style_check）：4 个长尾触发词（设计走查、前端走查、比对设计图和代码、找开发对比设计的差异）、"禁止其他 MCP 或 skill"显式排他句、指南链接、"不占 AI 上下文"安心话
