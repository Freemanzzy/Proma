# Proma 个人版 · 切换执行手册（Claude Code 执行）

> 定稿：2026-09-26。执行者：Claude Code 主会话（判断、与用户确认、验收）+ Sonnet 5 子代理（执行命令）。用户在场。
> 切换期间官方 Proma 退出，原先负责准备的 Proma 中控不可用；**本手册、`CLAUDE.md`、`docs/personal/fallback-runbook.md` 是全部依据**。
> 用户决定（2026-09-26）：**不做真实数据预演（P5），直接切换**；失败即回到官方版，由 Claude 负责恢复。因此第 5–6 节的首次启动验收同时承担预演职责，必须逐项做完。

## 0. 前置条件（任一不满足：停止并报告，不绕过、不临时修补）

1. 仓库：`cd ~/Documents/proma-personal && git status -sb` 干净、在 `personal`、与 `origin/personal` 一致；`PERSONAL.md` 末尾有 “切换准备 P1–P3” 与 “复核修复” 记录。
2. 脚本存在：`scripts/personal/{package-personal.sh,install-update.sh,verify-backup.py,health-snapshot.py}`。
3. 版本一致：
   ```bash
   defaults read /Applications/Proma.app/Contents/Info.plist CFBundleShortVersionString
   grep '"version"' apps/electron/package.json
   ```
   官方版更高 → 中止本次切换，先按 CLAUDE.md 同步流程把个人版同步到该版本（另行经用户确认）。
4. `/Applications/Proma.app/Contents/Resources/personal-build.json` **不存在**（当前是官方版）。若已存在，说明已切换过，改用 fallback-runbook 诊断。
5. 外置硬盘已挂载：`ls "/Volumes/Lexar ssd 2tb/proma 备份/"`；本机空闲空间 ≥ 10 GB：`df -h ~`（`~/.proma` 约 3.2 GB，安装脚本会再复制一份）。
6. 时间窗：**10:00–12:00 或 14:00–17:00**。当天的 “Phase A - 每日寄样基础同步”（03:20）与 “Phase B - 每日视频检查”（04:50）已跑完：用户在官方版“定时任务”里看这两项的最近一次运行是今天且已结束；当前没有任何定时任务在运行。
   - 说明：调度器启动时会把已过期的下次运行时间顺延到下一个周期（`automation-scheduler.ts` `startScheduler`），**切换期间错过的任务不会补跑**，也不会在首次启动时集中触发。
7. `~/.proma/web-remote/` 不存在（避免第 4 步覆盖）。

## 1. 打包（用户可继续使用官方版）

```bash
cd ~/Documents/proma-personal && export PATH="$HOME/.bun/bin:$PATH"
bash scripts/personal/package-personal.sh 2>&1 | tee /tmp/proma-package-$(date +%Y%m%d-%H%M).log
```
- 耗时较长，放后台并监控。
- 必须看到：测试失败/错误数不超过 PERSONAL.md 基线（当前 5 fail / 1 error）；`APP_UPDATE_YML=absent`；产物 `apps/electron/out/mac-arm64/Proma.app`。
- 复核：`cat apps/electron/out/mac-arm64/Proma.app/Contents/Resources/personal-build.json`（`personal: true`、`version` 与官方一致、`commit` = 当前 HEAD）；`codesign -dv` 显示 `Signature=adhoc`。

## 2. 退出官方版与开发实例（用户操作）

1. 请用户：Proma 菜单 → 退出，并确认菜单栏图标也已退出。
2. 确认：`ps -axo pid,command | grep "/Applications/Proma.app/Contents/MacOS/Proma" | grep -v grep` 为空。仍存在：请用户再退出；无响应时说明影响、征得同意后按 PID `kill`（SIGTERM）。禁止 pkill/killall。
3. 开发实例（通常随官方版的终端标签一起结束）：
   ```bash
   lsof -nP -iTCP:17888 -sTCP:LISTEN
   ps -axo pid,command | grep -E "proma-personal.*(electron|vite|electronmon|concurrently)" | grep -v grep
   ```
   仍有残留：列出 PID，征得同意后逐个 `kill`；再确认 17888 已释放（安装脚本也会检查）。
