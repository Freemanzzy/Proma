# 手机访问（Web Remote）使用说明

> 个人版功能。经 Tailscale 私有网络，用手机操作 Mac 上正在运行的 Proma。代码位于 `apps/electron/src/main/lib/web-remote/`；手机适配 CSS/JS 源文件分别位于 `full-ui/mobile-patch/mobile-css.ts` 与 `mobile-js.ts`，由主进程 esbuild 内联至 `renderWebRemoteMobilePatch()` 输出。变更记录见 [`PERSONAL.md`](../../PERSONAL.md)。

## 1. 它是什么

- 手机加载的是**与桌面同一套界面**（`/app/`），所有计算、文件、Skill、MCP、定时任务都在 Mac 上；手机只是远程窗口。
- 另有轻量页面 `/`（第一期），作为弱网或快速审批的备用入口。
- Mac 必须开机、接电源、不睡眠；合盖睡眠后手机无法连接。

## 2. 启用条件与数据位置

| 项目 | 说明 |
|---|---|
| 运行实例 | 个人版安装包（日常使用，数据 `~/.proma`）；或开发实例（数据 `~/.proma-dev`，用于预演）。官方打包版一律拒绝 |
| 启动开关 | 安装版：配置 `enabled: true`（完整界面另需 `fullUi: true`），无需环境变量。开发实例：环境变量 `PROMA_WEB_REMOTE=1` **且** 配置 `enabled: true` |
| 监听 | 只监听 `127.0.0.1:17888`，对外只经 Tailscale Serve（仅 tailnet 可达） |
| 数据目录 | 安装版 `~/.proma/web-remote/`，开发实例 `~/.proma-dev/web-remote/`：`config.json`、`devices.json`、`pairing.json`、`push-subscriptions.json`、`vapid.json`（均 0600，不入库） |
| 端口 | 安装版 `127.0.0.1:17888` ← Tailscale Serve https 443（常开）；开发实例 `127.0.0.1:17889` ← Tailscale Serve https 8443（仅同步验证期间临时开启，结束即关闭）。开发实例 `allowedOrigin` 带 `:8443` |

启动当前测试分支的开发实例（须遵守已批准的临时安全措施）：

```bash
PROMA_WEB_REMOTE=1 bash scripts/personal/dev.sh
```

**当前分支临时启动措施（2026-09-30）**：在 `apps/electron/package.json` 的 `dev` 与 `dev:electron` 中移除了两处 `dev-kill` 调用；`scripts/dev-kill.ts`、`scripts/personal/dev.sh` 的进程实例预检和独立进程安全工作树均未修改。静态检查确认 `mobile-preview.sh start → dev.sh → bun run dev` 不再调用 `dev-kill`、`pkill`、`killall` 或 `taskkill`。用户已确认本批可依此临时措施启动；完整 PID/进程归属方案推迟到下个版本。测试期间不得退出或结束正式版。

暴露给 tailnet（安装版，只需一次，可随时撤销）：

```bash
tailscale serve --bg --https=443 http://127.0.0.1:17888
tailscale serve --https=443 off   # 撤销
```

开发实例（同步验证时临时开启，结束后关闭）：

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:17889
tailscale serve --https=8443 off
```

## 3. 配置（`config.json`）

| 字段 | 含义 |
|---|---|
| `enabled` | 是否启用服务（需重启实例） |
| `fullUi` | 是否启用完整桌面界面 `/app/`（需重启实例） |
| `allowedOrigin` | 手机访问的 HTTPS 地址（Tailscale 主机名），写操作与 WS 校验 Origin |
| `allowedTailscaleLogins` | 允许的 Tailscale 账号 |
| `trustedTailscaleNodes` | 免配对的受信设备名（Tailscale 设备名，换 VPN 客户端后名字会变） |
| `workspaceScope` | `all`（全部工作区）或 `allowlist` |
| `allowedWorkspaceIds` | `allowlist` 模式下开放的工作区 |

推荐通过桌面 **设置 → 远程连接 → 手机访问** 管理：服务状态、访问地址、受信设备（从 tailnet 在线设备中添加/删除）、已配对设备（撤销、生成配对码）、工作区范围、通知订阅与测试通知。该分区只能在桌面使用，手机端不可见也不可调用。

命令行备用：`scripts/personal/web-remote.sh pair | devices | revoke <deviceId>`。

## 4. 手机端

1. 手机登录与 Mac 相同的 Tailscale 账号并保持连接（iOS 上 Shadowrocket 内置 Tailscale 在后台容易掉线，官方 Tailscale App 更稳定）。
2. 打开 `https://<Mac 的 Tailscale 主机名>/app/`：受信设备直接进入；其他设备输入桌面生成的 6 位配对码。
3. 添加到主屏幕：iPhone Safari“分享 → 添加到主屏幕”；Android Chrome“菜单 → 添加到主屏幕”。从图标打开为全屏应用。
4. 开启通知：从主屏幕图标打开后，点顶栏“开启通知”并允许（iPhone 只支持主屏幕模式）。

