# Proma 个人版 SSOT

## 目的

本仓库是 Proma 的个人测试版，用于在不影响官方 Proma 的前提下验证构建、升级和功能变化。个人版与官方版长期并存：官方版继续承担日常工作与生产自动化，个人版只用于个人测试和完善。

## 基线

- 上游仓库：`proma-ai/Proma`
- 个人 Fork：`Freemanzzy/Proma`
- 基线版本：`v0.19.57`
- 基线 commit：`4e96c5e859302c4a34618d45db352b29a7ebeb28`
- 当前个人主线：`personal`
- Electron 版本：`0.19.57`

## 分支策略

- `main`：跟随上游，仅用于同步与对照。
- `personal`：个人版主线，基于稳定基线维护。
- `sync/YYYY-MM-DD`：按日期创建的上游同步分支，用于合并、解决冲突和验证。
- `feature/*`：独立功能或修复分支，完成验证后再合入 `personal`。

## 数据与隐私规则

- 仓库只放源码、构建配置和本 SSOT，不放个人运行数据。
- 个人数据只存在于 `~/.proma` 或 `~/.proma-dev`，永不提交到公开仓库。
- 不提交环境变量、密钥、令牌、用户会话、Automation 数据或备份包。
- 每次推送前必须检查差异范围，并扫描密钥模式和正式 Proma 数据路径。
- 阶段二只做空数据启动与日志/进程验证，不导入用户数据、不录入任何渠道凭据、不改 Automation。

## 路径策略

并存期间，项目文件保持原地不动；开发版使用独立的 `~/.proma-dev`，官方版继续使用 `~/.proma`。正式切换前不接管官方数据目录；切换时再按经确认的迁移方案由个人版接管 `~/.proma`。

## 与上游的差异清单

个人版不改动上游运行逻辑；新增以下本地维护脚本：

- `scripts/personal/import-proma-backup.py`：从备份 zip 导入到隔离目录，改写 Proma 自身索引路径，停用 Automation/桥接并提供核验。
- `scripts/personal/dev.sh`：检查官方版与个人开发版进程隔离后，以 `~/.proma-dev` 启动开发版。

## 数据导入

导入只接受备份 zip，不读取或修改官方 `~/.proma`。典型用法：

```bash
python3 scripts/personal/import-proma-backup.py \\
  --zip "/path/to/proma-backup.zip" \\
  --target ~/.proma-dev --replace
python3 scripts/personal/import-proma-backup.py \\
  --zip "/path/to/proma-backup.zip" \\
  --target ~/.proma-dev --verify-only
```

导入过程先在 target 同级临时目录完成，再原子改名；已有非空 target 会整体改名为带时间戳的 `.bak-*`，不删除。排除项及原因：`cloud-auth.json`、`sync-state.json`（避免个人版复用官方云登录刷新令牌或触发同步）、`logs/`、`fc-bridge/`、`fc-bridge-group/`（由官方版外部进程使用），以及文件名含 `.bak` 的备份文件。UTF-8 文本中的正式 `~/.proma` 路径会改写为 target；`agent-workspaces/*/workspace-files/` 保持原样。超过 50 MB 或非 UTF-8 文件不改写，并记录在 manifest 中；SQLite 的 `planning.db` 通过标准库 sqlite3 只改写导入副本中的文本字段。

为避免重复执行，导入会把全部 Automation 设为 `active=false`，把 `feishu.json` 的 `bots[].enabled` 和 `wechat.json` 的 `enabled` 设为 false，并按源码合法值将 `settings.json` 的 `feishuSessionMirror.mode` 设为 `off`。源码依据：`apps/electron/src/main/lib/settings-service.ts` 默认/回退值为 `{ mode: 'off' }`，`apps/electron/src/main/index.ts` 仅在桥接配置 enabled 且凭据存在时自动启动飞书、钉钉、Slack、微信 Bridge；导入备份未发现独立的钉钉或 Slack 配置文件。导入前 active Automation 的 id/name 会保存到 `<target>/.personal-migration/automations-active-before.json`，完整统计与源 zip SHA-256 在 `manifest.json`。

恢复某个 Automation 前，先确认官方版仍停用或个人版是唯一运行实例，再在个人版 GUI 的 Automation 设置中启用；也可以仅对隔离目录执行一次受控 JSON 修改，然后重新运行 `--verify-only`（核验会因 active 任务而失败，这是预期的安全提醒）。不要把个人版导入目录或 manifest 提交到公开仓库。

