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

个人版保留上游功能源码与旧数据兼容路径；用户选择保留 Chat 模式；仅对下列入口、初始化和打包项做精简，并维护本地脚本和文档区块：

- `scripts/personal/import-proma-backup.py`：从备份 zip 导入到隔离目录，改写 Proma 自身索引路径，停用 Automation/桥接并提供核验。
- `scripts/personal/dev.sh`：检查官方版与个人开发版进程隔离后，以 `~/.proma-dev` 启动开发版。
- `README.md` 与 `README.en.md` 顶部的 `<!-- personal-fork:start -->` / `<!-- personal-fork:end -->` 独立区块：标明个人 Fork、基线和主要改动，便于读者识别且便于后续同步。
- 钉钉、Slack 桥接：设置入口隐藏；桥接源码与 IPC 保留以兼容旧数据，但启动注册明确禁止自动连接。
- GitHub Copilot 订阅渠道：从新增渠道类型列表隐藏；编辑已有 Copilot 渠道时仍保留选项，不影响旧数据使用。
- Agent Island：设置入口隐藏；启动时不初始化状态机或 macOS helper；electron-builder 不再打包 helper，相关源码和开发构建脚本保留。
- 远程网页（实验）：仅在开发实例设置 `PROMA_WEB_REMOTE=1` 且 `~/.proma-dev/web-remote/config.json` 明确启用时启动；主进程只监听回环地址，配对、设备撤销和 Tailscale Serve 建议命令由 `scripts/personal/web-remote.sh` 管理；不打包进安装版。

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

合并上游时若 README 冲突，保留 `personal-fork` 区块，其余内容采用上游版本。

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

## 2026-09-24: 外观简化为浅色/深色/跟随系统

- `AppearanceSettings.tsx` 与欢迎空状态移除特殊风格选择、预览和相关状态引用；设置界面仅展示浅色、深色、跟随系统三项。
- 在 `types/settings.ts` 增加纯函数迁移逻辑：`special` 或任意非 `default` 风格读取为 `system/default`；主进程 settings-service、renderer theme atom、localStorage 缓存和主题初始化均使用该逻辑，避免首帧回到特殊风格。
- `ThemeMode`、`THEME_STYLES` 与 `globals.css` 风格样式保留以兼容旧数据和降低上游同步冲突；写入路径只保存三种模式与 `default` 风格。删除 7 张主题预览图及其 import。
- 新增主题迁移与三项模式列表单元测试。验证结果：typecheck 通过；bun test 为 464 pass / 5 fail / 1 error，较基线 461 pass / 5 fail / 1 error 未增加失败，新增测试通过。构建与开发版运行检查在本分支提交前执行。


## 与上游的差异：EgoBrowser 原生工具接入

- 新增 `apps/electron/src/main/lib/adapters/pi-ego-browser-tool.ts` 与 `pi-ego-browser-tool.test.ts`：解析 `EGO_BROWSER_BIN`、PATH 和 `~/.local/bin/ego-browser`，通过 stdin 执行 `ego-browser nodejs`，合并输出、抽取升级提示、处理 50KB 截断、超时和 AbortSignal。
- `apps/electron/src/main/lib/adapters/pi-builtin-tools.ts`：仅在可执行文件存在时注册 `EgoBrowser`。
- `apps/electron/src/main/lib/agent-prompt-builder.ts`：仅检测到 ego-browser 时注入 TaskSpace、官方 Skill、用户接管和升级确认规则。
- `packages/shared/src/constants/permission-rules.ts`：`EgoBrowser` 不再归入 `SAFE_TOOLS`，因此智能模式首次调用走正常权限请求；`agent-permission-service.ts` 对该请求保留 `allowAlways`，用户选择“始终允许”后仅加入当前会话工具白名单，新会话重新确认。
- `apps/electron/src/renderer/components/agent/tool-utils.ts`：增加地球图标、中文显示名和脚本 goto/首行摘要。

## 2026-09-24: 新增 EgoBrowser 原生工具取代内置浏览器

- 从 `personal` 分支创建 `feature/ego-browser-tool`，实现方案 B；新增测试 6 项全部通过。
- 验证结果：改动后 `bun run typecheck` 通过；定向 `bun test apps/electron/src/main/lib/adapters/pi-ego-browser-tool.test.ts` 为 7 pass / 0 fail。全量 `bun test` 为 471 pass / 5 fail / 1 error（476 tests），相对基线 464 pass / 5 fail / 1 error 仅增加 7 个通过测试，失败与错误仍为官方已有 OAuth 代理、Electron mock、planning 数据库和代理设置问题。
- 已知限制：个人工作区 Skill `ego-browser-research` 仍为旧版 API，需另行更新；本次工具只执行官方说明中的 Node.js API，不复制旧 Skill 内容。

## 2026-09-24: EgoBrowser 改为每会话确认一次

- 从 `SAFE_TOOLS` 移除 `EgoBrowser`，避免智能模式把可读写本机文件、启动进程的 ego-browser Node 脚本误判为只读工具。
- 正常权限请求对 `EgoBrowser` 保留“始终允许”选项；用户确认后写入当前会话白名单，同一会话后续调用免询问，新会话重新确认。`bypassPermissions`、计划模式拒绝和子代理自动批准规则保持不变。
- 新增 `agent-permission-service.test.ts` 覆盖首次询问、同会话白名单和跨会话重新询问。

