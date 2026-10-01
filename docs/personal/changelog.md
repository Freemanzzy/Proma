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
- 验证：`bash -n scripts/personal/package-personal.sh`、typecheck、`build:main` 通过；对生成的独立资源目录用 Node ESM `import()` middleware 通过、入口 `--help` 通过。原安装包的 `ERR_MODULE_NOT_FOUND: Cannot find package 'ws'` 复现证据见本机 `install-result-2026-09-28-2.md`；隔离的 ESM 模块树缺少依赖时实际测试确认 import 失败（exit 1 / `ERR_MODULE_NOT_FOUND`）。修复后 `package-personal.sh` 实际完成一次完整打包：600 pass / 0 fail / 0 error；用 Electron Node 模式加载包内 middleware 与 CLI 入口通过；Booted iPhone 17 Pro 上随包服务返回 HTTP 200，运行 5 秒后按 UDID 关闭。最终包核验：见本记录末尾最终打包节；包未启动、未安装。

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
- 验证：`bash -n scripts/personal/install-update.sh`、typecheck、`build:main` 通过；静态断言确认 Web Remote 启动位于 Bridge 初始化之前，安装等待/主进程独立回滚分支文本有效。未运行安装脚本、未触碰 Keychain、未停止或重启已安装 Proma。`shellcheck` 本机不可用；安装健康等待与回滚分支尚未在真实安装流程演练，最终验证仍需 Claude Code 在授权安装时执行。

## 2026-09-28: 随包包含主进程使用的 macOS ICNS

- electron-builder 的 `files` 规则原先排除整个 `dist/resources/**`，只重新纳入 PNG；`index.ts:getIconPath()` 与 `workspace-memory-window.ts` 都从 `dist/resources` 查找 `icon.icns`，因此包内资源缺失并触发 `[WARN] App icon not found`。在排除规则后显式纳入 `dist/resources/icon.icns`，让 ASAR 路径与两处现有查找路径一致。
- 验证：源码 `dist/resources/icon.icns` 存在（116,454 bytes）；完整 ASAR 清单含 `/dist/resources/icon.icns`（116,454 bytes），与 `index.ts:getIconPath()` 和 workspace-memory window 的现有路径一致。

## 2026-09-28: 限制模拟器预览退出清理耗时

- 退出清理复用当前已选择的 serve-sim invocation；只对随包入口并发按本进程拥有的 UDID 发 `--kill`，单轮最多等待 1.5 秒，npx 回退路径不再在退出时运行可能下载包的 npx。随后只终止 Agent 自己记录的 serve-sim 子进程 PID，等待 400 ms 后仍不退则 SIGKILL；避免按设备串行等待 15 秒。
- 验证：typecheck、`build:main`、模拟器服务定向单测 7 pass / 0 fail 通过。先前安装/退出报告仅提供既有 20–60 秒延迟观察，尚未在开发实例完成修复前后实测；当前开发实例未运行，按要求仍需后续启动并进行桌面预览退出实测。

## 2026-09-28: 个人版打包前收窄并签名 serve-sim helpers

- `package-personal.sh` 在 app 签名之前检查随包 3 个原生 helper（AX settings、Duo renderer、camera injector dylib）包含 arm64；若为 universal 则先 `lipo -thin arm64`，再由现有固定证书对 app 深度签名。签名后逐个 `codesign --verify --strict`，并继续验证整个 app。
- 验证：源资源 3 个文件均为 x86_64+arm64 universal；实际打包后 lipo 检查均只含 arm64；三项 helper 的 `codesign --verify --strict` 与整个 app 的 `codesign --verify --deep --strict` 均通过。

## 2026-09-28: 安装后修复批次全量验证与打包

- 基于本轮代码提交 `e1ac4446` 完成完整 `scripts/personal/package-personal.sh`：typecheck 通过；全量 Bun 测试 **600 pass / 0 fail / 0 error**；main、agent runtime、terminal runtime、preload、renderer、web-preload、CLI 与 native helpers 构建通过；personal build marker 的 version `0.19.58`、commit `e1ac4446`，无 `app-update.yml`。
- 打包后自检通过：serve-sim middleware ESM import、入口 `--help`、随包 serve-sim 在 Booted iPhone 17 Pro 上 127.0.0.1 临时端口 HTTP 200 冒烟（运行 5 秒并按 UDID 停止）；ASAR 含 `dist/resources/icon.icns`；App Authority `Proma Personal Code Signing`，designated requirement 包含固定 certificate leaf，app deep strict 签名通过。3 个原生 helper 已 thin 到 arm64，并分别 strict 验签。
- 产物：`apps/electron/out/mac-arm64/Proma.app`。脚本明示“包未启动”；未运行 `install-update.sh`、未安装、未退出/重启已安装 Proma。
- 最终 marker 对齐：本节文档变更提交后再次运行同一完整打包脚本；包内 `personal-build.json.commit` 与该次最终分支 HEAD 完全一致。此次重打包只包含本文档差异，没有新的应用代码变更。

## 2026-09-28: 手机端失效连接自动恢复

- 问题：19:33 手机发送的消息未到达 Mac（会话记录、运行时、main.log 均无痕迹），界面停在 “Agent Running”。推断：iOS 切后台再回到前台后，页面沿用“看似 OPEN 实已断开”的 IPC WebSocket，`ws.send` 静默丢失，35 秒后才超时，且上游发送失败时只停止运行状态、消息仍显示为已发送。
- 修复（`web-electron-shim.ts` / `web-remote-ipc.ts`，均为个人版文件）：服务端支持 `ping` → `pong`；客户端空闲超过 10 秒时先 ping（3 秒无响应即丢弃旧连接并重连）再发请求；页面回到前台 / `pageshow` / `online` 时强制校验连接；连接关闭时立即让该连接上的在途请求失败（按连接区分，不误伤新连接）；`agent:send-message` 失败时显示红色提示“消息未送达 Mac”。
- 验证：新增 harness 套件 `dead-socket`（让当前 `/api/ipc` 连接双向静默 11 秒后发请求），iPhone / Android 均在约 3.0 秒内重连并成功（修复前会挂起 35 秒）；首版实现中旧连接关闭误伤新连接请求，由该套件发现并修正。`mobile-preview.sh test` 默认 8 套全过；全量 601 pass / 0 fail；新增 ping/pong 单测。发送失败提示未做端到端验证。

## 2026-09-28: 安装后修复批次合并（待安装）

- 合并 `fix/post-install-2026-09-28`：serve-sim 独立 extraResources 与依赖、打包实跑冒烟、启动失败回退 npx 与状态同步、Web Remote 先于钥匙串相关初始化启动、安装脚本 SecurityAgent 等待与只对主进程回滚、退出清理限时、icon.icns 打包、helper thin arm64 签名、手机失效连接自动恢复。
- 用户 2026-09-28 20:15 在开发实例确认。

## 2026-09-28: 安装 9aaecb0b（Claude Code）

- 结果：成功，健康检查一次通过，未回滚；`/Applications/Proma.app` = `9aaecb0b`，previous = `f2db00f3`，本机最新备份 `20260928-202002-63617`（BACKUP VERIFY PASS，SNAPSHOT MATCH，会话 910）；较早两份备份已归档到外置硬盘。
- 验证：main.log 三次启动均有启动标记、无 `[FATAL]`、无 `App icon not found`；模拟器面板从 Finder 启动使用 `Resources/serve-sim`（不走 npx，仅监听 127.0.0.1:3200），切设备、Home、截屏（文件已保存）、关机、停止均通过；退出耗时：面板未运行 0.41 s，面板运行中 serve-sim 0.41 s、主进程 0.69 s（此前 20–60 s）；两台手机切后台约 30 秒后回来发送正常；TCC 未弹窗。
- **钥匙串观察**：同证书升级仍弹 1 次（SecurityAgent 出现 17 秒，选“始终允许”后两次 Finder 启动未再弹）；弹窗在 60 秒健康检查内处理完，脚本额外等待分支未触发。结论：同证书升级仍会弹 1 次，选“始终允许”后稳定。
- 遗留（已在后续批次处理）：截屏成功无提示；Node DeprecationWarning 记为 `[ERROR]`；`app.asar.unpacked/node_modules/serve-sim` 多余副本。

## 2026-09-28: 截屏提示、Node 警告分级、去除 serve-sim 重复副本

- `SimulatorPanel.tsx`（个人版文件）：根因是截屏后 `run()` 调用的 `refresh()` 立即清空了“截屏已保存”消息；`refresh` 增加 `clearMessage` 参数，操作后的刷新保留结果消息；截屏成功弹出 toast“截屏已保存到会话附件”（显示文件名），失败弹出“截屏失败”及原因。
- `personal-log-writer.ts` / `personal-main-log.ts`：经 console.error 输出的 Node 进程警告（`(node:PID) [DEPxxxx] DeprecationWarning:`、`ExperimentalWarning` 等，或 name 以 Warning 结尾的 Error）记为 `[WARN]`；其他文本中提到 Warning 不降级。新增单测；判定函数放在不依赖 electron 的 writer 中，避免测试间 electron 模块污染。
- `electron-builder.yml`：`files` 排除 `node_modules/serve-sim/**`，运行时只用 `Contents/Resources/serve-sim`。
- 验证：typecheck、全量 602 pass / 0 fail、build:main / build:renderer。打包层面的副本移除与截屏提示待下次打包/安装验证。

## 2026-09-28: 协作子 Agent 完成后自动唤醒父会话

- 新增 `apps/electron/src/main/lib/personal-delegation-wake.ts`：默认开启（数据目录 `personal-settings.json` 中 `delegationAutoWake: false` 可关闭，读取失败按开启处理）；在子会话完成、失败或取消后合并父会话 30 秒内的结果，并等待父会话空闲后通过 `runAgentHeadless` 在原会话渠道、模型、工作区与权限模式发起带 `triggeredBy: 'delegation'` 的自动通知轮次。相同父会话每小时最多 10 次；不存在/归档/用户停止、已消费、关闭开关和限频均跳过并记录 `[子任务唤醒]` 原因。
- 消费判定：`wait_for_delegations` 返回以及 `get_delegation_results` 读取时，将已返回终态的 delegationId 标记为 consumed；未完成状态不标记。唤醒前再次过滤 consumed，父会话忙碌时每秒轮询并重新检查终止/归档/消费条件。子会话运行与 `wait_for_delegations` 行为不变。
- 最小上游接入：`agent-collaboration-tools.ts` 新增个人模块 import、终态回调一行、wait/get 两处消费标记调用，并在委派记录保留父工作区；未改其他上游文件。
- 文档：新增 `docs/personal/delegation-auto-wake.md` 开关说明，并更新 `PERSONAL.md` 的个人版差异索引。
- 验证：`bun run typecheck`、`build:main`、`build:renderer`、`build:web-preload` 通过；全仓 `bun test` 602 pass / 0 fail / 0 error。开发实例 `mobile-preview.sh start`、`sim` 均通过；`mobile-preview.sh test` 全部默认套件通过（iPhone panel-probe/smoke/mobile-polish/layout/dead-socket，Android smoke/attachments/dead-socket，异常数均 0）。尚未完成专用协作子 Agent 发起、消费去重与自动续轮的端到端实测；对应功能单测亦未新增，属于待验证项。开发实例及 8443 保持运行，未停止正式版、未运行安装更新脚本。

## 2026-09-28: 自动唤醒父会话身份修正与验收完成

- 修正上一节实现的身份错误：自动唤醒输入改为 `triggeredBy: 'external'`，headless `source` 使用 `bridge`。父会话因此不再被 `agent-collaboration-tools.ts` 判定为子会话；复核直接依赖 `triggeredBy === 'delegation'` 的委派创建、工作区 MCP/视觉中继与规划策略，以及 renderer 的子会话完成提醒分支，均不会误判唤醒父会话。`agent-service.runAgentHeadless` 仍负责发出完整 stream/`STREAM_COMPLETE`、`external_run_started` 与 `run_completed`；bridge source 走 Web Remote 的普通“运行已完成”推送。完成/失败回调现在有可观测的结束/错误日志，不替代现有事件分发。
- `personal-delegation-wake.ts` 改为依赖注入控制器，单测不导入真实 Electron；加入 `personal-delegation-wake.test.ts` 的 8 项测试：consumed、stoppedByUser、开关关闭、忙时排队后空闲、合并、每小时 10 次、failed/cancelled 消息状态、external/bridge 身份及原会话参数。全仓 `bun test`：610 pass / 0 fail / 0 error；workspace typecheck 通过。
- 开发实例真实模型端到端：测试父会话 `6c156e88-d803-4864-ac3f-a55cf629f69d` 首轮只委派“只回复 pong”并直接结束；子会话于 2026-09-28 21:56:41.608 GMT+8 完成，父会话自动轮于 21:57:11.623 GMT+8 开始，延迟 **30.015 秒**。父 Agent 调用 `get_delegation_results` 后成功再次调用 `delegate_agent` 创建第二子任务，未出现“协作子会话不能继续创建”错误；第二子任务结果后也收到后续唤醒。
- 消费去重端到端：另一父会话先用 `wait_for_delegations` 收回子任务终态并回复 `WAIT_RESULT_COLLECTED`；观察后续 **36.016 秒**无自动运行/通知，开发日志记录 `[子任务唤醒] consumed`。两组 E2E 测试父会话、子会话均通过 IPC 删除；配对设备撤销。
- 手机回归：`mobile-preview.sh test` 默认 iPhone/Android 套件全过，JS exceptions 0。为修复附件套件中模型对单词 `Red`/`red` 的大小写差异导致的误失败，`scripts/personal/mobile-harness.mjs:waitForAssistantReply` 将期望文本匹配改为大小写不敏感；图像答案仍由后续 `\bred\b/i` 断言实际验证为红色。复跑 `android:attachments` 及完整默认套件均通过。
- 文档更新：`docs/personal/delegation-auto-wake.md` 补充 identity/source 与事件推送说明；本记录补记修复原因、单测和 E2E 证据。开发实例、8443 Serve 与 iPhone 17 Pro 模拟器保持运行；未运行打包、安装更新或重启正式 Proma。

