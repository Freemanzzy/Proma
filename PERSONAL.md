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

目前为空。个人版当前仅记录基线、隐私防护和验证结果，未对上游源码做功能改动。

## 同步记录

| 日期 | 分支 | 上游基线 | 结果 | 备注 |
|---|---|---|---|---|
|  |  |  |  |  |

## 已知问题

- Git 首次 `git push` 触发 macOS `credential-osxkeychain` GUI 授权弹窗，在无人值守环境会阻塞；已改为仅本仓库配置 `!gh auth git-credential`，并用 `GIT_TERMINAL_PROMPT=0` 与 120 秒超时推送。
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
