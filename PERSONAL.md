# Proma 个人版 SSOT

## 当前状态概览

### 基线
- 上游：`proma-ai/Proma`；个人 Fork：`Freemanzzy/Proma`。
- 基线正式 tag：`v0.19.58`（`f20943edd047ecdc929df67de9412d6e58cd4312`）；应用 version 始终等于所跟随的官方 tag。Electron 原则上跟随官方 tag，**例外（用户 2026-11-14 决定）**：官方大概率不再更新，个人版可在**当前 Electron 大版本内**自行升级补丁版以获得 Chromium/V8/Node 安全修复（当前 `43.8.10`，官方 v0.19.58 为 `43.2.0`）；跨大版本升级须单独立项、经用户批准。周检 Automation（`07439dfd`）第 10 步监测补丁版与内置 Node。
- 当前主线：`personal`；正式安装版 `76cad12c`（2026-10-01）。已验证未发布的分支见 [`docs/personal/backlog.md`](./docs/personal/backlog.md)。
- 最新已验证基线：2026-10-01 `personal` 全量 `bun test` 676 pass / 0 fail（打包日志）；待合入分支 `fix/mobile-dedupe-20261001` 为 678 pass / 0 fail。

## 与上游的差异

- 桌面输入框会话用量指示器。
- Skill 全局统一：`~/.proma/shared-skills/` 与 `shared-skills-inactive/` 同时存在时，所有工作区共用这两个目录（路径重定向，新建工作区不再复制模板）。逻辑在 `personal-shared-skills.ts`；涉及上游文件（均为 1–3 行级接入）：`apps/electron/src/main/lib/config-paths.ts`（两个 Skill 路径函数）、`agent-workspace-manager.ts`（`copyDefaultSkills` 早返回）、`workspace-watcher.ts`（启停共享目录监听）、`agent-prompt-builder.ts`（系统提示词 Skills 路径）、`packages/shared/src/utils/skill-usage.ts` 与 `renderer/components/agent/tool-phrase.ts`（识别 `shared-skills/<slug>/SKILL.md`）、`apps/electron/src/main/ipc.ts`（旧预览路径识别；另含 `file:resolve-path` 目录直接返回 null）。

个人版以完整跟随官方正式 tag 为默认（方案 A），保留数据格式兼容和回退开源版能力。主要差异：手机 Web Remote（loopback + Tailscale、IPC deny-by-default；代码高亮改用不依赖 WebAssembly 的引擎，CSP 不放宽）、桌面 iOS 模拟器面板、EgoBrowser 原生工具、协作子 Agent 完成后自动唤醒父会话（可在 `personal-settings.json` 关闭）、个人版数据导入/备份/打包/更新脚本、GPT-6.1 Sol Codex 模型支持、Agent 图片上下文预算（Read 缩图、请求前旧图移出）与请求级诊断日志，以及隐藏不使用的桥接、Copilot 新建入口和 Agent Island 初始化；保留旧数据兼容。详细实现和逐次改动见 [`docs/personal/changelog.md`](./docs/personal/changelog.md)，手机访问见 [`docs/personal/web-remote.md`](./docs/personal/web-remote.md)，子任务自动唤醒见 [`docs/personal/delegation-auto-wake.md`](./docs/personal/delegation-auto-wake.md)。

## 本分支实验（尚未合入）

