# Proma 个人版完整变更历史

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

## 2026-09-26: 手机完整客户端 B2

- 桌面“设置 → 远程连接”新增“手机访问”管理分区及独立 renderer 组件：展示开发实例服务状态、`allowedOrigin`、唯一连接设备数、受信 Tailnet 设备、配对设备、配对码与工作区范围；支持启停/full-ui、受信节点增删、设备撤销及范围选择。Tailscale 候选仅通过只读 `tailscale status --json` 获取并按当前账号过滤。配置字段严格校验，使用临时文件 + rename 原子写入并设为 `0600`；enabled/fullUi 明确标注需重启，受信节点/工作区授权借助既有轮询刷新。
- 新增 `web-remote:admin-get/save/pair/revoke` 管理 IPC；四通道在 full-ui 显式分级表和 denied 清单中均为 `denied`，远程 renderer 隐藏管理分区，主进程处理器只接受开发实例的本地 `file://` renderer。登记覆盖率仍为 100%。
- 手机文件预览通过 SidePanel 既有 `PreviewPanel` 路径打开，继续使用分级 `file:*` IPC 与 realpath 根目录检查。移动补丁使用 `visualViewport` resize/focus 维护键盘 inset 与输入可见位置，并保留 standalone 安全区。
- `/app/` PWA manifest 改为 `Proma`，声明 standalone、192/512 SVG 图标；静态路由公开提供图标，文档头加入 iOS standalone 与 touch-icon 元数据，CSP 显式允许 `manifest-src 'self'`。
- `mobile-harness.mjs` 支持 1280×800 桌面视口检查管理 IPC denied；finally 对运行期间记录的新建专用会话逐一调用 `agent:delete-session` 确认流程，记录删除前后清单并核实已有会话不变；设备撤销、Chrome/profile 清理流程保留。
- 验证（提交前）：typecheck、Web Remote + 设置分区 SSR + harness 定向测试 62 pass、`node --check`、`build:main`、`build:renderer`、`build:web-preload` 通过；全量测试 534 pass / 5 fail / 1 error，与 B1 既有的 5 fail / 1 error 类别一致，无新增失败/错误。远程 1280×800 harness 确认四个管理 IPC 均 denied，手机访问分区不可见；Chrome/profile 与测试配对设备已清理。开发配置 SHA-256 前后相同，未更改配置值；包版本保持 0.19.57。
- 当前未完成文件预览的移动端 E2E 截图：harness 能上传本次专用会话内的 Markdown 与图片，但本轮无法在手机 Files 面板中稳定定位附件树行；不将文件预览记为已验证。键盘模拟及双 UA smoke 的最终证据应以最后提交后的 harness 结果为准。

## 2026-09-26: 手机完整客户端阶段 B 真机验收通过

- 用户真机验收通过：文件预览、软键盘不遮挡、添加到主屏幕（standalone）。B1 附件此前已通过。
- 父会话复核修复：桌面“手机访问”管理 IPC 原仅接受 `file://` 渲染页，开发实例主窗口来自本地 Vite 服务，导致桌面操作全部被拒；已放行开发服务来源（桥接调用 senderFrame 为 null 仍被拒，且通道在远程分级为 denied）。
- 合并到 `personal`。

## 2026-09-26: 手机完整客户端 C1（Web Push）

- Web Push 使用成熟库 `web-push@3.6.7`（MPL-2.0；安装包约 180 KB），由库实现 RFC 8291/8292 加密；代理使用其原生 `proxy` 选项，优先读取开发实例既有有效代理设置，再回退到代理环境变量或 `http://127.0.0.1:7897`。推送失败最多重试一次，端点返回 404/410 时删除订阅。
- VAPID key 首次在开发实例数据目录 `web-remote/vapid.json` 生成，目录与 key 为 0700/0600；按设备保存的订阅在 `web-remote/push-subscriptions.json`，0600、原子替换。没有加入密钥到 Git，也没有改 Web Remote 配置值。
- 仅对当前工作区授权会话的运行完成/失败、权限审批、AskUserQuestion、ExitPlanMode 与 automation 终态发中文推送；标题含会话标题，正文使用安全固定摘要并限制至 120 字。相同会话/事件 30 秒去重；设备若在手机端可见且正打开该会话则静默，桌面状态不参与静默判定。通知点击打开 `/app/?session=...`，注入层切换至会话。
- `/app/sw.js` 是公开、固定且不含数据的脚本；执行 `skipWaiting`/`clients.claim`、push 与 notificationclick，不缓存页面，不拦截 `/api/*` 或 WS。`/app/` CSP 新增 `worker-src 'self'`。订阅/状态 API 均要求认证，订阅只能写入/删除当前设备记录，presence 会校验会话授权。
- 注入层提供“开启通知”按钮；iOS 非 standalone 会提示先添加到主屏幕。桌面“手机访问”显示订阅状态，可发送测试通知、删除订阅。新增 `web-remote:admin-push-test` 与 `web-remote:admin-push-delete` 两个 IPC，均为 denied 并沿用 `assertDesktop`；IPC 登记分级覆盖率仍为 100%（invoke=370、event=8）。新增 HTTP 路由清单覆盖 6 个新增路径。
- 验证：typecheck、Web Remote/设置定向测试通过；新增 push、HTTP 鉴权与 service worker 测试覆盖摘要截断、30 秒去重、前台静默、工作区拒绝、410 清理、失败重试、订阅接口鉴权及 SW 公共路由；新增 harness guard 单测通过。全量 `bun test` 为 541 pass / 5 fail / 1 error（546 tests）；与既有基线 534/5/1 相比增加 7 个通过，无新增失败/错误。既有失败仍为 Electron dialog/shell mock、OAuth proxy scope、proxy-settings export、planning-manager Electron binary 问题。
- `build:main`、`build:renderer`、`build:web-preload` 通过；renderer 构建仍有仓库原有大 chunk 警告。版本保持 `0.19.57`。
- Android Chrome headless 实测：CDP 授权通知，PushManager 真实订阅（端点为 FCM），服务端订阅登记成功；Agent 因开发实例 ChatGPT OAuth 登录失效而产生失败事件，服务端推送请求获得端点 HTTP 201，Service Worker 收到并展示与本次 harness 会话对应的失败通知。此轮未验证正常 pong 回复完成通知；双 UA Android/iPhone smoke 均完成页面加载与会话打开，但 pong 验证因同一 ChatGPT OAuth 失效未通过。真实桌面 IPC“发送测试通知”目前只通过订阅 store 定向单测验证，不记为桌面 E2E 已通过；iPhone Web Push 真机验收仍待用户进行。
- 清理：harness 临时设备均撤销、专用 harness 会话均由脚本删除；会话清单中既有 ID/标题/权限模式前后未变；Chrome 进程退出、profile 删除，`/tmp/proma-mobile-chrome-*` 为 0；开发订阅文件最终 0 条。保留本地 VAPID key 以免重建用户订阅所需密钥。未改 `~/.proma-dev/web-remote/config.json`，没有改 Tailscale、官方版或用户手机。
- 真机开启与测试：Android Chrome 或 iPhone Safari 先打开 `/app/` 并“添加到主屏幕”；iPhone 必须从主屏幕启动独立模式。登录后在移动顶栏点“开启通知”并允许系统通知。随后在桌面“设置 → 远程连接 → 手机访问 → 通知订阅”检查设备状态，点“发送测试通知”；会话运行结束/失败、权限请求、提问或计划审批时会收到对应通知。若手机正在前台打开同一会话，该设备按规则静默。

## 2026-09-26: 手机完整客户端阶段 C 验收通过

- C1 Web Push：用户真机验证通过（两台手机开启通知、桌面测试通知、真实运行完成通知与点击定位会话）。父会话复核：65/65 web-remote 测试、全量 541/5/1、VAPID 私钥与订阅仅存本机、新增依赖 `web-push`（MPL-2.0）。
- C2：每周版本检查任务增加“上游新增未分级 IPC 通道”检查，并按 tag 提交时间判断最新正式版本。
- C3：新增使用说明 `docs/personal/web-remote.md`。
- 合并到 `personal`。手机完整客户端正式版计划（A/B/C）全部完成。


## 2026-09-26: 同步官方 v0.19.58

- 在 `sync/2026-09-26` 基于 `personal` 合并官方 `v0.19.58`（基线提交 `f20943edd047ecdc929df67de9412d6e58cd4312`），唯一冲突为 `apps/electron/src/renderer/components/settings/ChannelForm.tsx`。新建列表不含 GitHub Copilot、编辑已有 Copilot 渠道时动态追加回显逻辑保留；同时完整应用上游移除 OpenCode Go 与火山方舟套餐的目录改动。与 tag 对比，`ChannelForm.tsx` 仅保留这项个人版 Copilot 差异。
- 自动合并复核：README 中英文个人 Fork 区块保留、`agent-orchestrator.ts` 延续个人版移除内置浏览器并保留 EgoBrowser、`DiffPanelTabBar.tsx` 移除上游浏览器入口、`packages/shared/src/types/agent.ts` 保留 Web Remote 增量。Electron 包版本为 `0.19.58`。
- Pi 运行时从 `0.86.1` 升至 `0.87.1`；`pi-ai` 补丁改为 `patches/@earendil-works%2Fpi-ai@0.87.1.patch`。`bun install` 成功，四个 `@earendil-works/pi-*` 包均解析为 `0.87.1`，补丁版本登记且已应用。为消除上游类型收窄后的编译错误，Pi provider 判断去掉已退休 `doubao` 类型、渠道迁移清理仍用字符串识别历史套餐类型、Logo 映射移除已退休的 `ark-coding-plan` 与 `doubao` 项。
- 渠道配置迁移 `v5 → v7`，只清除上游已退休的 OpenCode Go 与火山方舟套餐记录。开发实例 `~/.proma-dev/channels.json` 为 version 7；与迁移前 `/tmp/channels-before-sync.txt` 对比，9 个渠道的名称、provider、enabled 三元组完全一致。上游候选更新器另为 ChatGPT 订阅 (Codex) 渠道追加 2 个 GPT-6 候选模型；没有改动渠道标识、端点或凭据。IPC 分级日志显示覆盖率 100%（invoke=370、event=8）。未读取或修改正式数据目录 `~/.proma`。
- 验证：`bun run typecheck` 通过。全量 `bun test` 为 541 pass / 5 fail / 1 error（546 tests），与给定基线完全一致；既有问题为 Electron `dialog`/`shell` mock 导出、OAuth proxy scope、proxy-settings-service 测试导出以及 planning-manager 测试中的 Electron binary 类型。`build:main`、`build:agent-runtime`、`build:preload`、`build:renderer`、`build:web-preload` 均通过；renderer 保留既有大 chunk 警告。
- 真实 Agent 回归：隔离新建会话分别使用 clipproxyapi 主渠道与 ChatGPT 订阅 Codex 渠道完成“只回复 pong”；Pi 0.87.1 运行正常。另一次 Agent 调用确实观察到 `EgoBrowser` 工具调用，打开 `https://example.com` 并返回标题 `Example Domain`。
- 手机 harness：Android 与 iPhone UA 的 `--suite smoke` 均通过；两种 UA 的 `--suite attachments` 均通过文本附件首行提取、PNG 识别主色及 Markdown 附件链路。iPhone 首次运行的图片答案为小写 `red`，旧 harness 的大小写敏感检查误报；在临时大小写无关检查下复验通过，随后还原 harness 源文件。全部 harness 设备已撤销、临时 Chrome 已退出且 profile 已删除；每次 harness 创建的专用会话都已删除，既有会话清单前后未变。运行中可见音效预加载 XHR 错误，但 JavaScript exceptions 为 0，未影响验证。
- 本次仅提交同步分支，不 push、不合并到 `personal`；没有停止/手动重启开发实例、改 Web Remote 配置或用户设备，也未触及官方应用或 Tailscale。

## 2026-09-26: 回退手册与数据完整性修正

- 新增 `docs/personal/fallback-runbook.md`：供 Claude Code 在个人版不可用时诊断、回退应用、恢复数据、从源码重建。
- 父会话发现 C1 的服务端默认把推送密钥写到 `getWebRemoteDataDir()`，在测试环境会解析为官方 `~/.proma`，留下 `~/.proma/web-remote/vapid.json`（已移至 /tmp，官方版不读取该文件）；已改为复用 auth 数据目录（`001aada3`），全量测试后确认不再生成。
- `proma-backup` Skill 的 zip 改为 `-y` 保留符号链接（`~/.proma` 内约 50 个 Skill 链接，此前会被展开成副本）。

## 2026-09-26: 切换准备 P1–P3