## 2026-09-28: 子任务自动唤醒合并（待打包）

- 合并 `feature/delegation-auto-wake`（`b12f5038`、`bf9c3e13`）。父会话复核：唤醒轮次为 `triggeredBy: 'external'`、`source: 'bridge'`，父 Agent 可再次委派；全量 610 pass / 0 fail；开发实例端到端唤醒延迟 30.0 秒、已收回结果不重复唤醒。用户 2026-09-28 23:41 在开发实例桌面确认成功。
- 与截屏提示 / Node 警告分级 / serve-sim 单副本（`c6be1acb`）一起等待打包。

## 2026-09-29: 安装 cb94c897（Claude Code）

- 结果：成功，健康检查通过，未回滚；`/Applications/Proma.app` = `cb94c897`，previous = `9aaecb0b`，本机最新备份 `20260928-235900-30636`（BACKUP VERIFY PASS，SNAPSHOT MATCH）；`20260928-202002-63617` 已归档到外置硬盘。
- 首次运行 EXIT=3 为 Claude Code 自身进程筛选错误（漏判 Proma 仍在运行），脚本按设计等待后放弃、未改动任何文件；正常退出后重跑成功。
- 验证：main.log 启动后 `[FATAL]`/`[ERROR]` 均为 0；`DEP0169` 记为 `[WARN]`；自动唤醒桌面实测（`[子任务唤醒] wake count=1` → 父 Agent 读取结果并汇报，只唤醒 1 次）、已收回结果不唤醒（consumed）、手机同步与“运行已完成”推送均通过；截屏提示出现；serve-sim 仅 `Resources/serve-sim` 一份。
- **钥匙串**：同证书升级再次弹 1 次（17 秒，选“始终允许”）。连续两次安装一致：每次升级弹 1 次，之后稳定。
- 待办：唤醒正常事件记为 `[WARN]` 易误读（已在下一节处理）；测试会话 `978d1d72`、`7696f5c0` 由用户删除。

## 2026-09-29: 子任务唤醒日志改为信息级

- `personal-log-writer.ts` 新增 `info` 级别与 `recordPersonalInfo` / `setPersonalInfoSink`（不依赖 electron）；`personal-main-log.ts` 初始化时接入 main.log，写 `[INFO]`。
- `personal-delegation-wake.ts`：wake / consumed / queued / disabled / stopped / rate-limited / run-completed 等正常流转记 `[INFO]`；只有 run-error / start-error / dependency-error 记 `[WARN]`。
- install-update.sh 健康检查只判 `[FATAL]`，不受影响。验证：typecheck、全量 611 pass / 0 fail、build:main。待下次打包。

## 2026-09-29: Web Remote WebSocket 保守压缩

- WebSocketServer 启用 per-message deflate，阈值 16 KB，双端 no-context-takeover，zlib 并发限制 2；扩展仅作用于 WebSocket，不影响桌面 IPC。
- 更新 `docs/personal/web-remote.md`。验证：Electron typecheck 通过；web-remote-server 定向测试因测试初始化时 Electron mock 导出缺失而失败（0 pass / 2 fail），尚未完成 iOS Safari / Android Chrome 握手核验。

## 2026-09-29: Web Remote 大会话历史分页与分块传输

- 仅对 Web Remote `agent:get-sdk-messages` 响应启用历史裁剪：先将 tool_result 内超 16 KB 文本裁剪并注明原大小，图片块/base64 图片改为含类型与尺寸估算的占位；再按约 2 MiB JSON 序列化预算从尾部选取完整轮次，返回 omittedCount/hasEarlier/startIndex 元数据。轮次扫描将匹配的 tool_use 与 tool_result 作为同轮续接；超预算单轮会整体保留，不从中间截断。桌面 IPC 未改。
- 手机端由 `mobile-patch` 增加“加载更早（已省略 N 条）”按钮，复用 IPC 传入 endIndex 与预算，以 2 MiB 页前置消息。`AgentView.tsx` 仅新增一行事件监听钩子同步加载结果，符合尽量缩小上游改动面；未新增 IPC 通道，既有 `agent:get-sdk-messages` 继续按 session scope 鉴权。单条原文展开未实现，原因是没有稳定 message ID 与单条 tool_result 读取 API；占位文案提示完整内容请在桌面查看。
- 大于 256 KB 的 IPC 响应按约 180 KiB UTF-8 切片，分片带请求 ID/序号/总数；shim 重组并在每个进度分片到达时重置 35 秒超时。WebSocket 压缩另见同日上一节提交：threshold 16 KB、双端 no-context-takeover、concurrencyLimit=2。
- 验证：历史窗口/瘦身、手机 patch 与 Web Remote 分级集成定向测试 **20 pass / 0 fail**（89 assertions）；全量 `bun test` **541 pass / 0 fail / 0 error**（83 files，1222 assertions）；typecheck、build:main、build:renderer、build:web-preload 均通过。Renderer 仍有既有大 chunk 警告。手机回归实跑 8 套，其中 7 套通过（panel-probe、smoke、layout、dead-socket、Android smoke/attachments/dead-socket）；iPhone mobile-polish 因既有侧栏目标会话“回复 pong”不可见失败，未涉及新历史入口，待重跑确认。定向 server 测试仍受现有 Electron mock 导出缺失影响，0 pass / 2 fail。
- 未完成：未构造/清理 `~/.proma-dev` 30 MB 合成会话，未运行 CDP 300 ms/2–4 Mbps 弱网修复前后对比，未验证 Safari/Chrome 压缩扩展握手；因此无真实大会话首屏耗时与传输字节对比，不把算法测试结果冒充端到端证据。开发实例、8443 与 iPhone 17 Pro 模拟器已启动并保留，供继续验收；未运行安装更新、未退出/重启正式 Proma。

## 2026-09-29: Web Remote 大会话与移动回归验收补齐

- 大会话当前实现：在 `~/.proma-dev` 生成并登记 33,408,055 B 的全合成 SDK JSONL（user/assistant/tool_use/tool_result、64 KB 工具结果、base64 图片）。在 iPhone UA Chromium harness、300 ms latency、下行 3 Mbps、上行 1 Mbps 下，独立运行历史首屏 **7,911 ms**；最终默认回归中的 `iphone:heavy-session` 为 **8,137 ms**。“加载更早”点按后可见消息节点从 **242 增至 484**；工具结果可展开并显示“内容已截断，原文 64.0 KB；完整内容请在桌面查看”，图片占位“图片已省略：image/png，约 16.0 KB；完整内容请在桌面查看”可见；**0 JS exceptions**。最终回归 CDP 收到 2,808,871 B 解压 WebSocket payload、最大解压帧 245,870 B；并非线缆压缩字节。对应截图由 harness 生成到系统临时目录。合成 session 与 JSONL 均已清理，开发索引恢复为测试前 6 条会话。
- 修复前对照：以仅开发可用的 `PROMA_WEB_REMOTE_HEAVY_SESSION_BASELINE=1` 关闭历史窗口/瘦身与分片传输、保留 permessage-deflate，运行同一 33 MB 合成输入。**40,420 ms** 仍未显示历史，随后 IPC 页面连接断开；CDP 仅收集到 117,103 B 已解压 WebSocket 帧，未提供线缆压缩字节。连接断开使 harness 无法通过 UI 清理；随后按两个精确 synthetic ID 与标题前缀校验，只从 `~/.proma-dev` 删除本次建立的两个会话索引项和会话文件，余下原有 6 条记录未改。
- 压缩握手：iPhone UA 与 Android UA 对 `/api/ipc` 均为 **101**，扩展为 `permessage-deflate; server_no_context_takeover; client_no_context_takeover`。独立 Node 线缆侧探针的 118,784 B 高重复文本帧压缩为 335 B、RSV1=true。Chrome CDP 的 `Network.webSocketFrameReceived.payloadData` 是解压内容，`Network.dataReceived` 未提供 WebSocket 编码字节，故未声称测得大会话实际压缩线缆量；iOS Safari 真机仍未测。
- `mobile-polish` 归因：从 `9f7cfcac` 读取旧版 harness 并复跑，重现“目标会话在侧栏不可见：回复 pong”。旧 harness 假设既有 `回复 pong` 会话位于当前侧栏可视区；改为本轮自建源/目标会话后，当前分支 iPhone mobile-polish **2/2 单击检查通过**、0 exceptions。该失败归因于 harness 夹具/可见性假设，不是新历史功能的侧栏回归。
- `web-remote-server.test.ts` 单独复跑仍为 **0 pass / 2 fail**：Electron mock 初始化报 `Export named 'app' not found`，后续 `server.stop` undefined 为清理连带错误。该测试文件相对 `9f7cfcac` 未改动；本轮未扩大 Electron mock 修复范围。
- 最终验证：`mobile-preview.sh test` 默认 **9/9 套件通过**（原 8 套 + `iphone:heavy-session`），所有套件 **0 JS exceptions**；mobile-polish 单击检查 2/2。`bun test` **542 pass / 0 fail**（84 files，1,226 assertions），Electron typecheck 通过；`build:main`、`build:renderer`、`build:web-preload` 均通过，Renderer 保留既有大 chunk warning。独立重跑 `web-remote-server.test.ts` 仍为 0 pass / 2 fail：Electron mock 缺少 `app` 导出，之后 `server.stop` undefined 为清理连带错误；该测试文件与 `9f7cfcac` 相同，未归因于本次改动。`git diff --check` 通过。开发实例、17889/5173、8443 Serve 与 iPhone 17 Pro 模拟器均保持运行；未 push、合并、打包或运行安装更新；正式 Proma 未退出/重启。

## 2026-09-29: 修复 continue_delegation 后不再自动唤醒

- 现象：父会话 01:52 被唤醒并用 `get_delegation_results` 收回 `05c70f81` 的结果（标记 consumed），随后用 `continue_delegation` 让子任务补做验收；03:52 子任务再次完成时 main.log 记 `[子任务唤醒] consumed: delegationId=05c70f81…`，未唤醒——consumed 标记没有随委派重跑清除。
- 修复：`personal-delegation-wake.ts` 新增 `markPersonalDelegationRestarted`；`agent-collaboration-tools.ts` 在 `continue_delegation` 把委派重置为 running 时调用一行清除标记。新增单测；全量 618 pass / 0 fail。待打包。
- 同日记录：上游改动面第 1 阶段（报告在 `.context/proma-personal/upstream-surface/phase1-2026-09-29.md`）结论为第 2 阶段暂缓，下次正式 tag 同步时按实际冲突决定，并顺带把 `useGlobalAgentListeners.ts` 个人版恢复逻辑迁出；仓库已开 `git rerere`（autoupdate=false）。

## 2026-09-29: Web Remote 历史图片与原文按需加载

- 历史消息只在 Web Remote bridge 返回值中转换，桌面端 IPC 不变。单图解码后 ≤256 KB 可作为内联数据由移动补丁生成 `<img>`；每个返回页（首屏或“加载更早”）从较新的消息向前分配，原始图像字节合计 ≤1 MB。更大的图片是含机器可读媒体标记的文本块，手机显示大小卡片，点按后按需读取原图。窗口预算在插入 base64 后再次核验；多轮时必要则从尾部向前缩窗，单一超预算轮次仍保留完整。
- tool_result 文本仍先裁至 16 KB，追加可识别原文标记与“点按查看完整内容（原文 X KB）”；手机按需取回并原位展开。完整原文上限 2 MB，单张按需图片上限 25 MB。
- 标记为 `[[proma-web-remote-media:<base64url JSON>]]` / `[[proma-web-remote-text:<base64url JSON>]]`，载荷包含 `sessionId`、SDK `uuid`（如无则用 SDK 数组索引）、消息 SHA-256、块路径、MIME/字节数及原文 SHA-256；内联小图另带数据。`uuid` 在 SDK 历史中唯一时优先定位；缺少 UUID 时使用数组索引并强制校验整条消息 SHA-256，消息移动或变化时拒绝而不猜测。
- 新增 `web-remote:get-history-media` 为 `read/session`，只在真实 session resolver 存在时注册；IPC 鉴权仍先验证目标 session 的工作区授权，再按 UUID/索引、消息摘要和路径解析图片或原文。失配、不唯一、缺少目标、文本/图片超限均返回明确错误。大结果复用现有 WebSocket 分片/进度超时。
- 手机补丁以 text-node marker 识别卡片，状态标记管理加载、失败可重试与原位展示；未比较 `innerHTML`/SVG 字符串，MutationObserver 收敛测试覆盖已变换的占位。
- 变更文件：`sdk-history-window.ts`、`sdk-history-window.test.ts`、`web-remote-ipc.ts`、`channel-policy.ts`、`full-ui-security.test.ts`、`mobile-patch/mobile-js.ts`、`mobile-patch.test.ts`、`scripts/personal/mobile-harness.mjs`、`docs/personal/web-remote.md` 与本记录。**未改任何上游 renderer 文件，新增上游钩子 0 行**。
- 测试：Web Remote 历史/分级/mobile patch 定向测试 **25 pass / 0 fail**（113 assertions）；全量 `bun test` **623 pass / 0 fail**（94 files，1,415 assertions）；Electron typecheck、`build:main`、`build:renderer`、`build:web-preload` 通过；`node --check scripts/personal/mobile-harness.mjs` 与 `git diff --check` 通过。Renderer 保留既有大 chunk 警告。
- 手机弱网验证：iPhone UA Chromium、300 ms 延迟、下行 3 Mbps、上行 1 Mbps，33,594,585 B 合成 SDK JSONL；首屏 **8,023 ms**，加载更早后 236→472 个消息节点，最大解压帧 245,870 B、解压接收 payload **2,842,207 B**，CDP 线缆字节不可用（0 个 `Network.dataReceived` WebSocket 事件），JS exceptions **0**。小图 `naturalWidth=32`，大图点按后 `naturalWidth=32`；长文本原文从 16 KB 预览取回并在原位展开至 **65,562 字符**。默认 `mobile-preview.sh test` **9/9 套件通过**。此前全部占位版本记录的基准为 33,408,055 B 输入、7,911 ms、2,808,871 B 解压 payload；本轮增加 SVG 小/大图后输入大小不同，故只作指标参考，不宣称严格同文件字节对比。
- 另按基线开关关闭窗口/瘦身与分片，用本轮 33,594,585 B 输入复跑原始响应策略：**40,364 ms** 仍未显示历史，随后 IPC 断开；部分解压帧 145,432 B，不能代表线缆传输字节。该次异常使两个合成 session 索引项未能自动删除（合成 JSONL 已移除）；随后以标题前缀校验并按精确 ID 经开发实例 IPC 删除，专用 `cleanup-synthetic` suite 通过，未改动其他会话。
- 增加 `media-demo` harness suite，并在开发实例保留“手机图片演示”会话。
- 在 `~/.proma-dev` 保留一条全合成演示会话“手机图片演示”（JSONL **465,051 B**，小图 111 B、大图 307,384 B、长文本 54,024 B），经 harness 重载后历史首条可见。其它本轮合成大会话/会话已清理；开发实例工作区中原有记录未改。
- 未运行 `install-update.sh`、未打包/push/合并；未触碰正式 `~/.proma` 或已安装 Proma 进程。

