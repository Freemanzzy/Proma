# Proma 个人版 SSOT

## 当前状态概览

### 基线
- 上游：`proma-ai/Proma`；个人 Fork：`Freemanzzy/Proma`。
- 基线正式 tag：`v0.19.58`（`f20943edd047ecdc929df67de9412d6e58cd4312`）；Electron 版本必须跟随官方 tag，不自行递增。
- 当前主线：`personal`；正式安装版 `76cad12c`（2026-10-01）。已验证未发布的分支见 [`docs/personal/backlog.md`](./docs/personal/backlog.md)。
- 最新已验证基线：2026-10-01 `personal` 全量 `bun test` 676 pass / 0 fail（打包日志）；待合入分支 `fix/mobile-dedupe-20261001` 为 678 pass / 0 fail。

## 与上游的差异

个人版以完整跟随官方正式 tag 为默认（方案 A），保留数据格式兼容和回退开源版能力。主要差异：手机 Web Remote（loopback + Tailscale、IPC deny-by-default）、桌面 iOS 模拟器面板、EgoBrowser 原生工具、协作子 Agent 完成后自动唤醒父会话（可在 `personal-settings.json` 关闭）、个人版数据导入/备份/打包/更新脚本，以及隐藏不使用的桥接、Copilot 新建入口和 Agent Island 初始化；保留旧数据兼容。详细实现和逐次改动见 [`docs/personal/changelog.md`](./docs/personal/changelog.md)，手机访问见 [`docs/personal/web-remote.md`](./docs/personal/web-remote.md)，子任务自动唤醒见 [`docs/personal/delegation-auto-wake.md`](./docs/personal/delegation-auto-wake.md)。

## 同步规则

- `main` 只用于跟随/对照官方；同步只选官方正式 tag。使用 `sync/YYYY-MM-DD` 分支完成合并、冲突处理、验证；功能开发用 `feature/*`。
- 当前采用完整跟随方案 A，同时尽量缩小上游文件改动面。若最新正式 tag 距今 ≥8 周，或冲突试探冲突文件 >30，周检建议切换为独立维护/选择性引入方案 B，由用户决定。
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