4. 确认没有其他进程在写 `~/.proma`：`lsof +D ~/.proma 2>/dev/null | head`（允许 nowledge-mem 等只读；有写入者先报告用户）。

## 3. 切换前快照与备份

```bash
mkdir -p ~/.proma-switch-backups
python3 scripts/personal/health-snapshot.py ~/.proma --output ~/.proma-switch-backups/pre-switch-snapshot.json
bash ~/.proma/agent-workspaces/default/skills/proma-backup/scripts/proma-backup.sh
python3 scripts/personal/verify-backup.py --preset proma-backup ~/.proma "/Volumes/Lexar ssd 2tb/proma 备份/<刚生成的 zip>"
```
- 必须看到 `BACKUP VERIFY PASS`（missing/extra/mismatched 均为 0）。不通过 → 停止。
- 用户若已自行准备好备份，仍需运行上面的校验确认其完整（校验对象为用户指定的 zip）。

## 4. 迁移手机访问配置（开发实例 → 正式数据，需用户同意写入 `~/.proma`）

```bash
mkdir -p ~/.proma/web-remote && chmod 700 ~/.proma/web-remote
for f in config.json devices.json vapid.json push-subscriptions.json; do
  [ -f ~/.proma-dev/web-remote/$f ] && cp -p ~/.proma-dev/web-remote/$f ~/.proma/web-remote/$f
done
chmod 600 ~/.proma/web-remote/*.json
python3 -c "import json,os;c=json.load(open(os.path.expanduser('~/.proma/web-remote/config.json')));print({k:c.get(k) for k in ('enabled','port','fullUi','workspaceScope')})"
```
- 不复制 `pairing.json`；不打印其他字段与密钥。`enabled` 应为 `true`、`port` 为 17888。
- `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status` 应显示 https 443 → `http://127.0.0.1:17888`，不需要修改。
- 如用户暂不需要手机访问，可跳过本节；安装脚本不会检查端口。

## 5. 安装（需用户同意）

```bash
bash scripts/personal/install-update.sh apps/electron/out/mac-arm64/Proma.app 2>&1 | tee /tmp/proma-install-$(date +%Y%m%d-%H%M).log
```
脚本依次：检查个人版标记 → 等待 Proma 退出（不强杀）→ 检查 17888 未被其他进程占用 → `cp -a` 备份 `~/.proma` 到 `~/.proma-switch-backups/<时间戳>/proma` 并校验、生成快照 → 官方版改名 `/Applications/Proma.previous.app` → 新包先复制为临时包再原子替换 → 启动 → 60 秒健康检查（进程存活、`~/Library/Logs/@proma/electron/main.log` 本次启动后无 `[FATAL]`、对象计数与各任务/渠道启用状态一致、手机端口由新包进程监听）→ 失败自动：结束新包进程、还原官方版、保留 `Proma.failed-*.app`；**数据不自动还原**。
- 首次启动 macOS 会弹 Keychain 访问请求：请用户点 **“始终允许”**（可能多次）。若用户误点“拒绝”，**不要在应用里保存任何渠道**（会用空凭据覆盖），退出应用后重新打开再允许。
- 健康检查可能因用户尚未处理 Keychain 弹窗而失败；此时向用户确认后可重试**一次**（`--health-seconds 120`）。
- 失败处理：确认 `/Applications/Proma.app` 已是官方版（无 `personal-build.json`）、无 failed 包进程；用快照对比 `~/.proma` 是否被改动；按 fallback-runbook 诊断；向用户报告，由用户决定修复后重试或中止。

## 6. 首次启动验收（替代预演，逐项完成）

1. 标记：`cat /Applications/Proma.app/Contents/Resources/personal-build.json`。
2. 快照对比：
   ```bash
   python3 scripts/personal/health-snapshot.py ~/.proma --output ~/.proma-switch-backups/post-switch-snapshot.json
   python3 scripts/personal/health-snapshot.py --compare ~/.proma-switch-backups/pre-switch-snapshot.json ~/.proma-switch-backups/post-switch-snapshot.json
   ```
   `--compare` 会先打印两份快照，最后一行为 `SNAPSHOT MATCH` 或差异。只有 `sessions.count` 增加（用户新建了对话）视为正常；定时任务与渠道的 id、启用状态、各格式版本、`planning_user_version`、符号链接数必须一致。