## 同步记录

| 日期 | 分支 | 上游基线 | 结果 | 备注 |
|---|---|---|---|---|
|  |  |  |  |  |

## 已知问题

- Git 首次 `git push` 触发 macOS `credential-osxkeychain` GUI 授权弹窗，在无人值守环境会阻塞；已改为仅本仓库配置 `!gh auth git-credential`，并用 `GIT_TERMINAL_PROMPT=0` 与 120 秒超时推送。
- `brew install oven-sh/bun/bun` 因本机 Xcode/Command Line Tools 版本过旧而失败；按计划改用 Bun 官方安装脚本，安装 `bun 1.4.2` 成功。未执行需要 sudo 的系统升级。
- Electron 43.2.0 的 Node 下载流程受当前代理环境影响，`node node_modules/electron/install.js` 报 `TypeError: fetch failed`；已用官方 GitHub Release URL 通过 `curl` 下载并解压到本地 `node_modules/electron/dist`，随后开发版成功启动。后续如重新安装依赖，需确认 Electron 二进制是否完整。
- 构建阶段的 `node-pty`、macOS agent-island helper、EventKit native helper 和 officecli 均构建/校验成功。

## 变更记录

## 2026-09-24: 阶段一建立个人版仓库

- 从上游 `v0.19.57` 建立 `personal` 分支。
- 配置仓库级 Git 身份，不修改全局 Git 配置。
- 关闭 Fork 的 GitHub Actions，避免个人公开 Fork 误触发发布流程。
- 在 `.gitignore` 中追加个人运行目录、环境变量、备份包等隐私防护规则。

## 2026-09-24: 阶段一二 建仓与构建冒烟

- 阶段一：Fork `Freemanzzy/Proma`，建立 `personal` 分支并推送；Fork Actions 已禁用。
- 阶段二：`bun install` 安装 1283 个依赖；开发模式使用独立 `~/.proma-dev`，未导入用户数据、未录入凭据、未改 Automation。
- 冒烟结果：Vite 在 `127.0.0.1:5173` 就绪；Electron 主进程从本仓库路径启动；日志确认配置目录为 `~/.proma-dev`，并完成 IPC、工作区监听和 Chat 工具监听初始化。
- 隔离结果：开发版 Electron 的 `lsof` 未命中 `~/.proma/` 路径；官方 Proma 主进程 PID `50828` 启动前后保持不变；停止开发版后 5173 端口已释放；保留 `~/.proma-dev`。
- 处理问题：首次 push 被 macOS 钥匙串 GUI 弹窗阻塞，改用仓库级 gh 凭据助手；首次开发启动因 Node fetch 代理导致 Electron 二进制下载失败，改用官方 Release zip 的 curl 下载后重试成功。

## 2026-09-24: 阶段三 数据导入与隔离核验