手机端可用：会话与实时输出、Skill（`/`）、`@` 引用、模型与权限模式切换、新建会话、附件（相册/拍照/文件/粘贴，单文件 25 MB）、提问与计划审批、中止、Todo、定时任务、MCP/Skills、文件面板与预览。顶栏“刷新”会重新加载 `/app/` 并重建 WebSocket；右侧工作区使用顶栏标题下拉切换已打开页面，项目记忆与详情表单按“列表 → 详情 → 返回”显示；侧栏单击切换会话，左右面板带手机端过渡与触控反馈。手机端不可用：设置页、终端、原生对话框、在 Finder 打开、解密密钥、快速任务浮窗等桌面专属能力。

Web Remote full-ui 的 `agent:stream:complete` 只向手机镜像完成状态和元数据，不携带已持久化的 `messages` 列表；renderer 仍通过既有 `agentMessageRefreshAtom` 刷新并调用 `agent:get-sdk-messages` 获取持久化历史。桌面 Electron 收到的完成事件不变。

Android 等触屏设备切换会话时，程序触发的输入框 autofocus 不会弹出软键盘；用户直接触摸输入框仍按浏览器默认行为聚焦并弹出键盘。

### 历史图片与长工具结果

历史窗口内，解码后不超过 256 KB 的图片可直接在手机以 `<img>` 显示；每次返回（首屏或“加载更早”页）从最新内容向前累计，内联图片总量不超过 1 MB。其他图片以卡片显示大小并可点按加载；超 2 MB 的 tool_result 文本会先显示截断预览，点按后在原位读取并展开完整文本。单张按需图片读取上限 25 MB，原文展开上限 2 MB；超过上限或会话/消息发生变化时提示刷新或在桌面查看。

顶部的“省流量模式”开关可手动启用/关闭并记入 localStorage。未手动选择时，浏览器报告 `slow-2g`/`2g` 或 downlink < 1 Mbps 会自动开启。开启后历史尾部预算为 256 KiB，内联图片预算为 0（全部点按加载）；关闭时恢复 2 MiB 历史预算与 1 MiB 图片预算。此预算由 Web Remote shim 仅附加到手机的历史 IPC 参数，不改变桌面行为。


媒体标记仅由 Web Remote 的历史裁剪层生成，包含会话 ID、SDK 消息 UUID（缺少 UUID 时使用消息索引）及整条消息 SHA-256、块路径与内容校验摘要。按需读取通过 `web-remote:get-history-media` 只读 IPC，并按会话所属工作区授权；定位不唯一、摘要变化、越权或目标不存在均拒绝。桌面 renderer 的 SDK 历史返回不经该移动端裁剪，不包含 Web Remote 标记。

## 5. 通知（Web Push）

- 推送时机：运行完成、运行失败、工具审批、Agent 提问、计划审批、定时任务完成/失败。
- 静默：该会话正在某台手机前台打开时，不向这台手机推送；同一会话同类事件 30 秒内去重。
- 推送经 Google（Android）/ Apple（iPhone）推送服务，Mac 通过代理 `http://127.0.0.1:7897` 发送；推送服务返回 404/410 时自动删除失效订阅。

## 6. 安全边界

- 网络：只监听回环地址；只经 Tailscale Serve（不使用 Funnel）；Serve 注入 `Tailscale-User-Login` 并剥离客户端伪造的同名头。
- 身份：配对设备用 32 字节随机令牌（服务端只存 SHA-256，Cookie `HttpOnly; Secure; SameSite=Strict`，可撤销）；连续超过 30 天未使用时按 `lastUsedAt`（无则 `createdAt`）惰性撤销，撤销超过 30 天的记录自动清理；受信 `tailnet:*` 身份不受期限影响。受信设备须同时满足：账号在允许列表、来源 IP 属于 tailnet、`tailscale whois` 返回同一账号且设备名在受信列表。本机其他进程理论上可伪造回环请求头，但本机进程本就拥有同等权限。
- IPC 分级：`full-ui/channel-policy.ts` 为全部 IPC 通道的显式分级表，**未分级即拒绝**，启动时校验覆盖率（当前 100%）。级别：`read`、`session`、`workspace`、`write`、`confirm`（手机端二次确认，如删除会话/Todo、定时任务立即运行）、`denied`（凭据、终端、设置写入、原生窗口等）。历史媒体读取使用 `web-remote:get-history-media`，为 session 范围只读；请求须解析到已授权会话，并在读取前校验 UUID/索引、消息 SHA-256 与块路径。
- 过滤：列表类返回与流事件按会话所属工作区过滤；文件类通道对目标路径做 realpath 范围校验；设置、渠道、MCP 配置返回前掩码密钥字段。

## 7. 维护与排错

