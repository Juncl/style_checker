---
name: design-checker
description: 基于设计规范文档的前端工程 UI 规范检查与修复能力。检查对象不限 HTML——任意前端工程（原生 HTML/CSS、Vue、React 等）或单文件均可；规则库不限 Markdown——任意可读文本格式的 UI 校验规则均可。用户未指定时优先从会话上下文推断检查对象与规范（如上一步刚用某规范生成代码，直接说"检查一下"即可无缝衔接）；推断不出才向用户索要。先检查是否符合设计规范并生成报告，经用户确认后在副本上逐条修复问题并复查验证。当用户提到 UI 规范检查、规范走查、检查并修复设计规范问题等场景时加载本 skill。
---

## 能力总览

| 命令 | 用途 | 输出 |
|------|------|------|
| `--list-specs` | 列出可用规范领域 | 领域清单表（服务端优先，本地兜底） |
| `--sync-spec <领域key>` | 检查&更新本地规范（读规范前必跑） | 「来源: server/local」 |
| `--scan-spec <领域key>` | 规范粗筛（检查必跑，替代规范通读） | 疑似规则行清单（文件 + 行号 + 原文行） |
| 检查递交（stdin） | 存档 + 生成检查报告 | 报告路径 + 工作目录 + 问题统计 |
| 修复递交（`--fix`，stdin） | 存档 + 生成修复报告 | 报告路径 + 修复结果摘要 |

规范库 = skill 内 `specFiles/`（本地自带，唯一规范读取来源）。配套文档：`check-method.md`（检查方法论，检查前 Read）、`fix-guide.md`（修复守则，用户确认修复后 Read）。

**调用方式**：`node <skill目录>/bin/design-checker.mjs <command>`。零外部依赖，无需 npm install。

---

## 主线：检查 → 询问 → 修复 → 汇报

用户未提供信息且从上下文推断不出时，**不执行任何命令**，先跑 `--list-specs` 取清单，再索要：**① 检查目标**（工程/文件路径，必填）、**② 期望规范**（可选，按清单「规范名称」列展示候选，只有 1 个领域时只列 1 行）。上下文能推断（如刚用某规范生成代码后说"检查一下"）→ 简述依据直接开始，不索要。

```
用户意图：UI 规范检查 / 规范走查 / 检查并修复
  │
  ├── 1. 确认领域 key：--list-specs（🔴 禁止跨领域混用）
  │        用户已指定 → 按清单对照；未指定 → 从代码/路径推断或让用户选
  │        不在清单内 → 告知需先经 spec-server 管理接口上传
  ├── 2. --sync-spec <领域key>（🔴 读取规范前必跑）
  │        来源=local（服务不可达，静默用本地自带规范，🔴 不向用户提示）→ 继续
  ├── 3. 检查（Read check-method.md）
  │        Read 样式载体（引用链追本地 CSS；排除 node_modules/dist/build 等；
  │        外部 CSS 不读，检查时标 warning）
  │        规范一律先 --scan-spec 粗筛拿候选行 → 按需片段精读（🔴 禁止整读规范文件）
  │        （🔴 规范库混有示例代码、生成指南、开发教程等非规则内容时一律忽略，
  │          只提取可对照检查的 UI 规则条目——数值、色值、尺寸、状态样式等）
  │        → issues 经 stdin 递交（🔴 0 问题也递交——报告必出）
  ├── 4. 询问（🔴 硬性交互点）
  │        N=0 → 告知"前端实现符合设计规范，未发现问题" + 报告路径，结束
  │        N>0 → 询问是否在副本上修复：全部 / 只修 error / 自定义 / 不修
  │              （info 为提示级，"全部修复"默认不含 info）
  ├── 5. 修复（Read fix-guide.md）
  │        生成副本（🔴 原件只读）→ 逐条修复（每条回读 specFiles/<specFile>
  │        核对 specQuote）→ 复查 → fix-result 经 stdin 递交
  └── 6. 汇报（🔴 一律绝对路径）
           原件未动 + 副本位置 + 修复统计 + 未通过/failed 条目说明（询问是否继续）+ 报告路径
```

---

## 命令详细参数

```bash
node <skill目录>/bin/design-checker.mjs --list-specs [--spec-server <url>]        # 领域清单（服务端优先，本地兜底）
node <skill目录>/bin/design-checker.mjs --sync-spec <领域key> [--spec-server <url>]  # 检查&更新；stdout 固定输出「来源: server|local」
node <skill目录>/bin/design-checker.mjs --scan-spec <领域key>                     # 粗筛，纯只读
node <skill目录>/bin/design-checker.mjs [--out-dir <绝对目录>] <<'JSON'           # 检查递交（stdin）
{ "summary": "...", "sourceFile": "...", "specDomain": "<领域key>", "issues": [...] }
JSON
node <skill目录>/bin/design-checker.mjs --fix --work-dir <检查工作目录> [--out-dir <绝对目录>] <<'JSON'  # 修复递交（stdin）
{ "sourceFile": "...", "copyMode": "...", "fixedFiles": [...], "fixes": [...] }
JSON
```

- 🔴 AI 不写产物文件：只递交数据、读 stdout，存档与报告全部由脚本完成
- `--work-dir` = 检查 stdout 返回的「工作目录」，**原样透传**
- `--out-dir` 仅当用户指定过报告保存目录时追加，整理成绝对目录（`~/` 与相对路径脚本会兜底展开）；未指定时报告落 `~/.octo-uxlint/design-check/`（7 天自动过期），用户指定目录不过期
- stdout 输出的路径均为绝对路径，汇报时原样告知

**串联规则**：`--list-specs` 清单「领域 key」→ `--sync-spec`；`--scan-spec` 候选行清单 → 检查依据 + specQuote 来源（按行号片段精读）；检查 stdout「工作目录」→ 修复 `--work-dir`。领域清单与规范内容一律经脚本获取，**AI 不直接 curl 服务端**。

---

## 🔴 失败处理

- **失败即止步**：命令报错（非零退出码 / stderr 有 `✗`）→ 停止流程，不假装成功
- **重试上限 2 次**（含首次共 3 次），耗尽后向用户报告，让用户决定下一步
- 服务不可达时 `--list-specs` / `--sync-spec` 已由脚本自动退回本地（stdout 标注来源），继续流程即可；本地无领域 → 报告用户，**不要自建规范目录**
- 递交失败 → 读 stderr 按数据结构修正后重试
- ❌ 禁止：改 `bin/`、`lib/`、文档等任何源码；用空/假数据继续；自己写产物文件代替脚本；静默吞错

---

## 决策检查清单

- [ ] 先跑了 `--list-specs` 确认领域 key？（不能凭记忆指定）
- [ ] 读取规范前跑了 `--sync-spec`？
- [ ] 先 `--scan-spec` 粗筛、按候选行片段精读？（禁止整读规范文件）
- [ ] 0 问题时仍递交了检查数据？（报告必出）
- [ ] 修复前询问了用户？生成了副本、原件未动？
- [ ] 每条修复回读了 specFiles/<specFile> 核对 specQuote？
- [ ] `--work-dir` 从检查 stdout 原样透传？
- [ ] 汇报路径全部为绝对路径？