- P1：新增包内 `personal-build.json`（personal、版本、commit、builtAt）；个人版启动时跳过 electron-updater 初始化、官方检查/下载/安装与空闲安装调度，设置页显示“个人版由维护流程更新”。个人构建 afterPack 清除可能由 electron-builder 生成的 `app-update.yml`；官方构建不写个人标记。`package-personal.sh` 执行依赖安装、typecheck、受基线约束的全测、完整 Electron build、macOS arm64 目录打包与 ad-hoc 签名。
- P1 Web Remote：个人版打包标记允许正式数据目录仅由 `web-remote/config.json` 的 `enabled` 控制启动，不再要求环境变量；开发实例仍需既有环境开关，官方打包版无论环境 override 均拒绝。桌面管理 IPC 仅允许个人版正式包 `file://` 渲染页或开发实例桌面页。
- P2：新增 `install-update.sh`，参数化应用目录、数据目录与备份根目录，支持超时等待（不杀进程）、cp -a 备份 + 完整性校验、previous 轮换、启动/健康检查和应用自动回滚；不自动还原用户数据。`--dry-run` 不写入，`--test-mode` 用于隔离假包成功路径，`--simulate-health-failure` 用于回滚演练。
- P3：新增 `verify-backup.py`，逐文件比较文件数、大小、SHA-256、类型/链接目标与权限，支持目录/zip 和重复 `--exclude`。导入器改为字节流式替换 >50 MB 与非 UTF-8 文件中的 `.proma` 路径，保留 zip 符号链接；SQLite 仍仅修改导入副本。导入完成后生成内容完整性清单并运行完整性及原安全/配置校验。此前 2026-09-24 记录的“大文件/非 UTF-8 跳过”是已修复的旧状态。
- 验证（提交 `ff39f31d` 后实际运行 `bash scripts/personal/package-personal.sh`）：Bun 1.4.2 `bun install` 成功；typecheck 通过；全量测试 546 pass / 5 fail / 1 error，相对既有基线 541/5/1 增加 5 个通过测试、失败和错误数未增加；全部 Electron build 成功（含 web preload、CLI 与 native helpers；renderer 有既有的大 chunk 警告）。
- 打包产物：`apps/electron/out/mac-arm64/Proma.app`，版本 `0.19.58`，`appId=com.proma.app`，架构 arm64；包内 marker 为 `personal=true`、`version=0.19.58`、`commit=ff39f31d982c511f046a6ecad5008700cefd7271`、`builtAt=2026-09-26T13:30:36.688Z`。`Contents/Resources/app-update.yml` 不存在。`codesign -dv` 确认为 `Signature=adhoc`、`TeamIdentifier=not set`。本地 ad-hoc 签名不代表 Apple Developer 身份签名，也没有公证；此目录包没有启动。
- /tmp 集成演练：临时假包成功安装路径退出 0，回滚演练用 `--simulate-health-failure` 退出 4 并还原原假应用，数据保持未自动还原；没有触及默认应用/数据目录。导入实测 52,428,825 字节文件与非 UTF-8 文件路径改写、符号链接保留、SQLite 文本字段改写，3 处路径替换，完整性/安全校验通过。verify-backup 目录与 zip 均 PASS，人工篡改 alpha.txt 时按预期退出 1。
- `verify-backup.py ~/.proma-dev <临时 cp -a 副本>` 只读自检 PASS：77 MiB，2,997 条目，missing/extra/mismatch 均为 0。未读取或写入 `~/.proma`，未访问 `/Applications/Proma.app`，未启动打包产物、停止开发实例或操作官方进程；未 push。

## 2026-09-26: P1–P3 外部复核修复

- 原子安装：安装脚本在任何 app bundle 改名之前安装 EXIT/ERR/INT/TERM 处理；新包先复制到同卷 `.Proma.installing-<时间戳>.app`，校验 marker 完整一致后才 `mv` 到 `Proma.app`。健康失败时先对本次跟踪的新进程及其子进程发送 SIGTERM，最多等待 20 秒，再保留失败包为 `Proma.failed-*.app` 并恢复 `Proma.previous.app`；不会使用 `pkill`/`killall`。新增 `--simulate-copy-failure`，仅在 `/tmp` 的 `--test-mode` 演练。
- 健康校验：默认观察 60 秒；安装前检查 17888（以及配置启用时的自定义端口）是否被非应用进程占用；安装后验证端口监听 PID 可执行路径属于本次 app。新增 `health-snapshot.py`，比较配置版本、会话数、Automation `id→active`、渠道 `id→name/provider/enabled`、符号链接数和 `planning.db` user_version。更新前后快照只写入时间戳备份目录外层；`proma/` 副本保持 `cp -a` 原样，不写入 object-counts 或 `.personal-migration`。后者是备份导入器写入其导入目标的迁移清单，不是更新备份的附加文件。
- 日志复核：源码原先没有 electron-log 或主进程文件 transport，`app.getPath('logs')` 只用于显示路径。个人版现写入 `app.getPath('logs')/main.log`（macOS 默认 `~/Library/Logs/Proma/main.log`），最大 5 MiB、保留 3 份轮转，0600 文件权限；日志仅记录 startup/error/fatal 分类，不写错误对象或消息详情，避免泄露密钥。
- 完整性预设：`verify-backup.py --preset proma-backup` 对目录和 zip 同步排除 `.DS_Store`、`*.lock` 与 `__MACOSX`，也保留自定义 `--exclude`。
- 安装脚本的成功、模拟健康失败、模拟 staging 复制失败三种演练均使用 `/tmp` 临时应用与数据目录：成功退出 0 并切换假包；健康失败退出 4、恢复旧假包并保留 `Proma.failed-*.app`；复制失败退出 7、旧假包始终未移动且 partial staging 被清理。各自的 `proma/` 副本都经完整性校验无差异，快照/统计只写在时间戳目录外层。没有接触 `/Applications/Proma.app`、`~/.proma` 或官方进程；未 push。
- 验证：`bun run typecheck` 通过；新增个人日志单测与 P1/Web Remote 测试共 6 pass / 0 fail；集成脚本中的语法检查、备份预设目录/zip 校验、导入和三种安装演练全部通过。最终运行 `package-personal.sh` 的全量测试为 547 pass / 5 fail / 1 error，相对记录基线 541/5/1 增加 6 个通过测试，失败/错误数相同；全部 Electron build（含 web preload、CLI/native helpers）与实际 arm64 目录打包通过。曾有一次 `pi-ego-browser-tool` 测试超过 5 秒导致 6 fail / 2 errors，立即重跑恢复到基线 5/1；测试脚本现正确解析 Bun 的 `errors` 复数总结，不会漏报。
- 新产物：`apps/electron/out/mac-arm64/Proma.app`，`0.19.58` / `com.proma.app` / arm64，marker commit `4601e74a74051183fda00c3dab06254a2e41e372`，`builtAt=2026-09-26T14:09:45.267Z`；`app-update.yml` absent，`codesign` 显示 adhoc、无 Team ID。未启动产物。主进程原先无文件日志 transport：`app.getPath('logs')` 仅被用于展示位置，无 electron-log；现已加入限量轮转、事件级脱敏的 `main.log`。macOS 默认路径为 `~/Library/Logs/Proma/main.log`，本批未启动应用实测该绝对位置。

## 2026-09-26: 切换准备复核、切换手册定稿与交接

- 父会话复核 P1–P3 与复核修复：typecheck 通过；全量测试 547 pass / 5 fail / 1 error（基线内）；`/tmp` 三种安装演练（成功、健康失败回滚、复制失败）亲自复跑通过；打包产物 `personal-build.json`、无 `app-update.yml`、ad-hoc 签名已核对；`health-snapshot.py` 在正式数据上只读运行正常（不含密钥）。合并 `7751fec7`。
- 用户决定：**不做真实数据预演（P5），直接切换**；失败回到官方版，由 Claude 恢复。首次启动验收承担预演职责。
- 新增 `docs/personal/switch-runbook.md`（定稿）；fallback-runbook 补“先判断阶段”、恢复前检查、Keychain/定时任务/桥/手机访问排错；CLAUDE.md 增加切换手册与职责交接说明。
- 已知：调度器启动时顺延过期任务，切换期间错过的定时任务不补跑。
- 交接：此后切换与维护由 Claude Code 负责（见 CLAUDE.md）。

## 2026-09-26: 切换为日常主力

- 执行者：Claude Code 主会话（判断、复核、安装）+ Sonnet 5 子代理（打包、外置硬盘备份），用户在场；依据 `docs/personal/switch-runbook.md`。安装版本 `0.19.58`，包内 marker commit `bf63f7db47c623b5a826b6f5420af6af09850437`，`builtAt=2026-09-26T14:47:16.454Z`，ad-hoc 签名、无 Team ID，`app-update.yml` 不存在。
- 时间窗口：22:43 开始，不在手册 10:00–12:00 / 14:00–17:00 窗口内；用户明确豁免。依据：Phase A（03:20）与 Phase B（03:51）当天已运行（用户在官方版确认），无运行中任务，下一个任务 02:00。另记：Phase B 实际计划时间为 05:50，手册写的 04:50 与数据不符。
- 打包：首次 `package-personal.sh` 测试为 6 fail / 2 error，超基线中止；新增项为 `web-remote-bundle.test.ts` 在高负载（load ≈ 6，官方版与开发实例同时运行）下超时 5006 ms 及其派生 unhandled error。单独重跑 3 次均通过（冷启动 4.79 s）。重跑打包 547 pass / 5 fail / 1 error，与基线一致，退出 0。
- 切换前快照 `~/.proma-switch-backups/pre-switch-snapshot.json`：会话 868、Automation 23（启用 20）、渠道 9、符号链接 50、planning `user_version` 9、格式版本 channels 7 / agent-sessions 2 / automations 4。
- 外置硬盘备份 `proma-backup-20260926-2250.zip`（1.4G）。手册命令 `verify-backup.py --preset proma-backup` 对该 zip 失败：85 个中文文件名以 UTF-8 字节存储但未设置 zip 的 UTF-8 标志（0x800），Python `zipfile` 按 cp437 解码成乱码，报为 missing/extra。用临时包装脚本（复用原比较逻辑，仅对无该标志的条目做 cp437→UTF-8 还原）复验：20,750 / 20,750，missing/extra/mismatched 均 0，`BACKUP VERIFY PASS`。备份本身完好；安装脚本的目录备份校验不受影响。
- 手机访问：`~/.proma-dev/web-remote/` 的 `config.json`、`devices.json`、`vapid.json`、`push-subscriptions.json` 复制到 `~/.proma/web-remote/`（700/600，逐字节一致）；未复制 `pairing.json`。Tailscale Serve 未改。
- 第一次安装失败并自动回滚：`install-update.sh` 默认 `LOGS_DIR=~/Library/Logs/Proma`，但 macOS 下 `app.getPath('logs')` 取自 package.json 的 `name`（`@proma/electron`），个人版实际日志为 `~/Library/Logs/@proma/electron/main.log`。脚本 15 秒内找不到日志即判失败，未执行后续 60 秒观察、快照、端口检查；已结束新版进程并还原官方版，失败包保留为 `/Applications/Proma.failed-20260926-225616-72208.app`。回滚后快照与切换前 `SNAPSHOT MATCH`，数据未受影响。同时更正 2026-09-26「P1–P3 外部复核修复」记录中的默认日志路径。
- 第二次安装（经用户同意重试一次）：`--logs-dir ~/Library/Logs/@proma/electron --health-seconds 120`，退出 0。安装前备份 `~/.proma-switch-backups/20260926-230027-73361/`（20,818 项校验 PASS）；120 秒观察内进程存活、无 `[FATAL]`、快照一致、17888 由新版进程监听。官方版已改名 `/Applications/Proma.previous.app`（0.19.58，无个人版标记）。
- 首次启动验收：主会话复跑切换前后快照 `SNAPSHOT MATCH`（`post-switch-snapshot.json`）；用户在个人版中逐项验收通过（会话与大会话、渠道对话、Todo/日程/定时任务、桥接、Skills/MCP、EgoBrowser、关于页、手机访问与通知）。Keychain 首次弹窗用户选择“允许”（非“始终允许”），后续启动可能再次询问。
- 修复（本分支）：`install-update.sh` 默认日志目录改为 `~/Library/Logs/@proma/electron`；`CLAUDE.md`、`switch-runbook.md`、`fallback-runbook.md` 同步更正。
- 遗留事项：
  - 收尾第 7 步待用户逐项确认：官方版 `ditto` 存档到外置硬盘、官方更新缓存移入 `~/.proma-switch-backups/`。
  - `verify-backup.py` 读取 zip 时需对未设 UTF-8 标志的条目还原文件名（另开分支修复并补测试）。
  - `/Applications/Proma.failed-20260926-225616-72208.app` 保留，观察期后经用户确认移出。
  - 观察期（3–7 天）：定时任务成功率、飞书/微信桥、手机访问、`main.log`；fc-bridge 由用户在应用内重新配置；“Google 收录完成度监测（每周）”提示词改为只用 ego-browser（需用户确认）。观察期通过后 `Proma.previous.app` 移到 `~/.proma-switch-backups/`。

## 2026-09-26: 切换收尾与 verify-backup zip 文件名修复

- 收尾（用户同意）：官方版 `Proma.previous.app` 以 `ditto` 存档到外置硬盘 `official-Proma-0.19.58-20260926.app.zip`（244 MB，2,769 文件，`unzip -t` 无错误），应用本身观察期内仍留在 `/Applications`；官方更新缓存 `com.proma.app.ShipIt`、`cool.proma.app.ShipIt`、`@promaelectron-updater`（224 MB）移入 `~/.proma-switch-backups/updater-caches-20260926/`，未删除。
- `verify-backup.py`：新增 `restore_filename()`，对未设置 0x800 标志的 zip 条目做 cp437→UTF-8 还原后再参与排除规则与比较；`archive.open()` 仍用原始 ZipInfo。`test-personal-scripts.py` 增加中文文件名 + 符号链接的 macOS `zip -r -y` 用例（校验通过、篡改后失败）；去掉修复时该用例失败，证明能捕获该问题。
- 验证（主会话复跑）：`test-personal-scripts.py` 退出 0；用修复后的仓库脚本校验真实外置备份 `proma-backup-20260926-2250.zip` 对比安装前冻结目录备份 `20260926-225616-72208/proma`（`--preset proma-backup`，排除之后才迁入的 `web-remote/`）：20,750 / 20,750，missing/extra/mismatched 均 0，`BACKUP VERIFY PASS`。
- 仍待办：观察期检查；fc-bridge 重配；“Google 收录完成度监测（每周）”提示词第 4、11 行改为只用 ego-browser（用户在应用内修改）；观察期后移出 `Proma.previous.app` 与 `Proma.failed-20260926-225616-72208.app`。

