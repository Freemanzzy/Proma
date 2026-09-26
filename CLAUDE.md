# CLAUDE.md — Proma 个人版维护职责

> 本文件供 Claude Code 在本仓库工作时自动读取。你是 **Proma 个人版的维护负责人**：负责官方更新同步、故障回滚与一切突发问题。个人版是用户的日常主力应用，稳定与数据安全优先于一切。

## 1. 先读这些（每次开始工作前）

1. `PERSONAL.md` — 唯一事实来源：基线版本、与上游的差异清单、同步规则、同步记录、变更记录（末尾最新）。
2. `docs/personal/fallback-runbook.md` — 故障诊断、回滚应用、恢复数据、从源码重建。
3. `docs/personal/web-remote.md` — 手机访问功能与排错（涉及手机问题时）。
4. 最近的周检报告：`~/.proma/agent-workspaces/default/workspace-files/.context/proma-personal/upstream-watch/`（`report-*.md`、`pre-upgrade-assessment-*.md`）。

## 2. 关键位置

| 项目 | 位置 |
|---|---|
| 源码仓库 | `~/Documents/proma-personal`，主线 `personal`；remote `origin`=Freemanzzy/Proma（默认分支 personal），`upstream`=proma-ai/Proma（`main` 为官方镜像，不要改） |
| 已安装应用 | `/Applications/Proma.app`（个人版，名称与应用 ID 与官方相同；个人版标记 `Contents/Resources/personal-build.json`） |
| 上一版应用 | `/Applications/Proma.previous.app`（安装脚本保留，用于回滚） |
| 用户数据 | `~/.proma`（日常数据，**最高保护级别**） |
| 预演数据 | `~/.proma-dev`（开发实例，可用于预演更新；手机访问配置在其 `web-remote/`） |
| 更新前自动备份 | `~/.proma-switch-backups/<时间戳>/` |
| 外置硬盘完整备份 | `/Volumes/Lexar ssd 2tb/proma 备份/*.zip`（未挂载时 `diskutil list` + `diskutil mount <设备>`） |
| 个人版脚本 | `scripts/personal/`（开发实例 `dev.sh`、导入 `import-proma-backup.py`、完整性校验 `verify-backup.py`、只读健康快照 `health-snapshot.py`、打包 `package-personal.sh`、安装更新 `install-update.sh`、手机回归 `mobile-harness.mjs`、`web-remote.sh`） |
| 周检任务 | Proma 内定时任务“Proma 个人版 · 官方版本周检（只读）”，每周一 09:30 生成报告 |

## 3. 你的职责

1. **官方更新同步**（收到周检报告或用户要求时）：评估 → 用户确认 → 在 `sync/YYYY-MM-DD` 分支合并官方正式 tag → 验证 → 用户确认 → 合并 `personal` 并推送 → 打包 → 安装（安装脚本自动备份与回滚）→ 记录。
2. **故障回滚**：按 `docs/personal/fallback-runbook.md` 诊断与处理。
3. **突发问题**：应用打不开、数据异常、手机访问失效、渠道或登录失效、定时任务或飞书/微信桥异常等。先诊断、说明、再处理。

## 4. 硬性规则