## 2026-09-24: README 增加个人版说明

- 在 `README.md` 与 `README.en.md` 顶部标题之前加入 `personal-fork:start` / `personal-fork:end` 独立区块，说明个人 Fork、官方 `v0.19.57` 基线、主要差异、隔离开发启动方式和 `PERSONAL.md` 入口。
- 区块与官方 README 正文分离，后续同步冲突时保留标记区块，其余正文采用上游内容。

## 2026-09-24: 隐藏钉钉与 Slack 桥接

- `apps/electron/src/renderer/components/settings/BotHubSettings.tsx` 从远程连接设置平台列表移除钉钉和 Slack，保留飞书、微信及其他通用设置入口；钉钉/Slack 设置组件与源码文件未删除。
- `apps/electron/src/main/index.ts` 保留 Bridge Registry 与 IPC 兼容旧数据，但钉钉和 Slack 的 `shouldAutoStart` 固定为 `false`，启动和自愈流程不会自动连接这两个桥接。
- 个人版确认保留语音听写、微信桥接、飞书桥接、officecli 与 `bin/proma` 命令行；本次未修改这些能力。

## 2026-09-24: 隐藏 GitHub Copilot 新增渠道入口

- `apps/electron/src/renderer/components/settings/ChannelForm.tsx` 从新增渠道类型列表移除 `github-copilot`。
- 编辑已有 Copilot 渠道时，原有 `providerSelectOptions` 兼容逻辑会把当前 provider 追加回选项，因此旧数据仍可显示、编辑和使用；OAuth 服务及运行时源码未删除。

## 2026-09-24: 停用 Agent Island

- `apps/electron/src/renderer/components/settings/GeneralSettings.tsx` 隐藏 macOS 与 Windows 的 Agent Island/状态通知开关。
- `apps/electron/src/main/index.ts` 启动流程不再初始化 Agent Island 状态机或 macOS 原生 helper；保留 IPC handler、旧设置字段和退出清理调用，旧 `agentIsland.enabled=true` 也不会启动 helper，renderer 上报已查看时安全空操作。
- `apps/electron/electron-builder.yml` 从 macOS `extraResources` 与 `binaries` 移除 `agent-island/macos-agent-island-helper`；helper 源码和 `build:agent-island-native` 开发脚本未删除。更正：macOS `binaries` 仍保留 `resources/eventkit/macos-eventkit.node`，仅移除 Agent Island helper，确保 hardenedRuntime 下 EventKit 可加载。

## 2026-09-24: 恢复 EventKit 签名清单

- 修正 `apps/electron/electron-builder.yml`：将 `resources/eventkit/macos-eventkit.node` 恢复到 macOS `binaries`，位置放在 `officecli` 之前。
- Agent Island 精简仍只移除 helper 的 `extraResources` 条目和 `binaries` 条目；EventKit 的打包与单独签名保持不变。

## 2026-09-24: 恢复 Chat 模式入口

- 原因：用户决定保留 Chat。
- 方式：revert `41eda1e6`，恢复官方 Chat 模式入口及相关行为。

## 2026-09-25: 新增远程网页第一期（实验）

- 新增个人版 Web Remote 第一阶段：回环 HTTP/WS 服务、设备配对与撤销、Origin/可选 Tailscale 身份校验、工作区白名单、会话读取、实时事件、手机发消息/中止/单次工具审批，以及内联单文件 PWA。
- 默认关闭；仅 `PROMA_WEB_REMOTE=1` 与 `~/.proma-dev/web-remote/config.json` 的 `enabled: true` 同时满足时启动，默认端口 `17888`，启动失败隔离记录日志。
- 新增 `scripts/personal/web-remote.sh`，用于生成一次性配对码、列出/撤销设备并打印 Tailscale Serve 建议命令。手机端不提供 ExitPlanMode、AskUserQuestion 或“始终允许”。

## 2026-09-25: Web Remote 复核修复

- 修正 Tailscale Serve 身份头为 `Tailscale-User-Login`，并将鉴权设备数据目录改为显式传入；只读配置路径不再创建 `web-remote/` 目录，只有配对/设备写入时才创建。
- Web Remote 与管理脚本默认拒绝正式配置目录，除非显式设置 `PROMA_WEB_REMOTE_ALLOW_PROD=1`；设备 `lastUsedAt` 写盘限制为每 60 秒最多一次。
- 手机 PWA 改为页面内审批卡、流式助手气泡、工具状态、断线指数退避重连、前台恢复、运行状态和工作区名称展示；根页面增加随机 nonce CSP 与安全响应头，历史接口默认只返回最后 200 条并支持 `limit=1..1000`。
- 修复 Electron esbuild 下 `ws` 的 ESM/CJS 入口差异：主进程改用具名 `WebSocketServer` 导入，新增本地类型增强声明与 Node CJS bundle 回归测试，避免运行时出现 `WebSocketServer is not a constructor`。

## 2026-09-25: Web Remote 真机反馈修复

- 修复 Android Chrome 经 Tailscale Serve 的 WS 二进制帧问题，改为文本帧并增加浏览器 Blob/ArrayBuffer 防御解析。
- 按真实 JSONL 重写消息 DTO：支持嵌套用户文本、thinking、多工具调用、tool_result 合并、aborted 和本轮汇总；工具调用参数生成完成显示为“已发出调用”，结果完成状态以 tool_result 为准。
- 重做移动端 PWA：移动优先浅/深色界面、会话筛选、状态顶栏、审批卡、工具折叠卡、安全 Markdown、输入区、toast、manifest 和 SVG 图标。