## 2026-09-29: 父会话复核历史图片批次

- 复核 `5af07180`：上游文件 0 行改动；新通道 `web-remote:get-history-media` 分级 read/session；全量 623 pass。
- 父会话修复：`mobile-js.ts` 中标记载荷解析失败时原样放回 `[[proma-web-remote-…]]` 文本，会被 MutationObserver 反复命中并替换（潜在死循环）；改为替换为“标记无法解析，请在桌面查看”提示。新增单测；全量 624 pass / 0 fail。

## 2026-09-29: 手机大会话批次合并（待安装）

- 合并 `fix/mobile-heavy-sessions`：尾部分页 + 加载更早、瘦身、保守压缩、分片按进度超时、小图直显 / 大图与长文本点按加载（`web-remote:get-history-media`）、continue_delegation 后重新可唤醒、标记解析失败防循环。用户 2026-09-29 12:49 同意打包。

## 2026-09-29: 安装 a6775099（Claude Code）

- 结果：成功，未回滚；`/Applications/Proma.app` = `a6775099`，previous = `cb94c897`，本机最新备份 `20260929-125237-70276`（BACKUP VERIFY PASS，SNAPSHOT MATCH，会话 921）；`20260928-235900-30636` 已归档外置硬盘。钥匙串同证书升级弹 1 次（19 秒，始终允许），与前三次一致。
- 验证：main.log `[FATAL]`/`[ERROR]` 为 0，DEP0180 为 `[WARN]`；桌面“Proma personal”历史完整；两台手机在 **Wi-Fi** 下打开该 36 MB 会话十秒级、加载更早 / 小图 / 大图点按 / 截断展开 / 发送 / 通知均通过。`[子任务唤醒]` 的 `[INFO]` 分级待长期观察。
- **蜂窝网络不可用（未解决）**：对照实验（15:50–15:57，OPPO 蜂窝，官方 Tailscale App）——16 KB 图标秒出；`/app/` 约 1 分钟出框架、内容 2 分钟以上未完成。路径直连（33 ms），官方 Tailscale 与代理内置 Tailscale 无差别；服务端采样 Mac→手机平均 62 KB/s（约 0.5 Mbps），回环 Send-Q 最高约 475 KB（应用数据已就绪，瓶颈在链路）；窗口内下发 9.66 MB。已知体量：会话索引 `agent-sessions.json` 3.85 MB、前端资源 brotli 约 5.3 MB（更新后首次需重下）、历史尾部 ≤ 2 MiB。推断运营商对直连 UDP 限速（未证实）。
- 处理：`CLAUDE.md` §6 第 7 项加入“更新后先在 Wi-Fi 下打开一次 `/app/`”；应用侧降载（会话列表精简、服务端计量、蜂窝首屏预算）另立批次。
## 2026-09-29: 蜂窝弱网降载实现（待开发实例端到端验收）

- Web Remote IPC 计量按 device/channel 汇总响应 JSON 原始字节、应用层发送字节、`deflateRawSync` 压缩估算、调用数、耗时、分片数与发送队列 `bufferedAmount` 峰值；WebSocket 关闭单独记录 close code/reason。静态 HTTP 汇总设备、相对资源路径、原始/实际发送字节、估算压缩字节、耗时及请求次数。均通过 `recordPersonalInfo('Web Remote 计量', ...)` 每 30 秒或连接关闭写 `[INFO]`，正文不保存；开发模式已认证端点 `GET /api/dev/metrics` 返回内存 JSON，生产关闭。`ws` 无法直接读取 permessage-deflate 线缆字节，估算字段不代表线上实测；HTTP Content-Length 为实际发送编码字节。
- 仅 Web Remote 的 `agent:list-sessions` meta 转换删除 `delegationGoal`、`piSessionFile`，`piEntryBindings` 保留 message key 并将 value 替换为 `true`。桌面 IPC 不经过此转换。renderer 仅使用 `AgentHistorySelectionLayer.tsx` 的 `parentSession?.piEntryBindings?.[messageId]` truthy 判断，因此当前/历史分叉可见性语义保留；未发现 renderer/preload 对前两字段有读取。
- 仿照字段统计的合成 900 会话索引：瘦身前 3,163,631 B，瘦身后 289,031 B（减少 90.9%，低于 300 KB，无需分页）。合成数据只包含字段形状与重复填充内容，不复制正式会话正文。删除字段清单：`delegationGoal`、`piSessionFile`；`piEntryBindings` 的 value 替换为 boolean。
- Web Remote shim 对并发且参数相同的 `agent:list-sessions` 合并为单请求，完成后清除缓存项，后续调用仍可重新获取；不会改变桌面请求行为。请求次数的实际手机冷启动统计需开发实例 harness 实测。
- 手机 shim 根据 `navigator.connection` 的 `slow-2g`/`2g` 或 downlink < 1 Mbps 自动启用省流量模式；顶部开关将 on/off 记入 localStorage，手动选择覆盖自动判断。模式开启时历史预算 256 KiB、内联图片预算 0；关闭时为原 2 MiB/1 MiB。图片统一改为点按加载。
- 新增 `cellular` harness suite：CDP 下行 0.5 Mbps、50 ms RTT，打开合成大会话，记录 WebSocket 接收 payload 与开发计量 JSON；目标首屏 30 秒。尚未执行 cellular suite、更新后清缓存/已缓存两组、baseline 对照及全默认 mobile-preview 回归；因此未得出首屏新旧实测耗时或完成对 9.66 MB 的通道拆账。合成 900 索引通过单测验证瘦身数字。
- Service Worker 仅处理 push/通知，不缓存导航、静态文件、API 或 WebSocket。Wi-Fi 后台预取可以通过 install/activate 预缓存静态 hash 资源实现，但需先取得资源清单并处理版本激活、存储配额、过期资源清理与并发更新；若错误地 `cache.addAll` 大资源可能耗流量、占空间或延迟新版本使用。本批评估后未实现。
- 验证：专项 28 pass；全量 `bun test` 629 pass / 0 fail；`bun run typecheck` 通过；`build:main`、`build:renderer`、`build:web-preload` 通过。`build:renderer` 仍报告既有大 chunk 警告；未修改 Vite 上游拆包配置。
- 未运行安装、更新脚本、打包或 push；未触碰正式 `~/.proma` 与已安装 Proma 进程。开发实例 start/sim 与 cellular/mobile-preview 测试待本轮结束时执行。

## 2026-09-29: 蜂窝降载开发实例验证补记

- `mobile-preview.sh test` 默认套件通过：iPhone panel-probe/smoke/mobile-polish/layout/dead-socket/heavy-session，Android smoke/attachments/dead-socket；大会话首屏 8,028 ms，2.83 MB 解压 payload，0 JS exceptions。另 `iphone:cellular` 通过：CDP 50 ms / 下行 0.5 Mbps / 合成 32 MiB JSONL，弱网模式首屏历史 **4,754 ms**，WebSocket 解压 payload 共 276,617 B（最大帧 249,328 B），0 exceptions；省流量模式标识开启、所有图像均未内联，点按大图成功；加载更早消息 28→56。该测试进入会话时 app 静态资源已在 harness 前置加载，属于已缓存资源 + 低速历史 IPC 验证，不代表更新后清缓存的完整 `/app/` 冷启动耗时。
- 冷启动 IPC 计量摘要中 `agent:list-sessions` 1 次 / 9,447 B（当前开发数据）；同时 harness 多步骤及周期活动产生的后续采样中 `agent:list-sessions` 6–7 次、总 56,942–64,261 B。后续重复调用有移动端存活/显示周期等来源；shim 已做并发合并但不缓存串行轮询。HTTP 静态计量跨 harness 连接汇总的一次记录：60 次、原始 8,224,870 B、实际发送 3,245,958 B；不是单次冷启动口径。`agent:get-sdk-messages` 的 `sentBytes` 是应用层序列化/分片帧估计，不是 WebSocket 压缩线缆字节；这轮 CDP `encodedDataLength` 对 IPC WebSocket 为 0。
- `PROMA_WEB_REMOTE_HEAVY_SESSION_BASELINE=1` 环境对照在相同 50 ms / 0.5 Mbps 下等待 40.4 秒未显示历史，并有 WebSocket/renderer 连接中断；支持“旧式无历史窗口策略在弱网超时”的基线结论。baseline 对照在 IPC 中断后 harness teardown 无法完成，随后已通过独立的 harness 清理步骤移除自建会话与 JSONL；核实开发会话清单恢复原有条目，未触碰其它会话。为使启动脚本支持该试验，`mobile-preview.sh start` 现在透传该可选环境变量。
- 首屏资源方面没有完成“更新后清缓存”与“静态资源缓存关闭”两组 under-throttle 对照；未证明完整 `/app/` 框架时间下降。旧 9.66 MB 的各项实际贡献仍不能由本次历史通道样本反推；新的 0.5 Mbps 套件只在会话数据阶段启用节流。
- 上述计量/弱网回归与 build/typecheck 结果见上一节；`mobile-preview.sh start` 与 `sim` 在最终检查阶段保持运行（sim 状态待最终记录）。

## 2026-09-29: 父会话复核蜂窝降载批次

- 复核 `097b4e74`/`84ef7aae`/`189446ad`：无上游文件改动；会话列表对手机去掉 `delegationGoal`/`piSessionFile`、`piEntryBindings` 值改 true（合成 900 会话 3.16 MB → 0.29 MB）；并发同参列表请求合并；省流量模式（256 KiB 历史、图片全部点按）；0.5 Mbps 已缓存资源下历史首屏 4.75 s。全量 629 pass。
- 父会话修复：`/api/dev/metrics` 原以 `NODE_ENV !== 'production'` 判定开发环境，打包主进程未必设置该变量，可能在安装版暴露；改为仅在配置目录为 `.proma-dev` 时提供。
- 说明：蜂窝慢的根因确认为运营商对直连 UDP 限速（用户确认），降载只是辅助；根治方案（国内自建 DERP + Mac 侧阻断外网直连 UDP）另行推进。

## 2026-09-29: “加载更早”改为顶部小条 + 会话列表 3 秒短缓存

- 用户反馈（OPPO 截图）：“加载更早（已省略 N 条）”固定悬浮在顶栏下方居中，文字折行、遮挡会话标题与正文。
- 修复（`mobile-js.ts` / `mobile-css.ts`，个人版文件）：改为紧凑单行小条 `[data-web-remote-history-bar]`（“↑ 加载更早 · N 条” + “省流量 开/关”），定位在消息滚动区顶部下方 8 px，**只在消息列表滚到顶部附近（≤ 80 px）时显示**，阅读中不再遮挡；省流量开关从顶栏移入该小条（顶栏保持 4 个图标，避免挤压标题）。点“加载更早”直接用历史元数据中的会话 ID，不再为此拉取整份会话列表。滚动监听用 WeakSet 去重，DOM 写入经 `setIfChanged`。
- `ipc-request-dedupe.ts`：`agent:list-sessions` 在并发合并之外增加 3 秒成功结果复用（失败不缓存），减少弱网下启动与交互中的重复下载。
- 验证：全量 630 pass / 0 fail；harness heavy-session（小条 top 112 px 位于顶栏 56 px 之下，宽 223 px 单行）、cellular（0.5 Mbps 首屏 4.3 s）、android smoke、iphone layout 11/11 通过。用户同意跳过开发实例体验，直接随蜂窝批次打包。

## 2026-09-29: 蜂窝批次合并（待安装）

- 合并 `fix/mobile-cellular`：Web Remote 计量（dev 端点仅开发实例）、手机会话列表瘦身（约 −91%）、列表请求并发合并 + 3 秒复用、省流量模式、加载更早小条、蜂窝回归套件；并记录自建 DERP 中继与 Mac pf 规则（运维配置，非应用代码）。用户 2026-09-29 17:38 同意跳过开发实例体验直接打包。


