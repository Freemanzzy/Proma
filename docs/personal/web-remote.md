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

启动开发实例：

```bash
PROMA_WEB_REMOTE=1 bash scripts/personal/dev.sh
```

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

## 5. 通知（Web Push）

- 推送时机：运行完成、运行失败、工具审批、Agent 提问、计划审批、定时任务完成/失败。
- 静默：该会话正在某台手机前台打开时，不向这台手机推送；同一会话同类事件 30 秒内去重。
- 推送经 Google（Android）/ Apple（iPhone）推送服务，Mac 通过代理 `http://127.0.0.1:7897` 发送；推送服务返回 404/410 时自动删除失效订阅。

## 6. 安全边界

- 网络：只监听回环地址；只经 Tailscale Serve（不使用 Funnel）；Serve 注入 `Tailscale-User-Login` 并剥离客户端伪造的同名头。
- 身份：配对设备用 32 字节随机令牌（服务端只存 SHA-256，Cookie `HttpOnly; Secure; SameSite=Strict`，可撤销）；受信设备须同时满足：账号在允许列表、来源 IP 属于 tailnet、`tailscale whois` 返回同一账号且设备名在受信列表。本机其他进程理论上可伪造回环请求头，但本机进程本就拥有同等权限。
- IPC 分级：`full-ui/channel-policy.ts` 为全部 IPC 通道的显式分级表，**未分级即拒绝**，启动时校验覆盖率（当前 100%）。级别：`read`、`session`、`workspace`、`write`、`confirm`（手机端二次确认，如删除会话/Todo、定时任务立即运行）、`denied`（凭据、终端、设置写入、原生窗口等）。
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

- `bash scripts/personal/mobile-preview.sh start`：检查 17889/5173 空闲、开启临时 8443 Tailscale Serve、后台启动开发实例并等待启动与分级覆盖率 100% 日志；PID/日志分别记于 `/tmp/proma-mobile-preview.pids` 与 `/tmp/proma-mobile-preview.log`。
- `bash scripts/personal/mobile-preview.sh sim [--device <name|udid>]`：默认启动 iPhone 17 Pro 模拟器、打开 Simulator、生成配对码并通过 AXe 的辅助功能树定位配对控件，配对后打开 `/app/` 并以 `simctl` 截图确认界面。
- `bash scripts/personal/mobile-preview.sh test [suites...]`：默认运行 iPhone 的 panel-probe/smoke/mobile-polish/layout 与 Android 的 smoke/attachments；每套单独去掉代理变量并受 420 秒外层 watchdog 保护，结束核查无残留 `proma-mobile-chrome`。
- `bash scripts/personal/mobile-preview.sh status` 查看服务、模拟器与 harness 进程；`stop` 只按记录 PID 停止开发实例进程树，关闭 8443 并确认 Serve 路由状态。用户需要继续体验时，最后运行 `start` 与 `sim`，保持服务运行，不要执行 `stop`。

harness 默认整体超时 300 秒（可用 `--timeout-ms` 覆盖），每次页面评估前以 3 秒 CDP 探活；每次运行后自动撤销测试配对设备、删除自建会话、关闭 Chrome 并移除临时 profile。`full-ui/mobile-patch.test.ts` 使用 linkedom 执行注入脚本并多次触发 MutationObserver，验证刷新/面板/菜单/通知图标、标题和 Tab 下拉菜单的 DOM 写入趋于稳定。`layout` 检查文件、改动、Todo、定时任务、MCP/Skills 与项目记忆列表/详情的横向溢出和元素可点性；`panel-probe` 检查页面下拉中的 Tab 可点性；`mobile-polish` 检查刷新和会话单击切换。左侧项目名是展开/折叠分组，不是 `agentWorkspaceId` 切换，勿以此字段判定工作区按钮点击。同步上游后必须运行；安装后另由用户在安装版上用两台手机验收（CLAUDE.md §6 第 7 项）。每周一的版本检查任务会报告上游新增、尚未分级的 IPC 通道。
