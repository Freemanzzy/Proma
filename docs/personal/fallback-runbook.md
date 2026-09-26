# Proma 个人版 · 故障回退手册（给 Claude Code 执行）

> 用途：个人版 Proma 更新后无法启动或无法正常工作时，由 **Claude Code（Claude 桌面版中的 Claude Code，或终端 `claude`）** 按本手册诊断、回退、恢复。Proma 自身此时可能不可用，所以本手册不依赖 Proma。
>
> 状态：安装脚本、打包名与备份目录属于“切换计划”的设计，切换完成后以仓库中实际脚本为准。本手册与实际不一致时，先读仓库 `PERSONAL.md` 的最新记录，并在报告中指出差异。

---

## 0. 给 Claude Code 的硬性规则（先读完再动手）

1. **先诊断、后操作**。每一步都先打印将要执行的命令与理由；任何删除、覆盖、恢复数据的操作，必须先向用户说明影响并取得明确同意。
2. **永远先备份当前状态再回退**：回退前把当前 `~/.proma` 另存一份（即使它已损坏），命名带时间戳，放在 `~/.proma-switch-backups/`。
3. **禁止**：`rm -rf ~/.proma`（只允许 `mv` 改名保留）；`pkill` / `killall`（只按 PID 结束确认属于个人版 Proma（/Applications/Proma.app） 的进程）；`git push --force`；修改或删除任何备份文件；把密钥、令牌、API Key 打印到输出或写进文件。
4. **不要从官网下载或安装官方 Proma**：个人版与官方版同名、同应用 ID（`com.proma.app`），官方安装包会直接覆盖个人版，且官方版会自动更新并把数据迁移到更高版本。判断当前 `/Applications/Proma.app` 是否为个人版：看 `Contents/Resources/personal-build.json` 是否存在（个人版打包时写入，含版本、提交与构建时间）。
5. 需要网络（git、bun install）时使用代理：`export HTTPS_PROXY=http://127.0.0.1:7897`；git 使用 `git -c http.proxy=http://127.0.0.1:7897 ...`；命令加超时，疑似卡住就停止并报告。
6. 结束时给用户一份中文报告：发生了什么、做了哪些操作、当前版本与数据状态、还剩什么问题。

---

## 1. 关键位置

| 项目 | 位置 |
|---|---|
| 个人版应用 | `/Applications/Proma.app`（切换后） |
| 上一版应用（安装脚本保留） | `/Applications/Proma.previous.app` |
| 用户数据 | `~/.proma`（个人版切换后直接使用） |
| 开发/预演数据 | `~/.proma-dev`（与正式数据隔离） |
| 更新前自动备份 | `~/.proma-switch-backups/<时间戳>/`（安装脚本在替换应用前生成） |
| 外置硬盘完整备份 | `/Volumes/Lexar ssd 2tb/proma 备份/*.zip`（`proma-backup` Skill 生成；未挂载时用 `diskutil list` 找到卷后 `diskutil mount <设备>`） |
| 源码仓库 | `~/Documents/proma-personal`（`personal` 分支；SSOT：`PERSONAL.md`） |
| 官方上游 | remote `upstream` = proma-ai/Proma；个人版 remote `origin` = Freemanzzy/Proma |
| 日志 | `~/.proma/logs/`；开发实例日志 `/tmp/proma-personal-dev-webremote.log` |
| 工具 | bun：`~/.bun/bin/bun`（先 `export PATH="$HOME/.bun/bin:$PATH"`） |

---

## 2. 诊断（只读）

```bash
# 应用与版本
ls -la /Applications | grep -i proma
defaults read "/Applications/Proma.app/Contents/Info.plist" CFBundleShortVersionString
defaults read "/Applications/Proma.app/Contents/Info.plist" CFBundleIdentifier
cat "/Applications/Proma.app/Contents/Resources/personal-build.json"   # 不存在 = 不是个人版

# 进程（确认命令行属于个人版 Proma（/Applications/Proma.app） 再考虑处理）
ps -axo pid,lstart,command | grep -i "Proma" | grep -v grep

# 仓库状态
cd ~/Documents/proma-personal && git status -sb && git log --oneline -5
grep -n '"version"' apps/electron/package.json

# 数据格式版本（只读 version 字段，不输出其他内容）
python3 - <<'EOF'
import json, os
for f in ["channels.json", "agent-sessions.json", "automations.json", "settings.json"]:
    p = os.path.expanduser(f"~/.proma/{f}")
    if os.path.exists(p):
        d = json.load(open(p)); print(f, d.get("version") if isinstance(d, dict) else "(list)")
EOF
sqlite3 ~/.proma/planning.db "PRAGMA user_version;"

# 最近错误
ls -t ~/.proma/logs | head -3
tail -200 "$HOME/.proma/logs/$(ls -t ~/.proma/logs | head -1)" | grep -iE "error|fatal|无法|失败" | tail -40

# 可用备份
ls -lt ~/.proma-switch-backups/ 2>/dev/null | head
ls -lt "/Volumes/Lexar ssd 2tb/proma 备份/" 2>/dev/null | head
```

判断故障类型：