## 2026-09-29: 安装 9b956f2b 与交接补充二

- 安装成功、未回滚，健康检查与快照一致；钥匙串弹 1 次（11 秒），OPPO 蜂窝测试通过。桌面与手机顶部小条、发送、通知通过。
- iPhone 最初蜂窝失败，交接补充二确认：tailnet 改为 `OmitDefaultRegions: true`、仅自建区域后恢复；不再安排重复的官方 iOS App 对照。无官方中继后备的风险由用户接受。此前文档“故障自动回落官方”的说法已在手机 SSOT 和回退手册纠正。
- 备份在外置硬盘“proma 自建中继/”，仅含 derpMap、Mac pf 与恢复说明，不含服务器证书/私钥/derper 配置/安全组。证书到期 2027-09-29；已创建北京时间 2027-08-01 09:00 的续期日程及提醒。
- 应用待办仍有效：每约 15 秒全量取会话列表；正式单次列表原文约 2.67 MB（未达此前合成数据估算）；分片 base64 膨胀、真实压缩与缓存待复核；计量日志过长被截断。此前“列表必降到 0.5 MB 以下”不适用于本次正式数据，不能以合成测试替代真实负载验收。

## 2026-09-29: 手机会话列表空闲降载、按需字段与完整计量

- **正式数据只读统计**：只读取 `~/.proma/agent-sessions.json` 的 JSON 结构与字段长度统计，没有输出/复制会话正文，也未改写正式数据。文件 3,964,154 B，925 条 session；`sessions` compact JSON 3,336,840 B。旧 `slimWebRemoteSessionMeta` 删除 `delegationGoal`、`piSessionFile` 并把 `piEntryBindings` 值改为 `true` 后仍为 **2,673,351 B**：699 个 `piEntryBindings` 字段共 2,437,800 B、合计 48,754 个键（键数 min 0 / median 19 / p95 240 / max 2,372）；194 个 `delegationGoal` 值共 275,773 B；700 个 `piSessionFile` 值共 79,800 B。仅改 `piEntryBindings` 的值不能缩短保留的键；此前 900 条测试夹具每 session 固定 5 个短键，没复现正式数据的长尾键数量，因此 0.29 MB 结论失真。
- **合成字段体量验证**：安全测试构造 925 条全合成索引，按正式 count/长度分布覆盖超长 binding keys、delegationGoal、路径、ID/标题/工作区及常见运行字段。紧凑 JSON：未瘦身 **3,302,755 B**；旧瘦身仍 **2,720,817 B**；现在删掉 `delegationGoal`、`piSessionFile`、整张 `piEntryBindings` 后 **459,407 B**。正式数据按同一新瘦身得到 **514,194 B**。该字段级测量是本机合成/本机只读结果，不冒充真实网络测量；编解码与分片还会增加应用层字节。
- **根因与修复**：从 `mobile-patch/mobile-js.ts` 实际追到每 5 秒 push-presence 心跳调用 `listAgentSessions()`；既有同参复用只有 3 秒，无法抑制串行 5 秒轮询（安装记录约每 15 秒的窗口实测与该根因吻合）。心跳现在首次解析、标题/请求会话改变、回前台时才读取列表，其余心跳复用已解析 session ID；查不到 session 也会缓存解析结果，避免无会话页面反复全量取数。手机隐藏时不强制重查；桌面路径不变。原 3 秒合并/短缓存仍仅用于互斥和邻近重复请求，不再作为长期轮询方案。
- **列表字段与授权**：`agent:list-sessions`、`agent:list-active-sessions`、`agent:list-archived-sessions` 都不再向 Web Remote 返回 `delegationGoal`、`piSessionFile`、`piEntryBindings`；仍返回完整列表，保留搜索、筛选、归档与定位能力，不作“最近 30 条”截断。回复探索在用户触发时才通过新增 `web-remote:get-session-entry-bindings` 取目标 session 的键→true 映射；该通道显式分级为 `read/session`，既有 session→workspace 授权检查拒绝其他工作区。测试覆盖活动/归档列表瘦身、敏感字段不存在以及授权/越权结果。
- **计量**：不改变通用错误日志 240 字符限长。IPC 每个通道现在写短结构 JSON 行（短窗口 ID、SHA-256 截断设备伪名、channel、calls/耗时；UTF-8 response、应用 framing、Base64、应用层总发送；deflateRaw 估算、`wireBytes:null`、chunks、bufferedAmountPeak）。分行后单体 JSON 仍完整落入 INFO writer；`personal-main-log.test.ts` 从实际主日志文件读回并解析三类完整行。应用层分片/编码字节、压缩估算与真实线上字节明确分开；`ws` 未提供压缩后的线缆计数，真实 wire 记为不可测，不再把估算称为实测。
- **经 Serve / 空闲与弱网验证**：iPhone UA Chromium harness 经开发实例 Tailscale Serve 访问，WebSocket 握手 HTTP 101，实际协商 `permessage-deflate; server_no_context_takeover; client_no_context_takeover`。0.5 Mbps / 50 ms 下 32 MiB 大会话合成历史首屏 **4,364 ms**、CDP 解压 payload 251,164 B、线缆编码量未取得、0 JS exceptions；默认 iPhone/Android 9 套件 **9/9 通过**。单独 180 秒空闲同步套件经 Serve 与 0.5 Mbps 节流运行 183,411 ms：初始页面当前真实开发数据列表 `agent:list-sessions` **1 次 / responseUtf8 3,761 B**；计量基线之后 180 秒该通道 **0 次 / 0 B response / 0 B appSent / 0 B buffered peak**，0 JS exceptions。初始列表为开发实例现有数据，不是 925 条合成列表；925 条 fixture 尚未经 Serve 做全量索引端到端测量。
- **编码与静态缓存核查**：不改 WebSocket 二进制协议，理由是当前已确认客户端按序重组、UTF-8/中文分片和连接失败回归均通过，且没有测得实际线缆带宽可证明改二进制收益大于风险；既有本机线缆探针记录的压缩帧结果不等于 Serve 线上实测。hash 静态 JS 由 server 设置 immutable Cache-Control 与 ETag，已有 server 测试验证 If-None-Match 返回 304。客户端 reload 来源是用户点击刷新，或生命周期恢复回调缺失/失败时的兜底 reload；本次未复现一个可修复的无谓 reload。iOS Safari 真机未测，CDP 解压帧不作线缆计量。
- **验证**：定向 Web Remote、安全分级、移动补丁与日志测试通过；全量 Bun 测试 **634 pass / 0 fail / 0 error**（96 files、1,472 assertions）；`bun run typecheck`、`build:main`、`build:renderer`、`build:web-preload` 通过；`node --check scripts/personal/mobile-harness.mjs`、`bash -n scripts/personal/mobile-preview.sh`、`git diff --check` 通过。Renderer 构建保留已有 500 KB 大 chunk 警告。
- **尚未证明/未完成的验收边界**：本机合成 925 条索引未注入/经 Serve 端到端测试；本轮未逐项操作“新建/改名/归档/删除”并测量每类变更可见延迟，也未做跨 workspace 的真浏览器列表切换 E2E；已有 9 套手机回归、列表权限单测和断线重连套件通过，不能替代以上专项验证。更新延迟目前没有实测数值；正式设备真实 iOS Safari 未测试；实际 WebSocket 线缆字节无法由当前指标取得。
- **保留开发实例**：`mobile-preview.sh start`、开发端口 17889/8443 与 iPhone 17 Pro 模拟器已启动并配对，供用户体验；harness 自身临时 Chrome/设备授权已清理。未运行打包、安装、合并或 push；未停止正式 Proma，也未修改 Tailscale/DERP/pf。

## 2026-09-29: 手机会话列表同步验收补齐（父会话复核）

- 925 条合成会话（按正式索引字段分布：`piEntryBindings` 48,754 键、`delegationGoal`、`piSessionFile` 等）临时注入开发实例（测试后按标记移除，开发索引与备份逐 ID 一致）。经 Tailscale Serve、0.5 Mbps / 50 ms：首屏 `agent:list-sessions` 1 次，原文 409,409 B、应用层实发 546,201 B（base64 分片 ×4/3）；此后 183.4 s 空闲 0 次、0 B。
- 新增 harness 套件 `session-sync`（只改本次新建会话）：本端改名 0.2 s 可见；外部（绕过本端渲染状态）改名/新建/删除**不实时**，断线重连后全部正确同步；归档从 active 列表移除；回复探索节点按需读取可用；0 JS 异常。复核代码：被移除的“在线状态上报”轮询从未把列表写入 renderer 状态，外部变更不实时是修复前即有的行为，本批未回退；如需实时应另加主进程会话变更推送事件。
- 全量回归中 iphone smoke / android attachments（模型未回复）与 iphone heavy-session（加载更早未增加）在长时运行的开发实例上失败；开发实例随后收到外部“Polite quit”退出。重启后三套复跑全部通过。全量 634 pass / 0 fail；typecheck、main/renderer/web-preload 构建通过。
- `mobile-preview.sh test` 单套超时由 420 s 调为 600 s（idle-session-sync 需 180 s 观察外加配对与清理）。

## 2026-09-30: 受限导入真实备份工作区到开发实例

- 新增 `scripts/personal/import-session-workspace.py`：默认 dry-run；`--apply` 只接受本机备份根中的单一来源工作区，且仅在 `~/.proma-dev` 不存在时写入会话索引、该工作区元数据与对应 JSONL。将 JSONL/元数据中的正式 `/.proma/` 路径引用改写为 dev 路径；新根目录权限 `0700`、数据文件 `0600`。不导入正式设置/渠道/密钥、Automation、Bridge、MCP、OAuth、Keychain、授权设备或推送订阅，不导入项目文件及其他工作区会话。
- 执行前将已有 dev 根与导入路径修复前的副本分别改名保留；其内容未删除。Web Remote 配置只从原 dev 授权状态中选择性恢复，启动前改为单工作区 `allowlist`；备份来源本身只读。复核导入根没有正式 `/.proma/` 路径引用，且目标 `~/.proma-dev` 仅包含一个工作区的 830 条会话元数据、826 个对应 JSONL。真实目标 JSONL 为 **41,914,743 B**；缺失的 4 份 JSONL、旧 Pi runtime artifacts、附件文件和项目文件未从其他备份区域补齐。
- 真实负载压力测试（iPhone UA Chromium，经开发 Serve；下行 **524,288 bit/s（约0.5 Mbps）**、50 ms RTT、上行 1,048,576 bit/s）：列表 830 条，responseUtf8 **459,730 B**、应用发送 **613,300 B**、fresh-list **10,135 ms**；41,914,743 B 历史首次可见 **4,349 ms**。历史 IPC response/app **197,907 B**，CDP 解压 WebSocket payload **140,728 B**，deflate estimate **58,844 B**，bufferedPeak **2,796,190 B**；实际线缆字节未取得。该 0.5 Mbps 数值仅是压力测试，不代表当前中继带宽。
- 用户截至本日给出的当前中继带宽为 **3 Mbps**。本轮未在3 Mbps下完成真实列表/历史/空闲专项：开发进程当时已无17889监听，8443 Serve 路由虽留存但上游不可用；旧 `mobile-preview.sh start` 会间接调用按名终止脚本，独立安全启动入口尚未就绪。未为继续测试而运行旧启动链或新增按名清理方案。后续需等安全启动入口完成，再记录3 Mbps当前条件结果。
- 更新：本记录与 [`web-remote.md`](./web-remote.md) 中的受限导入、安全边界、压力测试与 3 Mbps 未完成状态同步。模型渠道未导入；手机界面显示“暂无可用模型”是有意隔离结果，未用于本批历史/元数据测试。

## 2026-09-30: 会话索引写入发布脱敏增量事件

- `agent-session-manager.ts` 在 `writeIndex()` 单一持久化点比较前后安全投影，覆盖创建、普通元数据更新、归档/恢复、置顶/星标、跨工作区迁移与删除。每进程使用随机 boot `epoch` + 单调 `sequence`；`clearedFields` 显式表达旧可选分类字段被移除，避免客户端浅合并保留陈旧关系。投影按 renderer 实际消费保留 `parentSessionId`、`rootSessionId`、`sourceDelegationId`、`delegationStatus`、`sourceAutomationId`；不读的 `delegationRole`、`delegationDepth`、`automationGraduated`、`delegationGoal` 及 Pi artifact/entry bindings、路径不发出。
- `agent:session-metadata-changed` 明确登记为 `read/workspace`。服务端按授权 allowlist 裁剪并再次用安全字段白名单重建 payload；会话移出授权范围只发 session ID/remove，不含标题或目标工作区。Main IPC 与 Electron/web preload 添加只读订阅，桌面 IPC 原业务处理未改变。
- 定向安全与主进程测试 **45 pass / 0 fail**；测试覆盖写入点单调事件、创建/更新/移动/删除、字段脱敏、未授权 workspace 事件屏蔽及移出授权范围的 remove 映射。`bun run typecheck` 全 workspace 通过。
- 真实开发设备的 3 Mbps 验收仍因进程安全分支未就绪、17889 不监听而待办；相关 0.5 Mbps 数据只见上一节压力测试，不宣称已完成当前链路体验验证。更新 `docs/personal/web-remote.md` 会话元数据事件契约段。

## 2026-09-30: Renderer 增量与权威快照原子合并

