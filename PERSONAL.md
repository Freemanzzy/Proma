# Proma 个人版 SSOT

## 当前状态概览

### 基线
- 上游：`proma-ai/Proma`；个人 Fork：`Freemanzzy/Proma`。
- 基线正式 tag：`v0.19.58`（`f20943edd047ecdc929df67de9412d6e58cd4312`）；Electron 版本必须跟随官方 tag，不自行递增。
- 当前主线：`personal`；正式安装版 `76cad12c`（2026-10-01）。已验证未发布的分支见 [`docs/personal/backlog.md`](./docs/personal/backlog.md)。
- 最新已验证基线：2026-10-01 `personal` 全量 `bun test` 676 pass / 0 fail（打包日志）；待合入分支 `fix/mobile-dedupe-20261001` 为 678 pass / 0 fail。

## 与上游的差异

- 桌面输入框会话用量指示器。
- Skill 全局统一：`~/.proma/shared-skills/` 与 `shared-skills-inactive/` 同时存在时，所有工作区共用这两个目录（路径重定向，新建工作区不再复制模板）。逻辑在 `personal-shared-skills.ts`；涉及上游文件（均为 1–3 行级接入）：`apps/electron/src/main/lib/config-paths.ts`（两个 Skill 路径函数）、`agent-workspace-manager.ts`（`copyDefaultSkills` 早返回）、`workspace-watcher.ts`（启停共享目录监听）、`agent-prompt-builder.ts`（系统提示词 Skills 路径）、`packages/shared/src/utils/skill-usage.ts` 与 `renderer/components/agent/tool-phrase.ts`（识别 `shared-skills/<slug>/SKILL.md`）、`apps/electron/src/main/ipc.ts`（旧预览路径识别；另含 `file:resolve-path` 目录直接返回 null）。

个人版以完整跟随官方正式 tag 为默认（方案 A），保留数据格式兼容和回退开源版能力。主要差异：手机 Web Remote（loopback + Tailscale、IPC deny-by-default；代码高亮改用不依赖 WebAssembly 的引擎，CSP 不放宽）、桌面 iOS 模拟器面板、EgoBrowser 原生工具、协作子 Agent 完成后自动唤醒父会话（可在 `personal-settings.json` 关闭）、个人版数据导入/备份/打包/更新脚本、GPT-6.1 Sol Codex 模型支持、Agent 图片上下文预算（Read 缩图、请求前旧图移出）与请求级诊断日志，以及隐藏不使用的桥接、Copilot 新建入口和 Agent Island 初始化；保留旧数据兼容。详细实现和逐次改动见 [`docs/personal/changelog.md`](./docs/personal/changelog.md)，手机访问见 [`docs/personal/web-remote.md`](./docs/personal/web-remote.md)，子任务自动唤醒见 [`docs/personal/delegation-auto-wake.md`](./docs/personal/delegation-auto-wake.md)。

## 本分支实验（尚未合入）

- **Goal Memory M0**（截至2026-11-04 22:19 GMT+8）：**产品df8ae0fd通过当前M0实验计划验收，默认关闭、未合入/发布。** SSOT见 [`goal-memory.md`](./docs/personal/goal-memory.md)，分支及保留限制见 [`backlog.md`](./docs/personal/backlog.md)。首次绑定private owner提交屏障已最小修复，父双Worker CP0负向转正，9末端/16线程及完整矩阵、876测试/typecheck/scripts/五构建、17源一致通过。唯一定向复审6（CLI0.165.0/base personal，93秒）未发现可操作缺陷；Astra最终验收因额度仅返部分进展，不计结论，之后全新独立Sol role review实际核对源码/日志/hash，A/B/C/D/E和三个补充全部通过，父逐条采纳。独立审查/验收仅读代码和日志，不冒充重跑测试。未合并/推送/启用/升版/打包/安装，无M1/第七轮或新dev/provider/长压缩，旧真实实测分版本，未测GUI/实际watch/包和长期语义等限制保留。
  - 上游触点：原六处orchestrator、Pi/utility adapters、utility runtime/timeout及shared runtime类型接线不扩展新行为；本次另改Electron `package.json` 的worker build/watch scripts、`scripts/dev-bundle-readiness.ts`及`electron-builder.yml`精确worker解包项。策略/SQLite仍在`personal-goal-memory.ts`，新增个人artifact scan/protocol/worker/client模块；worker无数据库/SDK/Electron依赖。
  - 兼容与回退：不修改 Pi transcript、会话索引或 planning schema，不新增依赖；取消 `PROMA_PERSONAL_GOAL_MEMORY=1` 即关闭新路径，独立 sidecar 保留。未获合并、推送、打包或安装授权。
  - **追加核实（2026-11-05）**：按当日02:13 GMT+8新增授权，用同一全新隔离数据完成M0→当前安装源码1286ff19→M0的真实dev往返。普通/Goal工具历史可读且可续聊，旧版sidecar字节不变，回M0合同不变、Goal读取和checkpoint推进成功；43项材料断言通过。实际运行原watch组合及小样本GUI，更新此前未测这两项的证据边界；provider为本机确定性stub，不是真实模型、完整GUI性能或安装版降级。结果及限制唯一正文见Goal SSOT和changelog 2026-11-05；产品源码未变，未发布安装。

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