| 现象 | 类型 | 去哪一节 |
|---|---|---|
| 应用打不开、白屏、启动即退出，日志有代码错误 | A 应用损坏 | §3 |
| 应用能打开，但报“数据版本高于当前 Proma”、会话/渠道/Todo 丢失或读不了 | B 数据问题 | §4 |
| 仅手机访问、某个个人版功能异常，桌面主功能正常 | C 局部问题 | §5 |

---

## 3. 回退 A：恢复上一版应用

1. 退出个人版（让用户手动退出；无响应时，确认 PID 的命令行属于 `/Applications/Proma.app` 后 `kill <PID>`，等待 10 秒）。
2. 保留坏版本、换回上一版：

```bash
cd /Applications
mv "Proma.app" "Proma.broken-$(date +%Y%m%d-%H%M%S).app"
cp -R "Proma.previous.app" "Proma.app"
open "/Applications/Proma.app"
```

3. 如果上一版启动后报数据版本过高（新版已迁移数据），转 §4 恢复更新前备份。
4. 如果 `previous.app` 不存在：从仓库构建上一个已知可用版本（§6）。

---

## 4. 回退 B：恢复数据

> 必须先取得用户同意，并先保存当前数据。

1. 退出个人版（同 §3 第 1 步）。
2. 保存当前数据（不删除）：

```bash
mkdir -p ~/.proma-switch-backups
mv ~/.proma ~/.proma-switch-backups/current-before-restore-$(date +%Y%m%d-%H%M%S)
```

3. 选择要恢复的备份（优先顺序）：
   - `~/.proma-switch-backups/<更新前时间戳>/`（安装脚本自动生成，最贴近故障前状态）：
     ```bash
     cp -a ~/.proma-switch-backups/<时间戳>/proma ~/.proma
     ```
   - 外置硬盘 zip（完整备份，含符号链接）：
     ```bash
     mkdir ~/.proma && cd ~/.proma && unzip -q "/Volumes/Lexar ssd 2tb/proma 备份/<文件>.zip"
     ```
4. 校验：

```bash
du -sh ~/.proma
python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/.proma/agent-sessions.json')));print('sessions:', len(d['sessions'] if isinstance(d,dict) and 'sessions' in d else d))"
find ~/.proma -type l | wc -l      # 符号链接应存在（约 50 个 Skill 链接）
sqlite3 ~/.proma/planning.db "PRAGMA integrity_check;"
```

5. 启动与备份**匹配版本**的应用（备份在哪个版本下生成，就用哪个版本打开；更高版本可以打开，更低版本不行）。
6. 请用户确认：会话列表、渠道、Todo、定时任务是否齐全。

---

## 5. 局部问题（不回退整个应用）

- **手机页面空白**：`cd ~/Documents/proma-personal/apps/electron && bun run build:web-preload`，然后重启个人版。
- **手机提示需要配对**：手机的 Tailscale 设备名变了。在个人版“设置 → 远程连接 → 手机访问”里添加新设备名。
- **某功能在手机上无反应**：看日志中的“未分级通道”，在 `apps/electron/src/main/lib/web-remote/full-ui/channel-policy.ts` 分级（参考同类通道），走 §6 重新构建。
- 详见 `docs/personal/web-remote.md` 的排错表。

---

## 6. 从源码重建已知可用版本

```bash
cd ~/Documents/proma-personal
git fetch origin
git log --oneline origin/personal -15          # 找到出问题的同步合并提交（merge: sync upstream vX.Y.Z）
git switch -c recover/$(date +%Y%m%d) <上一个可用提交>
export PATH="$HOME/.bun/bin:$PATH"
bun install
bun run typecheck
bun test                                     # 对照 PERSONAL.md 记录的基线失败数，不得新增
# 打包与安装使用仓库中的个人版脚本（切换后提供），例如：
# bash scripts/personal/package-personal.sh && bash scripts/personal/install-update.sh
```

- 不要在 `personal` 分支上 `reset --hard` 或强推；在 `recover/*` 分支修复，验证通过后请用户确认再合并。
- 修复后在 `PERSONAL.md` 末尾追加 `## YYYY-MM-DD: 故障回退记录`（原因、操作、结果）。

---

## 7. 常见原因速查

| 原因 | 表现 | 处理 |
|---|---|---|
| 上游数据格式升级（如 `CONFIG_VERSION`、`PLANNING_SCHEMA_VERSION`） | 旧版打开新数据报错 | 用新版打开；必须回退时连数据一起回退到更新前备份 |
| Pi 运行时升级（`@earendil-works/pi-*`）不兼容 | Agent 运行报错、工具调用失败 | 回退应用；在仓库中检查 `patches/` 是否应用、`bun install` 是否完整 |
| web preload 缺失 | 手机空白 | `build:web-preload` |
| 渠道登录过期（如 ChatGPT OAuth） | 对话报“登录已失效” | 在个人版设置中重新登录，不需要回退 |
| 官方 Proma 被打开并自动更新 | `~/.proma` 数据版本高于个人版 | 先同步个人版到该官方版本再打开；不要让官方版继续运行 |