- `LeftSidebar` 按 `epoch`/`sequence` 接收事件；main-process 重启的新 epoch 可从 sequence 1 继续，不会被旧 ref 永久丢弃。重连时重置本地游标并触发权威 active/archive 快照。
- Renderer 全局 revision journal 记录被接受的增量。每个全量列表请求在发起前记 revision；快照返回后，只合并其基准之后发生的增量，避免旧快照覆盖较新标题/归档状态或复活已删除会话。侧栏 refresh 本身串行执行，期间事件缓冲并在快照提交后重放；global recover、自动任务刷新、Tab 恢复、工作区/会话表单/快捷菜单的全量 session snapshot 均复用同一合并 helper。
- 删除会话/移出 workspace 会关闭相关本地 Tab 并移除列表项；`clearedFields` 删除旧的父子、delegation、automation 分类属性而不是保留浅合并残值。删除墓碑与事件 journal 均限制为 **8,192** 条；超过 journal 保留窗口的 stale snapshot fail-closed（不覆盖当前缓存），待下一次权威快照。相同 session ID 的后续合法 upsert 会解除 tombstone。
- 新增 cursor epoch/sequence、两种事件消费者顺序、快照期间 rename/delete、同 ID remove→upsert 恢复、分类清除与 retention-floor 测试。相关测试 **50 pass / 0 fail**（按 main manager、full-ui security、agent-session-list 三文件），全 workspace typecheck 通过；全量 `bun test` 后续最终验证。
- E2E 仅依赖此前 0.5 Mbps 本地 harness 证据，session-sync raw IPC 操作测试 (非独立桌面进程控制) 实测创建 **0–202 ms**、改名 **0–1 ms**、归档 **1 ms**、恢复 **3 ms**、删除 **3 ms**，断线回补全部成功；限单工作区实际请求越权创建被拒。跨 workspace 的 manager move 与 server 移出授权 remove 由单测覆盖，**没有**为E2E临时开放第二个工作区。
- 本 commit 无 3 Mbps 真实 E2E：开发安全启动入口尚未交付，17889/5173 没有监听且 8443 临时 Serve 已关闭。当前链路结果必须等待独立安全任务；模型渠道与历史附件文件仍未导入。

## 2026-09-30: Harness 异常按动作开始基线计量

- `mobile-harness.mjs` 对每个专项显式记录动作前 exceptionCount；结果拆成 `preActionExceptionCategories` 与 `newActionExceptions`。只用精确的 WebAssembly/CSP 类别标注既有初始化异常；**没有**按异常文本过滤动作期间的任何异常。新增单测证明动作期间再次出现相同 WebAssembly/CSP 异常仍计为新异常，并与其他 JS 异常一起失败。
- 已保存的 0.5 Mbps stress 结果显示真实目标历史加载期间新增异常为 0；执行前页面存在 1–2 个已知 WebAssembly.instantiate/CSP 初始化异常。它们未通过 `unsafe-eval` 或放宽 CSP 绕过；当前开发服务不可安全启动，故本 commit 不重复运行 E2E、不将该历史结果标为 3 Mbps 验收。
- 验证：`bun test scripts/personal/mobile-harness.test.mjs` **1 pass / 0 fail**；`node --check` 与 `bash -n` 通过。仅调整 harness/test 汇总，不改开发进程清理或启动/停止逻辑。

## 2026-09-30: 会话同步离线收尾与验证边界

- 分阶段提交（均保留在 `fix/mobile-session-sync-20260929`，未合并/push）：受限导入 `a0c97d09`、metadata epoch/classification/clearedFields `4543e554`、revision journal/tombstone/snapshot merge `55d4d4ae`、harness exception baseline `273d9b3b`。
- 最终离线验证：全量 `bun test` **643 pass / 0 fail**（97 files，1,560 assertions）；`bun run typecheck` 全 workspace 通过；`build:main`、`build:renderer`、`build:web-preload` 通过。Renderer 保留已知 >500 KB chunk 警告；`git diff --check` 通过。
- 新版 harness 单测验证：仅按动作开始前计数确定基线；所有之后异常（含同类 WebAssembly/CSP）都计为 action exception。项目当前已知初始化类目为 `WebAssembly.instantiate` 被现有 `script-src` CSP 拒绝；不加 `unsafe-eval`、不改变 CSP。
- **3 Mbps 真实备份/双端 E2E 未完成**：已安全确认开发实例端口 17889/5173 不监听；临时 8443 Serve 路由已关闭。独立开发进程安全启动任务仍未就绪；根据用户指示没有调用旧 `mobile-preview.sh start`/`dev.sh` 链，没有修改或清理该独立任务。不得将此前 0.5 Mbps压力数据或 Chromium raw-IPC harness 当作当前3 Mbps双端实测。
- **本轮未测**：独立桌面进程/实体手机各操作的3 Mbps传播延迟、真实跨 workspace move E2E、Smoke/附件回答（隔离 dev 未导入模型渠道/钥匙串）、源备份外部附件/旧 Pi artifact 可用性、真机 iOS Safari。workspace 越权由 full-ui security 单测和单工作区端到端拒绝探针覆盖；子会话/自动任务分类字段由投影与 renderer reducer 单测覆盖。
- 将新增触碰的上游文件、逐文件增减行数与理由追加至本机 `.context/proma-personal/upstream-surface/phase1-2026-09-29.md`（不入库）；`docs/personal/web-remote.md` 更新为 3 Mbps 是当前目标、0.5 Mbps仅为压力测试。

## 2026-09-30: 开发入口临时移除按名进程清理

- 安全链路审计确认仅删顶层 `dev` 的 `dev-kill.ts --vite` 仍会从 `dev:electron` 间接执行 `dev:kill`。因此在 `apps/electron/package.json` 临时移除 `dev` 与其子项 `dev:electron` 中的两处自动 `dev-kill` 调用，保留 `concurrently` 和后续构建/监视流程；`scripts/dev-kill.ts`、`scripts/personal/dev.sh` 与独立进程安全分支均未改。
- 静态链路核对：`mobile-preview.sh start` → `scripts/personal/dev.sh` → `bun run dev` → `dev:vite`/`dev:electron` 的实际脚本值不再引用 `dev-kill`/`pkill`/`killall`/`taskkill`。`dev.sh` 原有“发现已运行 Personal Electron 即拒绝启动”检查保留。该临时措施只避免自动按名终止，不替代下个版本的PID/身份核验启动器。
- 开发实例与桌面正式 Proma 共享同一台机器的运行环境；后续测试期间不得为了重启 dev 退出/结束正式版。此步骤只做静态脚本链检查、package JSON 语法检查及 typecheck；未启动/停止任何进程、未执行测试 E2E，也未改 `~/.proma-dev`、Tailscale Serve 或端口。

## 2026-09-30: 拒绝退役 main-process epoch 的迟到事件

- Session metadata cursor 现记住 retired epochs：新 main-process epoch 即使从 sequence `1` 开始也接受；切换到新 epoch 后，迟到的旧 epoch 增量被拒绝，不能把 cursor 回滚。IPC 重连仍触发权威快照，不重置已识别的当前 epoch 顺序。
- 删除或移出授权范围均建立会话 tombstone；同一 session ID 在之后新 epoch 中重新 upsert 时解除 tombstone。相关状态保留以验证“移出授权工作区 → 同 ID 重新进入授权工作区”不会错误消失。
- 定向验证：`agent-session-list.test.ts` **8 pass / 0 fail**，`full-ui-security.test.ts` **30 pass / 0 fail**；全 workspace typecheck 通过。未启动开发实例/E2E，遵守进程安全分支的等待条件。

## 2026-09-30: Harness 网络条件默认对齐 3 Mbps 中继

- `mobile-harness.mjs` 的 `real-history`、`idle-session-sync`、`session-sync` 与大会话套件统一使用参数化 CDP 网络 profile；默认十进制速率为下行 **3,000,000 bit/s**、上行 **1,000,000 bit/s**、延迟 **50 ms**。结果 JSON 与 `mobile-preview.sh test` 汇总会回报实际 profile。
- 参数可通过 `--download-mbps`、`--upload-mbps`、`--latency-ms` 指定，或通过 `PROMA_WEB_REMOTE_DOWNLOAD_MBPS`、`PROMA_WEB_REMOTE_UPLOAD_MBPS`、`PROMA_WEB_REMOTE_LATENCY_MS` 环境变量传给 `mobile-preview.sh test`。0.5 Mbps 压力测试仍可显式选择，例如设置 `PROMA_WEB_REMOTE_DOWNLOAD_MBPS=0.5`；不再作为默认。
- 验证：Harness 单测 **2 pass / 0 fail**（覆盖 3/1 Mbps 默认及 0.5 Mbps 压力换算）；`node --check`、`bash -n`、`git diff --check` 通过。此为参数化实现与本地验证，尚非真实 `~/.proma-dev` 3 Mbps E2E 结果。

## 2026-09-30: 真实 3 Mbps 验收继续受安全启动门控

- 本轮新增提交：`b7e128b1` 临时移除启动链的按名清理调用；`20386656` 拒绝已退役 epoch 迟到增量并覆盖工作区移出后同 ID 恢复；`97066aa2` 将 Harness 网络条件参数化。提交均在 `fix/mobile-session-sync-20260929`，没有 merge、push、打包或安装。
- 上述安全计划 `dev-process-cleanup-safety.md` 仍标记“待执行”，完整 PID/进程归属安全启动入口尚未审查就绪。虽然临时 package 改动和静态 grep 已证明启动链不再调用 `dev-kill`、`pkill`、`killall`、`taskkill`，按用户约束仍未调用 `mobile-preview.sh start`/`dev.sh`，未启动或停止任何进程、未改端口/Tailscale Serve、未触碰正式版或 `~/.proma-dev`。
- 因启动门控未解除，未执行 830 会话列表、41.9 MB 历史、180 秒空闲、双端实时同步、越权隔离、临时会话清理/hash 核对；也未在本轮运行全量 `bun test` 与三个 build。定向验证仍以各前置条目所记录结果为准。此前最后一次环境快照显示 17889/5173 无监听、8443 Serve 关闭；本轮没有重新采集快照，也未改变该状态。

## 2026-09-30: Harness 仅按动作新增异常判定并精确识别 HTTP 429

- `evaluateHarnessExceptionWindow()` 统一将动作开始前的异常作为单独基线，只有动作期间新增异常使 session-sync、real-history、idle-session-sync 与大会话 suite 失败。结果 JSON 分开记录基线数量/类别与新增数量/类别；新增同类 WebAssembly/CSP 异常仍算失败。
- CDP `Network.responseReceived` 仅按结构化 HTTP status=429 记录服务响应；可读文本识别仅接受明确的 `HTTP 429`、`status 429` 或 `Too Many Requests`，不再用裸 `429` 子串。新增回归证明含 `429` 子串的会话 UUID 不会误报。
- 验证：Harness 单测 **4 pass / 0 fail**（含“基线 1、新增 0→通过；基线 1、新增 1 个同类 WASM→失败”）；`node --check`、`bash -n`、`git diff --check` 通过。实际 3 Mbps suite 尚待重跑。

## 2026-09-30: 等待初始化异常静默后再开始动作计量

- 修复后首个 3 Mbps 重跑观察到 2 条动作前 CSP 类异常及 1 条出现在过早基线之后的同类异常。没有按异常文本豁免；将 session-sync 的动作基线移至侧栏/工作区设置完成后，并在 real-history、idle-session-sync 与大会话 suite 的动作前等待有界异常静默期。任何静默期后出现的同类 CSP 异常仍然失败。
- 新增单测验证延迟到达的初始化异常会纳入动作基线；Harness 单测 **5 pass / 0 fail**，`node --check`、`bash -n` 与 `git diff --check` 通过。

## 2026-09-30: 补充归档命令的服务端/传输计量

- 两次既有 3 Mbps session-sync 结果的 `archiveCommandMs` 分别为 **7,687 ms、7,684 ms**，而 `archiveRemovedMs` 分别为 **25 ms、26 ms**，恢复调用为 **49 ms、55 ms**；这不像一次性抖动。启动后的 `agent-sessions.json` 为 **3,061,848 B**，3 Mbps 若完整传输该大小约需 **8,165 ms**，但该数值仅为相关性，不足以证明实际传输了全量索引。
- 代码路径确认 `agent:toggle-archive` handler 会读取全会话列表、更新并重写索引，再返回单条会话元数据。为区分主进程 handler 时间、是否重调全量列表以及 WebSocket 收发帧字节，Harness 增加 archive 前后 `/api/dev/metrics` 与帧体积差分；尚未得出根因或改动主进程路径。
- session-sync harness 现等待 `__PROMA_WEB_REMOTE_RECOVER()` 完成，并等重连后的 WebSocket 接收帧静默后才开始归档计时；恢复时延/帧数另行记录，避免把仍在途的权威快照误计为归档调用耗时。定向单测 **6 pass / 0 fail**，node/bash 语法与 diff 检查通过；实际重测尚未完成。

## 2026-09-30: 更正 77e2a992 的 3 Mbps 验收状态