## 2026-09-25: Web Remote 第一期真机验收

- 环境：开发实例（`~/.proma-dev`）+ Tailscale Serve（仅 tailnet 可达）+ Android Chrome；只开放一个测试工作区。
- 用户实测通过：配对、会话列表与历史、发送消息与流式输出、手机端审批、中止、锁屏后重连补发。
- 本机回环实测通过：无令牌/错误 Origin/错误配对码均被拒绝、配对码不可复用、工作区过滤、客户端传 `alwaysAllow` 被忽略、撤销设备后 WS 以 1008 断开。
- 发现：v0.19.57 权限模式只有 `bypassPermissions` 与 `plan`，`createCanUseTool` 无调用方；实际会发审批的只有删除规划分组/标签/提醒与 PowerShell。因此“EgoBrowser 每会话确认一次”在运行时不会触发（代码与单测保留，待决定是否改为编排层单次确认）。
- 结论：第一期作为轻量页面保留，合并到 `personal`。下一步验证“手机运行桌面同一套界面”的路线。

## 2026-09-25: 技术验证 手机运行桌面界面（spike）

- 分支：`spike/web-remote-full-ui`；实现了浏览器版 preload（esbuild + browser Electron shim）、单一 `/api/ipc` WebSocket、主进程 IPC 注册登记与镜像主窗口 `webContents.send` 事件、JSON 标记序列化、验证期拒绝清单，以及受 Cookie/Origin/Tailscale 身份保护的 `/app/` 静态 renderer 服务。
- 仅在开发实例配置 `fullUi: true` 时启用；`extraAllowedOrigins` 仅用于本机回环验证，并为 HTTP 回环配对使用非 Secure Cookie。未修改 `~/.proma-dev/web-remote/devices.json`；改前配置备份在 `/tmp/web-remote-config.json.backup-20260925`。
- 验证：typecheck、`build:main`、`build:renderer`、web preload 构建通过；新增 full-ui 单测 3 pass；全量 `bun test` 为 502 pass / 5 fail / 1 error，新增失败为 0（与基线失败/错误保持一致）。
- 真实 ego 验证：独立 task space `spike-ego`；`/app/` 首屏成功加载同一份 renderer，Agent/Chat、侧栏、工作区与 test 会话可见；在“独立站”工作区 test 会话发送无副作用 pong 指令，手机收到 10 个 Agent 流事件，最终回复 pong；IPC 拒绝 `channel:decrypt-key`、`terminal:create`、`shell:open-external` 均返回 `{ denied: true, channel }`。
- 加载指标：66 个资源请求，`transferSize` 约 7,928,424 bytes，`encodedBodySize` 约 7,915,224 bytes；单次 `listAgentWorkspaces` IPC 回环约 1ms（本机回环，不代表手机/尾网延迟）。截图：`/tmp/web-remote-spike/phone-390x844.png`（390×844）、`/tmp/web-remote-spike/tablet-1024x1366.png`（1024×1366）。
- 登记覆盖率：源码 `ipcMain.handle(` 360 个、`ipcMain.on(` 8 个，共 368 个；挂钩位于 `registerIpcHandlers()` 之前，预期覆盖 368/368（100%），未发现更早注册点。
- 已知障碍：原始 IPC 仍未按工作区白名单隔离；文件附件/原生文件选择等能力被浏览器环境限制或拒绝；未完成每项设置页、Automation/Todo、Chat 模式、@Skill/@MCP、流式中止、附件/文件预览的逐项实测；CSP 验证阶段允许 `style-src 'unsafe-inline'`。正式方案应拆分可远程安全 API 与本地/原生能力，补工作区授权、移动布局、二进制上传和端到端权限模型。
- 提交：`d7d7b384`、`d284de1d`、`1e9df13b`、`4e6340de`；每个 commit 末尾均带唯一 `Made-with: Proma` trailer。

## 2026-09-25: full-ui 捕获时序修复与手机适配复验

- 修复前次 spike 报告遗漏：`4e6340de` 曾将捕获改成异步动态 import，导致 `registerIpcHandlers()` 先执行、登记表为空。现改为静态导入纯 capture 模块，由 `main/index.ts` 在注册前同步调用 `prepareWebRemoteFullUi(ipcMain)`；注册后输出 `[Web Remote] full-ui 已登记 invoke=N event=M`。新增回归测试断言同步安装后后续 handler 会进入登记表。
- 最小手机适配通过 `/app/` 注入样式和脚本完成；renderer 仅增加 `data-web-remote-app-content`、`data-web-remote-sidebar`、`data-web-remote-main`、`data-web-remote-panel` 等稳定属性。390px 下侧栏抽屉、遮罩、右侧全屏面板按钮、输入字号和横向溢出策略已接入；头像坏图因本地 Electron 资源 URL 在浏览器无效，验证期隐藏坏图。
- 最终回归：全量 `bun test` 为 503 pass / 5 fail / 1 error，较修复前基线只增加 1 个同步捕获测试通过；失败/错误数量未增加。typecheck、web-remote 定向测试、build:main、build:renderer、web preload 构建均通过；构建顺序为 renderer 后 preload。
- 真实 ego 复验（task space `spike-ego-fix`）：`agent:list-workspaces`、`agent:list-sessions`、`settings:get` 正常返回；390×844 下 renderer 正常加载，侧栏菜单/遮罩、`独立站/test`、发送 `只回复 pong`、`/status` 只读 Skill 一句回复、`@` 文件列表、模型下拉均实测成功。设备 `354860d2693805b81f3abc91` 已撤销；验证结束已删除 `extraAllowedOrigins`，最终配置仅保留 `fullUi: true`。
- 未完成或部分验证：新建会话、流式中止、Todo/定时任务/MCP/Skills/设置首页的独立页面逐项实测不完整；右侧面板 DOM/CSS 状态已接入，但本轮未取得稳定的真实触控点击证据。