| 现象 | 原因与处理 |
|---|---|
| 手机页面空白 | web preload 缺失或过期；开发模式会自动重建，否则运行 `bun run --cwd apps/electron build:web-preload` |
| 手机提示需要配对 | 手机当前 Tailscale 设备名不在受信列表（常见于切换 VPN 客户端）；在桌面“手机访问”中添加 |
| 页面打不开 | 手机 Tailscale 掉线（在 Mac 上 `tailscale status` 查看）；或开发实例未运行（`lsof -iTCP:17888`） |
| 某个功能在手机上点了没反应 | 可能是上游新增 IPC 通道未分级；查看开发实例日志中的“未分级通道”，在 `channel-policy.ts` 中分级 |
| 通知收不到 | 确认从主屏幕图标打开并已允许通知；桌面“手机访问”中发送测试通知；检查代理 7897 |

手机预览与回归统一使用仓库脚本 `scripts/personal/mobile-preview.sh`（仅对开发实例运行，不对安装版运行）：

- `bash scripts/personal/mobile-preview.sh start`：检查 17889/5173 空闲、开启临时 8443 Tailscale Serve、后台启动开发实例并等待启动与分级覆盖率 100% 日志；PID/日志分别记于 `/tmp/proma-mobile-preview.pids` 与 `/tmp/proma-mobile-preview.log`。当前测试分支已按用户批准的临时措施去掉启动链中的按名清理调用；完整进程归属方案推迟到下个版本。测试期间不得退出或结束正式版。
- `bash scripts/personal/mobile-preview.sh sim [--device <name|udid>]`：默认启动 iPhone 17 Pro 模拟器、打开 Simulator、生成配对码并通过 AXe 的辅助功能树定位配对控件，配对后打开 `/app/` 并以 `simctl` 截图确认界面。
- `bash scripts/personal/mobile-preview.sh test [suites...]`：默认运行既有 iPhone/Android 回归套件并追加 `iphone:heavy-session` 大会话套件；真实会话历史、空闲同步与实时同步 suite 默认使用下行 **3 Mbps**、上行 **1 Mbps**、延迟 **50 ms**。可在调用前设置 `PROMA_WEB_REMOTE_DOWNLOAD_MBPS`、`PROMA_WEB_REMOTE_UPLOAD_MBPS`、`PROMA_WEB_REMOTE_LATENCY_MS` 覆盖，或直接运行 harness 并传 `--download-mbps`、`--upload-mbps`、`--latency-ms`。0.5 Mbps 仍可显式用于压力测试（例如 `PROMA_WEB_REMOTE_DOWNLOAD_MBPS=0.5`），不是当前默认；显式 `iphone:cellular` 也遵循选定 profile。静态资源在开启节流前已加载，因此不代表更新后资源冷启动。每套单独去掉代理变量并受 420 秒外层 watchdog 保护，终端只汇总结果，完整 harness 输出分别保存在 `/tmp/proma-mobile-preview-<ua>-<suite>.log`；结束核查无残留 `proma-mobile-chrome`。
- `bash scripts/personal/mobile-preview.sh status` 查看服务、模拟器与 harness 进程；`stop` 只按记录 PID 停止开发实例进程树，关闭 8443 并确认 Serve 路由状态。用户需要继续体验时，最后运行 `start` 与 `sim`，保持服务运行，不要执行 `stop`。

### 首屏资源拆分评估（2026-09-28）

使用 `build:renderer` 生成的当前产物按 chunk 大小排序（gzip 为构建日志数据）：

| 产物 | 原始体积 | gzip | 判断 |
|---|---:|---:|---|
| `index-DExTehsL.js` | 5,738,122 B | 1,738,120 B | HTML 唯一 module entry，首屏必需；内含代码编辑器/语法高亮等共享 UI，非独立桌面功能，不能直接排除 |
| `index-DplxyxBx.js` | 1,614,360 B | 492,360 B | 生成的独立 chunk，需调用时加载；现有构建输出未提供 module-level attribution |
| `emacs-lisp-*.js` | 779,850 B | 196,030 B | 语法语言 chunk，非桌面专用，通常按编辑内容按需加载 |
| `cynefin-*.js` | 691,030 B | 155,100 B | 图表/可视化 chunk，非桌面专用，交互场景使用 |
| `cpp-*.js` | 626,080 B | 44,820 B | 语法语言 chunk，按需加载 |
| `wasm-*.js` | 622,340 B | 230,290 B | 独立 WASM 相关 chunk，生成物未直接识别具体模块；不是桌面专用 |
| `mermaid.core-*.js` | 592,260 B | 138,360 B | Mermaid 图表核心，非桌面专用，图表场景使用 |
| `cytoscape.esm-*.js` | 443,720 B | 142,360 B | 图可视化依赖，非桌面专用，视图使用时加载 |
| `wolfram-*.js` | 262,390 B | 77,140 B | 语法语言 chunk，按需加载 |
| `vue-vine-*.js` | 190,050 B | 17,980 B | 语法语言 chunk，按需加载 |

当前 chunk 表可判断加载边界，但不能替代 Rollup 模块级可视化；首屏 entry 显示含有编辑器/高亮相关实现，尚未证明其中哪些依赖可延迟加载。1,511,206 B 图片为 `onboarding/hopper-seaside-white-house.png`，由 App 与 onboarding 组件引用；通常会在欢迎/新手引导 UI 中显示，不是已有会话的必要首屏画面，但图片 URL 是静态资源，若组件/浏览器提前请求仍需网络面板确认。

