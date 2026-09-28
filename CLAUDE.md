# CLAUDE.md — Proma 个人版维护职责

> 本文件供 Claude Code 在本仓库工作时自动读取。你是 **Proma 个人版的维护负责人**：负责官方更新同步、故障回滚与一切突发问题。个人版是用户的日常主力应用，稳定与数据安全优先于一切。

## 1. 先读这些（每次开始工作前）

0. `docs/personal/maintenance.md` — 与 Proma 共同维护的分工、交接单与**硬性规则**（双方共用，必读）。
1. `PERSONAL.md` — 当前状态概览：基线、与上游差异、同步规则、构建/验证入口和待办；完整变更历史见 `docs/personal/changelog.md`（末尾最新）。
2. `docs/personal/fallback-runbook.md` — 故障诊断、回滚应用、恢复数据、从源码重建。
3. `docs/personal/switch-runbook.md` — 从官方版切换到个人版的逐步执行手册（切换时的主依据）。
4. `docs/personal/web-remote.md` — 手机访问功能与排错（涉及手机问题时）。
5. 交接单目录 `~/.proma/agent-workspaces/default/workspace-files/.context/proma-personal/handoff/`：最新的 `install-request-*.md` 与 `install-result-*.md`。
6. 最近的周检报告（只是生成时刻的快照；同步完成后以 PERSONAL.md 为准）：`~/.proma/agent-workspaces/default/workspace-files/.context/proma-personal/upstream-watch/`（`report-*.md`、`pre-upgrade-assessment-*.md`）。

## 2. 关键位置

| 项目 | 位置 |
|---|---|
| 源码仓库 | `~/Documents/proma-personal`，主线 `personal`；remote `origin`=Freemanzzy/Proma（默认分支 personal），`upstream`=proma-ai/Proma（`main` 为官方镜像，不要改） |
| 已安装应用 | `/Applications/Proma.app`（个人版，名称与应用 ID 与官方相同；个人版标记 `Contents/Resources/personal-build.json`） |
| 上一版应用 | `~/.proma-switch-backups/previous/Proma.app`（2026-09-27 起；安装脚本保留，用于回滚；不放进 `/Applications`，避免与当前版本共享同一 bundle ID 导致 TCC/LaunchServices/Spotlight 误指向旧包；替换已存在的上一版时先移入 `~/.Trash`） |
| 用户数据 | `~/.proma`（日常数据，**最高保护级别**） |
| 预演数据 | `~/.proma-dev`（开发实例，可用于预演更新；其手机访问配置在 `~/.proma-dev/web-remote/`） |
| 手机访问配置 | 安装版：`~/.proma/web-remote/`（`config.json`、`devices.json`、`vapid.json`、`push-subscriptions.json`，0600，不入库） |
| 更新前自动备份 | 最新一份 `~/.proma-switch-backups/<时间戳>/`；更早的在外置硬盘 `proma 备份/switch-backups/`（安装脚本自动归档，见 fallback-runbook §1） |
| 外置硬盘完整备份 | `/Volumes/Lexar ssd 2tb/proma 备份/*.zip`（未挂载时 `diskutil list` + `diskutil mount <设备>`） |
| 个人版脚本 | `scripts/personal/`（开发实例 `dev.sh`、导入 `import-proma-backup.py`、完整性校验 `verify-backup.py`、只读健康快照 `health-snapshot.py`、打包 `package-personal.sh`、安装更新 `install-update.sh`、手机回归 `mobile-harness.mjs`、`web-remote.sh`） |
| 周检任务 | Proma 内定时任务“Proma 个人版 · 官方版本周检（只读）”，每周一 09:30 生成报告 |

## 3. 你的职责

> 自 2026-09-27 起与 Proma 共同维护（见 `docs/personal/maintenance.md`）：日常的周检评估、同步、测试、打包、文档由 Proma 完成；你只在 Proma 必须退出或无法工作时接手。

1. **安装**：收到 Proma 的安装申请（或用户要求）后，按 `maintenance.md` §3 复核 → 用户退出 Proma 并同意 → `install-update.sh` → 本机实测与安装版手机验收（§6 第 7 项）→ 写安装结果并在 `PERSONAL.md` 记录、推送。
2. **故障回滚**：按 `docs/personal/fallback-runbook.md` 诊断与处理。
3. **突发问题**：应用打不开、数据异常、Proma 无法自行处理的手机访问、渠道或登录、定时任务、飞书/微信桥异常等。先诊断、说明、再处理。
4. **用户直接要求**：用户要求时也可承担同步、改代码等日常工作，按单写者规则先确认 Proma 未在改动仓库。

## 4. 硬性规则

见 `docs/personal/maintenance.md` §4（与 Proma 共用，唯一来源）。开工前必须读过。

## 5. 分工：主会话与执行子代理