## 2026-09-25: Android 移动端问题复现与 round3 修复

- 使用独立 headless Chrome + CDP，经 Tailscale 地址直连验证；未修改 `config.json`，未增加 `extraAllowedOrigins`。复现确认：抽屉残影来自关闭态仍保留 sidebar `box-shadow`；文件按钮在 touch 合成 click 下发生二次切换；侧栏操作被隐藏的 resize handle 拦截，且 Todo/定时任务/MCP/Skills 需要强制打开全屏右侧面板；后台冻结后流事件可能错过。
- 修复：关闭态移除阴影并禁用移动端侧栏 resize handle；新增 touch/pointer 控件转发与 click 去重；Todo/定时任务/MCP/Skills 选择后自动设置全屏面板；shim 重连后派发 `proma-web-remote-reconnected`，页面切后台超过 5 秒恢复时 reload，复用 renderer mount 时的 active session snapshot/history 恢复路径。
- CDP 验收截图目录：`/tmp/web-remote-spike/round3/`。抽屉开关 3 次的 open/closed 截图均无残影；文件全屏面板 `panel-open-round3.png` / `panel-closed.png`；Todo 全屏面板 `todo-round3.png`；新建会话 `plus-round3.png`；设置首页 `settings-round3.png`；Skill 冻结恢复控制台与结果记录在 `freeze-console.json`。
- 真实功能：`/agent-reach` 查询在页面冻结 20 秒后恢复，最终答案出现在手机端；侧栏新建会话和设置可打开；Todo 触控经过移动转发后打开全屏内容；面板关闭可用。当前全量测试仍为 503 pass / 5 fail / 1 error；typecheck、web-remote 定向测试、build:main、build:renderer、preload 构建均通过。
- 本轮创建的配对设备 `df2bab01a7f2baca65f11bbc`、`48f2976d75d9335a0b451165` 均已撤销，并已用 `devices` 核对 `revokedAt`；headless Chrome PID/profile 已结束并删除。

## 2026-09-25: Android round4 全屏面板与移动顶栏

- 根因：全屏右侧面板内部 `SidePanel` 在 `isOpen=false` 时保留 `opacity-0 pointer-events-none`，移动端只切换外层显示导致蒙版/不可操作；浮动按钮固定在页面上方覆盖标签栏；面板入口切换时 touchend 后合成 click 二次翻转；设置入口仍出现在侧栏。
- 修复：移动注入层在全屏状态强制面板内容 `opacity:1/pointer-events:auto`；新增固定移动顶栏，承载左侧菜单、当前视图标题与文件/返回切换，内容区下移 56px；面板从 `top:56px` 起占满宽度，标签栏横向滚动，控件行高至少 42px；侧栏设置入口隐藏，若设置已打开显示“设置请在电脑端操作”提示和返回按钮；修复 touch/click 去重和 sidebar resize handle 拦截。
- Headless CDP 真实验证（412×915、deviceScaleFactor 3.5、Android touch、Tailscale HTTPS）：抽屉开关 3 次无残影；文件、Todo、定时任务、MCP/Skills 均以清晰的全屏面板显示；对话视图和面板均有固定顶栏；设置入口隐藏；冻结 20 秒后 `/agent-reach` 最终答案恢复显示。中止测试已看到“停止 Agent”按钮并点击，运行停止且未继续输出，但最终消息未渲染明确“已中止”文案，记为部分验证。
- round4 截图：`/tmp/web-remote-spike/round4/conversation-topbar-round4.png`、`drawer-open-round4.png`、`drawer-closed-round4.png`、`file-panel-round4.png`、`todo-round4.png`、`automation-round4.png`、`mcp-round4.png`、`sidebar-settings-hidden-round4.png`、`plus-round3.png`、`settings-round3.png`、`abort-round4.png`。
- 回归：全量 `bun test` 仍为 503 pass / 5 fail / 1 error；typecheck、web-remote 定向测试、build:main、build:renderer、preload 构建通过。config 未添加 `extraAllowedOrigins`；本轮 `cdp-mobile` 设备均已撤销；全部 `/tmp/proma-mobile-chrome-*` 目录已清理。

## 2026-09-25: 手机完整客户端 A1（验证脚本与 IPC 分级）

