# Proma 个人版 · 双方共同维护约定

> 适用于两位维护者：**Proma**（个人版应用内的 Agent，日常维护）与 **Claude Code**（外部维护者，只在 Proma 需要退出或无法工作时接手）。本文件是双方共用的规则来源；`CLAUDE.md` 与 Proma 的工作说明都引用本文件，不各自复制。
> 事实记录仍以 `PERSONAL.md` 为准，操作步骤以 `docs/personal/*-runbook.md` 为准。

## 1. 分工

| 环节 | Proma | Claude Code |
|---|---|---|
| 周检（每周一 09:30，定时任务“Proma 个人版 · 官方版本周检（只读）”） | ✅ | — |
| 评估周检、在 `sync/YYYY-MM-DD` 合并官方正式 tag、测试、构建 | ✅ | — |
| 开发实例验证（桌面对话、EgoBrowser、手机回归 17889 + 临时 8443 转发，见 `CLAUDE.md` §6） | ✅ | — |
| 打包 `bash scripts/personal/package-personal.sh` | ✅ | — |
| 小功能、文档、`PERSONAL.md` 记录、推送 | ✅ | — |
| 写安装申请（§3） | ✅ | — |
| 安装 `install-update.sh`、安装后本机实测与安装版手机验收、写安装结果 | — | ✅ |
| 应用打不开、白屏、数据异常、回滚与恢复（`fallback-runbook.md`） | — | ✅ |

原则：Proma 不能替换正在运行的自己，也无法在自身故障时自救；这两类由 Claude Code 负责，其余由 Proma 负责。

## 2. 单写者规则

- 同一时间只有一方修改仓库。Proma 写出安装申请后即停止改动仓库，直到读到对应的安装结果。
- Claude Code 只在自己的 `install/*`、`recover/*` 或 `docs/*` 分支上写，`--no-ff` 合并进 `personal` 后推送。
- 紧急例外：Proma 无法启动时，Claude Code 直接接手，无需安装申请；恢复后在安装结果中说明。
- 每次开工先 `git fetch` 并确认 `personal` 与 `origin/personal` 一致、工作区干净；不一致先停下报告用户。

## 3. 交接单

目录：`~/.proma/agent-workspaces/default/workspace-files/.context/proma-personal/handoff/`（本机，不入库；用户已同意双方在此目录读写交接单）。

**安装申请** `install-request-YYYY-MM-DD[-N].md`（Proma 写）：

```markdown
# 安装申请 YYYY-MM-DD
- 安装包：apps/electron/out/mac-arm64/Proma.app
- personal-build.json：version=…，commit=…（应等于 personal HEAD）
- personal HEAD / 是否已推送：…
- 改动摘要：…
- 改动类型：应用代码 是/否；数据格式变化 是/否（CONFIG_VERSION 等）；运行时依赖变化 是/否
- 打包日志：/tmp/…log；测试 pass/fail/error：…（基线见 PERSONAL.md）
- 开发实例验证结果：桌面…；手机回归（android/iphone/attachments）…
- 安装后需重点验证：…（如新增路由、IPC 通道、图标、定时任务）
- 已知风险与回滚要点：…
```

**安装结果** `install-result-YYYY-MM-DD[-N].md`（Claude Code 写）：结论（成功/回滚/未执行）、复核项结果、安装脚本退出码、快照对比、安装版手机验收结果、遗留事项；同时在 `docs/personal/changelog.md` 末尾追加记录并推送。

Claude Code 接手安装时只做必要复核：包内 marker commit 等于 `personal` HEAD 且已推送；`codesign --verify --deep --strict` 通过，且签名身份为本机固定证书 `Proma Personal Code Signing`（`codesign -dv` 显示 `Authority=Proma Personal Code Signing`，`codesign -d -r-` 的 designated requirement 含 `certificate leaf`；不得为 adhoc）；包内无 `app-update.yml`；打包日志测试数不超过基线；申请中列出的“需重点验证”项在包内可见（如 asar 内代码、`Contents/Resources` 文件）。任一不符则不安装，写安装结果说明原因。

## 4. 硬性规则（双方共用）