## 2026-09-26: 安装版手机访问两处修复（切换当晚）

- 更正：「切换为日常主力」记录中“用户逐项验收通过（…手机访问与通知）”不准确。切换后手机 `/app/` 在安装版上实际不可用，以下两处缺陷均只在安装包出现（此前手机测试都在有源码的开发实例上，P5 真实预演被跳过，未能提前暴露）。
- 缺陷 1：`web-remote-server.ts` 的 `ensureWebPreload()` 用 `dist/web-remote/preload.js` 与源文件 `src/preload/index.ts`、`web-electron-shim.ts` 比较 mtime；安装包只含产物、没有源文件，判定恒为过期，随后走开发模式 `spawnSync('bun')` 重建，报 `ENOTDIR`，手机显示“手机界面暂不可用”。修复（`987ad33f`，合并 `22d69abe`）：源文件不存在时视为安装包，产物存在且非空即就绪，缺失则提示重新打包，绝不在安装包内重建；开发实例逻辑不变。新增 2 个用例（撤掉修复时失败）。
- 缺陷 2：`full-ui/prepare.ts` 的 `prepareWebRemoteFullUi()` 仍要求 `.proma-dev` 数据目录与 `PROMA_WEB_REMOTE=1`，安装包从访达启动两者皆无，IPC 桥未安装，`/api/ipc` 被 `1013 full-ui disabled` 关闭，手机卡在“正在启动 Proma”。P1 只改了服务器启动判定，漏改此处。修复（`06f3d910`，合并 `29e7a81e`）：新增 `runtime.packaged` 参数，`app.isPackaged && isPersonalBuild()` 时只看 `config.enabled && config.fullUi`；开发实例两道门不变。新增 3 个用例（撤掉修复时首个用例得到 null）。已排查 web-remote 其余开发实例限定判断，均已识别个人版安装包。
- 验证：全量测试 552 pass / 5 fail / 1 error（基线 547/5/1 + 5 个新用例），typecheck 通过；两次打包均退出 0，主会话在 asar 内 `main.cjs` 确认修复代码存在。两次安装（23:32、23:51）均通过安装脚本健康检查，主会话复跑快照与切换前 `SNAPSHOT MATCH`。最终安装版 marker commit `29e7a81e`，安装前备份 `~/.proma-switch-backups/20260926-235153-90861/`。用户用两台手机验收通过（`/app/` 进入完整界面、发消息收到实时回复、通知）。
- Google 收录完成度监测（每周）：用户经 Proma 定时任务接口（运行中的应用写入）将提示词第 4、11 行改为只用 ego-browser；主会话只读复查确认，任务仍启用，第 18 行不变。
- 当前 `/Applications`：`Proma.app`（个人版 `29e7a81e`）、`Proma.previous.app`（个人版 `22d69abe`，手机卡启动页）、`Proma.previous.20260926-235153-90861.app`（个人版 `bf63f7db`，手机不可用）、`Proma.previous.20260926-233222-86078.app`（官方版 0.19.58）、`Proma.failed-20260926-225616-72208.app`（首次失败包，同 `bf63f7db`）。整理方式待用户决定。

## 2026-09-26: 整理旧版应用

- 经用户同意：`/Applications` 只保留当前个人版 `Proma.app`（`29e7a81e`）。三个旧个人版（`22d69abe`、`bf63f7db`、首次失败包 `bf63f7db`）手机端均有缺陷且可从已推送提交重建，移入废纸篓（`~/.Trash/Proma-personal-22d69abe.app`、`Proma-personal-bf63f7db.app`、`Proma-failed-bf63f7db.app`），未清空。
- 官方版 0.19.58（Team ID `55P2K523PB`）移出 `/Applications`，存放于 `~/.proma-switch-backups/official-Proma-0.19.58.app`，避免同名同 ID 被 Spotlight 或链接误启动并自动更新；外置硬盘 `official-Proma-0.19.58-20260926.app.zip` 保留。回退官方版的位置已写入 fallback-runbook §3 第 4 步。下次安装更新时，安装脚本会重新生成 `Proma.previous.app`（上一版个人版）。

## 2026-09-27: 切换后文档对齐与 SSOT 规则

- 用户要求：以后所有修改遵循 SSOT 规则；每次安装后在安装版上做手机验收。
- `CLAUDE.md`：新增 §7「文档规则（SSOT）」（权威位置划分、变更记录只追加、影响权威内容时同一提交内同步更新、验证结果直接写入、快照与 SSOT 冲突以 SSOT 为准），原 §7 汇报改为 §8；§6 新增第 7 项「安装版手机验收（每次安装后必做）」，其后编号顺延；§2 关键位置补“安装版手机访问配置 `~/.proma/web-remote/`”。
- `PERSONAL.md` 差异清单：“远程网页（实验）…不打包进安装版”已过时，改为安装版由 `~/.proma/web-remote/config.json` 控制的当前行为。
- `docs/personal/web-remote.md` §2：运行实例、启动开关、数据目录改为安装版与开发实例两种情况，新增端口冲突说明。
- 待用户在 Proma 内修改（定时任务在 `~/.proma`，不入库）：“Proma 个人版 · 官方版本周检（只读）”第 3 步仍按官方版读取 `/Applications/Proma.app` 版本，应改为读取 `personal-build.json` 并与 `personal` HEAD 对比；第 4 行“个人版版本必须不低于官方已安装版本”改为“只看最新官方正式 tag 与个人版基线”。

## 2026-09-27: 周检任务切换后改写（复查）

- 用户经 Proma `update_automation` 修改“Proma 个人版 · 官方版本周检（只读）”（`updatedAt` 09-27 00:50，仍启用，下次 09-28 周一 09:30）。主会话只读复查提示词：
  - 第 4 行同步原则：改为个人版已接管 `/Applications/Proma.app` 与 `~/.proma`、官方版不再安装、只看最新官方正式 tag 与个人版基线。
  - 第 5 行 tag 异常规则：按 tag 所指提交的提交时间判断，已删除与官方已安装版本交叉核对的旧说法。
  - 第 3 步：读取 `personal-build.json`，确认 `personal=true`，记录 version/commit，用 `git log --oneline <commit>..personal` 与 HEAD 对比；落后提交区分“仅文档/脚本（`*.md`、`docs/`、`scripts/personal/`，无需重装）”与“应用代码（需打包安装）”；文件不存在即“⚠️ 需要关注：已安装的不是个人版”，按 fallback-runbook 处理。
  - 摘要触发条件：新正式版本、已安装的不是个人版、已安装构建落后于应用代码改动、数据格式/运行时变更、未分级 IPC 通道；报告与 `notes.md` 字段改为“已安装个人版构建 version+commit”。
  - 全文已无“官方已安装”“CFBundleShortVersionString”“交叉核对”“不低于官方”等旧说法。
- 实测当前差异：已安装 `29e7a81e` → `personal` HEAD 之间只改动 `CLAUDE.md`、`PERSONAL.md`、`docs/personal/fallback-runbook.md`、`docs/personal/web-remote.md`，按新规则应判为“仅文档，无需重装”。
- 待修正（用户在 Proma 内修改）：`apps/electron/default-skills/**/SKILL.md`（36 个文件）由 `electron-builder.yml` 打进安装包并在启动时同步到 `~/.proma/default-skills/`，改动需要重装；现规则“`*.md` 无需重装”会误判。建议改为：仅文档/脚本 = 仓库根目录 `*.md`、`docs/`、`scripts/personal/`；`apps/`、`packages/` 下任何文件（含 `default-skills` 的 Markdown）都算应用改动。

## 2026-09-27: 周检“是否需重装”分类修正（复查）

- 用户经 `update_automation` 修改周检第 3 步（`updatedAt` 09-27 00:55，仍启用，下次 09-28 09:30），主会话只读复查通过：仅文档/脚本（无需重装）= 仓库根目录 `*.md`、`docs/`、`scripts/personal/`；`apps/`、`packages/`（含 `apps/electron/default-skills/` 的 Markdown）、依赖清单、`patches/` 及其余路径一律算应用改动（需打包安装）。旧规则“`*.md` 无需重装”已不存在。
- 该规则偏保守（如根目录 `bun.lock`、`.github/` 也算应用改动），误报只会多提示一次重装，不会漏报。
- 上一条记录中的“待修正”项已完成。

## 2026-09-27: 开发实例手机访问改用 17889 + 8443 临时转发

- 用户选择方案：开发实例手机访问端口 17888 → 17889，同步验证时临时开 Tailscale Serve https 8443 → `127.0.0.1:17889`，结束后关闭；安装版 17888 ← 443 不变。
- 本地配置（不入库）：`~/.proma-dev/web-remote/config.json` 的 `port` 改为 17889、`allowedOrigin` 改为带 `:8443` 的地址（`normalizeOrigin` 使用 `URL.origin`，保留端口）；改前备份为同目录 `config.json.bak-20260927-port17888`；安装版 `~/.proma/web-remote/config.json` 未改（port 17888）。
- 端到端验证（主会话执行）：临时开启 8443 转发；`PROMA_WEB_REMOTE=1 bash scripts/personal/dev.sh` 启动开发实例，日志“full-ui 分级覆盖率 100%（invoke=370, event=8）”“已启动: 127.0.0.1:17889”；此时安装版（PID 90969）仍监听 17888，两者并存。`mobile-harness.mjs --url https://<主机名>:8443 --suite smoke --user-agent android` 退出 0：load、open-session、send-pong、MCP/Skills、Todo、定时任务、文件面板 7 步全部通过，JavaScript exceptions 0（22 条 console error 为既有音效预加载类）；测试设备已撤销、自建会话已删除、既有 5 个会话前后不变、临时 Chrome 与 profile 已清理；安装版设备数 199 不变。结束后停止开发实例（17889、5173 已释放）并关闭 8443 转发，Serve 只剩 443 → 17888。
- 文档：`CLAUDE.md` §6 第 6 项改为 17889/8443 流程并注明 harness 只对开发实例运行；`docs/personal/web-remote.md` §2 端口说明、转发命令与回归测试说明更新；本文件已知问题中的端口冲突标记为已解决。

## 2026-09-27: 手机主屏图标改用 Proma 真实 PNG

- 素材由用户提供（由 `apps/electron/resources/icon.png` 裁透明边、黑底铺满生成），放入 `apps/electron/resources/web-remote/`：`apple-touch-icon.png`(180)、`icon-192.png`、`icon-512.png`、`icon-512-maskable.png`，与源文件逐字节一致。
- 打包：`electron-builder.yml` 通用 `extraResources` 新增 `resources/web-remote` → `web-remote`（`*.png`）。运行时目录由纯函数 `resolveWebRemoteIconDir()`（`web-remote-policy.ts`）决定：安装包 `process.resourcesPath/web-remote`，开发实例 `dist/../resources/web-remote`；`web-remote-service.ts` 传入 `iconDir`。
- 路由：`/apple-touch-icon.png`、`/icon-192.png`、`/icon-512.png`、`/icon-512-maskable.png`，固定文件名白名单、公开、`image/png`、`Cache-Control: public, max-age=86400`，缺文件 404；登记进 `web-remote-push.ts` 路由表（`public-static`）。SVG 路由保留。
- 静态内容：manifest icons 改为 3 个 PNG（192/512 `any`，512-maskable `maskable`）；根配对页 apple-touch-icon → `/apple-touch-icon.png`；service worker 通知 icon/badge → `/icon-192.png`；favicon 仍为 SVG。主会话复核发现 `/app/`（renderer index.html）原本没有 manifest 与 apple-touch-icon 链接，Android 无法读取 manifest，已在 `getRenderedIndex()` 于 `</head>` 前注入 manifest、favicon、apple-touch-icon、`apple-mobile-web-app-capable`、`apple-mobile-web-app-title`、`theme-color`（各一次）。
- 验证：全量测试 557 pass / 5 fail / 1 error（基线 552/5/1 + 5 个新用例，撤掉实现时新用例失败）；typecheck 通过。打包 `041c148d` 退出 0，`Contents/Resources/web-remote/` 4 个 PNG 逐字节一致，asar 内 `main.cjs` 含新路由与 head 注入。安装（02:18）通过脚本健康检查；安装后本机回环请求 4 个路由均 200 `image/png` 且逐字节一致，manifest 为 3 个 PNG；用户两台手机重新添加主屏后验证通过。
- 数据快照：安装脚本自身前后快照一致。与切换前基线相比，会话 868 → 870（正常使用），另有定时任务“Nowledge Mem 每日追补（会话归档 + Working Memory）”于 09-27 01:54:07 由启用改为停用（`updatedAt`），早于安装、非安装所致，02:00 未运行；是否为有意操作待用户确认。
- 整理：上一版个人版 `Proma.previous.app`（`29e7a81e`）经用户同意移入废纸篓（`~/.Trash/Proma-personal-29e7a81e.app`，由用户清空）；此前三个旧个人版已不在废纸篓。`/Applications` 现只有 `Proma.app`（`041c148d`），官方版仍在 `~/.proma-switch-backups/official-Proma-0.19.58.app` 与外置硬盘 zip。下次安装更新时脚本会重新生成 `Proma.previous.app`。
- `~/.proma-switch-backups/` 现有 5 份更新前数据备份（约 17G，含官方版与缓存），均保留；清理需用户另行确认。