- 新增 `scripts/personal/mobile-harness.mjs`：独立 headless Chrome、Android 412×915 触控视口、CDP 文本/触控编排、自动配对与 finally 撤销设备、截图、console/异常收集，以及加载→打开 `独立站/test`→发送 pong→MCP/Skills、Todo、定时任务、文件面板截图的冒烟套件。地址和会话名均由参数传入，不写入仓库。
- 新增 `scripts/personal/generate-web-remote-policy.mjs`，从 IPC 常量源码生成 432 条保守初稿；`full-ui/channel-policy.ts` 再按参数形态与副作用逐条归类为 `read`、`session`、`workspace`、`confirm`、`denied`，已登记通道启动时核对未分级数量并对未登记通道默认拒绝。
- full-ui IPC 增加会话/工作区范围解析与 allowlist/all 模式、列表结果过滤、session/workspace 事件过滤、一次性 confirm token 流程和敏感字段剔除。`workspaceScope` 默认按 `allowlist` 解释；本次未修改开发实例当前配置取值。`settings:get` 与 `channel:list` 返回会递归剔除 key/token/secret/password/credential 等字段，单测确认无密钥字段外泄。
- 删除验证期 `extraAllowedOrigins`、非 Secure Cookie 与无 Tailscale 身份头的回环放宽逻辑；配对与已认证请求均要求配置 Origin 和 `Tailscale-User-Login`，Cookie 固定 `HttpOnly; Secure; SameSite=Strict`。`/app/` CSP 仍保留 `style-src 'unsafe-inline'`，原因是上游 renderer 大量运行时内联样式，待后续拆分样式后再收紧；根配对页 CSP 已保持 nonce-only。
- 单元验证：`bun test apps/electron/src/main/lib/web-remote` 为 36 pass / 0 fail；新增安全测试覆盖分级表、默认拒绝、越权、列表/事件过滤、confirm、denied、设置密钥剔除。`bun run typecheck`、`build:main`、`build:renderer`、web preload 构建通过。
- 技术验证真机检验通过：上一轮 Android Chrome + Tailscale Serve 已验证配对、会话/流式消息、审批、中止、锁屏重连及移动抽屉/全屏面板。最终 A1 harness（提交 `1b6a14dc` 后运行）在 412×915、deviceScaleFactor 3 下完成 load、`独立站/test`、pong、MCP/Skills、Todo、定时任务、文件面板步骤；截图为 `/tmp/proma-mobile-harness-a1-final/mcp-skills.png`、`todo.png`、`automations.png`、`files.png`、`smoke-final.png`。allowlist 额外检查只显示预期工作区，伪造越权会话返回 404；确认框取消与只读 Skill 的独立 UI 检查仍待父会话复核。

## 2026-09-25: A1 复核修正（显式分级、文件路径与凭据掩码）

- 修正提交：`4992288f`、`c766ec56`、`3db11586`、`aa570067`、`4a5ecd51`、`77f68ab9`。运行时分级表改为 442 条显式 `channel -> level/scope/rationale` 字面量表，不再按正则推断；源码导出通道与 10 个字面量 file/migration 通道的覆盖检查保留为登记校验，未知登记通道默认拒绝。
- 最终分级统计：`read=64`、`session=36`、`workspace=35`、`write=9`、`confirm=28`、`denied=270`、未分级 `0`。新增 file 预览通道均执行 realpath 后的项目根、workspace-files、附加目录或允许会话目录校验；`file:write-text` 为 confirm；`migration:open-data-folder` 为 denied。
- 改级：Mac 开窗/改项目根的 memory-window 与 project-root 通道为 denied；删除/覆盖/批量变更为 confirm；planning 创建/更新/提醒操作为无确认 `write`；planning native-sync/connect/disconnect/privacy/profile 通道为 denied。MCP `env`/`headers` 值在返回前掩码，敏感 key 保留键名但值为 `[REDACTED]`。
- 开发实例真实 IPC 检查（不打印返回值）：`settings:get`、`channel:list`、所有允许工作区的 `agent:get-mcp-config` 均通过疑似密钥扫描，结果均为 `ok=true, suspicious=[]`；检查规则覆盖 `sk-`、`Bearer` 及敏感字段 key。工作区外 `file:resolve-and-read` 直接 IPC 请求返回 denied。
- 修正后定向 Web Remote 测试：`39 pass / 0 fail`；全量测试：`511 pass / 5 fail / 1 error`，相对复核基线 `508/5/1` 未新增失败或错误。typecheck、build:main、build:renderer、web preload 均通过。
- 最终手机证据（提交 `77f68ab9` 后运行）：panel DOM 标题断言全部通过（MCP/Skills、Todo、定时任务、文件），截图位于 `/tmp/proma-mobile-harness-a1-correction-final/`；Todo `harness-confirm-test` 创建成功，首次删除确认框取消后 Todo 仍在，第二次确认后消失；定时任务立即运行确认框出现并取消；只读 `/status` Skill 出现最终回复文本；文件越权 IPC 被拒。最终 smoke（同一最终代码）截图位于 `/tmp/proma-mobile-harness-a1-final-correction/`，load、会话、pong、四面板步骤全部成功。
- 开发实例 stdout 未被当前会话捕获，无法贴出 watcher 的原始启动日志行；代码启动检查现应输出 `[Web Remote] full-ui 分级覆盖率 100%（invoke=N, event=M）`，单测已覆盖“登记表 ⊆ 分级表”及 10 个此前缺口通道。该日志行仍请父会话从开发实例日志复核。

## 2026-09-25: 手机完整客户端 A2（实现批次）

