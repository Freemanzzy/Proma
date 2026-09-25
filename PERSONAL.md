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