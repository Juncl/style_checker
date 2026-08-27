# octo-uxlint-mcp vs Pixso MCP：一致性检查能力对比

> 只对比两种 MCP 在「UI 一致性检查」场景下给出的能力，其他能力（设计稿编辑、组件实例化等）不参与评价。
> octo-uxlint-mcp 逻辑详见 `docs/mcp逻辑/devlint-mcp工程逻辑.md`。

---

## 一、两种 MCP 的一致性检查路径

| | octo-uxlint-mcp（本工程） | Pixso MCP |
|---|---|---|
| 检查工具 | `ui_style_check`（封装 server 确定性算法） | 无专用检查工具，靠 `query_nodes` + `design_to_code` + `get_screenshot` + AI 读代码 + AI 语义对比 |
| 采集工具 | `collect_arkui` / `collect_web` / `collect_design`（双侧真实运行态） | 只能读 Pixso 客户端当前文件，无开发侧采集 |
| 对比主体 | 算法逐属性比对（封装在 `ui_style_check` 内） | LLM 自身判断 |
| 输出 | 结构化 diff + 报告落盘 md | 自然语言差异列表 |

---

## 二、一致性检查能力对比

### 2.1 开发侧数据获取

| 能力 | octo-uxlint-mcp | Pixso MCP |
|---|---|---|
| 鸿蒙 ArkUI 真机采集 | ✅ `collect_arkui` 启动 Inspector 采集 | ❌ 不支持 |
| Web 真页 DOM 采集 | ✅ `collect_web` puppeteer + 登录态克隆 + 有头降级 | ❌ 只能读本地 HTML 或源码 |
| 采集独立性 | ✅ 三采集工具互独立，一侧中断不阻塞另一侧 | — 无开发侧采集概念 |

> 这是 octo-uxlint-mcp 最核心的优势：**能拿到开发侧的真实运行态数据**（Inspector 导出的 ArkUI 节点树、浏览器渲染后的 DOM+计算样式），而 Pixso MCP 只能读工程源码，拿不到运行时渲染结果，对"代码写了但渲染出来不对"的场景无能为力。

### 2.2 检查执行

| 能力 | octo-uxlint-mcp | Pixso MCP |
|---|---|---|
| 检查引擎 | ✅ `ui_style_check` 内置确定性算法（节点匹配 + 逐属性容差比对） | ❌ 无引擎，全靠 LLM 逐项语义判断 |
| 结果稳定性 | ✅ 同输入同输出，可复现 | ❌ LLM 输出不稳定，同输入不同次结果可能漂移 |
| 量化 | ✅ error/warning 计数 + 评分 + 覆盖率 | ❌ 无量化，"偏小 2px""偏淡"靠经验 |
| 节点匹配 | ✅ 多 Pass 匹配 + 一对一裁决 | ❌ LLM 自由对齐，可能漏配/错配 |
| 结构缺失检测 | ⚠️ 未匹配节点进 unmatched，不主动报 | ✅ LLM 对"应有而没有"敏锐（如"少了加号按钮"） |
| 跨框架源码对比 | ❌ 只比导出数据 | ✅ `design_to_code` 支持 vue/react/html/arkui/flutter |

### 2.3 上下文与规模

| 维度 | octo-uxlint-mcp | Pixso MCP |
|---|---|---|
| 文件是否进 AI 上下文 | ❌ **不进**：MCP 内部 `fileToBlob` 转 multipart 上传 | ✅ 进：`query_nodes` 输出直接返回 AI |
| 大画板处理 | ✅ 全量解析，无截断 | ❌ 输出截断（实测 67KB/104KB 截断），需分批读，易漏深层节点 |
| AI 上下文压力 | ✅ 只回前 10 个 error preview + 报告路径 | ❌ 节点数据全进上下文，大文件易爆 |
| 图片读取 | ✅ MCP 内部处理 | ⚠️ 部分模型不支持图片输入（实测无法读截图） |

### 2.4 输出与可追溯