## 2026-09-27: 改为与 Proma 共同维护

- 用户决定：日常维护（周检评估、同步、测试、打包、文档、推送）由 Proma 完成；Claude Code 只在 Proma 必须退出（安装、替换应用）或无法工作（回滚、恢复）时接手，以节省 Claude Code token。
- 新增 `docs/personal/maintenance.md`：分工表、单写者规则（安装申请写出后 Proma 停止改仓库，直到安装结果写回；Proma 无法启动时 Claude Code 直接接手）、交接单目录与模板（`install-request-*.md` / `install-result-*.md`，位于 `~/.proma/.../.context/proma-personal/handoff/`，不入库）、Claude Code 接手安装时的复核项、双方共用的硬性规则（由 `CLAUDE.md` §4 迁入，新增“Proma 不得运行 install-update.sh”）与 SSOT 规则（由 `CLAUDE.md` §7 迁入）。
- `CLAUDE.md`：§1 必读新增 `maintenance.md` 与交接单目录；§3 职责改为安装、故障回滚、突发问题、用户直接要求；§4、§7 改为指向 `maintenance.md` 对应章节（规则只保留一份）；§5 新增“Proma 的安装申请按子代理报告对待、复核后才安装”。原“Proma 中控不再修改本仓库”的说法作废。
- 待 Proma 侧完成（不在仓库）：Proma 的工作说明引用 `docs/personal/maintenance.md`，打包后按模板写安装申请。仓库根 `AGENTS.md` 为上游文件，未修改，以免同步冲突。

## 2026-09-27: 清理本地分支；Nowledge 定时任务状态确认

- 经用户同意，用 `git branch -d`（只删已合并分支）删除 31 个已合并进 `personal` 的本地分支；本地只保留 `main`（官方镜像）与 `personal`。这些分支从未推送，GitHub 不受影响；提交均在 `personal` 历史中（同步记录表中的 `sync/2026-09-26` 现仅作名称引用）。
- 更正上一条“待确认”：定时任务“Nowledge Mem 每日追补（会话归档 + Working Memory）”09-27 01:54 的停用是用户本人操作，现已由用户重新启用，不影响个人版。

## 2026-09-27: README 个人版区块更新为日常主力

- `README.md` / `README.en.md` 个人版区块：由“个人测试、与官方并存、导入备份到 ~/.proma-dev”更新为“已作为日常主力（安装为 /Applications/Proma.app，使用 ~/.proma）”；新增个人版打包与更新（关闭官方自动更新、personal-build.json、安装脚本备份与回滚）、手机主屏 Proma 图标、每周检查官方 tag；使用说明改为打包/安装/开发实例，并链接 `maintenance.md`、`switch-runbook.md`、`fallback-runbook.md`。移除已不适用的 `import-proma-backup.py` 使用说明（脚本保留）。仅文档，无需重装。

## 2026-09-27: 切换后状态盘点

- 更正文首说明：官方版不在 `/Applications`（已存档于 `~/.proma-switch-backups/official-Proma-0.19.58.app` 与外置硬盘 zip），维护分工改指向 `docs/personal/maintenance.md`。
- 2026-09-26“仍待办”核对：“Google 收录完成度监测（每周）”已改为只用 ego-browser（09-26 23:15，经 `update_automation`）；`Proma.previous.app` 与 `Proma.failed-*.app` 均已不在 `/Applications`（`/Applications` 只有 `Proma.app`，`041c148d`）。
- 切换后首晚定时任务：Phase A（03:21）、Phase B（05:50）、超14天预警、Codex 守护、Product Analysis、AI 情报日报、Nowledge Mem 追补均成功。09-28 周一为首个周任务批次（周度回顾、Weekly、热点周报、周报、Google 收录、官方版本周检）。
- 本机电源：接电源时系统不睡眠（`pmset` AC `sleep 0`，显示器 60 分钟关闭），手机访问与定时任务不再依赖 Power Nap 唤醒；合盖仍会睡眠。
- 仍待办：观察期至约 09-30～10-03；fc-bridge 重配（`~/.proma/fc-bridge` 自 09-20 起未运行，早于切换）；`~/.proma-switch-backups/` 5 份更新前备份与官方版存档（约 17G）观察期后由用户决定是否清理；是否停用 3 个 Proma Cloud Skill 未决定。

## 2026-09-27: 切换期备份移到外置硬盘

- 用户同意：`~/.proma-switch-backups/` 中 4 份较早的更新前数据备份（09-26 22:56、23:00、23:32、23:51）、官方版 `official-Proma-0.19.58.app`、官方更新缓存 `updater-caches-20260926`，以 `ditto` 复制到外置硬盘 `/Volumes/Lexar ssd 2tb/proma 备份/switch-backups-20260926/`（APFS），逐项 `verify-backup.py --preset proma-backup` PASS（仅 `.DS_Store` 差异被排除），随后删除本机副本，释放约 14 GB。
- 本机保留：最新更新前备份 `20260927-021826-20863`（3.2 GB，供快速恢复）、`pre-/post-switch-snapshot.json`；`install-update.sh` 仍写入 `~/.proma-switch-backups/`。
- 恢复官方版或较早备份时从外置硬盘上述目录取用（fallback-runbook §1 已更新）。

## 2026-09-27: 安装脚本自动归档旧备份到外置硬盘

- `scripts/personal/install-update.sh`：安装成功（健康检查通过）后，除最新 `--keep-local N`（默认 1）份外，更早的 `~/.proma-switch-backups/20*` 更新前备份用 `ditto` 复制到 `--archive-dir`（默认 `/Volumes/Lexar ssd 2tb/proma 备份/switch-backups/`），`verify-backup.py --preset proma-backup` 通过后才删除本机副本；外置硬盘未挂载、目标已存在、复制或校验失败时一律保留本机副本并提示，不影响安装结果（该阶段关闭 ERR 陷阱与 `set -e`）。`--no-archive` 关闭；回滚路径不归档。`--test-mode` 默认不归档，显式归档目录也必须在 `/tmp` 内。取代原“超过 5 份仅提示”的逻辑。
- 验证：`bash -n` 通过；`scripts/personal/test-personal-scripts.py` 新增归档用例（不指定归档目录时本机保留 2 份；指定后本机只留最新 1 份、2 份归档且逐份与源数据校验一致；演练模式拒绝 `/tmp` 外归档目录），原有成功/健康失败回滚/复制失败三种演练仍通过。未对真实 `/Applications`、`~/.proma` 或外置硬盘执行。
- 文档：`docs/personal/fallback-runbook.md` §1 与 `CLAUDE.md` §2 备份位置更新。仅脚本与文档，无需重装（下次由 Claude Code 安装时生效）。

## 2026-09-27: 待办——手机端刷新按钮

- 用户需求：手机完整客户端（`/app/`，主屏 standalone 模式没有浏览器刷新手势/地址栏）增加“刷新”按钮；现在遇到界面卡住或连接断开只能退出 App 重新打开。下次更新（下一个 sync 或功能批次）时实现：放在移动端顶栏，行为为重新加载页面并重建 WebSocket 连接，需在 Android/iPhone standalone 下回归。属应用代码改动，需打包并由 Claude Code 安装。

## 2026-09-27: 修复右侧工作区 Tab 点击无效与 Agent 终端 Tab 不出现

- 用户反馈：桌面右侧工作区“文件/改动/Todo/定时任务”等 Tab 点击无反应，只能从左侧栏入口打开。
- 根因：`650e4953`（移除内置浏览器）误删两段非浏览器代码：① `SidePanel.tsx` `handleWorkspaceTabChange` 末尾的 `if (split) updateSplit(...)` 与 `onTabChange(tab)`，导致点击 Tab 不切换；② `RightSidePanel.tsx` 中同步 Agent 可见终端（`onAgentTerminalOpen/Close`）到右侧工作区的 effect（与浏览器 effect 相邻被一并删除），导致 TerminalExecute 打开的终端不出现 Tab。其余被删代码逐项核对，均为浏览器专用。
- 修复：两处恢复为 v0.19.58 原文（仅去掉浏览器行），`4e556323`。typecheck 通过；全量测试 557 pass / 5 fail / 1 error（基线内）。
- 属应用代码；用户选择与“手机端刷新按钮”等一起打包，由 Claude Code 统一安装。

## 2026-09-27: 手机端打磨（刷新按钮、单击、动效）

- `apps/electron/src/main/lib/web-remote/full-ui/mobile-patch.ts`：手机顶栏增加 42px“刷新”按钮并调用 `location.reload()`；左抽屉与遮罩淡入淡出；右工作区采用 display 按需挂载、双 requestAnimationFrame 触发 transform/opacity 过渡、关闭后延迟隐藏并禁用点击；补充触控按下反馈、无 hover 设备操作可见、减少动效偏好，以及捕获阶段过滤触摸后合成的 hover/mouse 事件。未改上游 renderer 组件。
- 根因代码证据：`LeftSidebar.tsx` 会话行由 `onMouseEnter` 同步更新 `rowHovered` 并触发 preview hover，DOM 行也含 `group` / `group-hover`；这与触摸后兼容 hover 改变 DOM、影响首击派发的假设吻合。实测单次 tap 前后成功率尚未取得：本机访问临时 Tailscale Serve `:8443` 的 TLS 连接失败（`SSL_ERROR_SYSCALL`），新加 harness 专项超时；它创建的临时配对设备已通过 `web-remote.sh revoke` 撤销，因此不能报告复现前后数值或声称该修复已实测通过。
- `scripts/personal/mobile-harness.mjs` 新增 `mobile-polish` 专项，计划统计刷新、单次切换工作区与会话成功率；此次因上述连接问题未运行成功。android/iphone smoke 与 attachments 未完成；截图目录 `/tmp/web-remote-polish/` 目前仅含开发日志与 PID 文件。
- 验证：typecheck 通过；`build:main`、`build:renderer`、`build:web-preload` 通过；全量 `bun test` 为 557 pass / 5 fail / 1 error，与记录基线一致。真机 Android/iPhone standalone、触控前后单次点击比例以及附件回归待后续验证。
- 影响文档：同步更新 `docs/personal/web-remote.md`。

## 2026-09-27: 手机端打磨复核与 iOS 模拟器实测（父会话）

- 复核 Luna `9d67860e` 时发现并修复两处缺陷：① `ensure()` 每次调用都把刷新按钮 `insertBefore` 到文件按钮前，自身又触发 subtree MutationObserver，形成无限循环，`/app/` 加载即冻结（`147c2ba1`，只在位置不对时移动）；② `@media (hover:none)` 强制显示侧栏行悬停操作按钮，但未隐藏被替换的时间标签，归档图标与时间重叠（`2026-09-27` 同分支提交，移除该规则，恢复原样式）。
- Luna 报告的 8443“TLS 错误”实为本机系统代理（Clash 7897）拦截 tailnet 地址：bun/harness 需去掉代理环境变量运行；用户已在 Clash Verge 系统代理绕过中加入 `*.ts.net`、`100.64.0.0/10`，此后本机工具与 iOS 模拟器 Safari 可直连 tailnet。
- Level 2 模拟器工具：Homebrew 的 `idb-companion`、`axe` 公式要求 Xcode 27（本机 Xcode 26.5），未升级 Xcode；改为下载 AXe v1.8.0 官方发行包（Developer ID 签名）到 `~/.local/share/axe`，`~/.local/bin/axe` 链接；Proma 工作区新增 MCP `mobilebuildmcp`（`npx -y mobilebuildmcp@latest mcp`，握手通过）。
- iOS 真实 WebKit 实测（iPhone 17 Pro 模拟器 · iOS 26.5 · Safari，开发实例 17889 经临时 8443）：配对成功；`/app/` 正常加载；侧栏单击切换会话 4/4 成功（含跨工作区），切换后侧栏自动关闭；刷新按钮单击重新加载；右侧面板滑入淡入、左侧抽屉与遮罩过渡正常（录屏 `~/Downloads/proma-mobile-animations.mp4`）；侧栏时间标签无重叠。未做修复前版本的对照测试。
- Chrome 模拟回归（去代理运行）：android/iphone smoke 各 7 步全过、android attachments 通过、刷新按钮单击 android/iphone 通过，JS exceptions 0；harness `mobile-polish` 套件的“工作区切换”判定条件有误（侧栏工作区为展开/折叠分组，不会改 `agentWorkspaceId`），以模拟器实测为准，待修正 harness。清理：harness 设备均撤销、自建会话删除、残留 headless Chrome 已按 PID 结束。
- 验证：typecheck 通过；全量 557 pass / 5 fail / 1 error（基线内）；build:main / renderer / web-preload 通过。本批（含右侧 Tab 修复 `4e556323`）为应用代码，需打包安装。

## 2026-09-27: 手机顶栏图标化与右侧面板 Tab 点击修复（模拟器验证）