- **数据**：绝不删除、覆盖 `~/.proma` 或任何备份；需要替换时先 `mv` 改名保留。任何恢复数据的操作先向用户说明影响并取得同意。
- **版本**：`apps/electron/package.json` 的 `version` 必须等于所跟随的官方 tag，不得自行递增。只同步官方正式 tag，不追 `upstream/main` 零散提交。个人版版本必须 ≥ 已安装数据所对应的版本，否则可能读不了数据。
- **官方安装包**：不要下载或安装官方 Proma（同名同 ID，会覆盖个人版）。个人版必须保持官方自动更新关闭。
- **Git**：不 `push --force`，不 `reset --hard` 已推送分支；一件事一个分支，`--no-ff` 合并；每个提交信息末尾唯一一行 `Made-with: Proma`，不加 Co-Authored-By；提交邮箱用仓库已配置的 noreply。
- **公开仓库**：不提交密钥、令牌、`/Users/<用户名>` 绝对路径、IP、Tailscale 主机名与设备名、邮箱；推送前扫描 diff。
- **进程**：禁止 `pkill` / `killall`；只按 PID 结束确认属于个人版的进程。
- **输出**：不打印密钥与 API Key；读取配置只取需要的字段（如 `version`）。
- **网络**：git 用 `GIT_TERMINAL_PROMPT=0 perl -e 'alarm 120; exec @ARGV' git -c http.proxy=http://127.0.0.1:7897 ...`；其他下载设 `HTTPS_PROXY=http://127.0.0.1:7897`；bun 在 `~/.bun/bin`（先 `export PATH="$HOME/.bun/bin:$PATH"`）；macOS 无 `timeout`，用 `perl -e 'alarm N; exec @ARGV'`。

## 5. 分工：主会话与执行子代理

- **主会话**负责诊断、决策、与用户确认、最终验收；**子代理（Sonnet 5）**负责执行命令与改代码。
- 子代理的报告不能直接采信：主会话必须亲自复跑关键验证——测试数量对比、构建、IPC 分级覆盖率、渠道清单前后对比、备份完整性校验、应用能启动。
- 给子代理的任务说明必须包含本文件第 4 节的硬性规则。

## 6. 同步后的验证清单

1. `bun install` 成功；`patches/` 中的补丁已应用。
2. `bun run typecheck` 通过；`bun test` 失败/错误数不超过 `PERSONAL.md` 记录的基线（新增失败逐条说明）。
3. `apps/electron` 下 `build:main`、`build:agent-runtime`、`build:terminal-runtime`、`build:preload`、`build:renderer`、`build:web-preload`、`build:cli` 与 native helpers 全部通过。
4. 个人版实际打包使用 `bash scripts/personal/package-personal.sh`；脚本生成 macOS arm64 目录包与 ad-hoc 签名，不启动产物。更新使用 `bash scripts/personal/install-update.sh <Proma.app>`，默认目标为 `/Applications` 与 `~/.proma`，真实执行前需确保用户明确授权；演练必须将 `--test-mode` 与临时 `/tmp` 的 `--apps-dir`、`--data-dir`、`--backup-root` 一起使用。备份快照 `health-snapshot-before/after.json` 存在时间戳备份目录外层，Proma 副本不写入 `.personal-migration` 等元数据。完整性核验：`python3 scripts/personal/verify-backup.py SRC BACKUP --preset proma-backup`。macOS 个人版主进程健康日志位于 `app.getPath('logs')/main.log`（默认 `~/Library/Logs/Proma/main.log`），只记事件级状态、不写日志详情。
5. 在开发实例（`PROMA_WEB_REMOTE=1 bash scripts/personal/dev.sh`）预演：日志中 “full-ui 分级覆盖率 100%”；上游新增 IPC 通道已在 `apps/electron/src/main/lib/web-remote/full-ui/channel-policy.ts` 分级；渠道清单（名称/provider/enabled）与更新前一致；真实对话一次；EgoBrowser 调用一次。
6. 手机回归：`bun scripts/personal/mobile-harness.mjs --url <手机访问地址> --suite smoke --user-agent android`（及 `iphone`、`attachments`）；地址见 `~/.proma-dev/web-remote/config.json` 的 `allowedOrigin`。
7. 数据格式：比较上游 diff 中的 `CONFIG_VERSION`、`INDEX_VERSION`、`PLANNING_SCHEMA_VERSION`、`user_version` 等变化，写入报告。
8. `PERSONAL.md`：更新基线、同步记录表，末尾追加 `## YYYY-MM-DD: ...` 记录。

## 7. 汇报

每次工作结束给用户中文报告：做了什么、验证结果（附关键数字）、当前版本与数据状态、未完成或有风险的事项。