**不实施拆分**：目前没有可复现的安全代码切分方案与首屏提速 ≥30% 的证据；且主 entry 使用范围涉及桌面与手机共享界面，任何改动都需证明桌面行为不变。为遵守阈值，不改 Vite 或上游文件。后续建议先用 Rollup visualizer/sourcemap 确认 entry 内最大模块，再做临时分支验证手机 transfer/ready timing 和桌面回归。

### 上游改动面（2026-09-28）

- 基线 `v0.19.58..personal` 共 71 个上游已有文件发生修改（非新增）。分类：其他个人版/同步改动 59；桌面模拟器入口与挂载 4（`agent-atoms.ts`、`SidePanel.tsx`、`DiffPanelTabBar.tsx` 等）；浏览器移除及资源清理 8（内置浏览器 Skill 删除、主题预览资源清理等）。本轮未删除既有上游文件改动，因此改前/改后均为 71。
- `data-web-remote-*` 标记目前出现在 13 个 renderer 源文件中，形成 22 种标记名。包括 AppShell 的主内容/左右面板定位，详情与双栏布局标记，记忆/自动化/技能/MCP/文件视图的移动端布局标记，以及模拟器入口标记。主布局节点没有上游稳定的语义标记可唯一定位；详情与移动端专用控件也没有稳定且唯一的 aria-label/role/data 属性。仅靠 class 或文本会受样式重构、本地化影响或误选多个同类节点，故本轮保留这些标记，不做脆弱替换。
- 可复用的既有稳定特征仍优先使用：右侧 Tab 以 `role="tablist"` + `aria-label="右侧工作区"` 定位；设置按钮按既有 `aria-label` 定位。模拟器菜单/标签本身继续保留显式标记，以避免与其它同类菜单项混淆。

harness 默认整体超时 300 秒（可用 `--timeout-ms` 覆盖），每次页面评估前以 3 秒 CDP 探活；每次运行后自动撤销测试配对设备、删除自建会话、关闭 Chrome 并移除临时 profile。`full-ui/mobile-patch.test.ts` 使用 linkedom 执行注入脚本并多次触发 MutationObserver，验证刷新/面板/菜单/通知图标、标题和 Tab 下拉菜单的 DOM 写入趋于稳定。`layout` 检查文件、改动、Todo、定时任务、MCP/Skills 与项目记忆列表/详情的横向溢出和元素可点性；`panel-probe` 检查页面下拉中的 Tab 可点性；`mobile-polish` 检查刷新和会话单击切换。左侧项目名是展开/折叠分组，不是 `agentWorkspaceId` 切换，勿以此字段判定工作区按钮点击。同步上游后必须运行；安装后另由用户在安装版上用两台手机验收（CLAUDE.md §6 第 7 项）。每周一的版本检查任务会报告上游新增、尚未分级的 IPC 通道。

### Web Remote 计量与开发汇总

开发实例中可由已认证设备读取 `GET /api/dev/metrics` JSON；生产环境不提供该端点。IPC 快照按唯一 `connectionId` 键控，每项仍保留认证 `deviceId`，同设备并发连接不再覆盖彼此；快照只包含当前连接，断开时先写日志再移除。每条 `/api/ipc` 连接建立时立即记录一行 v2 `event:open`，包含 connectionId 与设备哈希。计量主日志按设备伪名、连接 ID、短时间窗 ID 与通道拆成多条 `[INFO] scope=Web Remote 计量` JSON 行，不含响应正文、会话标题或消息内容。字段严格区分：`responseUtf8` 是序列化响应 UTF-8 字节；`appFraming` 与 `base64` 分别是分片 JSON 帧开销和 Base64 payload；`appSent` 是两者合计（或未分片响应字节）；`estimatedDeflateRaw` 是对完整响应单独计算的压缩估算；`wireBytes: null` 明确表示 `ws` API 无法读取 permessage-deflate 后的真实线缆字节，不能把估算称作实测。另记录 calls、累计处理毫秒、分片数与窗口内 `bufferedAmount` 峰值。每 30 秒还汇总事件通道发送字节 Top 2、背压丢弃事件数、resync 次数及 `agent:stream:complete` 事件数 `scN`；摘要行以 `connectionId, bufferedAmountPeak, backpressureDroppedEvents, resyncCount` 开头，事件 Top 2 以 `[alias, bytes]` 紧凑元组放在末尾，目标总行长不超过 300 字符。没有事件内容，只保留通道短名/原名与字节/计数。已登记别名：`agent:stream:event`→`se`、`agent:stream:complete`→`sc`、`agent:session-metadata-changed`→`smc`、`agent:stream:error`→`sx`、`chat:stream:chunk`→`cc`、`chat:stream:complete`→`ccmp`、`chat:stream:error`→`cx`；其他通道保留原名。静态资源计量记录相对路径、原始文件字节、HTTP 实际 Content-Length、估算压缩字节与耗时；hash 文件使用 `Cache-Control: public, max-age=31536000, immutable` 与 ETag，非 hash 文件使用 `no-cache` 并支持 304；静态字节计量中的 304 发送字节为 0。开发端点只保存在运行时内存，不落入用户数据目录。