- 顶栏菜单/通知/刷新/文件按钮改为内联图标（40px，保留可访问名称）`b0f04a81`。
- 右侧面板 Tab 左半部分点不动的根因：桌面右侧面板左边缘的列宽拖拽条是面板直接子元素，手机注入层 `[data-web-remote-panel="right"] > * { width:100% }` 把它拉满全宽成为透明遮罩（阶段 A 起即存在）；手机端隐藏 col/row-resize 拖拽条。另修复 Luna 动效改动的缺陷：面板关闭时写入的内联 `pointer-events:none` 在重新打开时未清除。新增 harness `panel-probe` 套件（报告每个 Tab 中心点实际命中的元素）。`ebd502a8`。
- 验证：panel-probe 4/4 命中目标；iOS 模拟器 Safari 点“改动”“文件”Tab 均切换。用户决定（选项 B）：与下一批“手机端布局适配”一起打包安装，本批先合入 personal 保留。

## 2026-09-27: 手机端布局适配

- `apps/electron/src/main/lib/web-remote/full-ui/mobile-patch.ts`：手机端隐藏右侧整行 Tab / 分屏 / 新建标签栏；顶栏标题以下拉形式列出现有 Tab，并代理原 Tab 的切换/关闭，不新增独立状态；面板开关统一以 `body[data-web-remote-right-open]` 同步 📁/✕ 与可访问名称（名称保留“文件”）；记忆文件、文件预览、Automation 表单及 MCP/Skills 详情改为适合手机的全宽视图；输入字号至少 16px、工具区和交互按钮满足触控高度、隐藏快捷键徽标/拖拽提示/附加文件夹；记忆绝对路径显示末两级并支持点开。顶栏开关图标使用显式 `data-icon-state`，标题按 label、Tab 菜单按签名更新；observer 回调链中同步右面板的 style/dataset 写入均改为状态变化时更新，避免 SVG 序列化比较和重复 DOM 写入造成主线程死循环。CSS/注入 JS 相对 `cdaefafd` 分别增加 5,532 B / 4,144 B；无新增依赖，媒体规则仅作用于 `max-width:767px`，桌面布局不变。
- 上游标记（共 9 个 renderer 文件）：`DiffPanelTabBar.tsx` 标记需手机隐藏的 Tab bar；`WorkspaceMemoryTab.tsx` 标记记忆列表/详情/路径及返回按钮；`PreviewTabContent.tsx` 标记预览详情与返回文件列表；`AutomationFormView.tsx` 标记表单详情；`AgentSkillsView.tsx` 标记工具条和搜索框；`McpDetailView.tsx`、`SkillDetailView.tsx` 标记详情与返回；`SidePanel.tsx` 标记拖拽提示；`FileDropZone.tsx` 标记附加文件夹区域。上游组件改动均只增加手机布局所需的 data 属性/返回控件，无功能状态移交。
- `scripts/personal/mobile-harness.mjs` 新增 `layout` 套件：每页截图、检查 document 与右面板横向溢出、对当前页可见交互元素用 `elementFromPoint` 检查可点性；逐项包含文件、改动、Todo、定时任务列表/详情、MCP/Skills 列表/详情、项目记忆列表/详情。增加默认 300 秒整体超时（`--timeout-ms` 可覆盖）、每次 CDP evaluate 前 3 秒页面探活（失败报告 `page_unresponsive`）；超时记录就绪态/最近步骤并进入设备、会话、Chrome 与 profile 清理流程。harness 外层另用 420 秒 alarm 兜底。
- 验证：`bun run typecheck` 通过；`build:main`、`build:renderer`、`build:web-preload` 通过；`node --check scripts/personal/mobile-harness.mjs` 通过；`bun test` 557 pass / 5 fail / 1 error，与基线一致。最终 layout iphone 与 android 均 11 页通过，所有页面 `scrollWidth=innerWidth=412`、面板内无横向溢出、命中检查 0 miss；panel-probe iphone 两项均命中；smoke android/iphone 各 7 步通过；attachments android 通过；mobile-polish android/iphone 刷新与单击会话切换各 2/2。mobile-polish 中“工作区切换”检查明确跳过：侧栏工作区名是折叠分组，不会改变 `agentWorkspaceId`，原断言不适用。
- 截图：`/tmp/web-remote-layout/layout-iphone-verified/`、`layout-android-verified/`、`panel-probe-verified/`、`smoke-android-final/`、`smoke-iphone-final/`、`attachments-final/`、`mobile-polish-android-final2/`、`mobile-polish-iphone-final/`；iPhone 17 Pro 模拟器 WebKit 刷新后截图 `/tmp/web-remote-layout/sim-refresh-verified.png`。所有最终 harness 运行均撤销配对设备、删除 harness 自建会话、退出 Chrome 并移除 profile；开发实例与临时 8443 保持运行供用户体验。
- 基线修复保留：逐段核对 `git diff cdaefafd -- apps/electron/src/main/lib/web-remote/full-ui/mobile-patch.ts`，本次只叠加新的 CSS/数据驱动下拉逻辑；原 `handleWorkspaceTabChange`/终端同步效果、刷新按钮循环防护、触屏 hover 拦截、左右面板动效与同步、隐藏拖拽条、顶栏图标、侧栏时间标签规则均保持不变。
- 文档：同步更新 `docs/personal/web-remote.md`。仅应用代码与验证工具，无版本、数据格式或运行时依赖变化；尚未合并、打包、推送或安装，留待用户在模拟器体验后决定。

## 2026-09-27: 手机端布局适配——父会话复核与补修

- 复核 Luna `67a7a219`：cdaefafd 已完成修复全部保留（刷新防循环、触屏 hover 拦截、面板重开清除 pointer-events、隐藏拖拽条、顶栏图标、右侧 Tab/终端同步）；observer 回调链内 DOM 写入均以状态标记判定（开关 `dataset.iconState`、标题 `dataset.label`、下拉 `dataset.signature`）。此前 Luna 版本曾因比较 SVG innerHTML 造成死循环、页面冻结（父会话定位后回退给 Luna 修复），harness 现有整体超时（默认 300s）与 3 秒 CDP 探活。
- iOS 模拟器自检发现并补修（`0cb12d32`）：页面下拉在右侧面板关闭时选择不会打开面板；侧栏“项目记忆/日程”不打开右侧面板（未在转发名单）；定时任务列表标题仍截断（加 `data-web-remote-automation-title` 标记，手机端两行显示）。
- 回归（去代理）：iphone panel-probe 文件/改动命中、smoke 7 步、mobile-polish 3 项、layout iphone/android 11 页均通过，JS exceptions 0，无残留 Chrome。等待用户在 iOS 模拟器体验确认后再合并打包。

## 2026-09-27: 手机端布局适配——用户模拟器体验通过

- 用户体验后补修：记忆详情可上下滚动（详情保持 flex 列布局）；手机端隐藏全部快捷键徽标（`ShortcutKeycaps` 加 `data-shortcut-keycaps` 标记，另隐藏会话快速切换提示）；记忆长路径改用 RTL 省略显示末尾（避免 React 重渲染覆盖），`c5e53baa`。左上角菜单按钮改为开/关切换，图标随侧栏状态变化（状态标记，无 observer 写循环），`897a2b41`。
- 用户在 iOS 模拟器体验确认（22:29）。合并前核对 cdaefafd 修复全部保留；全量 557 pass / 5 fail / 1 error（基线内）；harness smoke、mobile-polish、panel-probe、layout 通过。

## 2026-09-27: 安装 c6c27d02（桌面 Tab 修复与手机布局适配）

- 依据 Proma 安装申请 `install-request-2026-09-27-2.md`（取代已撤回的 `-2026-09-27`），安装结果见交接目录 `install-result-2026-09-27-2.md`。首次按“共同维护”流程执行。
- 复核（`maintenance.md` §3）全部通过：marker commit = `personal` = `origin/personal` = `c6c27d02`；adhoc 签名校验通过；无 `app-update.yml`；打包测试 557/5/1（= 基线）；申请列出的 6 个代码标记与 4 个 PNG 均在包内。
- 规则冲突处理：本次包含的 `install-update.sh` 旧备份归档（`6175266a`）会在校验后删除本机备份副本，与 `maintenance.md` §4“绝不删除备份”冲突；经用户同意允许，§4 新增唯一例外条款（仅限安装脚本、校验通过后删除本机副本；其他删除备份仍须逐次同意）。
- 安装：`install-update.sh` 默认参数退出 0；安装前备份 `~/.proma-switch-backups/20260927-223739-56251/`；`20260927-021826-20863` 归档到外置硬盘 `proma 备份/switch-backups/`，主会话对归档副本复跑健康快照一致。`Proma.previous.app` = `041c148d`。安装后 PNG 路由 200 且一致、无 `[FATAL]`。
- 用户验收：桌面右侧 Tab 切换与 Agent 终端 Tab、两台手机全部清单项通过。
- 与切换前基线：会话 868 → 884；启用定时任务 20；渠道 9 → 8（已停用的 `omniroute` 于 09-27 02:18 后被删除，非安装所致，待用户确认是否有意）。
- 新问题：右侧“文件/改动”Tab 恢复后读取 `~/Documents` 下项目，macOS 反复询问文稿访问权限；根因是 ad-hoc 签名每次构建变化，TCC 与 Keychain 授权不能跨版本保留。用户决定创建固定本机代码签名证书（`Proma Personal Code Signing`）长期解决，打包脚本改造交由 Proma（见交接结果待办）。
- 收尾：关闭遗留的 Tailscale Serve 8443 临时转发。

## 2026-09-27: 固定签名证书就绪；omniroute 确认

- 用户在登录钥匙串创建自签名代码签名证书 `Proma Personal Code Signing`（SHA-1 `D993D52C4C13601727F0B22A08133068A6F42589`，有效期至 2036-09-24，EKU = Code Signing，未设“始终信任”），`.p12` 备份在外置硬盘 `proma 自签证书/证书.p12`（密码由用户保管）。Claude Code 试签临时二进制：签名与 `codesign --verify --strict` 通过，designated requirement 为 `certificate leaf = H"d993d52c…"`，跨构建稳定，可让 TCC 文稿访问与 Keychain 授权在更新后保留。打包脚本改用该身份由 Proma 实施（见交接 `install-result-2026-09-27-2.md`）。
- 更正上一条“待确认”：已停用渠道 `omniroute` 为用户本人删除。

## 2026-09-27: 个人版改用固定代码签名身份

- 背景（install-result-2026-09-27-2 待办 1）：ad-hoc 签名每次构建都变化，macOS TCC（“想访问文稿文件夹”）与 Keychain 授权无法跨版本保留。用户在登录钥匙串创建自签名代码签名证书 “Proma Personal Code Signing”（10 年）。
- `scripts/personal/package-personal.sh`：签名身份默认 `Proma Personal Code Signing`，可用 `PROMA_PERSONAL_SIGN_IDENTITY` 覆盖；构建前用 `security find-identity -p codesigning`（不加 `-v`，自签名证书显示为未受信任但可用于签名）检查，找不到即报错退出，不退回 ad-hoc；沿用 `codesign --force --deep`，签名后 `--verify --deep --strict`，并校验非 adhoc、designated requirement 含 `certificate leaf`；输出 designated requirement。
- 文档：`docs/personal/maintenance.md` §3 复核项、`CLAUDE.md` §6 第 4 项、`fallback-runbook.md`（Keychain 说明与打包注释）、`switch-runbook.md` 复核项同步。首次以新身份安装后 TCC/Keychain 会再询问一次，之后跨版本保留。
- 待办 2（验证后关闭 8443）已记入 Proma 工作说明。

## 2026-09-27: 上一版应用移出 /Applications

- 原因：安装脚本一直把上一版留在 `/Applications/Proma.previous.app`，与当前 `/Applications/Proma.app` 共享同一 bundle ID（`com.proma.app`）。同一 bundle ID 在 `/Applications` 存在两份会导致 macOS 隐私授权（TCC）与 LaunchServices 指向错误副本（弹窗显示“Proma previous”），Spotlight 也可能误启动旧版。用户已手动把当前旧版移到 `~/.proma-switch-backups/previous/Proma.app`。
- `scripts/personal/install-update.sh`：
  - 上一版位置改为 `$BACKUP_ROOT/previous/Proma.app`（默认即 `~/.proma-switch-backups/previous/Proma.app`；`--backup-root` 演练时随之落在 `/tmp`）；新增可选 `--previous-dir DIR` 单独覆盖，`--test-mode` 下同样必须在 `/tmp` 内（沿用现有 `/tmp` 校验逻辑）。
  - 安装时若该位置已有上一版，不删除，而是移入 `$HOME/.Trash/Proma-previous-<commit 前 8 位或时间戳>.app`（可自行清空）；`--test-mode` 下改移到 `--previous-dir` 下的 `.trash/`，不碰真实废纸篓。目标重名时加时间戳+PID 后缀，绝不覆盖。然后把当前应用移到该位置成为新的上一版。
  - 兼容旧布局：若 `$APPS_DIR/Proma.previous.app`（旧版脚本的位置）仍存在，安装开始前按同样规则先迁移/移入废纸篓，并打印说明。
  - 回滚（健康失败/中断的 EXIT/ERR/INT/TERM 处理）从新位置恢复到 `$APP_PATH`；失败包仍按原逻辑保留在 `$APPS_DIR/Proma.failed-*.app`（未改动）。`/Applications` 与 `~/.proma-switch-backups` 同卷时改名仍是原子 `mv`；配置到不同卷时 `mv` 仍可工作但不再原子，已在脚本注释中说明。
  - 过程中发现并修复两处引入的 bug：新增的两条 `echo` 消息把 `$PREVIOUS_PATH` 直接接在全角标点前（无 ASCII 分隔），在 `LC_CTYPE=C.UTF-8`（Python 子进程会自动做 locale 强制转换）下会触发 macOS 自带 bash 3.2 的变量名扫描缺陷，把变量名连同标点首字节一起当成不存在的变量名，`set -u` 报“unbound variable”提前退出；改用 `${PREVIOUS_PATH}` 花括号形式后消失。仓库中另有 3 处同类隐患（第 342、524、526 行，`$pid）`/`$vol）`/`$ARCHIVE_DIR；`）在少见的错误分支里，本次未触发、按“外科手术式改动”原则未修，仅记录，供之后需要时处理。
  - 输出信息与 `usage()` 同步更新为新位置说明。
