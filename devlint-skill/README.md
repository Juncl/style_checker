# DevLint Skill

UI 一致性检查与设计规范检查的 opencode skill，内置完整的命令行工具，安装即用。

## 快速安装

```bash
# 1. 解压 zip 包
# macOS / Linux:
unzip devlint-skill-<ver>.zip
# Windows (PowerShell):
Expand-Archive devlint-skill-<ver>.zip -DestinationPath .

# 2. 进入目录运行安装脚本
cd devlint-skill-<ver>
node install.js

# 3. 重启 opencode
```

## 验证安装

```bash
devlint-skill --help
```

## 包含的命令

| 命令 | 用途 | 限制 |
|------|------|------|
| `collect-arkui` | 采集鸿蒙 ArkUI 开发侧数据 | 仅 Windows |
| `collect-web` | 采集 Web 页面 DOM 树 + 截图 | 需 Chrome |
| `collect-design` | 采集 Pixso 设计稿数据 + 截图 | 需 Chrome |
| `ui-style-check` | 对比设计稿与开发实现，输出差异清单 | 需 Chrome |
| `design-spec-check` | 检查 HTML/URL 是否符合设计规范 | 需 Chrome |

## 环境要求

- **Node.js** 16.7+（需要 `fs.cpSync` 支持）
- **Chrome 浏览器**（collect-web / collect-design / design-spec-check 需要）
  - 自动查找系统 Chrome
  - 或通过环境变量 `CHROME_PATH` 指定路径
- **Windows**（collect-arkui 需要，依赖 ArkUI Inspector 导出工具）

## 安装位置

安装脚本将以下内容放到对应位置：

| 内容 | 路径 |
|------|------|
| 工具代码 | 解压目录（原地） |
| 命令注册 | `devlint-skill` → 全局 PATH（npm link） |
| Skill 指令 | `~/.config/opencode/skills/devlint-skill/SKILL.md` |

## 工作流程

### UI 一致性检查

```
用户：帮我做 UI 一致性检查，设计稿传送码 111，开发侧是 https://example.com

AI 执行流程：
  1. devlint-skill collect-design --code 111 --path .
     → {"designJsonPath":"...","designImagePath":"..."}
  2. devlint-skill collect-web --url https://example.com
     → {"devJsonPath":"...","devImagePath":"..."}
  3. devlint-skill ui-style-check --design-json <path> --dev-json <path> --platform web
  4. 展示差异清单，引导用户修改代码
```

### 设计规范检查

```
用户：检查这个页面是否符合 Octo 规范：https://example.com/page

AI 执行流程：
  1. devlint-skill design-spec-check --source https://example.com/page --spec Octo
  2. 展示问题清单和修改建议
```

## 打包方式（开发者）

```bash
cd devlint-skill
npm run build
# 产物：dist/devlint-skill-<ver>.zip
```