- 新增 `scripts/personal/import-proma-backup.py` 与 `scripts/personal/dev.sh`；脚本使用 `Path.home()`，不硬编码主机路径。
- 从备份 zip 导入到 `~/.proma-dev`：共 19,967 个文件条目，复制 13,178 个，排除 6,789 个；路径改写 2,991 个文件、223,670 处。分区统计与跳过文件详见 `.personal-migration/manifest.json`。
- 迁移前有 19 个 active Automation，已全部停用；飞书 2 个 Bot、微信 Bridge、飞书 Session Mirror 均已关闭。导入后的 Automation 共 22 个，inactive=22。
- `--verify-only` 全部 PASS：正式 `~/.proma` 残留检查（排除 workspace-files 与按规则跳过文件）、Automation、飞书、微信、排除项、Session Mirror。
- 导入目录统计：`du -sh` 为 3.2G；`agent-sessions.json` 条目 820，`agent-sessions/*.jsonl` 811 个；工作区 5 个。
- 源码依据：`settings-service.ts` 的合法关闭值为 `feishuSessionMirror.mode='off'`；`index.ts` 的 Bridge 自动启动要求对应 enabled 配置与凭据。备份中未发现独立钉钉或 Slack 配置文件。
- 开发版启动与观察：日志确认配置目录为 `~/.proma-dev`，Vite 在 `127.0.0.1:5173` 就绪；观察至少 300 秒。开发版树内逐个 `lsof -p` 检查均无 `/.proma/` 路径，5173 停止后释放。
- 隔离结果：观察前后官方 Proma PID 均为 `50828`；官方 `channels.json` mtime `2026-09-24 05:00:02 +0800`、`automations.json` mtime `2026-09-24 13:13:36 +0800` 未变。个人版日志没有 Automation 执行记录，`runCount`/`lastRunAt` 均未变化；启动器仅做了 Automation 索引迁移，清理 6 个不可恢复的 `lastSessionId` 字段，因此个人版 `automations.json` SHA-256 从导入基线 `955c82f2…` 变为观察后 `51f47239…`，不是任务运行。
- 桥接日志仅出现“微信 Bridge 已恢复 1 个聊天绑定”，未出现飞书/微信连接或启动成功；由于 `wechat.json.enabled=false`，这是绑定数据恢复而非桥接连接。日志唯一明确错误是 Electron macOS trust store 的 `Error parsing certificate / Failed parsing extensions`，未阻止启动；另有 EventKit 权限为 `not-determined`，未影响启动。
- 过程问题：首次 `dev.sh` 启动因 Bash `set -u` 与中文全角标点紧邻变量名导致退出，已改用 `${...}` 并通过 `bash -n` 后重启验证；未触及官方进程。应用启动时在隔离目录生成了 `automations.json.bak` 与 `agent-sessions.json.bak` 迁移备份，停止开发版后仅删除这两个 target 内的临时备份以恢复排除项不变式；无官方目录删除操作。按记录 PID 停止开发版后无残留，官方 PID 保持 `50828`。
- 已知迁移限制：6 个超过 50 MB 的 UTF-8 会话文件和 1 个非 UTF-8 文件按要求跳过路径改写；不会影响 verify-only，因为它们被 manifest 明确记录并在核验中单独排除。个人版尚未录入 cliproxyapi 或其他渠道密钥，需在 GUI 设置中重新录入；不得把旧加密凭据当作可用。

## 2026-09-24: 精简测试数据与共享项目文件

- 测试阶段不需要完整数据：`~/.proma-dev` 由完整导入（3.2G）精简为约 60M，只保留设置、渠道列表、Skills、MCP、Automation（全部停用）、Todo/日程数据库和工作区设置；去掉历史会话、对话、附件、旧运行时记录。完整数据可随时用 `scripts/personal/import-proma-backup.py --replace` 从备份重新导入。
- 问题：导入会把 Automation 提示词中的路径改写到 `~/.proma-dev`，而精简后各工作区 `workspace-files` 为空，导致「首尔 VPS 数据库备份」找不到脚本。
- 处理：按并存期路径策略，把 `~/.proma-dev/agent-workspaces/<工作区>/workspace-files` 改为指向 `~/.proma/agent-workspaces/<工作区>/workspace-files` 的符号链接。两个版本共用同一份项目文件；Automation 仍只在官方版启用，避免重复执行。
- 影响：个人版中的 Agent 会读写真实项目文件；程序自身状态（会话、设置、密钥）仍在 `~/.proma-dev`。
- 待办：导入脚本增加精简导入与链接项目文件的选项，使上述步骤可重复执行。

## 2026-09-24: 移除内置浏览器（方案 A）

- 从 `pi-builtin-tools.ts`、`agent-orchestrator.ts`、`agent-prompt-builder.ts` 移除 Browser* 工具注册、权限分支、浏览器上下文和系统提示词；历史工具名在 `tool-utils.ts` 的图标/中文名称映射保留。
- 主进程不再初始化 `browserController`，IPC 不再注册浏览器处理器；preload 仅保留未实现的类型声明以便保留的浏览器源码文件通过类型检查，运行时不向 renderer 暴露浏览器 API。
- 渲染层移除浏览器面板、标签、按钮和状态订阅；Agent 回复 HTTP(S) 链接改为系统默认浏览器；`file-browser/` 与 `DiffTabContent` 未改动。
- 保留 `src/main/lib/browser-*.ts`、`components/browser/`、`atoms/browser-atoms.ts`、`packages/shared/src/types/browser.ts` 源码文件但不再由应用入口 import；删除默认 `in-app-browser` Skill，并移除其余默认 Skill 对该 Skill 的引导。
- 验证结果：`bun run typecheck` 通过；测试与四项 Electron 构建、产物扫描、开发版运行检查在本分支提交前执行。已知限制：保留源码文件仍由 TypeScript 项目纳入类型检查，因此 preload 保留仅类型兼容声明。
