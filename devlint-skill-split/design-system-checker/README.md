# design-system-checker

设计规范检查工具：模糊匹配设计规范名，检查 HTML/URL 是否符合规范，输出问题清单。

## 安装

```bash
# 1. 解压 design-system-checker-1.0.0.zip
# 2. 进入解压目录
npm install --omit=dev
npm link
# 3. 拷贝 SKILL.md 到 ~/.config/opencode/skills/design-system-checker/
# 4. 重启 opencode
```

## 命令

| 命令 | 用途 |
|------|------|
| `list-design-specs` | 模糊匹配规范名/场景名，返回规则文件路径列表 |
| `design-spec-check` | 检查 HTML/URL 是否符合设计规范（需先调 list-design-specs） |

## 使用

在 opencode 对话中直接描述需求即可，AI 会自动加载本 skill 并调用对应命令。

详细参数见 `SKILL.md`。