- **Goal Memory M0：已回退、数据已删除、开发搁置（截至 2026-11-08）**。M0 曾于 2026-11-05 合入并随 `ea92ba72`/`4fefcd5f`/`b1f26910` 安装；真实会话中提示缓存命中率由约 98.8% 降到约 15%（动态恢复包插在缓存边界之前），用户决定回退并暂停 Goal 模式开发。回退版 `3a2da9d6` 于 2026-11-08 安装：相关代码（含 `/命令` 粘贴例外、`/goal` 气泡显示）恢复到 `1c373673`，与上游的差异不再包含 Goal 相关触点，缓存命中率恢复。2026-11-08 按用户要求删除 `~/.proma/goal-memory/` 与 6 个 goal 分支（本机与外置硬盘的更新前备份中的副本按 maintenance §4 保留）。历史设计与验证记录保留在 [`goal-memory.md`](./docs/personal/goal-memory.md)。
- MCP 工具 schema 兼容化（2026-11-05）：MCP 工具 `inputSchema` 顶层的 `oneOf`/`anyOf`/`allOf` 从发给模型的 schema 中移出并写入工具描述（Anthropic 拒绝此类 schema，会使整次请求 400），`required` 形状的约束在执行前由本地补回校验。逻辑在 `personal-mcp-schema.ts`；上游接入 `apps/electron/src/main/lib/adapters/pi-mcp-tools.ts`（schema 转换、描述追加、执行前校验，约 7 行）。
- 安装脚本启动环境（2026-11-08）：`scripts/personal/install-update.sh` 经新文件 `scripts/personal/launch-env.sh` 启动应用，清除调用者 shell 的 `PROMA_*` 变量、只沿用 launchd 的值，启动后 `ps eww` 自检。只涉及个人版脚本，不改应用代码。

## 同步规则

- `main` 只用于跟随/对照官方；同步只选官方正式 tag。使用 `sync/YYYY-MM-DD` 分支完成合并、冲突处理、验证；功能开发用 `feature/*`。
- 当前采用完整跟随方案 A，同时尽量缩小上游文件改动面。同步官方新 tag 时，若官方 Electron 低于个人版当前版本，保留个人版版本（见“基线”中的例外）；若官方升了大版本，按跨大版本升级单独评估。若最新正式 tag 距今 ≥8 周，或冲突试探冲突文件 >30，周检建议切换为独立维护/选择性引入方案 B，由用户决定。
- 数据格式保持上游兼容；不迁移到商业版。变更记录只追加到 `docs/personal/changelog.md`，标题 `## YYYY-MM-DD: ...`；修订事实不得重写历史，追加更正记录。
- 共同维护分工、数据安全和安装权限以 [`docs/personal/maintenance.md`](./docs/personal/maintenance.md) 为准；操作步骤以 runbook 为准。每次同步按 `CLAUDE.md` §6 验证。

## 构建、安装与验证入口

- 安装依赖：`bun install`；类型检查：`bun run typecheck`；全量测试：`bun test`（必须 0 fail / 0 error）。
- 构建：在 `apps/electron` 执行 `bun run build:main`、`build:agent-runtime`、`build:terminal-runtime`、`build:preload`、`build:renderer`、`build:web-preload`、`build:cli` 和 native helpers；个人版打包入口 `bash scripts/personal/package-personal.sh`。
- 开发实例：`bash scripts/personal/mobile-preview.sh start`；模拟器预览：`sim`；手机回归：`test`；状态查看：`status`。安装包安装由 Claude Code 按 maintenance 交接流程执行，Proma 不运行 `install-update.sh`。
- 详细步骤和安全限制分别见 `CLAUDE.md` §6、`docs/personal/maintenance.md` 与相关 runbook。

## 已知问题与待办

- Renderer 首屏主 bundle 约 5.74 MB（Brotli 约 1.74 MB）；因未证明安全切分能减少首屏 ≥30%，暂不改构建配置，分析见 Web Remote 文档。
- `serve-sim@0.1.47` 已改为 apps/electron 精确运行时依赖，内置路径使用 Electron 自带 Node，npx 保留为包缺失时回退；待后续正式打包复核 ASAR 签名与安装版行为。
- 手机适配新增的 `data-web-remote-*` 稳定性标记当前保留；替换前需证明替代定位唯一且全套 iPhone/Android harness 通过。
- 待合入分支、后续待办、真实负载测试触发条件与 dev 数据约定的唯一清单：[`docs/personal/backlog.md`](./docs/personal/backlog.md)；逐次安装与验证结果见 changelog 末尾。

## 变更历史

完整历史（原文迁入）：[`docs/personal/changelog.md`](./docs/personal/changelog.md)。