- **历史更正（不改写 `77e2a992`）**：20:34 父会话更正，完整进程归属方案推迟到下个版本；本批临时提交 `b7e128b1` 已获批准，安全启动门槛解除。随后 `mobile-preview.sh start` 成功。启动前后正式版 PID `83615`、17888、Tailscale 443→17888 不变；开发启动器 PID `82401`、Vite PID `82429`，Web Remote 17889 最初由 PID `83386` 监听；8443→17889。全量 build 后 Electron 子进程重启为 PID `97427`，开发启动器仍运行，17889/5173 与 Serve 路由都保持在线。
- 本轮新增提交：`540a3249`、`db96babd`（异常基线）、`9c44054d`、`f2793e3c`（归档/重连计时诊断）；均未修改主进程代码、未 merge/push。
- **3 Mbps 实测**（下行 3,000,000 bit/s / 上行 1,000,000 bit/s / 50 ms）：`iphone:real-history` **通过**，授权列表 830 条，目标历史 JSONL **41,914,743 B**；列表 responseUtf8 **459,810 B**、appSent **613,404 B**、IPC **1,785 ms**；历史首屏 **4,346 ms**，history responseUtf8 **2,096,331 B**、appSent **2,796,367 B**。`wireBytes` 不可测。
- `iphone:idle-session-sync` **通过**，观测 **182,556 ms**，空闲窗口列表请求 **0**、响应 **0 B**、appSent **0 B**；初始化列表 2 次、responseUtf8 **919,619 B**、appSent **1,226,805 B**。
- `iphone:session-sync` 的完整 run 中草稿隐藏/推广、新建、改名、外部更新、删除/重连后消失、归档/恢复、entryBindings、单工作区视图、越权创建拒绝均为 true；完整 run 中 `archiveCommandMs=8,007`、列表移除可见 `1 ms`、恢复 `67 ms`。`agent:toggle-archive` 服务端 handler **24 ms**，该计时窗口同时完成了 1 次全量列表传输（responseUtf8 **460,162 B**、appSent **613,873 B**，WebSocket decoded frames **2,864,075 B**）。采纳父会话结论：约 8 秒是重连权威全量快照在 3 Mbps 下与计时重叠，归档本身不是回归；重连全量快照是本批设计，成本留待下版优化，本轮不改主进程。其后按新 Harness 边界的最终一次 suite 尝试在 `liveDeleteGoneMs` 等待时发生 CDP `Runtime.evaluate` **3,500 ms `page_unresponsive`**，未完整结束；按父会话要求不再重跑或继续调试。
- CSP 异常如实分开统计：real-history、idle-session-sync 各为基线 **2** 条已知 `WebAssembly.instantiate`/现有 `script-src` CSP 异常、新增 **0**；此前完整 session-sync run 为基线 2、新增同类 1。父会话确认此 CSP 缺陷在安装版也存在且不阻塞发版；Harness 仍计数，未放宽 CSP、未加 `unsafe-eval`。实际 HTTP 429 状态响应数 **0**；先前把会话 UUID 中的 `429` 子串误判为状态码，已在 Harness 修正。
- 清理：最终 CDP 超时 run 遗留的两个 `web-remote-sync-*` harness 会话按该 run 基线与标题前缀核实后，使用应用 `deleteAgentSession` API 删除；cleanup suite 明确删除 **2** 条、无错误，之后回到 **830** 条。after-start 与 after-cleanup canonical session SHA-256 均为 `090d9a28…467c7149`；826 个 JSONL 总字节 **535,970,089 B**，JSONL 集合 SHA-256 前后均为 `71688f45…43a53cac`。启动前原始索引 hash 为 `62a5992e…513f1c59`，启动后为 `bc0d6e2c…d875f977`；启动时索引指纹变化原因本轮未再追查。正式 `~/.proma`、备份和导入源未写入。
- 0.5 Mbps **旧压力对照**（非本轮）：830 列表 responseUtf8 **459,730 B**、appSent **613,300 B**、fresh-list **10,135 ms**；同一 41,914,743 B 历史首屏 **4,349 ms**。Smoke/attachments 未跑（隔离 dev 无渠道）；独立桌面 UI/真机 iOS Safari 和真实跨工作区移动也未 E2E。子任务/自动化分组、移出授权范围只发 ID-only remove、迟到旧快照不复活由本轮全量单测覆盖。
- 收尾验证：全量 `bun test` **648 pass / 0 fail**（97 files，1,581 assertions）；workspace typecheck 通过；`build:main`、`build:renderer`、`build:web-preload` 均通过。Renderer 仍有 >500 KB chunk 警告。未 merge/push/打包/安装；dev 与 8443 保持运行。

## 2026-09-30: 手机左侧栏仅在导航状态变化后收起

- 移除 mobile-patch document capture handler 对左栏任意点击都删除 `webRemoteSidebarOpen` 的行为。现在比较点击前后的导航状态：左栏中活跃会话的 `data-session-switch-id`/会话类型变化，或 Chat/Agent 模式 rail 的当前选中状态变化时才收起。活跃行暂时消失（如折叠分组）不视为导航；箭头、分组折叠、更多菜单/菜单项和输入操作保持抽屉打开。
- `forwardMobileControl` 未改；Todo、定时任务、MCP/Skills、项目记忆、日程、设置和新建会话仍沿用原有转发/收起路径。未改 `LeftSidebar.tsx` 等上游组件；补丁不比较 `innerHTML` 或 SVG 内容。
- 回归测试覆盖箭头点击、更多菜单、分组折叠不收回；会话选择与 Chat/Agent 模式状态变化收回。`mobile-patch.test.ts` **5 pass / 0 fail**；全 workspace typecheck 与 `build:main` 通过。
- dev 自动重载后状态核验：启动器 PID `82401` 运行，17889 由 PID `8911` 监听，5173 由 PID `82429` 监听，Serve 8443→17889；正式版 PID `83615` 与 443→17888 未变。`~/.proma-dev` 保持 830 条，会话与 JSONL 集合 hash 未变。未运行 harness、未 merge/push/打包/安装。

## 2026-10-01: 安装 2f13f490（手机会话实时同步批次）

- Claude Code 00:24 用 `install-update.sh` 安装 `2f13f490`（0.19.58），EXIT=0，备份校验通过，前后快照一致；钥匙串弹窗 1 次。previous 轮换为 `9b956f2b`。
- 健康检查：17888 监听、Serve 仅 443 → 17888、main.log 无 `[FATAL]`/`[ERROR]`、17 个启用任务无过期 `nextRunAt`、会话与渠道数与安装前一致。
- 手机：用户 00:43 确认两台手机测试通过（列表速度、Mac 侧会话变更即时同步、侧栏展开不收起、锁屏回来一致）。
- 计量：安装后 `agent:list-sessions` 只在首次连接/重连时发生（6 次，均有对应连接或 close 事件），约 3 分钟空闲期 0 次，已无 15 秒周期拉取；单次 appSent 约 694 KB（上一版 3.56 MB）。其中 responseUtf8 520 KB、分块 base64 693 KB，编码放大约 33%；且列表包含 799 条归档会话。两者列入下批优化。
- iPhone 出现 2 次 1006 异常断开后自动重连，体验未受影响，继续观察。
- 调度器重启后首次到点触发（10-01 01:00 / 02:00）用户选择先安装；已建一次性只读核对任务 02:40 执行，结论写入本机交接 `scheduler-check-2026-10-01.md`。
- 详见本机交接 `install-result-2026-10-01.md`。

## 2026-10-01: 手机发送 1.5 秒内确认接收

- Web Remote full-ui 对 `agent:send-message` 特殊处理：调用原 handler 后，1.5 秒内结束则照常返回；1.5 秒内 reject 原样返回；仍运行则返回 `{ accepted: true }`，并消费后续 rejection、记 `[WARN]`。其他 IPC 通道维持原 30 秒超时。
- 未改 `ipc.ts` 或桌面 renderer。核对 `AgentView.tsx`：`sendAgentMessage()` 的 resolve 值未读取，仅挂接 `.catch()` 处理发送错误，因此不依赖成功返回值；长运行错误继续由既有 Agent 事件呈现。
- 定向单测 `apps/electron/src/main/lib/web-remote/full-ui/full-ui.test.ts`：**10 pass / 0 fail**，覆盖立即拒绝、窗口内完成及窗口外迟到拒绝；后续拒绝被消费。`git diff --check` 通过。未运行全量测试（留待收尾）。

## 2026-10-01: 手机发送超时后核对会话记录

- 手机 shim 将 `agent:send-message` 的 IPC 响应与分块停滞超时单独延长到 **60 秒**；其他通道保持 **35 秒**。WebSocket 断开仍立即拒绝在途请求。
- 发送因超时/连接不确定而失败时，先显示“发送确认较慢，正在核对…”，然后对本会话调用一次 `agent:get-sdk-messages`（尾部预算 **128 KiB**），只检查最近返回的用户消息是否包含本次文本前 **200** 字。找到则撤掉提示并按已接收处理；未找到或核对失败则提示“可能未送达，请刷新确认后再重发”。确定性拒绝仍保留原错误提示，`denied` / `needsConfirm` 分支不变。
- 新增 `web-electron-shim.test.ts` 覆盖找到、未找到、核对失败三种路径；连同步骤 A 定向测试 **13 pass / 0 fail**。全量测试与构建留待收尾。

## 2026-10-01: Web Remote 大响应分块改为 UTF-8 文本帧

- 侧栏核对：`LeftSidebar.tsx` 首屏/活跃视图已调用 `listActiveAgentSessions()` 与归档计数；归档视图才追加 `listArchivedAgentSessions()`，且已复用 `refreshAgentSidebarSessions(includeArchived)`。因此 C1 无需代码改动，也未触碰 `LeftSidebar.tsx`。
- 对超过 **256 KiB** 的 full-ui IPC 响应，仍按约 **180 KiB** 块大小发送，但现在按 UTF-8 字符边界切分并以文本帧传输；shim 直接按序拼接文本，不再 base64 解码。发送与计量使用相同切块函数，`base64PayloadBytes` 对新文本帧为 0，`appSentBytes` 包含帧开销。
- 单测覆盖 CJK/emoji 边界分块、帧重组一致及上限；Web Remote 定向测试 **37 pass / 0 fail**。`git diff --check` 与全量 typecheck/构建留待后续收尾。
- 改前 830 会话 3 Mbps 基准采用 2026-09-30 已记录的 `agent:list-sessions`：responseUtf8 **459,810 B**、appSent **613,404 B**。本机当前 dev 未运行，改后真实 830 会话 metrics/harness 测量安排在后续 dev 启动验证中采集；不得以模拟估算冒充实测。

## 2026-10-01: 发送核对兼容 SDK 历史消息结构

- 收尾代码复核发现 `agent:get-sdk-messages` 返回持久化 SDK 结构 `{ type: 'user', message: { content } }`，不只存在旧式 `{ role: 'user', content }`。修正发送核对器兼容两种结构，避免真实 SDK 用户消息被误判为缺失；测试改用实际 SDK 包装结构覆盖。
- 定向 `web-electron-shim.test.ts` **4 pass / 0 fail**，`git diff --check` 通过。

## 2026-10-01: 手机列表分块实测与 full-ui 积压调查

- 开发实例通过 `mobile-preview.sh start` 启动；17889、5173 与临时 8443→17889 均在线；正式版 PID 28971 未变。使用 `iphone:real-history` harness，网络仿真下行 **3,000,000 bit/s**、上行 **1,000,000 bit/s**、RTT **50 ms**。首次误选的最大 JSONL 属于归档会话，harness 在选中阶段安全失败并按应用 API 清理自建会话；随后改用最大活跃会话重跑成功。最终 manifest **830 → 830**，清理确认通过。
- **C 改后 830 列表实测**：830 条列表、单次 `agent:list-sessions` responseUtf8 **459,810 B**、appSent **501,278 B**、base64 payload **0 B**、IPC **1,491 ms**、发送采样 bufferedPeak **2,545,869 B**。对照 2026-09-30 改前 responseUtf8 **459,810 B** / appSent **613,404 B**，responseUtf8 不变，appSent 减少 **112,126 B（18.28%）**，帧开销从 **153,594 B** 降至 **41,468 B**。改后首次显示真实大会话 **4,334 ms**，会话 JSONL **41,914,743 B**；history 两次请求合计 responseUtf8 **2,096,331 B** / appSent **2,170,230 B**，`wireBytes=null`。
- **积压来源占比（本轮可观测的请求范围）**：

  | 来源/帧类型 | responseUtf8 | appSent | 占本轮已量化列表+历史响应 appSent | 观测边界 |
  |---|---:|---:|---:|---|
  | IPC response（列表 + 历史，含大响应文本分块） | 2,556,141 B | 2,671,508 B | 100% | 两类 response 的 `/api/dev/metrics` 差分；不是整个页面的总流量 |
  | agent 流事件 | 未测 | 未测 | 不可计算 | 开发数据无可用模型渠道；现有 harness 没有持续流事件注入/历史事件回放入口，本轮未伪造或改 harness |
  | session-metadata 事件 | 未测 | 未测 | 不可计算 | 实测窗口未产生元数据变更事件 |
  | 其他帧/页面控制流量 | 未测 | 未测 | 不可计算 | harness 汇总结果未提供全连接按帧类型的原始分项 |

- **bufferedAmount / 背压结论草稿**：当前只能取得 IPC response 发送路径同步采样出的峰值（列表 **2,545,869 B**、历史 **2,170,069 B**），没有每 5 秒采样数据；不能用该值推断持续事件流积压。本轮因此没有复现或排除 agent-event 积压。代码审阅确认 `full-ui` 的 `broadcast()` 与 invoke response 均直接 `sendRaw()`，没有 `bufferedAmount` 上限、队列限流或丢弃策略；另一个 `web-remote-events.ts` Hub 有独立的 **1,000,000 B** 阈值、文本 delta 合并及超限丢弃/刷新策略，但不能视为 full-ui 的保护。`bufferedAmountPeak` 存在于每个 `IpcClient` 的独立 metrics 对象，故内存累积按连接分别进行；但快照以 `deviceId` 为键，同设备新连接会覆盖旧连接快照，日志也没有稳定连接 ID，外部观测不能可靠比较同设备多个并发窗口。建议后续另行批准加入只读采样/事件回放能力后再做完整归因；本轮未修工具或 harness。
- 3 个初始化期既有 WebAssembly/CSP 异常为基线，real-history 动作期新增 **0**；HTTP 429 状态响应 **0**。`/tmp` harness 日志显示授权设备已撤销、Chrome/profile 已清理；开发 `~/.proma-dev` 最终仍为 **830** 条。dev 保持运行，供用户体验；未关闭临时 8443。