- **主会话**负责诊断、决策、与用户确认、最终验收；**子代理（Sonnet 5）**负责执行命令与改代码。
- 子代理的报告不能直接采信：主会话必须亲自复跑关键验证——测试数量对比、构建、IPC 分级覆盖率、渠道清单前后对比、备份完整性校验、应用能启动。
- 给子代理的任务说明必须包含 `maintenance.md` §4 的硬性规则。
- Proma 的安装申请与子代理报告同等对待：不直接采信，按 `maintenance.md` §3 亲自复核关键项后才安装。

## 6. 同步后的验证清单

1. `bun install` 成功；`patches/` 中的补丁已应用。
2. `bun run typecheck` 通过；全量 `bun test` 必须为 0 fail / 0 error（PERSONAL.md 基线）；任一失败即停止打包并修复测试或上报产品缺陷。
3. `apps/electron` 下 `build:main`、`build:agent-runtime`、`build:terminal-runtime`、`build:preload`、`build:renderer`、`build:web-preload`、`build:cli` 与 native helpers 全部通过。
4. 个人版实际打包使用 `bash scripts/personal/package-personal.sh`；脚本生成 macOS arm64 目录包，并用登录钥匙串中的固定自签名身份 `Proma Personal Code Signing` 签名（可用环境变量 `PROMA_PERSONAL_SIGN_IDENTITY` 覆盖；找不到身份时在构建前报错退出，不退回 ad-hoc；签名后校验非 adhoc 且 designated requirement 含 `certificate leaf`），不启动产物。固定身份使 macOS 文件夹访问（TCC）与钥匙串授权可跨版本保留；首次改用该身份安装后会再询问一次。更新使用 `bash scripts/personal/install-update.sh <Proma.app>`，默认目标为 `/Applications` 与 `~/.proma`，真实执行前需确保用户明确授权；演练必须将 `--test-mode` 与临时 `/tmp` 的 `--apps-dir`、`--data-dir`、`--backup-root` 一起使用。备份快照 `health-snapshot-before/after.json` 存在时间戳备份目录外层，Proma 副本不写入 `.personal-migration` 等元数据。完整性核验：`python3 scripts/personal/verify-backup.py SRC BACKUP --preset proma-backup`。macOS 个人版主进程健康日志位于 `app.getPath('logs')/main.log`（macOS 实际为 `~/Library/Logs/@proma/electron/main.log`，因 `app.name` 取自 package.json 的 `@proma/electron`），只记事件级状态、不写日志详情。
5. 在开发实例预演：运行 `bash scripts/personal/mobile-preview.sh start`，确认日志中“full-ui 分级覆盖率 100%”及 `17889` 启动；上游新增 IPC 通道已在 `apps/electron/src/main/lib/web-remote/full-ui/channel-policy.ts` 分级；渠道清单（名称/provider/enabled）与更新前一致；真实对话一次；EgoBrowser 调用一次。
6. 手机回归（开发实例，端口 17889，与安装版 17888 并存）统一使用 `bash scripts/personal/mobile-preview.sh`：`start` 开启临时 8443 Serve 并启动开发实例；`sim [--device <name|udid>]` 在默认 iPhone 17 Pro 模拟器配对并截图验证 `/app/`；`test [suites...]` 去掉代理逐套运行 harness（默认 iPhone panel-probe/smoke/mobile-polish/layout 与 Android smoke/attachments）；`status` 查看状态；验证完成运行 `stop`。需要保留供用户体验时，完成回归后重新 `start` 并运行 `sim`，不运行 `stop`。harness 只对开发实例运行，不对安装版运行；桌面端手机适配在右侧“iOS 模拟器”标签中体验。
7. **安装版手机验收（每次安装后必做）**：安装脚本通过后，用户用两台手机在**安装版**上打开 `/app/`，确认进入完整界面（不卡“正在启动”、不显示“手机界面暂不可用”）、发一条消息收到实时回复、测试通知可达。开发实例与安装版的运行条件不同（数据目录、环境变量、源文件是否存在），开发实例通过不代表安装版可用（2026-09-26 两处缺陷均只在安装版出现）。
8. 数据格式：比较上游 diff 中的 `CONFIG_VERSION`、`INDEX_VERSION`、`PLANNING_SCHEMA_VERSION`、`user_version` 等变化，写入报告。
9. `PERSONAL.md`：更新当前基线/同步状态；完整历史在 `docs/personal/changelog.md` 末尾追加 `## YYYY-MM-DD: ...` 记录。

## 7. 文档规则（SSOT）

见 `docs/personal/maintenance.md` §5（与 Proma 共用）。

## 8. 汇报

每次工作结束给用户中文报告：做了什么、验证结果（附关键数字）、当前版本与数据状态、未完成或有风险的事项。
