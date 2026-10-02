# Proma 个人版 · 待合入分支与待办（SSOT）

本文件是“已完成但未发布的分支”和“已确认的后续待办”的唯一权威清单。下次功能批次或整改时，从这里挑选合入；合入或放弃后在此更新状态，并在 `docs/personal/changelog.md` 追加记录。

## 待合入分支（已验证、未发布）

| 分支 | 基于 | 内容 | 验证 | 状态 |
|---|---|---|---|---|
| `fix/mobile-dedupe-20261001`（已合入） | `personal` efc420c1 | P：手机端 `agent:list-active-sessions` / `count-archived-sessions` 并发合并 + 3 秒复用，元数据变更事件使缓存失效（同组操作 13 次 / 825 KB → 6 次 / 382 KB）。Q：IPC WebSocket 带 `src` 与随机 `page` 参数，v2 `open` 行记录来源，用于区分同页双连接与多页面实例。R：非省流量模式首屏历史预算 2 MiB → 1 MiB（41.9 MB 历史弱网首屏 11.3 s → 7.7 s），“加载更早”仍 2 MiB/页 | 原分支 678 pass / 0 fail；合入后本批全量 685 pass / 0 fail；typecheck 与 main/renderer/web-preload 构建通过 | 2026-10-02 以 `--no-ff` 合入 `fix/mobile-batch-20261002`（未推送、未发布）；冲突仅在 changelog，双方记录均保留并按时间顺序排列 |

已归档、不合入：开发进程安全完整方案（原 `fix/dev-process-safety-20260930`，约 2,000 行 launchd 托管），以 git bundle 存档于本机会话工作台 `archive/dev-process-safety-20260930.bundle`；评估结论为过重，改走下方“开发启动小修复”。

## 用户反馈收集（2026-10-01 起，下一批一并实现）

用户使用当前安装版（76cad12c）几天，期间反馈的问题与需求逐条追加到此表（日期、现象/需求、来源设备、初步判断）。下一批开工前与“待合入分支”“后续待办”一起排优先级。

| 日期 | 反馈 | 设备 | 初步判断 / 方案 |
|---|---|---|---|
| 2026-10-01 | 手机端无法调整思考强度，只能开/关 | 手机 | 思考按钮在桌面靠鼠标悬停弹出强度滑块，点击只切换 off/high；手机无悬停，滑块不可达。2026-10-02 首次修复未阻止 Radix PopoverTrigger 后续 toggle，安装后手机面板仍关闭；2026-10-02 再修复为 Web Remote 触屏 click 先 `preventDefault()` 再显式打开，并忽略合成 mouseleave 关闭。全量测试通过，iOS Safari 模拟器实点确认“思考深度”面板保持打开；桌面和非触屏 click 仍走原逻辑。
| 2026-10-02 | 安卓同时收到“桌面 App（PWA）”和“Chrome”两条相同通知，关闭 Chrome 页面后仍如此 | OPPO | 服务端 push-subscriptions.json 只有 1 个安卓订阅（09-28 创建），按设计每个事件只推送 1 次；第二条来源未证实（候选：页面内通知路径、安卓把同一推送同时归到 Chrome 与 WebAPK）。待用户提供通知栏截图与长按所属应用。部分处理于 2026-10-02：页面存在 Service Worker 推送订阅时不再创建 renderer 页面内 Notification（提示音不变），无订阅仍保留页面通知；推送发送新增 `[INFO] scope=Web Remote 推送`，仅记设备哈希、kind、状态，不含标题/正文。原来源仍待 OPPO 通知栏截图确认；若仍双显，下一步区分 Android 对同一推送的系统归类行为。与“同设备双连接”无直接因果。 |
| 2026-10-02 | 手机端对话里的本地图片显示“图片无法读取”（桌面正常；与省流量开关无关） | OPPO | 根因：Markdown 图片经 `file:resolve-path` 解析，服务端路径授权通过（计量有调用、无拒绝），但返回的是 `proma-file://` 自定义协议 URL，手机浏览器无法加载 → `<img>` onError。已实现于 2026-10-02：Web Remote shim 对 `file:resolve-path` 返回的 PNG/JPG/JPEG/GIF/WebP/BMP 使用同一授权路径的 `file:read-binary-base64` 转 data URL，单张上限 8 MiB，同一路径在页面内缓存；超限返回 null。SVG、PDF 等非目标格式保持原结果。 |
| 2026-10-02 | 回答已结束，手机仍显示“Agent Running 6m31s”，刷新页面后恢复 | OPPO | 正式版计量：连接 e1d195af 流式输出到 12:07:51 后以 `1006` 异常断开，所有连接都没有收到完成事件（各窗口 `scN=0`），12:11:07 页面内自动重连。代码确认 `restoreActiveSnapshots()` 只把主进程“仍在运行”的快照合并进本地状态，**不会清除本地标记为运行中、但已不在快照里的会话**，因此断线期间错过的完成永远不会被纠正。已实现于 2026-10-02：仅 Web Remote 恢复路径将 running/retrying/background-waiting 且不在活跃快照中的会话结束，并逐会话触发一次历史刷新；仍运行的快照状态保留，桌面初始化路径不变。`web-remote-recovery.test.ts` 与 `useGlobalAgentListeners.recovery.test.ts` 覆盖恢复筛选、结束态及一次刷新。 |
| 2026-10-02 | 手机端对话内本地图片超过 8 MiB 时只显示“图片无法读取”，希望可以点击加载原图 | 手机 | 现状（fix/mobile-batch-20261002）：shim 以 8 MiB 上限调用 `file:read-binary-base64`，超限返回 null。方案：超限时显示“图片较大（xx MB），点按加载原图”占位，点按后不设该上限（或更高上限）读取并缓存；蜂窝/省流量下保持需点按。备选：Mac 端缩放为长边约 2048 的 JPEG 先显示缩略版 |
| 2026-10-02 | 观察：正式版 13:28:45 `[WARN] 消息截断后仍超限 (1471K / 3046K chars)` | Mac | 上游 `agent-session-manager.ts` `serializeSDKMessageForStorage` 对超大 SDK 消息截断后仍 >上限，消息照常写入。可能来自 Read 图片/大工具输出的 base64。手机历史已有瘦身与按需加载，暂不处理；若相关会话在手机打开变慢再查 |