## 2026-10-01: 手机发送与弱网调整收尾验证

- 全量 `bun test`：**657 pass / 0 fail**（98 files，1,600 assertions）；workspace `bun run typecheck` 通过；Electron `build:main`、`build:renderer`、`build:web-preload` 均通过。Renderer 构建保留已有 >500 KB chunk 警告。
- 最终 `git diff --check` 通过，分支工作树干净。未 merge、未 push、未打包或安装；正式 Proma PID `28971` 未变。开发启动器仍运行，17889/5173 在线，临时 Serve 8443 仍指向 17889；`~/.proma-dev` 会话数核对为 **830**。

## 2026-10-01: Web Remote 重连由侧栏独占列表快照

- `recoverWebRemoteState()` 不再调用 `fetchAndMergeAgentSessionSnapshot()` 的全量 `agent:list-sessions`，也不再重复调用 `restoreStoppedSessions()` 的 active list。停止态只在 renderer 初始化时用 active list 恢复；WebSocket 重连不销毁 atom 状态。重连列表唯一权威由 `LeftSidebar` 的 `proma-web-remote-reconnected` resync 按当前视图刷新：active 视图拉 active，归档视图拉 active + archived。未改少见未知会话等其他全量刷新点；桌面不使用此重连回调，归档视图也不会被 active-only recover 快照覆盖。
- 新增 `useGlobalAgentListeners.recovery.test.ts`，验证恢复函数只还原运行快照、排队消息与待处理请求，不调用 full/active/archive 列表；**1 pass / 0 fail**。一次 `iphone:session-sync`（3 Mbps/1 Mbps/50 ms）通过：两次断线重连均恢复成功，耗时 **4,596 ms / 4,353 ms**，UI 的外部改名/新建/删除恢复断言通过；suite 结束配对撤销、Chrome/profile 清理通过。
- harness 对同一设备的完整 session-sync 生命周期按 metrics 窗口汇总，而不是按重连动作切片：全 suite 的 `agent:list-sessions` 共 **6 次**、每次约 **459.8–460.5 KB**；`agent:list-active-sessions` 共 **18 次**、每次约 **66.2–66.9 KB**。这些列表调用含 session-sync 的初始读取、测试操作及未知会话等既有路径，不能全部归因给重连；本次无法从 harness 汇总值单独分离每个重连瞬间的请求数。代码路径已确认恢复函数本身列表调用 **0 次**，sidebar 的 reconnect listener 每次只触发当前视图的一次权威刷新。
- **830 条 dev 数据 active 投影仅测量**：未归档 **105** 条；删除 `delegationGoal`、`piSessionFile`、`piEntryBindings` 后，字段投影共 **65,992 B**（按每项 JSON UTF-8 字节求和，不含数组逗号/外层 IPC envelope），平均 **628.50 B/会话**。按实际发送投影逐字段累计 key/value UTF-8 字节的前五名：`title` **6,587 B**、`workspaceId` **5,460 B**、`sdkSessionId` **5,406 B**、`channelId` **5,250 B**、`id` **4,515 B**。运行 metrics 的多次 active 请求每次 responseUtf8 约 **66.2–66.9 KB**，与投影计算相符。正式版简报基准是 934 条数据下每次 1 次全量列表（约 520 KB）+ 1 次 active（约 340 KB）；不同数据集不作精确百分比比较。`~/.proma-dev` 会话索引测试前后仍为 **830**。

## 2026-10-01: full-ui 高积压时丢弃可重建流增量

- full-ui 按连接检查 `bufferedAmount`。超过 **1,000,000 B** 时只丢弃 `chat:stream:chunk` 与 `agent:stream:event` 中 `payload.kind === 'sdk_delta'`（兼容旧式 `event.type === 'text_delta'`），并为该连接置 `needsResync`。不丢弃 `sdk_message`、`proma_event`（含 AskUser/计划/权限交互）、`agent:stream:complete/error`、`agent:session-metadata-changed` 或任意 invoke 响应。
- 连接缓冲低于 **256 KiB** 时发送一次 WebSocket `resync` 控制帧；手机 shim 将它映射到已有 `proma-web-remote-reconnected` 事件，复用 `__PROMA_WEB_REMOTE_RECOVER` 与 LeftSidebar resync，无新增 IPC channel/权限分级。
- 单测覆盖 droppable 分类、超阈值增量丢弃、完整/错误/AskUser/metadata 状态帧与 invoke response 保留，以及缓冲回落后只发送一次 resync；`full-ui-security.test.ts` **26 pass / 0 fail**，`git diff --check` 通过。该步骤未增加或修改 channel-policy 项。

## 2026-10-01: 按 WebSocket 连接独立积压计量

- `/api/dev/metrics` 的 `devices` 映射改为以随机 `connectionId` 为键，每项保留 `deviceId`；同一设备的多个并发连接各自拥有独立计量对象。连接关闭时先 flush 最终窗口再删除快照，避免重连导致旧连接覆盖新连接，也避免长期保留断开连接。
- 每个 30 秒窗口汇总窗口内 `bufferedAmountPeak`、事件通道发送字节 Top 5、`backpressureDroppedEvents` 与 `resyncCount`；现有 IPC 通道字节计量行新增 connectionId。只记 channel、字节与次数，不记事件内容或会话标题，仍写入 `[INFO] scope=Web Remote 计量`。
- 更新 `docs/personal/web-remote.md` 计量契约。`full-ui-security.test.ts` **27 pass / 0 fail**，覆盖同 deviceId 的两个连接互不覆盖、各自峰值/事件字节/丢弃计数独立及断开后移除。测试输出样例：`{"v":2,"w":"…","d":"…","connectionId":"…","bufferedAmountPeak":1000001,"eventBytesTop5":[{"channel":"agent:session-metadata-changed","bytes":226},{"channel":"agent:stream:event","bytes":194}],"backpressureDroppedEvents":1,"resyncCount":0}`。`git diff --check` 通过。

## 2026-10-01: 重连与事件背压第二部分收尾验证

- 全量 `bun test`：**662 pass / 0 fail**（99 files，1,632 assertions）；workspace `bun run typecheck` 通过；Electron `build:main`、`build:renderer`、`build:web-preload` 均通过。Renderer 保留 >500 KB chunk warning。
- 最终 `git diff --check` 通过，开发启动器运行、17889/5173 在线、临时 8443→17889 保持开启；`.proma-dev` 会话数 **830**，正式版 PID `28971` 未变。未 merge、未 push、未打包或安装。

## 2026-10-01: 安装 ed95818c（手机发送确认与背压批次）

- Claude Code 12:14 用 `install-update.sh` 安装 `ed95818c`（0.19.58），EXIT=0，备份校验通过，前后快照一致；钥匙串弹窗 1 次。previous 轮换为 `2f13f490`。
- 健康检查：17888 监听、Serve 仅 443 → 17888、main.log 无 `[FATAL]`/`[ERROR]`、17 个启用任务无过期、会话 942 / 渠道 7 与安装前一致。调度器 10-01 01:00 / 02:00 已到点运行（用户确认），09-30 停摆在重启后恢复。
- 手机：用户确认 OPPO 与 iPhone 蜂窝下响应达标，发消息不再误报“未送达”，页面不卡不断线。
- 计量 v2 发现：每轮 Agent 完成时 `agent:stream:complete` 携带完整已持久化消息列表（约 5.3 MB），造成约 5.5 MB 积压峰值，背压不覆盖；同一设备加载页面时会同时建立两个连接；单连接 30 秒内 `agent:get-queued-messages` 可达 250 次。列入下一批。
- 详见本机交接 `install-result-2026-10-01-2.md`。

## 2026-10-01: 手机 stream:complete 移除重复持久化消息

- 仅在 full-ui Web Remote 广播前对 `agent:stream:complete` 的 remoteValue 去掉 `messages`；主进程发出的原始 payload 与桌面 Electron renderer 不变。核对 `useGlobalAgentListeners.ts`：complete handler 不读取 `data.messages`，仍只调用一次 `bumpRefresh()`；`AgentView.tsx` 的 refreshVersion effect 随后使用既有 `getAgentSessionSDKMessages(sessionId)` 读取持久化历史，无需增加 shim IPC 请求，也不改上游组件。
- 5 条合成、每条约 1 MiB 的消息列表：测试中原始 event **5,243,195 B**，手机下发 event **137 B**（减少 **5,243,058 B**）；桌面 spy 收到原完整 5 条消息，手机事件保留 sessionId/runGeneration/startedAt/resultSubtype 且没有 `messages`，不再产生分块。
- `full-ui-security.test.ts` **28 pass / 0 fail**；`useGlobalAgentListeners.recovery.test.ts` **2 pass / 0 fail**，验证 complete 使用现有一次刷新路径并保持 AgentView 历史补拉依赖。同步更新 `docs/personal/web-remote.md`；`git diff --check` 通过。

## 2026-10-01: 压缩背压计量摘要行

- 30 秒 v2 背压摘要调整字段顺序为 `connectionId`、`bufferedAmountPeak`、`backpressureDroppedEvents`、`resyncCount` 在前；事件 Top 5 缩为 Top 3，改用 `[channel, bytes]` 紧凑元组并置于末尾。摘要行保留 `v:2`；window/device 仍可由同连接相邻的 IPC v2 计量行关联。
- 长通道场景使用 `agent:session-metadata-changed`，构造 24 位 connectionId、较大峰值/计数后，含 `[INFO] scope=Web Remote 计量 ` 前缀的整行 **287 字符**（≤300）。`full-ui-security.test.ts` **29 pass / 0 fail**；同步更新 `docs/personal/web-remote.md`；`git diff --check` 通过。

## 2026-10-01: 修复 IPC 重连退避与新连接竞态

- J 调查确认 `/app/` full-ui 的唯一 `/api/ipc` 创建点是 `web-electron-shim.ts::connect()`；renderer 的所有 preload IPC listener/invoke 共用模块级 `socket` / `socketPromise`，mobile-patch 的通知 presence 使用 HTTP，Service Worker 不创建 WebSocket。轻量根页 `/` 的 `/api/stream` 是独立页面/协议，不是 PWA `/app/` 的第二条 full-ui IPC 连接。
- 找到可复现的重复建连竞态：旧 socket close 安排了 reconnect timer；若其他请求在退避 timer 触发前已创建 replacement socket，而 timer 无条件清空 `socketPromise`，replacement 仍 CONNECTING 时 timer 的 `connect()` 会再创建第三条 socket。修复为 timer 到期直接调用 `connect()`，由其 OPEN/socketPromise 检查复用现有连接。
- 新增 `web-electron-shim.connection.test.ts`：同一页面的多个监听器只创建一个初始 socket；旧 socket 关闭后，在退避窗口内请求创建 replacement，原 timer 到期不会再创建第三条连接。**1 pass / 0 fail**。正式版的两条记录未含 document/JS realm 标识，不能逐条断定这次竞态就是它们的来源；没有证据显示 full-ui 设计了第二条独立 `/api/ipc` 用途。
- `agent:get-queued-messages` 来源只调查未修改：`useGlobalAgentListeners.ts::restoreQueuedMessages()` 先对 `agentSessionsAtom` 与本地 queue-map keys 去重，逐 session 顺序调用一次。该函数在 hook 首次挂载及 Web Remote `recoverWebRemoteState()`（WebSocket 重连/页面恢复调用）执行，不是 5 秒定时轮询。约 250 次/30 秒可由一次约 250 个 session 的恢复遍历解释；mobile-js 每 5 秒只重复 POST presence，首次列表查找结果会缓存。
- 更新 `docs/personal/web-remote.md` 的连接生命周期说明；`git diff --check` 通过。

## 2026-10-01: 安卓会话切换不再自动弹出键盘

- 仅在 `mobile-patch/mobile-js.ts` 为触屏设备安装一次性焦点护栏，以 documentElement dataset 标记避免重复注册。输入框/ProseMirror 仅在最近 **900 ms** 有针对该同一编辑器的 `touchstart` 时保留焦点；程序自动聚焦（如切换会话触发的 `autoFocusTrigger`）立即 `blur()`。不改 AgentView/ChatInput；桌面无触屏不受影响。
- `mobile-patch.test.ts` 覆盖会话切换后的程序焦点被撤销、用户先触摸输入框后的焦点保留；**6 pass / 0 fail**。更新 `docs/personal/web-remote.md`；`git diff --check` 通过。

## 2026-10-01: 完成事件测试兼容严格索引检查

- 收尾 typecheck 指出大消息完成事件测试读取固定消息索引时需显式确认元素存在；补充非空断言，不改变运行逻辑。workspace typecheck 复跑通过。

## 2026-10-01: stream:complete / WebSocket / Android focus 收尾验证

- 全量 `bun test`：**667 pass / 0 fail**（100 files，1,655 assertions）；workspace `bun run typecheck` 通过；`build:main`、`build:renderer`、`build:web-preload` 均通过。Renderer 有既有 >500 KB chunk warning。
- 开发实例按要求重新启动：launcher PID 7836，17889/5173 在线，临时 Serve 8443→17889；最终 `.proma-dev` 会话索引仍 **830** 条。正式 Proma PID `95991` 未变。
- 最终 `git diff --check` 通过。未 merge、未 push、未打包或安装。

## 2026-10-01: 安装 f8e745f7（完成事件瘦身批次）