#### 会话列表同步与按需字段

- 完整 UI 目前必须保留全量列表，以支持全部工作区/归档视图、搜索与当前会话定位；不能只下发最近 30 条或截断列表。Web Remote 对 `agent:list-sessions`、`agent:list-active-sessions`、`agent:list-archived-sessions` 均应用移动端 metadata 瘦身，桌面 IPC 不变。
- 手机列表不再下发 `delegationGoal`、`piSessionFile` 或可能很大的 `piEntryBindings`。`piEntryBindings` 只在用户从一条回复启动“回复探索”时，通过 `web-remote:get-session-entry-bindings` 按目标 session 查询键→true 的最小映射；该接口为 `read/session`，请求须通过既有 session→workspace 授权校验。正式设备行为与跨工作区拒绝仍须按变更记录完成开发实例验收。
- 手机 renderer 对相同参数的 `agent:list-sessions`、`agent:list-active-sessions`、`agent:list-archived-sessions` 和 `agent:count-archived-sessions` 并发请求合并，并在 **3 秒**内复用成功结果；收到 `agent:session-metadata-changed` 后先失效这些列表缓存，再分发事件，避免复用过期快照。
- Push presence 每 5 秒仍需续报。会话 ID 优先使用当前历史窗口 `sessionId`、路由 ID 或活跃 Agent 行 ID；deep-link 需要标题时按 ID 查询 active 列表，其他缺 ID 情形按标题回退 active 列表，不调用全量 `agent:list-sessions`。解析结果按当前 session ID + 标题缓存，标题/ID 改变才重新解析；普通 heartbeat 只 POST presence。
- Web Remote 运行期间收到本地未知的 Agent stream/title session ID 时，只拉 `agent:list-active-sessions` 并以 `includeArchived=false` 合并；同 ID 60 秒内最多拉取一次，若 active 结果仍不含该 ID，则标为当前 renderer 生命周期内不可见、不再重复查询。桌面 renderer 继续保留全量快照路径。
- 以上瘦身不改变完整 session 搜索/加载范围。按需 Pi 节点接口的数据体积取决于单个会话分叉数，尚未给它设置分页上限；若单 session 数据异常大，需用真实使用数据另行评估。

### WebSocket 压缩（2026-09-29）

`/app/` full-ui 每个页面由 `web-electron-shim.ts` 独占一条 `/api/ipc` WebSocket；并发 IPC 调用共享当前 OPEN socket 或尚未完成的 `socketPromise`。自动重连退避定时器不会清空其他调用者已创建的在途连接；轻量配对页 `/` 的 `/api/stream` 是不同页面的独立通道。Web Remote WebSocket 为超过 16 KB 的消息启用 per-message deflate；服务端与客户端均禁用 context takeover，zlib 并发限制为 2，避免跨消息压缩状态与过量并发占用。iPhone UA 与 Android UA 的 Chromium harness 对 `/api/ipc` 均收到 HTTP 101，并协商 `permessage-deflate; server_no_context_takeover; client_no_context_takeover`。独立线缆侧探针确认 118,784 B 高重复文本帧在线路上压缩为 335 B，RSV1=true。此结果验证协议与压缩帧；不等同于 iOS Safari 真机验收。CDP 的 `Network.webSocketFrameReceived.payloadData` 是解压后的消息内容，当前 `Network.dataReceived` 未提供 WebSocket 线缆字节，因此不能据 CDP payload 计算实际压缩传输量。

### 大会话历史（2026-09-29）