- `/app/` 静态资源增加内容哈希资源的 immutable 长缓存、index/preload 的 ETag/Last-Modified 协商缓存、Brotli/gzip 按请求压缩与 64 MiB LRU 内存上限；index 的注入结果按源文件版本缓存，避免动态 CSP nonce 与 304 复用不一致。
- 手机后台恢复改为补同步：重连或后台超过 5 秒后重新拉取活动会话快照、队列、当前会话历史、会话列表与三类待处理交互；补同步失败才 reload。浏览器版 `sendSync` 返回安全空值；启动时必需但被 denied 的少量原生通道返回安全默认值，未放宽分级。
- AskUserQuestion 与 ExitPlanMode 响应通道按 requestId 解析 session 范围并过滤 pending 快照；新增覆盖测试。harness 增加首次/二次加载请求数、传输字节、耗时，以及 recovery 套件。
- 定向 web-remote 测试 41 pass；Electron typecheck、build:main、build:renderer、web preload 构建通过；全量测试 513 pass / 5 fail / 1 error，相对 A1 基线 511/5/1 仅增加新增测试通过数，未增加失败或错误。
- A2 smoke 最终链路通过：pong、MCP/Skills、Todo、定时任务、文件面板截图；设备撤销、临时 Chrome 退出、临时 profile 删除均核对通过。当前加载指标与 AskUser/ExitPlan 完整交互及冻结恢复证据由父会话继续汇总。

## 2026-09-25: 手机完整客户端 A2 收尾复核

- 修正 recovery harness：输入步骤现在通过 `getAgentSessionSDKMessages` 断言用户消息已落盘；回复等待只检查该用户消息之后的 assistant 消息，并同时检查 `[data-message-role="assistant"]` 页面区域，避免用户消息自身包含目标文本造成误判。
- recovery 使用 `Bash sleep 15` 确保冻结时确有运行中任务。最终证据：`/tmp/proma-mobile-harness-a2-recovery-fixed3/`，运行中快照 1 个、冻结约 28.9 秒、最终 `recovery-done` 出现、`performance.timeOrigin` 保持不变、未整页重载。
- 加载统计改为按唯一 CDP requestId 计数，并记录 response 数、缓存响应数和 encoded transfer bytes。最终口径：首次约 78 请求 / 3.21 MB，二次约 77 请求 / 0.6–1.0 KB，二次大部分响应来自浏览器缓存/协商缓存；此前 8 请求统计是未等待动态资源完成的旧口径。
- AskUserQuestion 已取得手机卡片、选择 A、assistant 回复 A 的截图和历史证据，见 `/tmp/proma-mobile-harness-a2-interactions2/`。ExitPlanMode 请求被 Agent 运行时直接完成审批，未出现手机审批卡，手机端计划审批仍未取得独立证据。
- 中止测试受同一 `独立站/test` 会话中排队的长任务影响，未取得稳定的桌面/手机对比证据；不将其标记为已验证。

## 2026-09-25: 用户决定（手机工作区范围与 EgoBrowser 权限）

- 手机端工作区范围改为全部开放：开发实例配置 `workspaceScope: "all"`（本地配置，不入库）；敏感能力仍按 IPC 分级表拒绝或需二次确认。开启后父会话在最终代码上重跑 harness smoke 通过。
- EgoBrowser 不再询问权限：维持当前运行时行为（v0.19.57 默认 `bypassPermissions` 下所有工具直接放行）。此前“每会话确认一次”的代码与单测保留但运行时不生效，不再作为目标。
- 问题记录：A2 的 ExitPlanMode 验证曾把 `独立站/test` 会话改名为 `web-remote-harness-ask-plan-*` 并切到计划模式，导致 smoke 找不到会话；父会话已恢复标题与权限模式。后续 harness 不得修改既有会话的标题或权限模式，只能在自建的专用会话中改。

## 2026-09-25: Tailnet 受信设备免配对

- Cookie 设备认证维持原路径；无有效 Cookie 时，只有允许的 `Tailscale-User-Login`、XFF 最左侧 Tailnet IP、`tailscale whois --json` 的登录用户一致且 `Node.ComputedName` 在 `trustedTailscaleNodes` 配置列表中，才生成 `tailnet:<ComputedName>` 身份。whois 使用只读 `execFile`，2 秒超时，成功/失败均按 IP 缓存 60 秒；失败拒绝。
- 该认证统一覆盖 API、`/app/` 与静态文件、`/api/stream`、`/api/ipc` WebSocket 升级及连接建立后的二次认证；Origin/写操作检查不变。受信设备访问根配对页会跳转 `/app/`。撤销列表每秒刷新，删除信任项后已建立的 Tailnet WebSocket（含 IPC）将于轮询周期内关闭。
- 配对页防止重复点击；配对返回 401 时会再验证已有 Cookie，若仍有效则进入 `/app/`。
- 安全边界：撤销时从开发配置 `trustedTailscaleNodes` 删除该节点；规则同时要求 Tailnet 用户登录名、Tailscale 地址段、whois 用户和设备名精确匹配。服务只监听回环地址；同机进程理论上能伪造回环请求头，但本机进程本就拥有等同的本地访问权限。受信列表只写入个人开发配置，不入库。

## 2026-09-25: Web Remote 手机输入工具栏布局修复