- 测试（`scripts/personal/test-personal-scripts.py`）：更新现有成功/健康失败/复制失败演练的断言到新位置；新增三组：①已有上一版时被移到演练 `.trash/`，新上一版是刚被替换下来的旧包；②旧布局 `Proma.previous.app` 存在时被迁移到新位置；③健康失败时从新位置恢复原应用。临时撤掉实现（`git stash` 还原 `install-update.sh`）复跑，新断言按预期以 `FileNotFoundError`（新位置的 `Proma.app/Contents/Resources/old.txt` 不存在）失败；恢复实现后复跑全部通过（`38` 处 `PASS`，退出码 0）。
- 文档同步（SSOT）：`docs/personal/fallback-runbook.md` §1（上一版应用位置行）与 §3（回退命令改用新路径）、§6（`install-update.sh` 行为摘要）；`CLAUDE.md` §2（上一版应用行）；`docs/personal/switch-runbook.md`（安装步骤摘要一句话，属于对脚本现行机制的描述，同步；观察期收尾等一次性切换历史步骤保持原样不改）。
- 验证：`bash -n scripts/personal/install-update.sh` 通过；`python3 scripts/personal/test-personal-scripts.py` 退出 0；仓库根 `bun test`：557 pass / 5 fail / 1 error，与基线一致（无新增失败）。
- 范围：只改 `scripts/personal/install-update.sh`、`scripts/personal/test-personal-scripts.py` 与上述文档；未打包、未安装、未合并、未推送，分支 `fix/previous-outside-applications`。
- 主会话复核补充：同类隐患（`$pid）`、`$vol）`、`$ARCHIVE_DIR；` 三处，分别在端口冲突、外置硬盘未挂载、归档目录创建失败分支）已一并改为 `${...}` 写法；归档分支在安装成功之后运行，若触发会以非零退出误导安装结果。`bash -n` 与 `test-personal-scripts.py`（38 PASS）通过。

## 2026-09-27: 首个证书签名版本安装（3081e30f）与“文稿”授权反复弹窗根因

- 用户暂停 Proma 打包，由 Claude Code 接手：在 `05cae780`（Proma：固定证书签名）之上合并“上一版移出 /Applications”（`47ae81b7` 及 `${var}` 修复），打包安装 `3081e30f`；详见交接 `install-result-2026-09-27-3.md`。
- 打包：557/5/1；签名身份 `Proma Personal Code Signing`，designated requirement 含 `certificate leaf = H"d993d52c…"`（主程序与 Helper 一致），非 adhoc。安装脚本退出 0，备份 `20260927-233608-74409`，上一版 `c6c27d02` 存 `~/.proma-switch-backups/previous/Proma.app`，`041c148d` 移入废纸篓，`20260927-223739-56251` 归档到外置硬盘并复核一致。
- 根因：LaunchServices 中 `com.proma.app` 登记了 5 份、3 种签名身份的副本（证书、两个 ad-hoc、官方 Team ID）。TCC 对该 bundle ID 只存一条带 csreq 的授权，弹窗时解析到不同副本（显示“Proma”或“Proma-previous-041c148d”），每次“允许”都改写 csreq，另一身份随即不匹配，形成反复弹窗。
- 修复（用户同意）：证书重签 `previous/Proma.app`；外置硬盘官方版改名 `official-Proma-0.19.58.app.disabled`（zip 存档仍在）；`lsregister -u` 注销旧路径；用户清空废纸篓并运行 `tccutil reset SystemPolicyDocumentsFolder com.proma.app`（清除 3 条记录）后重新允许一次。现登记 3 份，签名同为证书，桌面不再反复弹窗。
- 规则：Proma 副本（含备份）必须与当前版本同一签名身份；外置硬盘存放旧 `.app` 一律改为 `.app.disabled` 或只存 zip（待 Proma 写入 `maintenance.md`）。
- 手机：两台设备推送订阅登记成功；通知按钮成功后显示为空白块且无反馈（`mobile-patch.ts` 用文字覆盖图标），已交 Proma 修复。

## 2026-09-28: 手机通知按钮状态修复与旧副本规则

- 处理 install-result-2026-09-27-3 待办。①通知按钮：订阅成功后原代码 `notify.textContent='通知已开启'` 覆盖图标（方形图标按钮显示为空白）并 `disabled`。改为状态标记 `data-notify-state`（off/on，只在状态变化时写 DOM）：已开启显示绿色 bell-check 图标、aria-label“通知已开启”、不禁用；成功时与再次点击时显示轻提示（toast）；页面加载时若通知权限已授予且服务端 `GET /api/push/subscription` 返回已订阅，直接显示已开启。harness `push` 套件改为断言 `notifyState==='on'`、按钮保留 SVG 无文字，并在推送送达后刷新页面验证状态保留与点按 toast。②`docs/personal/maintenance.md` §4 新增“同 bundle ID 的旧副本”规则（外置硬盘/备份中的旧 `.app` 改为 `.app.disabled` 或只存 zip）。③开发实例为本次验证重新启动，用户模拟器确认后关闭并关闭 8443。
- 验证：harness（去代理）android push（订阅、FCM 送达“运行已完成”、刷新后仍为已开启、点按 toast）、iphone smoke / mobile-polish / layout 通过，JS exceptions 0；typecheck 通过；全量 557 pass / 5 fail / 1 error（基线内）。

## 2026-09-28: iOS 模拟器嵌入右侧栏

- 基于 `feature/simulator-panel` 实现个人版桌面 iOS 模拟器预览：主进程新增 `simulator-preview-service.ts`（iOS/iPadOS 设备查询、Node.js ≥20 与登录 shell PATH 检查、固定 `serve-sim@0.1.47`、3200 起空闲端口、只绑定 loopback、启动/停止/Home/截屏与退出清理）；新增 6 个 simulator IPC，full-ui 分级均为 `denied`；新增右侧工作区 `simulator` 组件标签、`SimulatorPanel.tsx` 工具栏与 iframe 预览。关闭标签/切换会话不主动停止预览。截图写入当前 agent session 的 `attachments/` 子目录。
- 上游挂载改动（仅最小接入）：`apps/electron/src/renderer/atoms/agent-atoms.ts` 扩展组件标签；`apps/electron/src/renderer/components/agent/SidePanel.tsx` 增加面板挂载及桌面 macOS、非 web-remote 入口判断；`apps/electron/src/renderer/components/diff/DiffPanelTabBar.tsx` 增加“打开 iOS 模拟器”菜单项和标签标记；`apps/electron/src/main/lib/web-remote/full-ui/mobile-patch.ts` 仅追加手机端隐藏入口/标签及菜单过滤规则。其余实现位于新增文件，另同步 IPC types/preload、主进程生命周期、`channel-policy.ts`、本文件、`CLAUDE.md` §6 与 `docs/personal/maintenance.md`。
- 验证：`bun run typecheck` 通过；`build:main`、`build:renderer`、`build:web-preload` 通过；全量 `bun test` 为 561 pass / 5 fail / 1 error（基线为 557 pass / 5 fail / 1 error，失败/错误数量未增加；本次新增 4 个服务单测，均通过）。6 个新 IPC 在 full-ui 策略表显式 denied，完整覆盖率测试通过。serve-sim `--help` 确认 `--fit`、`--panes none`、`--host`、`--kill <device>`、`button --device` 参数；`--list -q` 返回 JSON `{"running":false}`。CLI 直连当前 iPhone 17 Pro 做了独立服务 smoke：启动在 127.0.0.1:3200，GET 200；输出实际为 localhost URL 的人类可读行（未输出启动 JSON）；显式 `--kill <UDID>` 后 launcher 退出且 3200 端口释放。模拟器截屏 `/tmp/simulator-panel/simulator-current.png`（`xcrun simctl io`）。
- 手机回归：iPhone `layout` 11/11 页通过，412px 视口与右面板均无横向溢出，所有命中检测 0 miss；手机标签下拉可见项不含“iOS 模拟器”；`panel-probe` 文件/改动两 Tab 均命中；`smoke` 7/7 步骤通过、JS exception 0。截图与 JSON 位于 `/tmp/simulator-panel/layout-verified/`、`/tmp/simulator-panel/panel-probe/`、`/tmp/simulator-panel/smoke/`。所有 harness 均撤销临时配对设备、退出 Chrome、删除临时 profile；smoke 自建会话已删除，原有会话清单前后不变。harness 控制台有既存音频预加载 XHR 错误，不影响测试通过。
- 桌面端尚未完成：当前 Electron 只监听 web-remote 17889，无远程调试/CDP 端口；未能对已运行的桌面 renderer 执行 DOM 断言或 `Page.captureScreenshot`，因此未验证侧栏启动/iframe 点按/Home/截屏/关标签持续运行等 UI 流程。按父会话更正，曾在约 02:22 GMT+8 对 Proma 进程调用 `screencapture` 1 次，命令失败并返回 `could not create image from display`，没有生成桌面截图；不会再调用任何屏幕录制权限截图方式。通过 simctl 已保存模拟器画面 `/tmp/simulator-panel/simulator-current.png`。独立 CLI smoke 后确认无 serve-sim 残留且 3200 端口已释放；iPhone 17 Pro 模拟器保持 Booted。开发实例及临时 8443 继续保持运行供用户体验。尚未 push、合并或打包。

## 2026-09-28: iOS 模拟器嵌入右侧栏——父会话复核与用户体验通过

- 复核 Luna `bdcb98f0`：serve-sim 固定 0.1.47、只绑 127.0.0.1；停止必带 UDID（`buildKillArgs` 空 UDID 抛错），兜底只结束自有子进程；6 个 `simulator:*` IPC 仅接受 macOS 桌面主窗口，web-remote 分级为 denied（开发实例覆盖率 100%，invoke=376）；Node 经已加载的登录 shell PATH 解析；退出时 `before-quit` 先清理 serve-sim，不关模拟器。父会话按实际参数实跑：页面 200、`button home -d` 成功、`--kill <udid>` 后端口释放无残留。已有修复全部保留；全量 561 pass / 5 fail / 1 error（基线内，新增 4 个测试）；iphone layout 11/11、panel-probe、smoke 通过，手机端无模拟器入口。
- Luna 曾调用 `screencapture` 1 次（约 02:22，失败未出图），触发 Proma“屏幕录制”权限请求；已禁止，本功能不需要屏幕录制权限（serve-sim 读模拟器帧缓冲，截屏用 `simctl io`）。
- 用户在开发实例桌面窗口体验通过（02:46）。与通知按钮修复一起打包安装。

## 2026-09-28: 安装 d6af4f8b（通知按钮修复、iOS 模拟器面板）

- 依据 Proma 安装申请 `install-request-2026-09-28.md`，结果见交接 `install-result-2026-09-28.md`。
- 复核（`maintenance.md` §3）通过：marker = `personal` = `origin/personal` = `d6af4f8b`；证书签名 leaf `d993d52c`（与上一版相同）；无 `app-update.yml`；打包测试 561/5/1（失败/错误 = 基线）；申请列出的包内标记可见；安装脚本与依赖无改动。另审查 `simulator-preview-service.ts`：固定 `serve-sim@0.1.47`、无 shell spawn、仅 127.0.0.1:3200–3299、用户主动打开时启动，手机端 `simulator:*` 全部 denied。
- 安装 12:10，脚本退出 0，备份 `20260928-121054-80664`，上一版 `3081e30f` → `previous/`，`c6c27d02` → 废纸篓，`20260927-233608-74409` 归档到外置硬盘并复核一致。**首次同证书升级：无文稿/Keychain 授权弹窗**，固定签名方案验证有效。
- 用户验收：桌面 iOS 模拟器面板与两台手机（通知已开启状态、无模拟器入口）全部通过。
- 基线差异均已确认：会话 899（正常使用）；渠道 8（用户删 omniroute）；启用定时任务 20 → 18（“Google 收录完成度监测（每周）”“Obsidian 归档同步 - 每周报告落盘”于 09-28 11:49/11:50 由用户停用）。

## 2026-09-28: 模拟器面板设备同步与关机（待打包）

- 安装后检查发现：serve-sim 跟随设备切换在同一 PID 下登记多个流（`$TMPDIR/serve-sim/server-<udid>.json`），面板仍记录启动时的设备，Home/截屏可能指向已关机设备。修复（`a040902d`）：状态读取按本进程 PID 过滤的流并结合 `simctl` 实际状态，工具条跟随实际显示设备；停止时逐个 UDID `--kill` 本进程的全部流；新增 ⏻ 关闭模拟器（`simctl shutdown`，`simulator:shutdown` 手机端 denied）；npx 启动时注入应用代理；web-remote-server 测试清理临时目录。
- 验证：typecheck 通过；模拟器服务测试 6 pass；全量 566 pass / 3 fail（均为既有失败，低于基线）；开发实例分级覆盖率 100%（invoke=377）；用户在开发实例体验通过（12:42）。
- 用户决定：**暂不打包**，与后续问题一起打包安装。