3. 用户在个人版中确认：
   - 会话列表完整；打开一个最近会话和**一个大会话**（超过 50 MB 的会话，例如 2026-09-10、2026-08-27 的长会话）能正常显示；
   - 渠道列表完整，用 clipproxyapi 发一条消息收到回复；再用另一个常用渠道（如 ChatGPT 订阅 Codex）发一条；
   - Todo、日程、定时任务列表（启用状态与切换前一致）；
   - 飞书 / 微信桥连接状态（fc-bridge 原凭据已失效，用户已决定切换后重新配置，不算失败）；
   - Skills、MCP 列表与连接；
   - 让 Agent 调用一次 EgoBrowser 打开 `https://example.com`；
   - 设置 → 关于：显示“个人版由维护流程更新”，无更新检查；
   - 语音听写、日历/提醒等系统权限如被重新请求，按需授权。
4. 手机：两台手机打开 `/app/`，发一条消息；在手机上点“开启通知”并在桌面“设置 → 远程连接 → 手机访问”发送测试通知。
5. 日志：`tail -50 ~/Library/Logs/@proma/electron/main.log` 无 `[FATAL]`（`[ERROR]` 行为事件计数，数量多不代表故障）。

任何一项不符：记录并报告用户，由用户决定继续观察、局部修复，还是回退（fallback-runbook §3：两边版本相同，通常只需换回应用，不需要恢复数据）。

## 7. 收尾（需用户同意的项分别确认）

1. 官方版存档到外置硬盘（不删除）：
   ```bash
   ditto -c -k --keepParent /Applications/Proma.previous.app "/Volumes/Lexar ssd 2tb/proma 备份/official-Proma-<版本>-$(date +%Y%m%d).app.zip"
   ```
   `Proma.previous.app` 在观察期内留在 `/Applications` 以便快速回滚，**观察期结束后移出 `/Applications`**（同名同 ID，长期留着可能被 Spotlight 或链接误启动并自动更新）。观察期内不要打开它。
2. 官方更新缓存移入备份目录（不删除）：
   ```bash
   D=~/.proma-switch-backups/updater-caches-$(date +%Y%m%d); mkdir -p "$D"
   for c in com.proma.app.ShipIt cool.proma.app.ShipIt @promaelectron-updater; do [ -e ~/Library/Caches/$c ] && mv ~/Library/Caches/$c "$D/"; done
   ```
3. `PERSONAL.md` 末尾追加 `## YYYY-MM-DD: 切换为日常主力`：版本、commit、快照对比结果、备份位置、遗留事项；同时把文首“目的 / 路径策略”从并存期描述更新为“已接管 `~/.proma`”。提交并推送（遵守 CLAUDE.md 公开仓库规则）。

## 8. 观察期（3–7 天）

- 每天（用户叫 Claude 时，或经用户同意设只读定时检查）：定时任务运行记录与切换前成功率对比；飞书/微信桥；手机访问与推送；`main.log`；`/Applications` 中无官方版被启动或更新的迹象。
- 待办：在个人版中重新配置 fc-bridge（凭据由用户在应用内填写）。
- 已知差异：个人版没有内置浏览器；依赖网页的定时任务使用 ego-browser。“Google 收录完成度监测（每周）”的提示词提到内置浏览器，观察期内改为只用 ego-browser（经用户确认后修改任务）。
- 观察期通过且用户确认后：把 `/Applications/Proma.previous.app` 移到 `~/.proma-switch-backups/`（外置硬盘存档保留）；记录到 PERSONAL.md。

## 9. 红线

同 CLAUDE.md §4：不 rm `~/.proma` 与任何备份；不装官方安装包；个人版运行时不打开 `Proma.previous.app`；不 pkill/killall；不 force-push；不打印密钥；数据恢复、写入 `~/.proma`、结束进程、提交推送都先征得用户同意。