- 根因（源码证据）：`InputToolbarOverflow` 原为固定 `h-[48px]`、单行 `justify-between`；左侧子行 `flex-1 min-w-0 overflow-hidden`，右侧模型选择器与发送控件又占用固定宽度。在 390pt 宽度下，左侧可用空间被挤压且工具子项可能被 `overflow-hidden` 裁掉；症状由布局与裁切造成，不是 mobile touch-forward 脚本专门拦截输入栏。
- 修复：给工具栏容器增加稳定属性 `data-web-remote-input-toolbar`；移动注入层将其改为自动高度/可换行布局，左、右区域分行，并给按钮设置至少 40×40px 的触控边界，避免左侧与模型/发送区抢占同一行。Harness 增加 iPhone UA 参数，创建专用会话前先打开侧栏。
- Android 412×915 触控证据：截图 `/tmp/web-remote-composer-fix/plan6/toolbar-412x915.png`。逐控件边界框分别为快速模式 x=19..59、权限模式 x=65..105、思考入口 x=111..151、语音 x=157..197、附件 x=203..243，均为 40×40px、相互留有 6px 间隔；各控件中心 `elementFromPoint` 命中自身 button。快速模式 `false→true`，权限模式“完全自动→计划模式”，思考入口触控后 Popover 可见。控件截图：`control-quick.png`、`control-permission.png`、`control-thinking.png`（均位于同目录）。
- iPhone UA、390×844 smoke 通过，含 `/app/` 会话加载、发 pong、打开 MCP/Skills、Todo、定时任务及文件面板；截图 `/tmp/web-remote-composer-fix/iphone/smoke-final.png`。Android 412×915 对应 smoke 截图 `/tmp/web-remote-composer-fix/android/smoke-final.png`。本轮没有取得 iPhone 视口下逐控件命中/点击记录。
- 计划审批未完成：手机 harness 的新会话创建流程在开发实例报 `Cannot read properties of null (reading 'id')`，未出现计划审批卡；因此没有批准后 assistant 回复 `done` 的 IPC 历史与截图证据，不能将手机端审批标记为通过。测试中曾临时改动 `独立站/test` 的标题、权限与 Codex 快速模式，均已恢复核验为标题 `test`、权限“完全自动”、快速模式关闭；未保留额外会话标题。
- 回归：typecheck 通过；Web Remote 定向测试 51 pass / 0 fail；build:main、build:renderer、web preload 均通过；全量测试为 523 pass / 5 fail / 1 error，与记录基线 523/5/1 相同。Harness smoke 两个视口均通过。
- 清理：本轮 harness JSON 均记录 `revoked=true`、`chromeExited=true`、`profileRemoved=true`；`/tmp` 中 `proma-mobile-chrome-*` 剩余数量为 0。未操作 Tailscale、官方版进程或用户 Web Remote 配置字段。

## 2026-09-26: Web Remote ExitPlan 手机审批卡修复与双视口验收

- 根因（代码与运行证据）：full-ui IPC 桥原先将 `agent:stream:event` 设为 `denied`，因此 AskUser/ExitPlan 事件未从主窗口镜像到 `/app/` 手机 renderer；Renderer 已有 `onAgentStreamEvent` → `useGlobalAgentListeners` → pending atom → `ExitPlanModeBanner` 路径，卡片不是缺组件。另，harness 原创建通道按 session scope 校验，但新会话尚无 sessionId，无法通过授权并造成返回 ID 为 null；不能通过复用/改名/改模式已有会话绕过。
- 修复：在桥接端允许 `agent:stream:event` 进入，但只镜像当前获准工作区会话中的 `permission_request/resolved`、`ask_user_request/resolved`、`exit_plan_mode_request/resolved`、`enter_plan_mode`、`plan_mode_changed`、`permission_mode_changed`；SDK 消息、增量与其他未知/未列出的事件仍拒绝。`agent:create-session` 改为授权工作区范围；创建后必须从会话清单差异取得真实 ID。（子会话曾将 Electron 包版本改为 0.19.58，父会话已撤销：个人版版本号必须与所跟随的官方正式版本一致，否则每周版本检查与切换判断会失真。）
- 父会话复核补充（2026-09-26）：A1 起 `agent:stream:event` 被整体拒绝，手机端一直收不到实时输出（只在运行结束后刷新历史）。改为对已授权会话镜像全部流事件（SDK 消息、增量、审批/提问/计划事件），按 sessionId 所属工作区过滤；这些内容与该会话可读历史等价，不扩大暴露面。
- Harness 安全修复：先选择“独立站”工作区，再用运行前后清单识别新会话；仅记录该次创建的 ID 可改标题/权限模式，null、缺失或已有 ID 均拒绝。新增单测覆盖 guard。运行前后逐项比较既有会话 ID、标题与权限模式。
- iPhone UA 390×844：AskUser 卡片显示、选择 A、收到 AskUser request/resolved 同 requestId；ExitPlan 卡片显示并可见计划审批选项，审批前 pending ExitPlan 请求存在且活动运行快照仍存在（等待审批而非已停止），批准后 pending 清空、收到 request/resolved 同 requestId，Agent 继续并回复 `done`，最终模式为 `bypassPermissions`。截图在 `/tmp/proma-mobile-harness-exitplan-iphone-verified/`。
- Android UA 412×915：同一交互全部通过；截图在 `/tmp/proma-mobile-harness-exitplan-android-verified/`。
- 会话清单核对：iPhone 12→13，只增加专用会话 `4b6a0548…`；其余 12 项 ID/标题/权限模式完全相同。Android 13→14，只增加专用会话 `1b8d1224…`；其余 13 项完全相同。较早的 harness 尝试创建的 harness 测试会话仍保留，未改动 `test` 或任何已存在会话；不因“清理”而不可逆删除会话记录，若要删除这些专用测试会话需另行确认。
- 收尾：两轮均记录设备撤销 `true`、临时 Chrome 进程退出 `true`、profile 删除 `true`、JavaScript exceptions `0`；另有 24 条 console error，均为通知音频预加载 XHR / 即时解码失败，未影响交互；没有停止/重启开发实例，没有操作官方版、`~/.proma` 或 Tailscale；未 commit、未 push。
- 回归：workspace typecheck 通过；`build:main`、`build:preload`、`build:renderer` 通过；新增 guard 与 full-ui 安全测试均通过。全仓 `bun test`：527 pass、5 fail、1 error（Bun 报告 532 tests across 84 files）：失败项为 agent-session-manager/channel-runtime-api-key 缺少 Electron `dialog`/`shell` 命名导出、OAuth proxy scope 用例 rejected、proxy-settings-service 期望的 `redactProxyUrl` 导出缺失、planning-manager 测试拿到非字符串 Electron binary；未涉及本次修改文件，需在 Electron 测试环境中单独处理。