## 2026-09-28: README 个人版区块更新

- `README.md` / `README.en.md`：补充手机端布局适配、iOS 模拟器面板、固定证书签名、上一版移出 `/Applications` 与备份归档、右侧 Tab 修复、双方共同维护分工。仅文档。

## 2026-09-28: 手机预览与验证统一脚本

- 新增 `scripts/personal/mobile-preview.sh`：`start` 检查 17889/5173 端口、开启 8443 Tailscale Serve、后台运行开发实例并等候启动与分级覆盖率 100%；`sim [--device]` 默认启动 iPhone 17 Pro、打开 Simulator、生成配对码，通过 AXe `describe-ui` 动态定位配对输入框/按钮并配对，再打开 `/app/`、用 `simctl io screenshot` 截图核对；`test` 去除代理变量逐一执行六套默认 harness，单套外层 420 秒超时并检查无残留 Chrome；`stop` 只停止记录 PID 的开发进程树、关闭 8443 并检查 Serve；`status` 汇总监听、路由、模拟器和 harness 进程。
- 验证：`bash -n` 通过；脚本实测 `start → sim → test → stop → status`。启动日志含“full-ui 分级覆盖率 100%（invoke=377, event=8）”及 `17889`；iPhone 17 Pro Safari 配对成功、进入 `/app/`，截图 `/tmp/proma-mobile-preview-sim.png`。harness：iPhone panel-probe、smoke（7/7）、mobile-polish（2/2）、layout（11/11）；Android smoke（7/7）、attachments（文本/图片/Markdown 验证通过）全部通过，JS exceptions 均为 0，每项配对设备均撤销，Chrome/profile 清理完成，既有会话保持不变。harness 记录首次 `/app/` 传输约 3.23 MB、2.29 s，复载约 1.3–1.5 KB、2.1–2.35 s（供项 D 基线使用）。停止后 17889/5173 均未监听，PID 文件删除，Serve 仅保留安装版 443→17888；iPhone 17 Pro 模拟器仍为 Booted。
- 文档：`CLAUDE.md` §6 第 5/6 项与 `docs/personal/web-remote.md` 回归说明改为引用统一脚本。运行日志中存在已知通知音效预加载 XHR 错误，但 JS exceptions 为 0，未影响测试。

## 2026-09-28: 手机预览脚本已配对模拟器复用

- 首次模拟器成功配对后再次运行 `mobile-preview.sh sim` 时，Safari 已由现有 Cookie 直接进入应用；原脚本仍试图在根页面按配对表单定位控件。调整为仅在 AXe 点查询发现配对码输入框和“开始配对”按钮时输入新配对码；已配对时保留配对并直接校验 `/app/`，点位仍从 AXe `describe-ui` 返回的控件 frame 推导，不硬编码屏幕坐标。
- 验证：脚本在已配对 iPhone 17 Pro 上重跑成功，截图 `/tmp/proma-mobile-preview-sim.png`，识别并保留原配对，/app 界面核验通过；`bash -n` 通过。

## 2026-09-28: mobile-patch 源码拆分与 observer 写入收敛

- 将 `full-ui/mobile-patch.ts` 的 CSS、注入 JS 抽到 `full-ui/mobile-patch/mobile-css.ts` 与 `mobile-js.ts`，`renderWebRemoteMobilePatch()` 对外 API 不变，由 esbuild 正常静态打包；CSS 完整内容与 `4954e7d1` 的原规则逐字节一致（16,491 bytes）。JS 与原脚本的唯一行为逻辑差别为 `setIfChanged` 的状态标记辅助：通知 on/off、侧栏/面板图标、键盘 inset、标题 label、下拉菜单 signature 只在值变化时执行 DOM 写入；其他 JS 行为保持一致。
- 新增轻量 devDependency `linkedom@0.18.13` 与 `mobile-patch.test.ts`：真实加载拼接后的注入脚本到模拟 DOM，手动重复触发 100 轮 ensure/right-panel/menu MutationObserver；检查刷新按钮、面板图标、菜单图标、通知状态（含异步从 off→on）、标题与 Tab 下拉菜单。重复触发后写入计数不再增长。
- 等价性与回归：CSS 规则内容 byte-for-byte 相同；JS diff 审查只涉及上述状态 setter 加 guard，无其他行为差异。typecheck、`build:main`、`build:renderer`、`build:web-preload` 通过（renderer 保留既有大 chunk 警告）；定向单测 1 pass / 0 fail / 8 assertions。A 脚本的 iPhone 17 Pro `/app/` 界面检查通过；iPhone 与 Android 的 layout 11/11、smoke 7/7、panel-probe 2/2、mobile-polish 刷新与会话单击 2/2 全部通过，JS exceptions 0；mobile-polish 工作区切换项按既有逻辑标记 skip（该点击是折叠/展开分组，不切换 workspace ID）。所有 harness 配对设备撤销、session/profile/Chrome 清理完成，无 Chrome 残留。
- 全量 `bun test`：567 pass / 3 fail（570 tests）；3 个失败为既有 Electron `dialog` mock、Electron `shell` mock、planning-manager Electron binary 类型问题，统一由项 C 修复。仅新增 `linkedom` devDependency，未新增运行时依赖。
- 保留核对：原 CSS、刷新按钮循环防护、触屏 `lastTouchAt` hover 拦截、面板开关/动效/重开 pointer-events、隐藏拖拽条、顶栏图标及状态标记、菜单、通知状态与 toast、标题下拉/模拟器入口隐藏等原逻辑均保留。
- 文档：更新 `docs/personal/web-remote.md` 标出源文件路径与 observer 单测。

## 2026-09-28: 全量测试基线归零

- 按全仓实际运行结果处理现存三项失败，没有为通过测试改动产品逻辑：①`agent-session-manager.test.ts` 的 Electron 命名导出 `dialog` 与 `channel-runtime-api-key.test.ts` 的 `shell` 缺失，根因是 Bun `mock.module()` 会跨测试文件持续覆盖全局 `electron` 模块，其他测试的 mock 可能成为最终活跃版本；相关 `electron` mock 统一补齐所需的 `BrowserWindow`、`dialog`、`shell` 等命名导出。②`planning-manager.test.ts` 用 `createRequire('electron')` 取运行文件时可能读到前序测试留下的 mock 对象；改为通过 `createRequire.resolve('electron')` 找包目录，再读取包内 `path.txt` 计算 Electron 二进制真实路径，不受模块 mock 影响。
- 定向验证：四个相关文件 29 pass / 0 fail；typecheck 通过。全量 `bun test`：592 pass / 0 fail / 0 error（91 files，1305 assertions）。
- `scripts/personal/package-personal.sh` 的全测门槛改为 0 fail / 0 error；`CLAUDE.md` §6 第 2 项与本文件基线同步更新。历史记录保留原始当时数字，未改写。

## 2026-09-28: Web Remote 手机首屏资源与传输测量

- 本机开发实例 `/app/` 首次 CDP 加载（iPhone UA，18:41 GMT+8）：69 requests、48 responses；计入 `/app/` 的 45 个 200 响应资源，CDP 传输 3,230,010 bytes、资源响应头压缩体合计 3,223,847 bytes；CDP `Network.dataReceived.dataLength` 解码后 7,992,064 bytes，按资源体计算节省约 59.7%。导航到就绪计时 8.58 s；主 bundle 完成于 6.536 s。主要资源：`index-DExTehsL.js` 5,738,122 → 1,363,012 bytes（Brotli）；CSS 259,761 → 36,455 bytes（Brotli）；动态 `/app/` HTML 42,457 → 8,552 bytes（Brotli）；`preload.js` 121,520 → 21,688 bytes（Brotli）。最大图片 1,511,206 bytes 未压缩（编码结果无收益，服务端按规则直接返回原体）。
- 响应头核验：HTML、JS、CSS、preload 均有 `Content-Encoding: br`、`Vary: Accept-Encoding`；hash 静态资源返回 `Cache-Control: public, max-age=31536000, immutable`，HTML 与 preload 为 `no-cache`，符合动态页面与预加载脚本需要检查更新的要求。WOFF2 与大 PNG 未压缩；多个 MP3 资源的 Brotli 收益很小但服务端仅在编码体更小时返回压缩版本。`web-remote-server.ts` 已实现上述能力，无需源代码修改，因此无压缩前后对比数据。
- 回归：通过 `mobile-preview.sh start → test iphone:smoke → stop` 实跑；smoke 7/7，JS exceptions 0，测试设备撤销、会话/profile/Chrome 清理完成，停止后 17889/5173 释放、Serve 仅 443。harness 音效预加载 XHR console error 为既有问题，不影响 smoke。
- 未实施的后续建议（按本项范围不改代码）：评估将 5.74 MB 的主 JS 与桌面专用模块拆分/按需载入；单个约 1.51 MB 图片也可独立评估格式与首屏必要性。

## 2026-09-28: 已配对设备 30 天惰性过期

- `WebRemoteAuth.refreshFromDisk(now)`：配对设备按 `lastUsedAt`（无则 `createdAt`）判断；超过 30 天未使用即写入 `revokedAt=now`，超过 30 天的撤销记录从 `devices.json` 移除。`authenticateToken` 与桌面状态 `listDevices()` 均在处理时刷新期限；受信 `tailnet:*` 身份不因不活跃撤销/清理。设备 JSON 的配对创建、最近使用、手动撤销及惰性清理统一通过同目录临时文件 + 原子 rename 持久化（临时及目标权限 0600）。
- 桌面手机访问设置已有“已配对设备”列表和 `!revokedAt` 过滤；刷新时将 expired 设备从有效列表移除，无需改 UI。
- 新增 4 项 auth 单测：旧 lastUsedAt 撤销；lastUsedAt 缺省回退 createdAt；近 30 天 lastUsedAt 覆盖较旧创建时间并保持有效；清除过期撤销记录且保留近期撤销与 tailnet 身份。另验证临时文件清理和写盘结果。
- 验证：auth 定向测试 16 pass / 0 fail / 51 assertions；workspace typecheck、`build:main`、`build:renderer`、`build:web-preload` 通过；全量 `bun test` 596 pass / 0 fail / 0 error（91 files，1314 assertions）。Renderer 仍显示既有 large chunk warning。所有验证只写临时测试目录；未读取、修改或清理 `~/.proma` 正式数据。
- 文档：更新 `docs/personal/web-remote.md` 的设备安全与过期说明；本文件当前基线同步为 596/0/0。

## 2026-09-28: 手机预览回归输出收敛

- `mobile-preview.sh test` 过去会把每套 harness 的整个 JSON（包含 base64 音频数据 URI）打印到终端，无法快速阅读。改为逐套记录到 `/tmp/proma-mobile-preview-<ua>-<suite>.log`，解析 harness 结果 JSON 后只输出汇总（layout 页数、panel 命中、步骤数、单击比、异常数、配对/Chrome/profile 清理），失败时显示日志尾部。harness 结果完整留在临时日志，不泄漏到对话输出。
- 验证：`bash -n` 通过；最终 `mobile-preview.sh start → sim → test` 中，start 覆盖率 100% 且端口 17889 启动，iPhone 17 Pro 已配对态 `/app/` 截图通过；test 的 iPhone panel-probe 2/2、smoke 7/7、mobile-polish 单击 2/2、layout 11/11 与 Android smoke 7/7、attachments 全部通过，JS exceptions 0、Chrome/profile 清理完成。状态核对确认 PID 记录有效、17889/5173 监听、Serve 8443→17889 与 443→17888 并存、iPhone 17 Pro Booted。
- 最终用户体验状态按要求保留：开发实例与 8443 Serve 持续运行，不执行 `stop`。

## 2026-09-28: 稳健性批次合并与同步策略（待打包）

- 合并 `feature/robustness-2026-09-28`：`mobile-preview.sh` 统一预览/验证流程；mobile-patch 拆为 `mobile-patch/mobile-css.ts`、`mobile-js.ts` 并以 `setIfChanged` 收敛 DOM 写入，新增 observer 收敛单测；测试基线归零（596 pass / 0 fail，打包门槛 0/0）；首屏测量（Brotli 与缓存已生效，无需改动）；配对设备 30 天未用自动撤销、撤销 30 天后清除。
- 父会话复核：拆分前后 CSS 规则一致、JS 仅状态写入路径变化；esbuild 产物保留中文选择器（`String.raw` 依赖打包器不转义非 ASCII，后续打包需核对）。用户 2026-09-28 14:27 在模拟器确认。
- 同步策略决定写入 `docs/personal/maintenance.md` §4.1；周检任务已加入触发条件检查。
- 与 `a040902d` 模拟器同步修复一并等待打包（用户要求暂缓）。

## 2026-09-28: main.log 诊断信息脱敏与错误分级

- `personal-log-writer.ts` 增加摘要脱敏（用户名路径、URL 查询、Bearer、token/key/secret/password、sk-/gh*_ 令牌、邮箱）、错误名/scope/message 字段、240 字截断与 60 秒同签名限频；限频 Map 上限 500，周期后写入累计 `suppressed=N`。修正此前半成品中正则双重转义及无捕获组 `$1` 的缺陷。
- `personal-main-log.ts` 记录安全摘要；console.warn 记为 `[WARN]`，console.error 记为 `[ERROR]`，仅 `uncaughtExceptionMonitor` 记为 `[FATAL]`。普通内容含 “fatal” 不提升级别；启动标记保持 `personal main process started`，兼容 `install-update.sh` 健康检查。
- 验证：定向测试 4 pass / 0 fail / 22 assertions；全量 `bun test` 599 pass / 0 fail（91 files，1331 assertions）；workspace typecheck、`build:main`、`build:renderer`、`build:web-preload` 通过。Renderer 构建有既有大 chunk 提示。
- 范围：仅主进程日志实现、单测与本记录；未改动既有界面、手机补丁或模拟器功能。

