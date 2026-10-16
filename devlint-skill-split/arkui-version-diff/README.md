# arkui-version-diff

ArkUI 版本对比工具：采集或读取同一页面两个版本的 ArkUI Inspector 数据（旧版 base vs 新版 target），对比输出节点匹配、样式差异清单（JSON）和可视化 HTML 报告。

整体流程与 UI 一致性检查（ui-param-diff）一致：**采集（两次，或直接拿文件）→ 对比（版本对比接口）→ 报告（复用检查服务可视化报告）**。

## 安装

```bash
# 1. 解压 arkui-version-diff-<ver>.zip
# 2. 进入解压目录（零第三方依赖，无需 npm install）
npm link
# 3. 拷贝 SKILL.md 到 ~/.config/opencode/skills/arkui-version-diff/
# 4. 重启 opencode
```

## 命令

| 命令 | 用途 |
|------|------|
| `collect-arkui` | 采集一版 ArkUI 数据（仅 Windows，`--label base\|target` 区分新旧版本） |
| `version-diff` | 对比两个版本的 ArkUI 数据，输出 JSON 结果 + 可视化 HTML 报告 |

## 使用
```bash
# 方式一：已有两版本地文件，直接对比
arkui-version-diff version-diff \
  --base-json <旧版本json> --target-json <新版本json> \
  [--base-image <旧版本截图>] [--target-image <新版本截图>]

# 方式二：Windows 设备现场采集（先旧后新）
arkui-version-diff collect-arkui --label base     # 设备停留在旧版本页面
# ...设备切换/升级到新版本页面...
arkui-version-diff collect-arkui --label target
# 采集返回的路径直接传给 version-diff
```

检查服务地址取自随包的 `src/lib/config.js`（与 ui-param-diff 同源），无需参数。

在 opencode 对话中直接描述需求即可，AI 会自动加载本 skill 并调用对应命令。

详细参数见 `SKILL.md`。

## 结构说明

- `bin/` + `lib/`：skill 自有代码（全新写）
- `src/lib/`：采集引擎 + 服务配置（devlint-mcp 同源快照，已静态提交在本目录，与 ui-param-diff 行为一致；mcp 侧更新时需手动同步）
- `src/script/`：采集程序 `export_arkui.exe`（打包时从 devlint-mcp 拉取）