| 维度 | octo-uxlint-mcp | Pixso MCP |
|---|---|---|
| 输出形态 | 结构化 JSON + 落盘 md 报告（error+warning，开发侧节点维度） | 自然语言表格 |
| 可定位 | ✅ 每条 diff 带 componentChain（组件层级链）+ designRect | ⚠️ 只给文件名 + 属性名，无节点定位 |
| 完整报告 | ✅ 落盘 `.devlint/octo_uxlint_result.md`，后续改代码直接读 | ❌ 对话内一次性，无落盘 |
| preview 控制 | ✅ 只回前 10 个 error，控制上下文 | ❌ 全量返回，无截断控制 |

---

## 三、本工程 octo-uxlint-mcp 的优点（一致性检查场景）

1. **能采开发侧真实运行态**：`collect_arkui`（ArkUI Inspector）+ `collect_web`（puppeteer + 登录态克隆 + 有头降级）能拿真机/真页面的渲染数据；Pixso MCP 只能读源码或本地 HTML，对"代码对了但渲染跑偏"的场景束手无策。
2. **文件不经 AI 上下文**：MCP 进程内 `fileToBlob` 转 multipart 上传 server，文件内容不占 token；Pixso MCP 的 `query_nodes` 输出全进上下文，大画板动辄 67KB/104KB 截断，深层差异易漏。
3. **检查结果确定可复现**：`ui_style_check` 封装确定性算法，同输入同输出；Pixso MCP 靠 LLM，同输入不同次结果可能漂移，无法回归。
4. **采集与检查解耦、采集互独立**：三个采集工具各自独立，一侧中断不阻塞另一侧，路径串联检查；Pixso MCP 读节点失败只能整体重来。
5. **preview + 完整报告落盘**：AI 只拿前 10 个 error preview 控上下文，完整 error+warning 报告落盘 md，带 componentChain 帮定位代码；Pixso MCP 对话内一次性输出，无落盘、无节点定位。
6. **端到端一条链**：采集 → 检查 → 报告落盘，AI 拿路径即可继续改代码；Pixso MCP 需人工串联 query_nodes → 读代码 → AI 对比。

---

## 四、Pixso MCP 的长处（客观）

- **零导出直读 Pixso 原生**：直接读组件实例、变量集、共享样式、远程库，不用导出中间 JSON。
- **能抓"结构缺失"**：LLM 对"设计稿有但代码没有"的元素敏锐（如本次发现的"少了一个加号圆形按钮"），octo-uxlint-mcp 只把多余设计节点丢进 unmatched 不报差异。
- **跨框架对比源码**：`design_to_code` 支持 vue/react/html/arkui/flutter，octo-uxlint-mcp 只比导出数据。

---

## 五、互补建议

日常对话式初评用 Pixso MCP 抓"结构缺失 + 跨框架"；要确定性、要采运行态、要可追溯报告的严肃检查用 octo-uxlint-mcp。长期可给 octo-uxlint-mcp 的 `ui_style_check` 加"结构缺失检测"（对比两侧节点集合差集主动报差异）补齐唯一短板。

---

## 附：本次演练实证

用 Pixso MCP 检查 `AiChatDrawer.vue` 输入区 vs "通用问答"画板（`3:208`）：

- **Pixso MCP 抓到、octo-uxlint-mcp 抓不到**：发送区"设计稿有加号圆形按钮 + 渐变纸飞机两个元素，代码只有一个 `send.svg`"——结构缺失，octo-uxlint-mcp 只列进 unmatched 不报差异。
- **两者都能抓**：placeholder 文案/字号/颜色、上传标签字号、padding/gap 偏差。
- **Pixso MCP 抓不稳**：大画板 `query_nodes` 输出 67KB/104KB 截断需分批读；渐变光影只能靠 `design_to_code` 的 CSS 字符串推断；本模型无法读截图。
- **octo-uxlint-mcp 能量化而 Pixso MCP 不能**：评分、error/warning 计数、覆盖率。