- 手机通过完整 UI IPC 读取 SDK 历史时，服务端先将 tool_result 文本裁剪至约 16 KB（追加原长度提示），把 base64 图片块替换为含 MIME/尺寸估算的占位；原文提示“完整内容请在桌面查看”。随后按约 2 MiB 序列化字节预算从尾部取完整轮次；未裁剪历史会以 `hasEarlier/startIndex/omittedCount` 元数据标记。tool_use 与其 tool_result 被识别为同一轮，单个超预算轮次不拆分。
- 手机通过固定的“加载更早（已省略 N 条）”按钮以 2 MiB 页预算回取并前置到当前列表。此实现复用现有 `agent:get-sdk-messages` session-scope IPC，无新增通道或额外分级；桌面 IPC 返回值不变。React 侧只增加一行事件钩子，手机 DOM 入口由个人版 mobile-patch 添加。
- 大于 256 KB 的 IPC WebSocket 响应使用约 180 KiB UTF-8 分片并 base64 编码，携带请求 ID、序号和总数；客户端按序重组，任何进度分片都重置 35 秒无进展计时。小响应、ping/pong、断线恢复和 `agent:send-message` 失败提示沿用原路径。
- 全量大结果单条展开未实现：当前 SDK 历史 IPC 仅提供整段会话读取，不暴露有稳定消息 ID 的单条 tool_result 读取入口；故占位明确要求桌面查看，不在客户端保留或再次传输大原文。
- 端到端弱网验收：在 `~/.proma-dev` 创建 33,408,055 B 全合成 JSONL，会话覆盖 user/assistant/tool_use/tool_result 与 base64 图片。iPhone UA、300 ms 延迟、下行 3 Mbps、上行 1 Mbps 下，当前实现 7,911 ms 首次显示历史；点按“加载更早”后 DOM 消息数 242→484；工具结果截断副本与图片占位副本均确认，0 JS exceptions。临时 session 与 JSONL 已清理。CDP 观测到 2,831,569 B 解压后的 WebSocket payload、最大解压帧 245,870 B；这些是 payload 统计，不是线缆字节。
- 修复前对照使用开发版专用 `PROMA_WEB_REMOTE_HEAVY_SESSION_BASELINE=1`（仅 `NODE_ENV !== 'production'` 生效），关闭历史窗口/瘦身及分片传输，保留 WebSocket 压缩。相同 33 MB 测试在 40,420 ms 内仍未显示历史，随后 Web Remote IPC 连接断开；对照记录到 117,103 B 已解压帧，未获得编码线缆字节。由于页面断开，harness 无法经 UI 清理；仅删除其精确标记的两个 `~/.proma-dev` 合成会话索引项与合成文件，其他条目不变。详细证据见 `docs/personal/changelog.md`。
- 压缩握手为 iPhone/Android Chromium UA 验证，不代表 iOS Safari 真机验收；CDP 当前不暴露 WebSocket 压缩后的线上 payload 字节。

### 蜂窝网络：自建 DERP 中继 + Mac 侧阻断外网直连 UDP（2026-09-29）

- **根因**：国内移动蜂窝网络对个人设备之间的直连 UDP（WireGuard）限速，实测 Mac→手机约 0.5 Mbps；Wi-Fi 同局域网不受影响。Tailscale 只要直连可达就一直走直连，不按速度选路（上游 issue #2270/#3579 未实现），所以需要“让外网直连失败”。
- **中继**：国内云服务器（腾讯云轻量，3 Mbps 固定带宽）运行 `derper`（版本与服务器上的 tailscale 一致），IP + 自签证书，`-a :<DERP 端口> -http-port -1 -stun -stun-port 3478 -certmode manual -verify-clients`，systemd 服务 `derper.service` 开机自启；服务器以 `derp-gz` 加入 tailnet（后台已关闭密钥过期），供 `--verify-clients` 校验。防火墙只放行 DERP 的 TCP 端口与 UDP 3478。
- **Tailscale 后台 Access controls**：`derpMap` 新增 900 号区域（HostName/IPv4 为服务器 IP、DERPPort、STUNPort、`CertName: sha256-raw:<指纹>`），**2026-09-29 已改为 `OmitDefaultRegions: true`，仅保留自建区域 900**。此前 iPhone 选择官方香港区域导致蜂窝不可用；改为仅自建区域后用户确认恢复。**无官方中继兜底**，自建中继故障时依赖中继的远程访问会中断（用户已接受）。
- **Mac 侧 pf 规则**：`/etc/pf.anchors/proma-derp`（挂在系统自带的 `com.apple/*` 锚点下，不改 `/etc/pf.conf`），只作用于 Tailscale 本地 UDP 端口 41641：放行到局域网/私有地址与中继 STUN，其余丢弃；由 `/Library/LaunchDaemons/com.proma.derp-pf.plist` 开机加载（最多重试 12 次，日志 `/var/log/proma-derp-pf.log`）。效果：手机用蜂窝时经中继（TCP/TLS），同一 Wi-Fi 下仍直连。
- **核对**：`tailscale netcheck` 最近 DERP 为自建区域；`tailscale ping <手机节点>` 显示 `via DERP(<区域代码>)`；`sudo pfctl -a com.apple/proma-derp -s rules` 列出 3 条规则。
- **回退**：`sudo launchctl bootout system /Library/LaunchDaemons/com.proma.derp-pf.plist; sudo pfctl -a com.apple/proma-derp -F all; sudo rm /Library/LaunchDaemons/com.proma.derp-pf.plist /etc/pf.anchors/proma-derp`（恢复直连）；当前不会自动回落官方中继。恢复备用路径需用户在管理台重新允许官方区域，或在评估直连可用性后撤销 pf 限制；仅删除 pf 规则不保证受限网络恢复。服务器地址、SSH 密钥与证书指纹只记在本机，不写入仓库。
- **成本与到期**：服务器首年特惠，续费按日常价；到期前比价，迁移只需重建 derper 并更新 `derpMap`。

#### 中继恢复资料与证书维护（截至 2026-09-29）