- Claude Code 13:54 用 `install-update.sh` 安装 `f8e745f7`（0.19.58），EXIT=0，备份校验通过，前后快照一致；钥匙串弹窗 1 次。previous 轮换为 `ed95818c`。
- 健康检查：17888 监听、Serve 仅 443 → 17888、main.log 无 `[FATAL]`/`[ERROR]`、17 个启用任务无过期、会话 943 / 渠道 7 与安装前一致。
- 手机：安卓打开/切换会话不再弹键盘；蜂窝下 Agent 跑完一轮，最后一段无需刷新即显示。
- 计量：`agent:stream:complete` 每 30 秒窗口约 1 KB（上一版单次约 5.3 MB），Agent 完成窗口 bufferedAmountPeak 约 573 KB（上一版约 5.5 MB）；背压丢弃与 resync 均为 0。
- 待查：Agent 运行期间 `agent:list-sessions` 每 30–60 秒一次、每次约 525 KB；安装后 Wi-Fi 阶段同设备仍出现过两条同时关闭的连接；Top3 有 3 项时计量行仍达 332 字符截断上限。列入下一批。
- 详见本机交接 `install-result-2026-10-01-3.md`。

## 2026-10-01: 限制 Web Remote 未知会话恢复刷新

- L 源码确认与简报一致：`useGlobalAgentListeners.ts` 的未知 `agent:stream:event` session 分支和未知 `agent:title-updated` session 分支均直接调用 `fetchAndMergeAgentSessionSnapshot()` → `listAgentSessions()`；开发 `session-sync` harness 及正式版简报计量也观察到 830/934 全量请求，故按计划在这两处改用共享的未知会话刷新函数。
- Web Remote 使用 `listActiveAgentSessions()` 并以 `includeArchived=false` 合并；每个 session ID 用 `shouldRefreshUnknownAgentSession()` 节流 **60 秒**，同次请求并发事件合并；若 active 快照没有该 ID，则记录为已知不可见，后续事件不再查询。Desktop 仍走原 `listAgentSessions()` 全量逻辑；automation-graduated 等未列入范围的快照刷新未改。
- 单测 `Agent session metadata synchronization` 新增覆盖同 ID 60 秒节流、不可见 ID 永久抑制及桌面不节流；**10 pass / 0 fail**。`useGlobalAgentListeners.recovery.test.ts` 覆盖未知 stream/title 共用 active 路径；**3 pass / 0 fail**。
- 一次 `iphone:session-sync`（3 Mbps）通过，两个 reconnect 均恢复，耗时 **2,831 ms / 2,826 ms**，队列/会话清理后仍 **830** 条。Harness 的 metrics 是整套场景聚合值（其中仍有移动端 presence/其他既有读取），归档操作窗口的 `agent:list-sessions` 为 **0**；该 dev 数据无启用模型、现有 harness 未提供持久化 `agent:stream:event` 注入，因此未单独复现“归档会话持续流事件”并切片得到该触发器的前后计数。该通道已由源码定位，active 限流/不可见逻辑由单测覆盖；其他既有全量读取未扩大处理。
- 更新 `docs/personal/web-remote.md` 中未知会话 Web Remote 恢复行为；`git diff --check` 通过。

## 2026-10-01: 限定排队消息恢复查询范围

- O 检查 `preload/index.ts` 与 `main/ipc.ts` 后确认只有 `getQueuedAgentMessages(sessionId)` 单会话快照接口，没有一次返回全部队列的 IPC；因此未扩展主进程接口。Web Remote 仅查询当前列表中未归档、非草稿且 `running` / `backgroundWaiting` / 有本地队列的会话，再并入现有 queue-map keys；桌面仍检查全部列出的会话与原 queue-map keys。
- 新增 `selectQueuedMessageRecoverySessionIds()` 及单测：Web Remote 排除闲置 active、归档、draft，仅保留运行/排队与现有队列 key；Desktop 维持全列表。`agent-message-queue.test.ts` **9 pass / 0 fail**。

## 2026-10-01: 记录 full-ui WebSocket 建立事件

- 每条 `/api/ipc` 连接建立时，在当前 30 秒窗口前立即写 v2 `[INFO] scope=Web Remote 计量` 行：`{"v":2,"connectionId":"…","d":"…","event":"open"}`；`d` 是 SHA-256 设备伪名，不写原始 deviceId、事件内容或标题。
- 单测 `每条 IPC 连接建立时记录 v2 open 事件与设备哈希` 验证事件值、connectionId 和 10 位设备哈希，且日志不含原始测试 deviceId。`full-ui-security.test.ts` **30 pass / 0 fail**；`docs/personal/web-remote.md` 已同步；`git diff --check` 通过。

## 2026-10-01: 计量摘要改为 Top 2 短别名并统计完成次数

- 背压摘要从 event Top 3 改为 Top 2；加入当前 30 秒窗口 `agent:stream:complete` 次数 `scN`。已知通道别名为 `agent:stream:event`→`se`、`agent:stream:complete`→`sc`、`agent:session-metadata-changed`→`smc`、`agent:stream:error`→`sx`、`chat:stream:chunk`→`cc`、`chat:stream:complete`→`ccmp`、`chat:stream:error`→`cx`；未登记别名的通道保留原名。`scN` 每窗口 flush 后归零。
- `full-ui-security.test.ts` 验证 complete 事件计数、Top2/别名顺序、未知名称保留与真实最长会话元数据通道场景。含 `[INFO] scope=Web Remote 计量 ` 的构造长行 **223 字符**（≤300）；**30 pass / 0 fail**。更新 `docs/personal/web-remote.md`；`git diff --check` 通过。

## 2026-10-01: 运行期列表与恢复计量批次收尾验证

- 全量 `bun test`：**673 pass / 0 fail**（100 files，1,680 assertions）；workspace `bun run typecheck` 通过；`build:main`、`build:renderer`、`build:web-preload` 均通过。Renderer 保留 >500 KB chunk warning。
- 最终 `git diff --check` 通过；分支为 `fix/mobile-list-trigger-20261001`，工作树干净；`personal` 与 `origin/personal` 均停在基线 `479597f0`，version **0.19.58**。
- dev 保持运行（launcher PID **21747**；17889/5173 在线；8443→17889），`.proma-dev` 会话数 **830**；正式 Proma PID `15699` 未变。未 merge、push、打包或安装。

## 2026-10-01: 手机 presence 查询不再拉全量会话

- mobile-patch 的 presence session 解析优先用路由/活跃 Agent 行 ID 与当前 `__PROMA_WEB_REMOTE_HISTORY_META.sessionId`；缺少 ID 时只用 `listActiveAgentSessions()` 回退按标题查找。结果以 session ID+标题为 key 缓存，5 秒心跳只复用结果并 POST presence，不调用全量 `listAgentSessions()`。通知 deep-link 需要标题时按指定 ID 查 active 列表，取得完整目标会话后再点击侧栏项。加载更早的末级 fallback 同样改为 active list。
- 为避免新 document 复用上一页遗留的 history metadata，mobile-patch 用 documentElement dataset 标记将 history metadata 作用域限定在当前页面；presence 安装标记也改为 document dataset 幂等标记。测试 harness 显式把 `window.location` 注入 `new Function` 的 `location` 参数，修复 Bun 测试环境裸全局缺失造成的误失败。
- `mobile-patch.test.ts` **8 pass / 0 fail**，覆盖 HISTORY_META 不发列表、无 ID 时只查 active list、同标题心跳复用；新增 `mobile-patch-presence.test.ts` **1 pass / 0 fail**，验证 `?session=` 只调 active list 一次、取得 title 并选择深链目标，full list 调用 0 次。`git diff --check` 通过。

## 2026-10-01: Presence 省流补丁验证状态补记

- `mobile-patch.test.ts` **8 pass / 0 fail**、`mobile-patch-presence.test.ts` **1 pass / 0 fail**；workspace typecheck 与 `build:main` 通过。
- 全量 `bun test` 使用 900 秒 watchdog 后超时（进程退出码 142）；日志停在 Web Remote server/WebSocket suites，未产生全量 pass/fail 汇总，因此不记为通过，也未重跑。日志：`/tmp/proma-mobile-presence-final-test.log`。
- 开发实例保持运行，17889/5173 在线，8443→17889；`.proma-dev` 索引核对 **831** 条（父会话确认这是用户实测新增会话，未作删改）。正式 PID `15699` 未变。

## 2026-10-01: 修复 presence 测试的全局隔离

- `new Function` 测试 harness 显式注入 linkedom `location`、`history`、`setTimeout/setInterval/clearTimeout/clearInterval` 假实现；`mobile-patch.test.ts` 的 afterEach 恢复被覆盖的 Linkedom 原型描述符，并在每个假页面开始时清理 presence/history window 标记。通知 deep-link 用例并入既有 `mobile-patch.test.ts`，删除独立测试文件。
- 根因是测试运行环境没有裸全局 `location`，导致 presence callback 在列表与 fetch 前抛 ReferenceError；并行独立文件中的 Linkedom 原型/窗口标记共享会污染另一个测试。产品逻辑未为测试环境做特例修改。
- 合并后的 `mobile-patch.test.ts` **9 pass / 0 fail**；全量 `bun test` **676 pass / 0 fail**（100 files，1,691 assertions）；workspace typecheck 与 `build:main` 通过。

## 2026-10-01: presence 测试隔离最终全量验证

- 修复的测试 harness 显式注入 fake `location`、`history` 与全部计时器 API；afterEach 恢复 Linkedom 原型描述符，并清理共享 Window 标记。通知 deep-link 测试已并入 `mobile-patch.test.ts`，独立测试文件移除。根因是裸全局 `location` 在 Bun `new Function` 环境未定义、导致 presence callback 在请求前抛错；跨实例共享的 Linkedom 状态由 fixture 隔离处理，未改产品逻辑迁就测试。
- 合并后的 `mobile-patch.test.ts` **9 pass / 0 fail**；按 `alarm 900` 运行的全量 `bun test` 正常结束，**676 pass / 0 fail**（100 files，1,691 assertions）；typecheck 与 `build:main` 通过。
- dev 保持运行：17889/5173 在线，8443→17889；`.proma-dev` **831** 条；正式版 PID `15699` 未变。前一条 900 秒超时记录为修复前结果，本次全量通过已完成复核。

## 2026-10-01: 安装 76cad12c（运行期列表与 presence 批次）

- Claude Code 17:54 用 `install-update.sh` 安装 `76cad12c`（0.19.58），EXIT=0，备份校验通过，前后快照一致；钥匙串弹窗 1 次。previous 轮换为 `f8e745f7`。
- 健康检查：17888 监听、Serve 仅 443 → 17888、main.log 无 `[FATAL]`/`[ERROR]`、17 个启用任务无过期、会话 943 / 渠道 7 与安装前一致。
- 手机：Wi-Fi → 蜂窝、Agent 跑完一轮、点推送通知直达对应会话，用户确认通过。
- 计量：安装后 `agent:list-sessions` 仅首次打开 1 次，Agent 运行期 0 次（上一版每 30–60 秒约 525 KB）；`agent:get-queued-messages` 合计 10 次（原约 250）；完成事件约 1 KB；摘要行完整含 `scN`。
- 待查：18:03:06 同一设备 212 ms 内建立两条连接且都保持打开（疑与通知深链有关）；`agent:list-active-sessions` 每连接 4–7 次（约 84 KB/次）；iPhone 首次加载 `get-sdk-messages` 单连接合计约 4.2 MB，背压丢弃 2、resync 2。列入下一批。
- 详见本机交接 `install-result-2026-10-01-4.md`。

## 2026-10-01: 新增待办 SSOT，dedupe 分支暂缓发布

- 用户决定：`fix/mobile-dedupe-20261001`（P 活跃列表合并、Q 连接来源标记、R 首屏历史 1 MiB；678 pass / 0 fail）保留不发布，等下一批功能或整改时一起合入；分支已推送到 origin 保存。dev 与 8443 已停止。
- 新增 `docs/personal/backlog.md` 作为“待合入分支 / 后续待办 / 真实负载测试触发条件 / dev 数据约定”的唯一清单；`PERSONAL.md` 基线与“已知问题与待办”改为引用该文件；`maintenance.md` §5 SSOT 映射补充该文件。
- 记录：dev 数据已按用户授权复制正式渠道 `channels.json`（本机、600 权限，原文件改名保留），可真实发消息测试。

## 2026-10-01: backlog 新增“用户反馈收集”

- 用户将当前安装版 76cad12c 作为可用版本使用数日，期间的问题与需求统一记录到 `docs/personal/backlog.md` 新增的“用户反馈收集”表，下一批与 `fix/mobile-dedupe-20261001` 一并实现。首条：手机端思考强度只能开/关（悬停滑块在触屏不可达）。

## 2026-10-02: 反馈记录：安卓重复通知

- backlog“用户反馈收集”新增：安卓同时收到 PWA 与 Chrome 两条相同通知。核对服务端只有 1 个安卓推送订阅；来源待截图确认；记录合并方案（通知 tag）与推送发送计数。

## 2026-10-02: 反馈记录：手机端对话内本地图片无法显示；新增 cliproxy-image Skill

- backlog“用户反馈收集”新增：手机端 Markdown 本地图片显示“图片无法读取”。根因为 `file:resolve-path` 返回 `proma-file://` 协议 URL，手机浏览器无法加载；方案记入 backlog。
- 工作区新增 Skill `cliproxy-image`（不在本仓库）：经本机 CLIProxyAPI 的 `/v1/images/generations` 与 `/v1/images/edits` 用 GPT 订阅文生图/图生图，图片存会话工作台并以 Markdown 图片语法显示。实测文生图约 28 s、图生图约 41–47 s，均 HTTP 200。
