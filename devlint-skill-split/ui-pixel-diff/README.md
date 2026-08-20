# ui-pixel-diff

视觉检查工具：对比设计稿截图与开发实现截图，输出差异清单和带标注的 HTML 对比图。

## 安装

```bash
# 1. 解压 ui-pixel-diff-1.0.0.zip
# 2. 进入解压目录
npm install --omit=dev
npm link
# 3. 拷贝 SKILL.md 到 ~/.config/opencode/skills/ui-pixel-diff/
# 4. 重启 opencode
```

## 命令

| 命令 | 用途 |
|------|------|
| `ai-img-check` | 视觉检查，取 prompt → 看对话图 → 输出差异 JSON → 生成 HTML 标注图 |

## 使用

在 opencode 对话中传入两张截图（设计稿 + 开发实现），直接描述"对比图片"即可，AI 会自动加载本 skill 并调用对应命令。

详细参数见 `SKILL.md`。