- 备份位置：外置硬盘 `proma 自建中继/`。包含 `derpmap-region-900.json`、`mac-pf/` 规则与启动项副本、`README.md` 恢复说明。按交接记录，备份配置与客户端实收配置一致，证书指纹与服务器一致。
- **备份边界**：不含服务器证书、私钥、derper 配置与安全组规则；不能把它视为完整服务器备份。后续补备份应使用受保护的存储流程，禁止提交到公开仓库。
- 当前证书到期：**2027-09-29 09:22:34 UTC（北京时间 17:22:34）**；客户端是否强制验证有效期尚未确认，不依赖该不确定性继续使用。已安排 2027-08-01 09:00（北京时间）续期日程与提醒。续期须同步更新 `CertName`、验证连接、更新备份，避免仅服务器换证导致客户端指纹不匹配。
- Shadowrocket 内置 Tailscale **没有区域选择选项**。“始终使用 DERP”只禁止直连，不选择区域；保持关闭，避免 Wi-Fi 局域网也绕中继。当前规则分流设置不需改动。
- 服务器 IP、证书指纹、部署端口等具体值以本机受保护配置及外置备份为准，不在公开仓库新增这些值。

### 真实备份会话的受限开发导入（2026-09-30）

- 工具：`scripts/personal/import-session-workspace.py`。默认只做 dry-run；显式 `--apply` 仅接受位于本机 `~/.proma-switch-backups/` 下的来源、唯一目标 `~/.proma-dev`，且目标目录必须不存在。应用前先将现有开发根改名保留，不能覆盖。
- 数据范围：会话索引中单个指定工作区的条目、对应工作区元数据及匹配的会话 JSONL；不复制工作区项目文件、渠道、Settings、Automation、Bridge、MCP、OAuth、Keychain、授权设备或推送订阅。旧开发实例的既有测试设备仅从其保留目录选择性恢复，不从备份取授权数据。
- 导入过程中，JSONL 与元数据中对 `~/.proma/` 的路径引用改写为 `~/.proma-dev/`。新根与目录权限为 `0700`，文件为 `0600`。Web Remote 启动前必须设成 `workspaceScope: "allowlist"`，只列所需的一个工作区；未完成配置和审计前不得启用 Tailscale Serve。
- 2026-09-30 本地受限导入结果：备份目标工作区索引 830 条会话、826 个匹配 JSONL（535,645,225 B）；目标真实会话 JSONL 为 41,914,743 B。安全审计确认导入根仅有会话/工作区数据及最小 Web Remote 配置，且没有遗留正式 `/.proma/` 路径引用。附件、Pi runtime artifact、项目文件及其他 4 个工作区的会话数据均未导入，因此历史中指向这些缺失资源的旧引用不保证可打开。
- **0.5 Mbps 压力测试（不是当前网络代表值）**：iPhone UA Chromium，经开发 Serve；下行 524,288 bit/s、50 ms RTT、上行 1,048,576 bit/s。真实 830 条会话列表约 459,730 B responseUtf8、613,300 B 应用层发送，fresh-list 调用约 10,135 ms；41,914,743 B 真实会话历史首次显示约 4,349 ms。历史 IPC 约 197,907 B responseUtf8 / 应用层计量、CDP 解压 WebSocket payload 140,728 B；deflate 估算 58,844 B、bufferedPeak 2,796,190 B。CDP 解压 payload 与应用层计量都不是压缩线缆字节；`wireBytes` 为 `null`。
- **当前链路验收目标（2026-09-30 用户提供）为 3 Mbps 中继**，0.5 Mbps 只作压力测试，不得用来代表当前体验。已按用户批准的临时启动措施启动隔离开发实例；正式版 PID `83615`、17888 与 443→17888 保持不变。开发启动器 PID `82401`，Vite 5173；Web Remote 17889 由 Electron 子进程提供，Tailscale Serve 8443→17889。全量构建后 Electron 子进程 PID 更新，启动器保持运行，开发端口与 Serve 路由仍在线。
- 3 Mbps/1 Mbps/50 ms 的 `iphone:real-history` **通过**：授权视图 830 条；目标 JSONL 41,914,743 B；列表 responseUtf8 **459,810 B**、appSent **613,404 B**、调用耗时 **1,785 ms**；历史首次显示 **4,346 ms**，history responseUtf8 **2,096,331 B**、appSent **2,796,367 B**。`wireBytes` 不可测，CDP payload/应用层计量不等于线缆字节。
- 同条件 `iphone:idle-session-sync` **通过**：观测 **182,556 ms**；窗口内列表调用 **0**、响应 **0 B**、发送 **0 B**。初始化列表为 2 次请求、responseUtf8 **919,619 B**、appSent **1,226,805 B**。
- `iphone:session-sync` 在本轮最终尝试因 Chromium CDP `Runtime.evaluate` 3,500 ms 超时（`page_unresponsive`）未完整结束，故不标为通过。更早的一次完整 3 Mbps run 中，新建/草稿推广/改名/外部更新/删除/归档/恢复/重连可见、越权创建拒绝、entryBindings 可读等断言均通过；归档 API 调用约 **8,007 ms**，可见移除约 **1 ms**，恢复 API **67 ms**。服务端 `agent:toggle-archive` handler 仅 **24 ms**，同窗口发生 1 次全量 `agent:list-sessions`（responseUtf8 **460,162 B**、appSent **613,873 B**，CDP 收帧合计 **2,864,075 B**）；因此慢值来自 3 Mbps 下重连权威快照与归档计时重叠，不是归档写索引回归。重连全量快照是本批设计，其 3 Mbps 成本留作已知项，本轮不改主进程。
- 异常按动作前基线分别统计：真实历史与空闲 suite 均为基线 **2** 条已知 `WebAssembly.instantiate`/CSP 异常、新增 **0**。完整 session-sync run 记录基线 2、新增同类 CSP 1；父会话确认这是安装版也存在的独立 CSP 缺陷，不放宽 CSP、不加 `unsafe-eval`，按要求继续计数并作为已知非阻塞项单列。准确 HTTP 429 状态数为 **0**；此前裸数字匹配是误报。
- 会话完整性：suite 后两条最新 harness 自建会话已通过应用 `deleteAgentSession` API 清理；索引回到 **830** 条，826 个 JSONL 总字节 **535,970,089 B**。清理后 canonical session SHA-256 `090d9a28…467c7149`、JSONL 集合 SHA-256 `71688f45…43a53cac` 与测试前（dev 启动后）相同。0.5 Mbps 旧压力数据：列表 responseUtf8 **459,730 B**、appSent **613,300 B**、fresh-list **10,135 ms**；41,914,743 B 历史首屏 **4,349 ms**。这些旧数值与本轮 3 Mbps 实测分开记录。
- 子任务/自动化分组、越权移出只发 ID-only remove、旧快照不复活由会话管理器/Renderer/full-ui 单测覆盖；本轮没有独立桌面进程与真机 iOS Safari 双客户端 E2E。Smoke/attachments 因隔离 dev 无渠道而未运行。

