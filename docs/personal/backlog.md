# Proma 个人版 · 待合入分支与待办（SSOT）

本文件是“已完成但未发布的分支”和“已确认的后续待办”的唯一权威清单。下次功能批次或整改时，从这里挑选合入；合入或放弃后在此更新状态，并在 `docs/personal/changelog.md` 追加记录。

## 待合入分支（已验证、未发布）

- 无（`b3a24028` 已于 2026-10-08 20:31 安装）。

| 分支 | 基于 | 内容 | 验证 | 状态 |
|---|---|---|---|---|
| `fix/mobile-dedupe-20261001`（已合入） | `personal` efc420c1 | P：手机端 `agent:list-active-sessions` / `count-archived-sessions` 并发合并 + 3 秒复用，元数据变更事件使缓存失效（同组操作 13 次 / 825 KB → 6 次 / 382 KB）。Q：IPC WebSocket 带 `src` 与随机 `page` 参数，v2 `open` 行记录来源，用于区分同页双连接与多页面实例。R：非省流量模式首屏历史预算 2 MiB → 1 MiB（41.9 MB 历史弱网首屏 11.3 s → 7.7 s），“加载更早”仍 2 MiB/页 | 原分支 678 pass / 0 fail；合入后本批全量 685 pass / 0 fail；typecheck 与 main/renderer/web-preload 构建通过 | 2026-10-02 以 `--no-ff` 合入 `fix/mobile-batch-20261002`（未推送、未发布）；冲突仅在 changelog，双方记录均保留并按时间顺序排列 |

已归档、不合入：开发进程安全完整方案（原 `fix/dev-process-safety-20260930`，约 2,000 行 launchd 托管），以 git bundle 存档于本机会话工作台 `archive/dev-process-safety-20260930.bundle`；评估结论为过重，改走下方“开发启动小修复”。

## 用户反馈收集（2026-10-01 起，下一批一并实现）

用户使用当前安装版（76cad12c，现为 03901c8a）几天，期间反馈的问题与需求逐条追加到此表（日期、现象/需求、来源设备、初步判断）。下一批开工前与“待合入分支”“后续待办”一起排优先级。