## 2026-09-28: 记录上游改动面基线

- 对 `git diff --name-status v0.19.58..personal` 去掉新增文件后统计 71 个上游已有文件变更：浏览器/主题资源清理 8、模拟器入口/挂载 4、其他个人版改动 59。`data-web-remote-*` 标记分布在 13 个 renderer 源文件、22 种标记名；因对应节点没有足够稳定且唯一的上游语义定位器，本次保留，避免以易变 class/文案替代造成手机回归。
- `docs/personal/web-remote.md` 新增“上游改动面”记录，前后上游已有改动文件数仍为 71（未修改标记）。

## 2026-09-28: 首屏资源拆分评估（未实施）

- 本地 renderer 产物 Top 10 chunk 与压缩数据见 `docs/personal/web-remote.md`。HTML 唯一 module entry `index-DExTehsL.js` 为 5,738,122 B（gzip 1,738,120 B）；最大图片 `hopper-seaside-white-house.png` 为 1,511,206 B，属于 onboarding/welcome 展示，不是既有会话的必需内容（浏览器是否提前下载仍需网络面板复核）。语言包大 chunk 按需加载，图表 chunk 由相应 UI 使用。
- 未能从当前 Vite build 产物精确归因 entry 内的 Top 10 源模块，且没有证明安全拆分可令手机首屏传输或就绪时间下降 ≥30%，也未验证桌面行为不变；按门槛不实施代码改动。建议后续用 Rollup visualizer/sourcemap 分析 entry 内模块后再评估。

## 2026-09-28: PERSONAL.md 状态页与完整历史拆分

- 将 `PERSONAL.md` 收敛为 3,506 字节当前状态页（38 行），保留 `## 与上游的差异` 与 `## 同步规则` 标题；98 节原记录整体迁入 `docs/personal/changelog.md`。对比迁移前 `b3ba74a7` 的 `PERSONAL.md`，从 `## 变更记录` 起历史原文逐字节一致：672 行、133,897 字节。
- 更新 `CLAUDE.md`、maintenance/fallback/switch runbook、README 中记录位置说明；历史只追加至 changelog，当前基线/同步规则仍以 PERSONAL.md 为准。

## 2026-09-28: 打包时校验手机选择器原文

- `package-personal.sh` 在签名前调用 `check-packaged-mobile-selectors.cjs`，从 ASAR 提取 `dist/main.cjs` 并确认 3 个关键选择器含原始中文/属性值，不含对应转义形式；若不符合即失败中止。
- 验证：`bash -n scripts/personal/package-personal.sh`、`node --check scripts/personal/check-packaged-mobile-selectors.cjs` 通过；对当前 `apps/electron/dist/main.cjs` 校验通过（3/3）。没有运行完整打包。旧 `out/mac-arm64/Proma.app` 是此前生成的过期产物，尝试检查该旧 ASAR 失败，不能用于判定新脚本结果。

## 2026-09-28: bootstrap 致命路径写入 FATAL

- 补齐日志分级边界：`uncaughtExceptionMonitor` 及明确的 `handleBootstrapFailure()` 现在会记录 `[FATAL]`；普通 console.error/warn 中的 fatal 文本仍不升级。健康检查启动标记不变。
- 验证：typecheck、全量 `bun test`（599 pass / 0 fail / 0 error）、`build:main` 通过。

## 2026-09-28: serve-sim 精确依赖随包分发

- `apps/electron/package.json` 固定运行时依赖 `serve-sim: 0.1.47`，`bun.lock` 已记录 integrity；运行时依赖同步加入 serve-sim 及依赖闭包。服务优先用 Electron 自带 Node（`process.execPath` + `ELECTRON_RUN_AS_NODE=1`）执行包内入口，找不到时保留固定版本 npx 回退。electron-builder 对 `serve-sim/dist/**` 配置 asarUnpack，覆盖 `.node`、universal Mach-O helper 与 dylib。
- 依赖核验：serve-sim 包内 native addon、simcam/simax/simduo 工具均为 macOS x86_64/arm64 universal；包内含 `serve-sim-native.node`、可执行 helper 与 `libSimCameraInjector.dylib`。runtime-deps 实测同步 138 个包；Electron Node 模式 `--version` 返回 0.1.47、`--list -q` 正常；实际本机流返回 HTTP 200，Home 按钮退出 0，`--kill <UDID>` 停流，测试模拟器 shutdown 后恢复 Booted。
- 验证：定向服务测试 6 pass / 0 fail；全量测试 599 pass / 0 fail / 0 error；typecheck、build:main、build:renderer、build:web-preload 通过。手机预览全套 iPhone（panel-probe 2/2、smoke 7/7、mobile-polish 2/2、layout 11/11）和 Android（smoke 7/7、attachments）通过，JS exceptions 均 0。
- 未做完整 app 打包；因此尚未在新 ASAR/签名 app 内实测 native helper 执行。未通过桌面 UI 自动化逐项复测面板设备切换/关机按钮；现有 CLI 的多流/关停路径有独立验证。

## 2026-09-28: 清单收尾批次合并（待安装）

- 父会话补充 `dca3e775`：打包后 serve-sim 优先从 `app.asar.unpacked` 运行，使原生 helper 按真实目录解析。
- 父会话复核：全量 599 pass / 0 fail；手机回归 6 套全过；上游改动面未缩减（71→72，新增 `sync-runtime-deps.ts`），标记替换另立任务。用户 2026-09-28 16:42 确认并同意打包。

## 2026-09-28: 安装 f2db00f3（Claude Code）

- 结果：安装成功，未回滚；`/Applications/Proma.app` = `f2db00f3`，previous = `d6af4f8b`，本机最新备份 `20260928-183544-89297`（BACKUP VERIFY PASS，SNAPSHOT MATCH）。桌面、两台手机通过；TCC 未弹窗；main.log 新格式正常，`[FATAL]` 为 0。
- 健康检查误判：新版启动停在钥匙串授权，60 秒内 17888 未监听 → EXIT=4 并尝试回滚，SIGTERM 结束了 Helper 但主进程未退出，脚本停止文件回滚；用户输入钥匙串密码并干净重启后核对健康，未回滚、数据无变化。
- **模拟器面板不可用**：`asarUnpack` 只解包 `serve-sim/dist/**`，其依赖 `ws`、`inspect-webkit`、`sonner` 留在 asar 内，从 `app.asar.unpacked` 以 ESM 运行时 `ERR_MODULE_NOT_FOUND`；打包自检只跑 `--help` 未加载 middleware，故未发现；内置包崩溃时不回退 npx；启动失败后面板显示“已关机”而设备实为 Booted。
- 其他发现：退出迟滞（quit/SIGTERM 20–60 秒不退出）；`icon.icns` 未打入包（启动 `[WARN]`）；随包 helper 的 x86_64 切片未签名（arm64 通过）；钥匙串在同证书升级后仍弹窗。
- 待办转入修复批次：见 install-result-2026-09-28-2 “给 Proma 的待办” 1–7。

## 2026-09-28: serve-sim 运行时依赖独立随包

- 采用 `extraResources` 独立资源目录方案：`sync-runtime-deps.ts` 在运行时同步时扫描 serve-sim 的编译 JS 外部导入并构建 `resources/serve-sim/node_modules`，electron-builder 将其复制到 `Contents/Resources/serve-sim`。服务解析优先使用该资源路径，开发模式仍使用常规 `node_modules` 搜索路径。相比仅解包 serve-sim 文件或维护手写 `asarUnpack` 依赖名单，该方式确保 ESM 包与真实运行依赖从磁盘同目录解析，依赖升级后会按 bundle 编译产物中的外部导入自动调整。
- `sonner` 在 serve-sim 的 package.json 声明为依赖，但在发布的 `dist` JS 中没有运行时导入；扫描后未打包。`ws` 被编译产物实际引用并以嵌套 `node_modules` 方式随资源分发；`inspect-webkit` 的实现已被 serve-sim 编译产物内嵌，没有外部包导入，不重复打包。
- 验证：`bun run sync:runtime-deps` 同步 138 个运行依赖；独立资源目录中只包含 serve-sim 与实际外部依赖 `ws`；Node ESM 实际导入 `dist/middleware.js` 通过，serve-sim 主入口 `--help` 通过；typecheck、`build:main`、模拟器服务单测 6 pass / 0 fail、`bash -n scripts/personal/package-personal.sh` 通过。尚未完整打包验证。
- 文件：`apps/electron/scripts/sync-runtime-deps.ts`、`apps/electron/electron-builder.yml`、`apps/electron/src/main/lib/simulator-preview-service.ts`、`scripts/personal/package-personal.sh`（打包后检查）；对应验证与后续打包结果将继续补录。

## 2026-09-28: 打包后验证 serve-sim ESM 加载与预览服务

- `package-personal.sh` 签名后使用打包产物 `Contents/MacOS/Proma` 在 `ELECTRON_RUN_AS_NODE=1` 下执行 serve-sim 入口帮助路径，并实际 `import()` 独立资源目录中的 `dist/middleware.js`；任一模块加载失败即中止打包。
- 若本机存在 Booted 模拟器，脚本在 127.0.0.1 临时端口启动随包 serve-sim，最多等待 10 秒检查 HTTP 200，持续 5 秒后用设备 UDID 执行 `--kill` 并清理测试进程；没有 Booted 设备则提示跳过，不阻断打包。
- 验证：`bash -n scripts/personal/package-personal.sh`、typecheck、`build:main` 通过；对生成的独立资源目录用 Node ESM `import()` middleware 通过、入口 `--help` 通过。完整修复前/修复后打包证据和最终包结果待全批次结束时记录。

## 2026-09-28: serve-sim 启动回退与设备状态同步

- 内置 serve-sim 在启动 10 秒内以非零码退出或报告 ESM 模块缺失时，只重试一次 npx；npx 失败会在服务状态中保留 UDID，并报中文错误、退出码和脱敏后的首行输出。模拟器面板启动失败时刷新设备与预览状态，因此先 `simctl boot` 后启动失败也能显示真实 Booted 状态。
- 空状态和启动提示改为说明默认使用内置 serve-sim，组件不可用时才回退到 npx 下载。
- 单测覆盖回退条件：内置异常/缺包会回退，npx 失败和正常退出不重试；模拟器服务定向测试 7 pass / 0 fail；typecheck 和 renderer build 通过（仅既有大 chunk 提示）。

## 2026-09-28: 启动期间钥匙串等待的隔离与回滚保护

- 启动顺序调查：`bootstrap()` 原先在 `startAllBridges()`（飞书等 Bridge 读取凭据并可能调用 `safeStorage.decryptString`）之后才 `startWebRemoteIfEnabled()`；Bridge 的 await 会串行阻塞 Web Remote。Web Remote 依赖自己的配置、配对认证和 HTTP server，不读取渠道 API Key/Keychain；已将其启动移到 IPC 注册之后、Bridge 与 dock/settings 初始化之前。若 Keychain 授权仍阻塞主线程，17888 可先独立就绪；Bridge 仍等用户授权后启动。
- 安装脚本健康检查：初始观察期后若 Web Remote 未由新版监听且存在 `SecurityAgent`，提示用户在钥匙串弹窗授权，最多再等待 10 分钟；主进程不退出时回滚只向明确识别的新版主进程发 SIGTERM，不再向 Helper 发信号，20 秒未退即停自动文件回滚并提示手动退出。
- Keychain ACL 调研结论（未读取/修改任何钥匙串条目）：Apple TN2206 将 Keychain 授权描述为由应用代码签名 requirement/DR 跟踪；Apple TN3127 说明 ad-hoc 的 DR 与特定版本 cdhash 绑定，更新后不能可靠保持身份。Proma 现有签名报告中的 designated requirement 含固定 certificate leaf，而非单纯 cdhash；无 Team ID 本身并不能证明 Keychain 必然按 cdhash 绑定。故同证书升级后仍弹窗不能仅归因为“缺少 Team ID”，更可能涉及首次授权、访问的实际二进制/Helper 身份不同、条目 ACL 或 Keychain 项目的迁移/创建者身份，需在用户实际授权弹窗时再针对目标 item 的访问方做无密钥诊断。
- 建议：首次授权可选择“始终允许”，通常意在保存该访问方对当前项目的授权，但不能保证为其他 Helper/签名 requirement 不同的访问者授权，也不能修复不允许变更 ACL 的旧条目；不要自动删除条目或放宽为允许所有应用。若仍重复弹窗，先识别发起访问的进程与其 `codesign -d -r-` requirement，再针对该进程/目标条目让用户手动处理；固定身份与包含证书约束的稳定 DR 应继续保留。
- 资料：Apple [TN2206](https://developer.apple.com/library/archive/technotes/tn2206/_index.html)；Apple [TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)。
- 验证：`bash -n scripts/personal/install-update.sh` 通过；未运行安装脚本、未触碰 Keychain、未停止或重启已安装 Proma。`shellcheck` 本机不可用；安装健康等待与回滚分支尚未在真实安装流程演练，最终验证仍需 Claude Code 在授权安装时执行。