### 会话元数据增量事件契约（2026-09-30）

- `agent-session-manager.ts` 的索引写入点是会话元数据增量的单一事件源；按每次持久化索引前后的安全投影生成 upsert/remove。投影含 renderer 实际用到的 `parentSessionId`、`rootSessionId`、`sourceDelegationId`、`delegationStatus`、`sourceAutomationId`，以保持子会话树、运行状态和自动任务分组；不读取这些字段的 `delegationRole`、`delegationDepth`、`automationGraduated` 不随事件下发。
- 事件携带 main-process boot UUID `epoch` 与单调 `sequence`。可清除的列表分类字段通过 `clearedFields` 显式标记，防止客户端浅合并后残留旧关系/分组；不下发 `delegationGoal`、`piSessionFile`、`piEntryBindings`、凭据、secret、绝对路径或其他未列入投影的字段。
- `agent:session-metadata-changed` 在 full-ui 分级表中是 `read/workspace`。服务器按当前 workspaces allowlist 定向过滤；会话移出已授权范围时只发送此前允许列表的 `remove` + session ID，不发送标题或目标工作区；目标工作区未授权的新增/更新、未授权会话删除均拒绝。
- Renderer 的 revision journal 记录每次增量；所有列表快照写入使用请求开始时的 revision，并重放请求进行期间到达的增量。cursor 按 `epoch`/`sequence` 检查顺序：新 main-process epoch 可从 sequence `1` 开始；切换后将旧 epoch 记为 retired，迟到的旧 epoch 事件会被拒绝，不能回滚 cursor。WebSocket 重连会回取 active/archive 权威快照，但不清零已识别 epoch 的顺序。归档视图、active 列表、标签与删除后选中态共用增量路径；草稿保持隐藏，删除与工作区移出都清理本地条目；同 ID 后续合法 upsert 会清除删除标记。
- 删除标记与增量 journal 均最多保留 8,192 条。若非常旧的 snapshot 在 journal 超限后才返回，将丢弃该 stale snapshot、保留当前列表并等待下一次权威同步，不用不完整历史覆盖现有状态；同 ID 的后续合法 upsert 会解除 tombstone。单测覆盖旧快照晚到改名/删除、epoch 重启、移出范围和恢复、清除字段、cursor/journal 两种消费顺序及保留上限 fail-closed。
- 端到端状态（2026-09-30）：Chromium iPhone UA 通过 Web Remote 对本轮自建 session 执行实时改名/归档/恢复/删除和断线重连；main-side 操作通过 raw IPC 模拟，不是独立桌面 UI 或真机 iOS Safari 双端操作。`session-sync` 完整 run 的交互断言可通过，但最终批准的尝试在删除后等待侧栏状态时遇到 CDP page_unresponsive，因此本轮整体标为“部分验证/最终尝试未通过”。越权创建拒绝已在 suite 覆盖；授权移出只收到 ID-only remove、子会话/自动任务分组和迟到快照删除不复活由 `full-ui-security`、session-manager 与 Renderer reducer 单测覆盖。跨工作区真实移动及实体手机仍未 E2E。
- 最终离线状态核对（2026-09-30）：开发端口 17889/5173 无监听，临时 Tailscale Serve 8443 已关闭；只保留安装版 17888 的既有 Serve 路由，未尝试启动或停止任何应用进程。