| 日期 | 反馈 | 设备 | 初步判断 / 方案 |
|---|---|---|---|
| 2026-10-01 | 手机端无法调整思考强度，只能开/关 | 手机 | 思考按钮在桌面靠鼠标悬停弹出强度滑块，点击只切换 off/high；手机无悬停，滑块不可达。2026-10-02 首次修复未阻止 Radix PopoverTrigger 后续 toggle，安装后手机面板仍关闭；2026-10-02 再修复为 Web Remote 触屏 click 先 `preventDefault()` 再显式打开，并忽略合成 mouseleave 关闭。全量测试通过，iOS Safari 模拟器实点确认“思考深度”面板保持打开；桌面和非触屏 click 仍走原逻辑。✅ 已解决（03901c8a / 2026-10-06） |
| 2026-10-03 | 无档位模型的思考模式开关无法持久化（观察项） | 手机 | dev CDP 只读复现：临时 unsupported 模型下真实触摸使 Switch `aria-checked` 从 true 变 false，但 `settings:update` 被 Web Remote 拒绝，主进程 `agentThinking` 设置仍为 adaptive。当前 dev 实际启用的 Codex GPT-5.5 与 clipproxyapi Claude Opus 5.5 都返回 reasoning capability，未复现正式版所述的开关无效；无档位分支仅用本轮测试会话里的临时 unsupported model id 验证。暂不新增设置写通道，待使用实际无档位模型进一步确认。 |
| 2026-10-02 | 安卓同时收到“桌面 App（PWA）”和“Chrome”两条相同通知，关闭 Chrome 页面后仍如此 | OPPO | 服务端 push-subscriptions.json 只有 1 个安卓订阅（09-28 创建），按设计每个事件只推送 1 次；第二条来源未证实（候选：页面内通知路径、安卓把同一推送同时归到 Chrome 与 WebAPK）。待用户提供通知栏截图与长按所属应用。部分处理于 2026-10-02：页面存在 Service Worker 推送订阅时不再创建 renderer 页面内 Notification（提示音不变），无订阅仍保留页面通知；推送发送新增 `[INFO] scope=Web Remote 推送`，仅记设备哈希、kind、状态，不含标题/正文。原来源仍待 OPPO 通知栏截图确认；若仍双显，下一步区分 Android 对同一推送的系统归类行为。与“同设备双连接”无直接因果。✅ 已解决（4a2b6dac 后每设备 1 条推送，用户确认 / 2026-10-02） |
| 2026-10-02 | 手机端对话里的本地图片显示“图片无法读取”（桌面正常；与省流量开关无关） | OPPO | 根因：Markdown 图片经 `file:resolve-path` 解析，服务端路径授权通过（计量有调用、无拒绝），但返回的是 `proma-file://` 自定义协议 URL，手机浏览器无法加载 → `<img>` onError。已实现于 2026-10-02：Web Remote shim 对 `file:resolve-path` 返回的 PNG/JPG/JPEG/GIF/WebP/BMP 使用同一授权路径的 `file:read-binary-base64` 转 data URL，单张上限 8 MiB，同一路径在页面内缓存；超限返回 null。SVG、PDF 等非目标格式保持原结果。✅ 已解决（4a2b6dac / 2026-10-02） |
| 2026-10-02 | 回答已结束，手机仍显示“Agent Running 6m31s”，刷新页面后恢复 | OPPO | 正式版计量：连接 e1d195af 流式输出到 12:07:51 后以 `1006` 异常断开，所有连接都没有收到完成事件（各窗口 `scN=0`），12:11:07 页面内自动重连。代码确认 `restoreActiveSnapshots()` 只把主进程“仍在运行”的快照合并进本地状态，**不会清除本地标记为运行中、但已不在快照里的会话**，因此断线期间错过的完成永远不会被纠正。已实现于 2026-10-02：仅 Web Remote 恢复路径将 running/retrying/background-waiting 且不在活跃快照中的会话结束，并逐会话触发一次历史刷新；仍运行的快照状态保留，桌面初始化路径不变。`web-remote-recovery.test.ts` 与 `useGlobalAgentListeners.recovery.test.ts` 覆盖恢复筛选、结束态及一次刷新。✅ 已解决（4a2b6dac / 2026-10-02） |
| 2026-10-02 | 手机端对话内本地图片超过 8 MiB 时只显示“图片无法读取”，希望可以点击加载原图 | 手机 | 现状（fix/mobile-batch-20261002）：shim 以 8 MiB 上限调用 `file:read-binary-base64`，超限返回 null。已实现：超限显示“图片较大（>8 MB），点按加载原图”，点按后以 50 MiB 上限读取并缓存；蜂窝/省流量模式同样需点按。✅ 已解决（2026-10-07） |
| 2026-10-02 | 观察：正式版 13:28:45 `[WARN] 消息截断后仍超限 (1471K / 3046K chars)` | Mac | 上游 `agent-session-manager.ts` `serializeSDKMessageForStorage` 对超大 SDK 消息截断后仍 >上限，消息照常写入。可能来自 Read 图片/大工具输出的 base64。手机历史已有瘦身与按需加载，暂不处理；若相关会话在手机打开变慢再查 |
| 2026-10-05 | 手机点附件按钮，iPhone 直接打开相机，无法选文件/相册；安卓会弹出选择（相机/文件/相册） | iPhone | `web-electron-shim.ts` `openBrowserFileDialog()` 给 `<input type=file>` 设了 `capture="environment"`，iOS Safari 遵守该属性直接调起后置相机，Android Chrome 仍给选择器。方案：去掉 `capture`（两端都出现系统选择菜单，含“拍照”）；如需一键拍照另加入口。1 行 + 单测 |
| 2026-10-05 | 回归项：Agent 提问 / 计划审批 / 权限确认在手机端自 09-26 真机验收后未完整回归 | 手机 | 下次开 dev 时跑 harness `interactions` 套件（真实渠道，少量额度）；提问卡片自由输入框被程序聚焦时键盘不自动弹出属设计 |
| 2026-10-07 | 桌面新建 Agent 会话后，左侧栏同一工作区出现重复“新 Agent 会话”条目；发首条消息后其一自动命名，旧条目仍在 | Mac 桌面 | 2026-10-08 dev full-ui 复现：API 会话索引每个测试 ID 仅一条，但同一 `data-session-switch-id` 在侧栏 DOM 中可出现 5 次；新建第二会话并自动命名后，旧未命名条目仍显示。所有 LeftSidebar Agent 列表 memo 均过滤 `isDraft`/`draftSessionIds`，归档分组也过滤 `isDraft`；测试时 `settings.tabState` 只引用原会话，非来源。定位为侧栏可见项目会话投影未保证 root ID 唯一，加上创建 IPC 响应直接 prepend 可能与主进程 metadata upsert 重复。修复：投影输出按会话 ID 去重；所有 Agent 会话创建响应使用 `upsertAgentSession`。新增事件先于 IPC 响应的竞态单测与可见行 ID 去重单测；定向测试 12 pass，typecheck 和 renderer build 通过。dev full-ui 回归：修复后新建会话 ID 在侧栏 DOM 中恰好 1 行；截图存于当次会话工作台。测试会话已通过应用 API 删除，索引回到 831。
| 2026-10-08 | **子 Agent 跨渠道委派**：clipproxyapi 链路不稳时，子 Agent 改走其他已启用渠道 | Mac | 已实现：`delegate_agent(s)` 增加可选 `channelId`（省略时保留父渠道行为）；`list_available_agent_models` 返回分组渠道列表并排除 `provider=proma`；显式目标渠道/模型校验，省略模型时取目标渠道首个启用模型；子会话记录及 continue/恢复使用子会话的渠道。单测 6 pass，Electron typecheck 通过。真实 dev 已触发跨渠道委派及同一子会话 continue，确认子会话 channelId/modelId 为指定 Codex/gpt-5.5；两轮回复均因 ChatGPT 登录凭据无法刷新而失败，故内容级真实验收待凭据恢复后重跑。
| 2026-10-08 | harness `iphone:interactions` 的 AskUser 确认定位不稳定；计划审批与权限确认覆盖需确认 | 测试 | 已在 `AskUserBanner.tsx` 给确认按钮添加 `data-web-remote-ask-confirm="true"`，harness 优先使用该标记，回退到横幅最后一个可见按钮；计划审批仍按可见按钮名称“批准并完全自动执行”定位（按钮含同名可见文本），权限请求确认不在当前 interactions suite 中。两次 dev `iphone:interactions` 均在选择 A 后报未找到确认按钮（标记与末尾按钮均未命中），未进入计划审批步骤；需先查明选择后 AskUser DOM/按钮状态再继续，不能标为通过。两次 harness 均完成设备/Chrome/profile 清理，索引复核 831。
| 2026-10-08 | harness `iphone:interactions` 点选 A 后 AskUser 横幅立即消失；真机交互正常 | 测试 | ✅ harness 根因已查明并修复：`findElement('A')` 把关闭按钮 `title="关闭并终止 Agent"` 的 A 子串当作选项，实际触碰 X；精确按选项 `span` 匹配后 `iphone:interactions` 全套通过（AskUser 回答 A、计划审批通过）。证据与截图见 `docs/personal/changelog.md` 2026-10-08 条目/本次会话工作台。权限请求确认仍未覆盖：应用只有 `bypassPermissions`、`plan` 两种模式，没有需确认模式，待父会话决策是否补足产品/测试路径 |
| 2026-10-08 | 持久化的未使用草稿累积（正式版 9 条；用户确认侧栏不显示） | 数据 | ✅ 已实现启动时严格筛选空草稿，备份完整 metadata 后经会话删除 API 清理；dev 初始 832 会话/3 草稿，清理 3 后 829/0，备份权限 0600；全量测试通过。正式版 `~/.proma` 未触碰。详见 changelog 2026-10-08 “未使用草稿清理” |
| 2026-10-08 | ChatGPT 订阅 (Codex) 模型目录缺少 GPT-6.1 Sol | Mac | ✅ 已加入精确模型识别、与 GPT-6 Sol 相同的推理档位/上下文、Fast Mode、Pi catalog 与存量渠道幂等候选迁移。CLI 0.154.0 的 HTTP 400 属客户端版本门控；ChatGPT.app 自带 codex-cli 0.162.0-alpha.2 在同一账号返回 ok。Pi SDK 请求头为 `originator: pi` 且无 `version` 头，是否可用待用户在 dev 重新登录后实测，不下最终结论 |
| 2026-10-08 | Codex Ultra reasoning 档位 | 产品能力 | 未实现：虽然服务端模型清单报告支持 ultra，但该档位会影响 Astra/Sol 等多个模型系列；当前产品 ThinkingLevel/profile 类型没有 ultra，本次仅保持 6.1 Sol 与 6 Sol 一致，不扩展全局档位。后续需单独评估产品 UI、协议映射与各模型支持范围 |
| 2026-10-08 | `install-update.sh` 启动后快照比对要求会话数完全一致，会把启动时的草稿清理误判为失败并回滚；本次由 Claude Code 用授权的脚本副本安装 | 安装 | ✅ 已实现：`health-snapshot.py --compare` 仅在启动前 `since` 之后生成的草稿备份 ID 并集与减少 ID 完全一致、备份条目均为草稿、减少 ID 不在启动后索引且其他快照字段一致时接受差异；旧调用保持严格一致。脚本测试与 `/tmp` `--test-mode` 演练覆盖。另：打包前先 Boot 模拟器，避免 serve-sim 冒烟被跳过 |

