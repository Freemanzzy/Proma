# 外部受限工作区（`externalAccess: 'confined'`）SSOT

> 截至 2026-11-15。用途：客户飞书群 Bot 等对外入口专用的工作区。来源：BR 多客户会话 `f3156176` 交接（2026-11-14）。设计与分工计划在管理会话工作台 `plan/confined-workspace-20261114.md`；实现与验证记录见 changelog 2026-11-15。

## 用途与边界
- 客户在群里与 Bot 对话，等同于在该工作区内对话；只能读写本工作区的项目文件、运行管理员批准的命令。不能用本机浏览器、MCP、其他工作区、记忆、Skills、定时任务、Todo/日程。
- 这是 **Proma 主进程的工具层隔离，不是操作系统沙箱**。Bot 与管理员数据仍在同一台电脑、同一系统用户下。真正隔离要等专用 Mac mini。
- 不影响其他工作区：所有限制只在工作区 `externalAccess === 'confined'` 时生效。

## 怎么开启
1. 工作区菜单选“外部受限（客户 Bot）”（与“对其他工作区只读”互斥）。
2. 在 `~/.proma/agent-workspaces/<slug>/confined-policy.json` 写策略（Agent 读写不到这个位置）：
   ```json
   { "version": 1, "commands": ["/abs/path/outside/workspace/br-bot-<client>"], "env": [], "allowGroupChatHistory": true }
   ```
   - `commands`：允许执行的绝对路径。**入口及其依赖必须放在客户工作区之外**（位于项目文件目录或会话工作台内的入口会被拒绝执行），并由管理员控制。
   - `env`：需要额外传给入口的环境变量名（值取自 Proma 进程环境），默认空。
   - 文件缺失或格式错误：Bash 全部拒绝。修改策略即时生效。
3. 飞书 Bot 设置里把该 Bot 的默认工作区设为这个工作区。**不要**把客户工作区设成应用全局默认工作区。
4. 在该工作区**新建**会话使用。设为 confined 之前已存在的会话不能在 confined 下运行。

## 规则（实现：`apps/electron/src/main/lib/personal-confined-workspace.ts`、`personal-confined-paths.ts`）
- **默认拒绝**，在所有权限模式下生效（含完全自动）。放行：
  - Read/Grep/Glob/LS、Write/Edit/MultiEdit：只限项目文件目录与本会话工作台；路径按 Pi 的实际解析（`~`、`@`、`file://`、Unicode 空格、Read 的 macOS 文件名回退）并经 realpath，要求交给 Pi 的路径经再次解析后仍是同一路径。工作区根（AGENTS.md、mcp.json、策略文件、memory、skills）不可读写。白名单入口不可被改写。
  - Bash：命令按无展开的分词器拆分（拒绝 `$`、反引号、反斜杠、换行、`; & | < > ( )`、未加引号的通配符、`VAR=` 前缀），首词须逐字等于白名单路径；每个参数（含 `--k=v` 的值）按原文相对 cwd 解析并 realpath 后须在根内，含 `..` 段或以 `~` 开头一律拒绝；改写为逐词单引号 + `/usr/bin/env -i` 最小环境（HOME、系统 PATH、LANG、TMPDIR、TZ 及策略 env）。外层 Bash 也以最小环境启动。
  - 本会话进度项（Task*、TodoRead）、CompactContext、飞书本群聊天记录（策略 `allowGroupChatHistory: false` 可关）。
- **不提供**：不启动用户 MCP，不构建协作/定时任务/planning/Terminal/EgoBrowser 等产品工具，不加载 Skills 与 prompt 模板，忽略附加目录与 Vault。
- **精简系统提示**：只说明受限身份与工作区 AGENTS.md；不注入用户名、其他工作区、路径、记忆、MCP、Skills；Pi 自带的 cwd 段改为 `.`。
- **会话来源**（`AgentSessionMeta.confinedOrigin`，additive）：只有在工作区已是 confined 时由用户/Bridge 显式新建的会话才授予；委派子会话继承同工作区父链；fork 继承源；插队消息注入普通上下文前、工作区退出 confined 时撤销。无标记的会话在 confined 下运行前被拒绝，不 resume 旧 transcript。
- **Bridge**：飞书与通用（钉钉/微信）处理器按“有效默认工作区”（与新建会话同一回退链）判定；confined 时只允许 `/help /new /list /switch /stop`，`/list` `/switch` 仅限本工作区带来源标记的会话，旧的跨工作区绑定被忽略但保留在文件中。**Slack 未接入**：Slack 新建到 confined 工作区的会话没有来源标记，会被拒绝运行（fail closed）。

## 已知限制
- 非 OS 沙箱：入口脚本、入口依赖、策略 env、管理员手写的工作区 AGENTS.md 都属于信任边界；入口自己解释的参数（URI、SQL 等）需入口内做业务限制。
- 路径检查与实际打开之间存在 TOCTOU（并发换符号链接），不处理。
- Grep/Glob 使用 Pi 自带实现，搜索程序的宿主配置（如 `RIPGREP_CONFIG_PATH`）视为可信环境。
- 仅在 macOS 验证；受限 Bash 固定 `/bin/bash`。
- 精简提示不列出白名单命令，入口的用法要写在工作区 AGENTS.md 里。

## 回退
- 旧版本不认识 `'confined'`，会按非只读工作区运行（失去全部限制）。回滚应用前先把客户工作区改为“对其他工作区只读”或停用客户 Bot。
