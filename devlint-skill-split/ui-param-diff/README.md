# ui-param-diff

UI 一致性检查工具：采集鸿蒙 ArkUI / Web / Pixso 设计稿数据，对比设计稿与开发实现，输出差异修改清单。

## 安装

```bash
# 1. 解压 ui-param-diff-<ver>.zip
# 2. 进入解压目录
npm install --omit=dev
npm link
# 3. 拷贝 SKILL.md 到 ~/.config/opencode/skills/ui-param-diff/
# 4. 重启 opencode
```

## 命令

| 命令 | 用途 |
|------|------|
| `collect-arkui` | 采集鸿蒙 ArkUI 开发侧数据（仅 Windows） |
| `collect-web` | 采集 Web 页面 DOM 树 + 截图 |
| `collect-design` | 采集 Pixso 设计稿数据 + 截图 |
| `ui-style-check` | 对比设计稿与开发实现，输出差异清单 |

## 使用

在 opencode 对话中直接描述需求即可，AI 会自动加载本 skill 并调用对应命令。

详细参数见 `SKILL.md`。