## 后续待办（按建议优先级）

1. **观察项（部分确认）**：双连接自 2026-10-02 dedupe 分支后未再出现，标记已确认；iPhone 首次加载约 4.2 MB `get-sdk-messages` 单次/多次构成仍保留观察。
2. **开发启动小修复**：✅ 已完成（2026-10-07），只读 dev 进程诊断、独立 session 启动、PID 启动时间核对及异常健康状态处理均已实现；真实 start → stop 与伪造启动时间拒绝验证见 changelog。
3. **正式版后台服务诊断**：✅ 已实现（2026-10-07），Web Remote/调度器/子进程/退出阶段事件日志与定时自检详见 `docs/personal/web-remote.md`。
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
- **dev 中禁用 OAuth 渠道**（2026-10-08）：dev 的 `channels.json` 是正式渠道副本，ChatGPT 订阅 (Codex) 等 OAuth 渠道的 access token 过期后，dev 会用正式版已轮换的旧 refresh token 刷新并失败，还可能触发服务端重放检测、影响正式版登录。dev 验收默认只用 API Key 渠道（clipproxyapi、智谱、DeepSeek）；确需验证 OAuth 渠道时，由用户在 dev 中**重新登录**取得 dev 自己的凭据（2026-10-08 验证 GPT-6.1 Sol 时如此操作，正式版登录不受影响），不得使用复制来的过期凭据。


- 用户 2026-10-07 决定：不把 Proma 加入登录项，继续由用户手动启动。