## 2026-09-26: 手机完整客户端阶段 A 真机验收通过

- 用户在 OPPO（Android Chrome）与 iPhone（Safari）真机验收通过：受信 Tailnet 设备免配对、两台同时在线、实时输出、计划审批卡（手机端批准）、中止、iPhone 底部栏与输入栏左侧控件可点。
- 已知注意：重建 renderer 会清空 `dist/renderer/preload.js`，必须随后运行 `scripts/personal/build-web-preload.ts`，否则手机端空白（阶段 B 改为自动生成并在缺失时显式报错）。
- 合并到 `personal`。

## 2026-09-26: 手机完整客户端 B1（实现与端到端预检）

- Web preload 产物改为独立 `apps/electron/dist/web-remote/preload.js`，不依赖 `dist/renderer/`；`build:web-preload` 加入 Electron 完整 build 链路。`/app/` 请求前校验产物是否早于 preload 源或浏览器 shim；开发模式自动重建，失败时返回中文说明页和修复命令。
- full-ui shim 接管 Agent 回形针入口，提供支持多选、相册/拍照类型的浏览器文件选择器；文件由浏览器读取为 base64。附件选择、粘贴与拖放经 `saveFilesToAgentSession` 保存到当前会话目录，并以桌面端附件预览项/引用方式显示。上传时有 toast，失败显示错误；手机端每文件上限 25MB，桌面既有 100MB 限制不变。服务端验证文件名、base64、大小及 session/workspace 授权。
- Harness 的 `findElement` 现支持可见文字、`aria-label`、`aria-labelledby` 与 button/`role=button` 定位；回形针入口通过无文本 aria-label 点击。文件选择器取消时延迟 1.5 秒清理，给 CDP `DOM.setFileInputFiles` 留出操作窗口；测试 PNG 为有效 32×32 红色图像。Smoke 每次都在本次新建的专用会话运行，不会向既有会话发送消息。
- Android UA 与 iPhone UA 附件端到端预检均通过：文本文件保存到专用会话目录，输入区出现附件，Agent 只回复第一行 `B1_ATTACHMENT_FIRST_LINE`；有效红色 PNG 保存并显示为附件，Agent 回答 `Red`。两次测试前后，既有会话 ID、标题和权限模式均未变化。
- preload recovery 预检通过：故意删除 `dist/web-remote/preload.js` 后访问 `/app/`，开发服务自动重建（119,705 bytes），页面正常加载且无错误页。Android 与 iPhone smoke 的页面加载、pong、MCP/Skills、Todo、Automation、文件面板步骤均通过。
- 回归：typecheck 通过；Web Remote 57 pass / 0 fail；`scripts/personal/mobile-harness.test.mjs` 2 pass / 0 fail；全量 `bun test` 为 531 pass / 5 fail / 1 error，相对基线 527/5/1 未增加失败或错误。既有失败仍为 Electron `dialog`/`shell` 导出、OAuth proxy scope、`redactProxyUrl` 和 planning-manager Electron binary 问题。`build:main`、`build:renderer`、`build:web-preload` 均通过；重建 renderer 后独立 preload 仍在，旧 `dist/renderer/preload.js` 不存在，版本为 0.19.57。
- 用户此前指出的 3 个失败运行遗留的空 `web-remote-harness-attachments-*` 会话均保留；本轮新建的测试会话也保留，未删除、重命名或改动既有会话。最终验收截图会在最后提交后生成于 `/tmp/web-remote-b1/`。
- 所有预检 harness 设备均已撤销，Chrome 进程/profile 清理完成，`/tmp/proma-mobile-chrome-*` 数量为 0。未手动停止/重启开发实例；未改版本、Web Remote 配置或用户设备；未操作官方版、`~/.proma` 或 Tailscale。

## 2026-09-26: 手机完整客户端 B1 真机验收通过

- 用户真机验证手机附件（相册/拍照/文件/粘贴）通过；父会话在最终代码上独立复跑 iPhone UA 附件链路通过（文本首行、图片识别）。
- 清理：经应用 `agent:delete-session` 删除 35 个 harness 测试会话与 2 个空白会话；删除前会话索引备份于 /tmp。