- **数据**：绝不删除、覆盖 `~/.proma` 或任何备份；需要替换时先 `mv` 改名保留。任何恢复数据、写入 `~/.proma`（交接单目录除外）的操作先向用户说明影响并取得同意。
  - 唯一例外（用户 2026-09-27 同意）：`install-update.sh` 在安装成功后，可将本机较早的更新前备份（`~/.proma-switch-backups/20*`，保留最新 `--keep-local` 份）用 `ditto` 转存到外置硬盘 `proma 备份/switch-backups/`，经 `verify-backup.py --preset proma-backup` 逐文件校验通过后删除本机副本；未挂载、目标已存在、复制或校验失败时一律保留本机副本。其他任何删除备份的操作仍须用户逐次同意。
- **版本**：`apps/electron/package.json` 的 `version` 必须等于所跟随的官方 tag，不得自行递增。只同步官方正式 tag，不追 `upstream/main` 零散提交。
- **官方安装包**：不要下载或安装官方 Proma（同名同 ID，会覆盖个人版）。个人版必须保持官方自动更新关闭。
- **同 bundle ID 的旧副本**：任何位置（外置硬盘、备份目录）存放的旧 Proma `.app`（官方版或旧个人版）一律改名为 `.app.disabled` 或只保留 zip；`/Applications/Proma.app` 与 `~/.proma-switch-backups/previous/Proma.app` 之外不留可被 LaunchServices 登记的 `.app` 目录。原因：同一 `com.proma.app` 登记多个不同签名副本时，macOS TCC 解析到不同副本并反复改写授权记录，导致“想访问文稿文件夹”反复弹窗（2026-09-27 实测）。
- **Git**：不 `push --force`，不 `reset --hard` 已推送分支；一件事一个分支，`--no-ff` 合并；每个提交信息末尾唯一一行 `Made-with: Proma`，不加 Co-Authored-By；提交邮箱用仓库已配置的 noreply。
- **公开仓库**：不提交密钥、令牌、`/Users/<用户名>` 绝对路径、IP、Tailscale 主机名与设备名、邮箱；推送前扫描 diff。
- **进程**：禁止 `pkill` / `killall`；只按 PID 结束进程，且先征得用户同意。
- **输出**：不打印密钥与 API Key；读取配置只取需要的字段。
- **安装与重启**：安装、替换应用、退出 Proma 只由 Claude Code 在用户在场并同意时执行；Proma 不得运行 `install-update.sh`。
- **网络**：git 用 `GIT_TERMINAL_PROMPT=0 perl -e 'alarm 120; exec @ARGV' git -c http.proxy=http://127.0.0.1:7897 ...`；其他下载设 `HTTPS_PROXY=http://127.0.0.1:7897`；bun 在 `~/.bun/bin`（先 `export PATH="$HOME/.bun/bin:$PATH"`）；macOS 无 `timeout`，用 `perl -e 'alarm N; exec @ARGV'`。

## 4.1 同步策略（用户 2026-09-28 决定）

- 目前继续完整跟随官方正式 tag（方案 A），同时尽量减少对上游文件的改动面。
- 触发条件（周检“同步策略”小节自动报告）：最新正式 tag 距今 ≥ 8 周，或冲突试探冲突文件 > 30。任一触发即建议切换为“独立维护、只挑选性引入上游改动”（方案 B），由用户决定。
- 无论 A/B，`~/.proma` 数据格式保持与开源上游兼容，保留回退官方开源版的可能；不考虑迁往商业版。

## 5. 文档规则（SSOT）

- 每类事实只有一个权威位置：当前基线、与上游差异、同步规则 → `PERSONAL.md`；完整变更历史 → `docs/personal/changelog.md`；共同维护规则 → 本文件；Claude Code 的职责细节 → `CLAUDE.md`；操作步骤 → `docs/personal/*-runbook.md`；手机访问 → `docs/personal/web-remote.md`。其他文档引用，不复制。
- 变更记录只追加（`## YYYY-MM-DD: ...`），不改写历史；旧记录有误用新记录更正并写明更正了什么。
- 改动影响权威内容时，同一提交内同步更新对应文档，并在 `docs/personal/changelog.md` 追加记录，写明改了哪些文档。
- 验证、审查、故障处理结果直接写入变更记录，无需询问：方法、实测证据、通过项、缺陷项、待办。
- 手机端界面适配的桌面体验通过右侧工作区“iOS 模拟器”标签完成；手机 web-remote 不可见该入口，相关 simulator IPC 必须在分级表中标记 denied。
- 周检报告、日志、对话、交接单都是快照；与 SSOT 冲突时以 SSOT 为准，并修正过时的一方。