## 后续待办（按建议优先级）

1. **观察项（装上 dedupe 分支后用计量确认）**：同设备是否仍出现两条同一秒建立的连接（看 `open` 行的 `page`）；iPhone 首次加载约 4.2 MB `get-sdk-messages` 是单次还是多次。
2. **开发启动小修复（约 100 行以内）**：删除或改造 `apps/electron/scripts/dev-kill.ts` 中的 `pkill` / Windows 按名 `taskkill`（`dev:kill` 手动命令仍可触发）；dev 启动脱离父进程（避免随正式版退出）；`mobile-preview.sh status/stop` 结束前核对 PID 启动时间，进程在但端口未监听时判为不健康并关闭 8443。用一次真实 start → stop 验收。
3. **正式版后台服务诊断**：为 Web Remote 启停、调度器 tick、渲染进程重建、退出阶段写 `[INFO]`；定期自检“Web Remote 已启用但端口未监听”“启用任务 nextRunAt 过期 >10 分钟”并告警。对应 2026-09-30 凌晨停摆（根因未证实）。
4. **两层测试**：小测试集功能回归（约 20 条会话，含父子任务、自动化、归档、两个工作区和一条合成大历史，脚本生成、每次重置）；真实负载测试按下方“真实负载测试触发条件”执行，只测量不作功能判定。
5. **手机查看子任务**：点子任务时自动打开右侧抽屉并在窄屏正常显示（只改 mobile-patch，约半天）。
6. **`restoreQueuedMessages()` 合并为一次请求**（目前 Web Remote 已限定范围，约 10 次）。
7. **发送的可见确认标记**（可选，用户未要求）。
8. **“只推送手机正在看的会话的实时输出”**：完成事件瘦身与背压上线后积压已消除，暂不需要；若计量再出现 MB 级峰值再评估。
9. **WebAssembly 被 CSP 拦截的启动报错**：既有独立缺陷，不得放宽 CSP 修复。
10. **上游同步准备**：下次官方 tag 时把 `useGlobalAgentListeners.ts` 的个人版改动拆为独立模块，降低冲突面（见本机 `upstream-surface` 报告）。

## 测试与开发数据约定

- **真实负载测试触发条件**（父会话在派单前判断，并在交接/安装申请写明做了或没做及原因）：改动涉及手机列表数据内容（字段、投影、瘦身）、历史加载（分页、加载更早、按需媒体）、传输层（WebSocket、压缩、分块、超时、重连同步）、首次加载前端资源明显变大、同步官方版本且上游改了会话存储或 Web Remote、用户反馈手机变慢。其余改动用功能回归 + 打包冒烟即可。
- **个人自建 Skill 预装**：`~/.proma/default-skills/` 是新建工作区复制 Skill 的模板。Proma 启动时只同步安装包内置的 slug（缺失才复制、版本更高才覆盖），并只删除 `RETIRED_DEFAULT_SKILL_SLUGS` 列出的 slug，因此放入其中的个人 Skill（目前 `cliproxy-image` 1.0.1）不会被更新覆盖。副作用：Skills 页面会把它归入“内置”分组。修改个人 Skill 时需同步 `default-skills` 与各工作区副本。若以后上游内置同名 slug，会被上游版本覆盖，届时改名。
- **dev 数据**：`~/.proma-dev` 含按 `scripts/personal/import-session-workspace.py` 选择性导入的真实会话（单工作区 allowlist），以及用户 2026-10-01 授权复制的正式渠道 `channels.json`（权限 600，原文件改名保留）。只在本机，不提交仓库；密钥不解密、不打印。dev 中让 Agent 运行只用新建会话，不在导入的旧会话中运行（其附加目录可能指向真实仓库）；dev 对话消耗真实 API 额度。8443 只在测试期间开启。
