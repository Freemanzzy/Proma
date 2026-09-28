#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TIMEOUT=120
HEALTH_SECONDS=60
DRY_RUN=0
TEST_MODE=0
SIMULATE_FAILURE=0
SIMULATE_COPY_FAILURE=0
APPS_DIR="/Applications"
DATA_DIR="$HOME/.proma"
BACKUP_ROOT="$HOME/.proma-switch-backups"
LOGS_DIR="$HOME/Library/Logs/@proma/electron"
ARCHIVE_DIR="/Volumes/Lexar ssd 2tb/proma 备份/switch-backups"
ARCHIVE_SET=0
KEEP_LOCAL=1
PREVIOUS_DIR=""
PREVIOUS_DIR_SET=0
usage() {
  cat <<'EOF'
用法: install-update.sh NEW_APP [--timeout SEC] [--health-seconds SEC]
       [--apps-dir DIR] [--data-dir DIR] [--backup-root DIR] [--logs-dir DIR]
       [--previous-dir DIR] [--archive-dir DIR | --no-archive] [--keep-local N]
       [--dry-run] [--test-mode] [--simulate-health-failure] [--simulate-copy-failure]
安装成功后，除最新 N 份（默认 1）外的旧更新前备份会复制到 --archive-dir（默认外置硬盘
“proma 备份/switch-backups”），校验通过后才删除本机副本；外置硬盘未挂载或校验失败则保留本机副本。
默认目标为 /Applications 与 ~/.proma；--test-mode 仅允许配合临时目录使用，跳过真实应用启动。
演练参数 --simulate-health-failure / --simulate-copy-failure 必须同时指定 --test-mode。
上一版应用默认保存在 --backup-root 下的 previous/Proma.app（不再放进 --apps-dir，避免与当前版本
共享同一 bundle ID 导致 TCC/LaunchServices/Spotlight 误指向旧包）；可用 --previous-dir 覆盖，
--test-mode 下同样必须在 /tmp 内。替换已存在的上一版时会先移入废纸篓（$HOME/.Trash，可自行清空；
--test-mode 下改移到 --previous-dir 下的 .trash/，不动真实废纸篓），重名时加时间戳后缀，绝不覆盖。
EOF
}
NEW_APP=""
while (($#)); do
  case "$1" in
    --timeout) TIMEOUT="$2"; shift 2;;
    --health-seconds) HEALTH_SECONDS="$2"; shift 2;;
    --apps-dir) APPS_DIR="$2"; shift 2;;
    --data-dir) DATA_DIR="$2"; shift 2;;
    --backup-root) BACKUP_ROOT="$2"; shift 2;;
    --logs-dir) LOGS_DIR="$2"; shift 2;;
    --previous-dir) PREVIOUS_DIR="$2"; PREVIOUS_DIR_SET=1; shift 2;;
    --archive-dir) ARCHIVE_DIR="$2"; ARCHIVE_SET=1; shift 2;;
    --no-archive) ARCHIVE_DIR=""; ARCHIVE_SET=1; shift;;
    --keep-local) KEEP_LOCAL="$2"; shift 2;;
    --dry-run) DRY_RUN=1; shift;;
    --test-mode) TEST_MODE=1; shift;;
    --simulate-health-failure) SIMULATE_FAILURE=1; shift;;
    --simulate-copy-failure) SIMULATE_COPY_FAILURE=1; shift;;
    -h|--help) usage; exit 0;;
    --*) echo "未知参数: $1" >&2; usage >&2; exit 2;;
    *) if [[ -n "$NEW_APP" ]]; then echo '只允许一个新应用路径' >&2; exit 2; fi; NEW_APP="$1"; shift;;
  esac
done
[[ -n "$NEW_APP" ]] || { usage >&2; exit 2; }
[[ "$KEEP_LOCAL" =~ ^[1-9][0-9]*$ ]] || { echo 'ERROR: --keep-local 必须是正整数（至少保留 1 份）。' >&2; exit 2; }
[[ "$TIMEOUT" =~ ^[0-9]+$ && "$HEALTH_SECONDS" =~ ^[0-9]+$ ]] || { echo 'ERROR: timeout 与 health-seconds 必须是非负整数。' >&2; exit 2; }
if (( SIMULATE_FAILURE || SIMULATE_COPY_FAILURE )) && (( ! TEST_MODE )); then
  echo 'ERROR: 模拟故障参数只允许与 --test-mode 一起使用。' >&2; exit 2
fi
NEW_APP="$(cd "$(dirname "$NEW_APP")" && pwd)/$(basename "$NEW_APP")"
APPS_DIR="$(python3 -c 'import os,sys;print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$APPS_DIR")"
DATA_DIR="$(python3 -c 'import os,sys;print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$DATA_DIR")"
BACKUP_ROOT="$(python3 -c 'import os,sys;print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$BACKUP_ROOT")"
LOGS_DIR="$(python3 -c 'import os,sys;print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$LOGS_DIR")"
# 上一版应用默认位置随 --backup-root 走（同一份 --keep-local 之外的树），--previous-dir 可单独覆盖。
if (( ! PREVIOUS_DIR_SET )); then PREVIOUS_DIR="$BACKUP_ROOT/previous"; fi
PREVIOUS_DIR="$(python3 -c 'import os,sys;print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$PREVIOUS_DIR")"
# 演练模式默认不归档（不触碰外置硬盘）；显式传入的归档目录也必须在 /tmp 内。
if (( TEST_MODE )) && (( ! ARCHIVE_SET )); then ARCHIVE_DIR=""; fi
if (( TEST_MODE )); then
  python3 - "$NEW_APP" "$APPS_DIR" "$DATA_DIR" "$BACKUP_ROOT" "$PREVIOUS_DIR" ${ARCHIVE_DIR:+"$ARCHIVE_DIR"} <<'PY'
import os,sys
root=os.path.realpath('/tmp')
for raw in sys.argv[1:]:
 path=os.path.realpath(raw)
 if os.path.commonpath([root,path]) != root:
  print(f'ERROR: --test-mode 仅允许在 /tmp 内操作，拒绝路径: {raw}',file=sys.stderr)
  raise SystemExit(2)
PY
fi
APP_PATH="$APPS_DIR/Proma.app"
PREVIOUS_PATH="$PREVIOUS_DIR/Proma.app"
LEGACY_PREVIOUS_PATH="$APPS_DIR/Proma.previous.app"

[[ -d "$NEW_APP" ]] || { echo "ERROR: 新应用不存在: $NEW_APP" >&2; exit 2; }
MARKER="$NEW_APP/Contents/Resources/personal-build.json"
[[ -f "$MARKER" ]] || { echo 'ERROR: 新应用缺少 personal-build.json，拒绝安装' >&2; exit 2; }
NEW_VERSION="$(python3 - "$MARKER" <<'PY'
import json,sys
try:
 data=json.load(open(sys.argv[1],encoding='utf-8'))
 assert data.get('personal') is True and isinstance(data.get('version'),str) and isinstance(data.get('commit'),str)
 print(data['version'])
except Exception:
 print('ERROR: personal-build.json 无效',file=sys.stderr); raise SystemExit(2)
PY
)"
if [[ "$DRY_RUN" == 1 ]]; then
  printf 'DRY-RUN validated personal app: %s version=%s\n' "$NEW_APP" "$NEW_VERSION"
  printf 'DRY-RUN install target: %s\n' "$APP_PATH"
  printf 'DRY-RUN atomic staging path: %s/.Proma.installing-<timestamp>.app\n' "$APPS_DIR"
  printf 'DRY-RUN data backup: %s/<timestamp>/proma (snapshots stored alongside, not inside)\n' "$BACKUP_ROOT"
  exit 0
fi
mkdir -p "$APPS_DIR" "$BACKUP_ROOT" "$PREVIOUS_DIR"
[[ -d "$DATA_DIR" ]] || { echo "ERROR: 数据目录不存在: $DATA_DIR" >&2; exit 2; }

STAMP="$(date +%Y%m%d-%H%M%S)-$$"
STAGING_PATH=""
BACKUP="$BACKUP_ROOT/$STAMP"
TRASHED_PREVIOUS_PATH=""
HAD_APP=0
ROLLBACK_ARMED=0
ROLLBACK_COMPLETE=0
ROLLBACK_RUNNING=0
ORIGINAL_MOVED=0
COMMIT_STARTED=0
NEW_APP_COMMITTED=0
NEW_PIDS=""
APP_BEFORE_PIDS=""
FAILED_PACKAGE_PATH="$APPS_DIR/Proma.failed-$STAMP.app"

cleanup_staging() {
  if [[ -n "${STAGING_PATH:-}" && -e "$STAGING_PATH" ]]; then
    case "$STAGING_PATH" in
      "$APPS_DIR"/.Proma.installing-*.app) rm -rf -- "$STAGING_PATH" ;;
      *) echo "ERROR: 拒绝清理非预期 staging 路径: $STAGING_PATH" >&2 ;;
    esac
  fi
}

rollback_app() {
  (( ROLLBACK_ARMED == 1 && ROLLBACK_COMPLETE == 0 && ROLLBACK_RUNNING == 0 )) || return 0
  ROLLBACK_RUNNING=1
  echo '健康检查/安装失败：开始停止新版并恢复原应用；数据不自动还原。' >&2

  local binary="$APP_PATH/Contents/MacOS/Proma"
  local commit_app_is_new=0
  if (( NEW_APP_COMMITTED == 1 )); then commit_app_is_new=1
  elif (( COMMIT_STARTED == 1 )) && [[ ! -e "$STAGING_PATH" ]]; then commit_app_is_new=1
  fi
  if (( commit_app_is_new == 1 )) && [[ -z "$NEW_PIDS" ]]; then NEW_PIDS="$(find_app_pids "$binary")"; fi
  if [[ -n "$NEW_PIDS" ]]; then
    if ! stop_new_process_tree "$binary" "$NEW_PIDS"; then
      echo "ERROR: 新版进程在 20 秒内未退出；为避免移动正在运行的 bundle，保留原版于 ${PREVIOUS_PATH}，并停止自动文件回滚。" >&2
      echo "手动恢复提示：新版仍在运行时不要移动应用包；PID 仅限本次记录的新版本 PID：$NEW_PIDS" >&2
      echo "失败包路径预留为：$FAILED_PACKAGE_PATH" >&2
      return 1
    fi
  fi

  if (( commit_app_is_new == 1 )) && [[ -e "$APP_PATH" && -f "$APP_PATH/Contents/Resources/personal-build.json" ]]; then
    local installed_commit
    installed_commit="$(python3 - "$APP_PATH/Contents/Resources/personal-build.json" <<'PY'
import json,sys
try: print(json.load(open(sys.argv[1],encoding='utf-8')).get('commit',''))
except Exception: print('')
PY
)"
    local new_commit
    new_commit="$(python3 - "$MARKER" <<'PY'
import json,sys
print(json.load(open(sys.argv[1],encoding='utf-8')).get('commit',''))
PY
)"
    if [[ "$installed_commit" == "$new_commit" ]]; then
      if [[ -e "$FAILED_PACKAGE_PATH" ]]; then FAILED_PACKAGE_PATH="$APPS_DIR/Proma.failed-$STAMP-1.app"; fi
      mv "$APP_PATH" "$FAILED_PACKAGE_PATH"
    fi
  fi
  if [[ "$HAD_APP" == 1 && -e "$PREVIOUS_PATH" && ! -e "$APP_PATH" ]]; then
    mv "$PREVIOUS_PATH" "$APP_PATH"
    ORIGINAL_MOVED=0
  elif [[ "$HAD_APP" == 1 && "$ORIGINAL_MOVED" == 1 && ! -e "$APP_PATH" ]]; then
    echo "ERROR: 原应用副本缺失，保留当前目录结构供人工恢复：$PREVIOUS_PATH" >&2
    return 1
  fi
  if [[ -n "$TRASHED_PREVIOUS_PATH" && -e "$TRASHED_PREVIOUS_PATH" && ! -e "$PREVIOUS_PATH" ]]; then
    mv "$TRASHED_PREVIOUS_PATH" "$PREVIOUS_PATH"
  fi
  if [[ -n "$NEW_PIDS" ]]; then
    local remaining failed_binary
    remaining="$(find_app_pids "$binary")"
    if [[ -e "$FAILED_PACKAGE_PATH" ]]; then
      failed_binary="$(find_app_pids "$FAILED_PACKAGE_PATH/Contents/MacOS/Proma")"
      remaining="$(printf '%s\n%s\n' "$remaining" "$failed_binary" | sed '/^$/d' | sort -u)"
    fi
    if [[ -n "$remaining" ]]; then
      echo "ERROR: 回滚后仍发现来自失败包路径的进程 PID: $remaining" >&2
      return 1
    fi
  fi
  cleanup_staging
  ROLLBACK_COMPLETE=1
  if [[ -e "$FAILED_PACKAGE_PATH" ]]; then
    echo "应用回滚完成；失败包保留为：$FAILED_PACKAGE_PATH" >&2
  else
    echo '原应用未移动或已恢复；失败发生在新包提交到位之前。' >&2
  fi
  echo "官方更新缓存可手动移动到：$BACKUP_ROOT/updater-caches-$STAMP/（脚本不自动移动）。" >&2
  echo "数据备份在：$BACKUP/proma；如经用户授权手动恢复，先保留当前数据目录，再执行 cp -a '$BACKUP/proma' '$DATA_DIR'。" >&2
  return 0
}

on_exit() {
  local rc=$?
  trap - EXIT ERR INT TERM
  if (( ROLLBACK_ARMED == 1 && ROLLBACK_COMPLETE == 0 )); then
    rollback_app || true
  fi
  cleanup_staging
  return "$rc"
}
on_error() {
  local rc="$1" line="$2"
  echo "ERROR: 安装流程第 ${line} 行失败（exit=${rc}）；将运行退出清理/应用恢复。" >&2
  exit "$rc"
}
on_signal() {
  local signal="$1" code=143
  [[ "$signal" == INT ]] && code=130
  echo "收到 ${signal}；将清理 staging 并恢复原应用（若已开始替换）。" >&2
  exit "$code"
}
trap on_exit EXIT
trap 'on_error $? $LINENO' ERR
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM

# Move an existing previous-app bundle out of the way without deleting it: real ~/.Trash normally,
# or PREVIOUS_DIR/.trash under --test-mode so drills never touch the user's real Trash. Named after the
# bundle's own personal-build.json commit (first 8 chars) when present, else a timestamp; a name collision
# gets a timestamp+pid suffix instead of overwriting.
move_to_trash() {
  local src="$1" trash_root marker commit name target
  if (( TEST_MODE )); then trash_root="$PREVIOUS_DIR/.trash"; else trash_root="$HOME/.Trash"; fi
  mkdir -p "$trash_root"
  marker="$src/Contents/Resources/personal-build.json"
  commit=""
  if [[ -f "$marker" ]]; then
    commit="$(python3 - "$marker" <<'PY'
import json,sys
try:
    c=json.load(open(sys.argv[1],encoding='utf-8')).get('commit','')
    print(c[:8] if isinstance(c,str) else '')
except Exception:
    print('')
PY
)"
  fi
  [[ -n "$commit" ]] || commit="$(date +%Y%m%d-%H%M%S)"
  name="Proma-previous-$commit.app"
  target="$trash_root/$name"
  if [[ -e "$target" ]]; then
    target="$trash_root/Proma-previous-$commit-$(date +%Y%m%d-%H%M%S)-$$.app"
  fi
  mv "$src" "$target"
  printf '%s' "$target"
}

find_app_pids() {
  local expected_binary="$1"
  python3 - "$expected_binary" <<'PY'
import subprocess,sys
expected=sys.argv[1]
try: rows=subprocess.check_output(['ps','-axo','pid=,command='],text=True,stderr=subprocess.DEVNULL).splitlines()
except Exception: raise SystemExit(0)
for row in rows:
 parts=row.strip().split(None,1)
 if len(parts)!=2: continue
 command=parts[1].strip()
 if command.startswith('"') and '"' in command[1:]: command=command.split('"',2)[1]
 if command==expected or command.startswith(expected+' '): print(parts[0])
PY
}
process_command_matches() {
  local pid="$1" expected_binary="$2" command
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  command="${command#\"}"; command="${command%%\"*}"
  [[ "$command" == "$expected_binary" || "$command" == "$expected_binary "* ]]
}
stop_new_process_tree() {
  local expected_binary="$1" roots="$2" pid elapsed=0 current
  # 只通知新版主进程优雅退出；绝不先杀 Helper，避免主窗口/Helper 留下半死状态。
  for pid in $roots; do
    if process_command_matches "$pid" "$expected_binary"; then kill -TERM "$pid" 2>/dev/null || true; fi
  done
  while (( elapsed < 20 )); do
    current="$(find_app_pids "$expected_binary")"
    [[ -z "$current" ]] && return 0
    sleep 1; elapsed=$((elapsed + 1))
  done
  current="$(find_app_pids "$expected_binary")"
  if [[ -n "$current" ]]; then
    echo "ERROR: SIGTERM 后等待 20 秒主进程仍运行（PID：${current//$'\n'/,}）；未向 Helper 发信号，停止自动文件回滚，请用户手动退出 Proma。" >&2
    return 1
  fi
  return 0
}

# Never leave an unrelated local service bound to Web Remote's standard port.
port_listeners() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -u || true
}
assert_port_available_or_installed_app() {
  local port="$1" pid expected="$APP_PATH/Contents/MacOS/Proma" owners
  owners="$(port_listeners "$port")"
  for pid in $owners; do
    if [[ ! -d "$APP_PATH" ]] || ! process_command_matches "$pid" "$expected"; then
      echo "ERROR: TCP 端口 $port 已被非当前 Proma 应用进程占用（PID ${pid}）；请先退出开发实例/其他服务后重试。" >&2
      return 1
    fi
  done
}

# Wait for current Proma to quit without signaling it.
if [[ "$TEST_MODE" != 1 ]]; then
  deadline=$((SECONDS + TIMEOUT))
  while :; do
    APP_BEFORE_PIDS="$(find_app_pids "$APP_PATH/Contents/MacOS/Proma")"
    [[ -z "$APP_BEFORE_PIDS" ]] && break
    if (( SECONDS >= deadline )); then echo "ERROR: Proma 仍在运行；请手动退出应用后重试（等待 ${TIMEOUT}s）" >&2; exit 3; fi
    echo "Proma 仍在运行（PID: ${APP_BEFORE_PIDS//$'\n'/,}），请手动退出；脚本继续等待……"
    sleep 2
  done
fi

[[ ! -e "$BACKUP_ROOT/$STAMP" ]] || { echo "ERROR: 备份目录已存在: $BACKUP_ROOT/$STAMP" >&2; exit 2; }
BACKUP="$BACKUP_ROOT/$STAMP"
mkdir -p "$BACKUP"
echo "备份数据: $DATA_DIR -> $BACKUP/proma"
cp -a "$DATA_DIR" "$BACKUP/proma"
python3 "$ROOT/scripts/personal/verify-backup.py" "$DATA_DIR" "$BACKUP/proma"
BEFORE_SNAPSHOT="$BACKUP/health-snapshot-before.json"
AFTER_SNAPSHOT="$BACKUP/health-snapshot-after.json"
python3 "$ROOT/scripts/personal/health-snapshot.py" "$DATA_DIR" --output "$BEFORE_SNAPSHOT" >/dev/null
# Capture the copy as a separate snapshot outside the proma directory; verify all requested object counts.
python3 "$ROOT/scripts/personal/health-snapshot.py" "$BACKUP/proma" --output "$BACKUP/health-snapshot-backup.json" >/dev/null
python3 "$ROOT/scripts/personal/health-snapshot.py" --compare "$BEFORE_SNAPSHOT" "$BACKUP/health-snapshot-backup.json"

REMOTE_PORT="$(python3 - "$DATA_DIR/web-remote/config.json" <<'PY'
import json,sys
try:
 c=json.load(open(sys.argv[1],encoding='utf-8'))
 print(c.get('port',17888) if c.get('enabled') is True else '')
except Exception: print('')
PY
)"
if [[ "$TEST_MODE" != 1 ]]; then
  assert_port_available_or_installed_app 17888
  if [[ -n "$REMOTE_PORT" && "$REMOTE_PORT" != 17888 ]]; then assert_port_available_or_installed_app "$REMOTE_PORT"; fi
fi

mkdir -p "$APPS_DIR" "$PREVIOUS_DIR"
# 兼容旧布局：旧版本脚本把上一版留在 $APPS_DIR/Proma.previous.app（与当前应用同目录、同 bundle ID）。
# 迁移它到新位置，除非新位置已经被占用（此时按同样规则把它移去废纸篓，让本次安装的 PREVIOUS_PATH
# 处理逻辑统一接管）。
if [[ -e "$LEGACY_PREVIOUS_PATH" ]]; then
  if [[ -e "$PREVIOUS_PATH" ]]; then
    legacy_trashed="$(move_to_trash "$LEGACY_PREVIOUS_PATH")"
    echo "兼容旧布局：$PREVIOUS_PATH 已存在，旧版 $LEGACY_PREVIOUS_PATH 已移至废纸篓：$legacy_trashed" >&2
  else
    # $APPS_DIR -> $PREVIOUS_DIR；跨卷时的原子性说明见下方 APP_PATH -> PREVIOUS_PATH 处。
    mv "$LEGACY_PREVIOUS_PATH" "$PREVIOUS_PATH"
    echo "兼容旧布局：已将上一版从 $LEGACY_PREVIOUS_PATH 迁移到 $PREVIOUS_PATH" >&2
  fi
fi
HAD_APP=0
[[ -e "$APP_PATH" ]] && HAD_APP=1
STAGING_PATH="$APPS_DIR/.Proma.installing-$STAMP.app"
[[ ! -e "$STAGING_PATH" ]] || { echo "ERROR: staging 路径已存在：$STAGING_PATH" >&2; exit 2; }

# All writes happen in a sibling staging directory on the same volume. Arm recovery before any app-bundle rename.
ROLLBACK_ARMED=1
# 不删除已存在的上一版：移入废纸篓（可自行清空），为当前应用让出 PREVIOUS_PATH。失败时 rollback_app
# 会把它移回 PREVIOUS_PATH。
if [[ -e "$PREVIOUS_PATH" ]]; then
  TRASHED_PREVIOUS_PATH="$(move_to_trash "$PREVIOUS_PATH")"
  echo "上一版已移至废纸篓，可自行清空：$TRASHED_PREVIOUS_PATH" >&2
fi
if [[ "$SIMULATE_COPY_FAILURE" == 1 ]]; then
  mkdir -p "$STAGING_PATH/Contents/Resources"
  cp -a "$MARKER" "$STAGING_PATH/Contents/Resources/personal-build.json"
  echo 'SIMULATION: 在 staging 中途模拟 cp 失败。' >&2
  exit 7
fi
if ! cp -a "$NEW_APP" "$STAGING_PATH"; then
  echo 'ERROR: 新应用复制到 staging 失败。原应用尚未移动。' >&2
  exit 7
fi
[[ -f "$STAGING_PATH/Contents/Resources/personal-build.json" ]] || { echo 'ERROR: staging 包不完整，缺少个人版标记。' >&2; exit 7; }
python3 - "$STAGING_PATH/Contents/Resources/personal-build.json" "$MARKER" <<'PY'
import json,sys
left=json.load(open(sys.argv[1],encoding='utf-8')); right=json.load(open(sys.argv[2],encoding='utf-8'))
if left != right: raise SystemExit('staging marker does not match source bundle')
PY
# APP_PATH -> PREVIOUS_PATH now crosses from $APPS_DIR into $PREVIOUS_DIR (under $BACKUP_ROOT by
# default). When both are on the same volume (the default: /Applications and ~/.proma-switch-backups
# share the boot volume) this rename is atomic, same as before. If --backup-root/--previous-dir is
# pointed at a different volume, `mv` still works (coreutils falls back to copy+remove) but is no
# longer atomic — an interruption mid-move could leave a partial copy at PREVIOUS_PATH.
if [[ "$HAD_APP" == 1 ]]; then
  mv "$APP_PATH" "$PREVIOUS_PATH"
  ORIGINAL_MOVED=1
fi
# Same-volume directory rename is the commit point for the new application bundle.
COMMIT_STARTED=1
mv "$STAGING_PATH" "$APP_PATH"
NEW_APP_COMMITTED=1

if [[ "$SIMULATE_FAILURE" == 1 ]]; then
  echo 'SIMULATION: 故意触发安装后健康检查失败。' >&2
  exit 4
fi
if [[ "$TEST_MODE" == 1 ]]; then
  echo 'TEST-MODE: 已跳过真实应用启动与进程/端口健康检查；执行只读数据快照比对。'
  python3 "$ROOT/scripts/personal/health-snapshot.py" "$DATA_DIR" --output "$AFTER_SNAPSHOT" >/dev/null
  python3 "$ROOT/scripts/personal/health-snapshot.py" --compare "$BEFORE_SNAPSHOT" "$AFTER_SNAPSHOT"
else
  APP_BEFORE_PIDS="$(find_app_pids "$APP_PATH/Contents/MacOS/Proma")"
  STARTED_AT_EPOCH="$(date -u +%s)"
  open -na "$APP_PATH"
  # Capture only the new process whose executable path is the bundle just installed.
  start_deadline=$((SECONDS + 30))
  while :; do
    NEW_PIDS="$(find_app_pids "$APP_PATH/Contents/MacOS/Proma")"
    if [[ -n "$APP_BEFORE_PIDS" ]]; then
      NEW_PIDS="$(comm -23 <(printf '%s\n' "$NEW_PIDS" | sort -u) <(printf '%s\n' "$APP_BEFORE_PIDS" | sort -u) || true)"
    fi
    [[ -n "$NEW_PIDS" ]] && break
    if (( SECONDS >= start_deadline )); then echo '健康检查失败：启动 30 秒内未发现新版 Proma 进程。' >&2; exit 4; fi
    sleep 1
  done
  START_PID="$(printf '%s\n' "$NEW_PIDS" | head -1)"
  [[ "$START_PID" =~ ^[0-9]+$ ]] || { echo '健康检查失败：无法锁定新版进程 PID。' >&2; exit 4; }
  LOG_FILE="$LOGS_DIR/main.log"
  LOG_WAIT=0
  while [[ ! -s "$LOG_FILE" && $LOG_WAIT -lt 15 ]]; do sleep 1; LOG_WAIT=$((LOG_WAIT + 1)); done
  if [[ ! -s "$LOG_FILE" ]]; then echo "健康检查失败：个人版文件日志未创建，预期位置：$LOG_FILE" >&2; exit 4; fi
  grep -q 'personal main process started' "$LOG_FILE" || { echo "健康检查失败：个人版启动标记未写入 $LOG_FILE" >&2; exit 4; }
  echo "个人版主进程日志: $LOG_FILE"
  sleep "$HEALTH_SECONDS"
  if [[ -n "$REMOTE_PORT" ]]; then
    remote_owners="$(port_listeners "$REMOTE_PORT")"
    remote_ready=0
    for pid in $remote_owners; do
      if process_command_matches "$pid" "$APP_PATH/Contents/MacOS/Proma"; then remote_ready=1; fi
    done
    if (( remote_ready == 0 )) && /usr/bin/pgrep -x SecurityAgent >/dev/null 2>&1; then
      echo "检测到 Keychain 授权弹窗（SecurityAgent）；请在钥匙串弹窗中授权，健康检查最多额外等待 10 分钟。"
      keychain_deadline=$((SECONDS + 600))
      while (( SECONDS < keychain_deadline )); do
        sleep 2
        remote_owners="$(port_listeners "$REMOTE_PORT")"
        for pid in $remote_owners; do
          if process_command_matches "$pid" "$APP_PATH/Contents/MacOS/Proma"; then remote_ready=1; break; fi
        done
        (( remote_ready == 1 )) && break
        /usr/bin/pgrep -x SecurityAgent >/dev/null 2>&1 || break
      done
    fi
  fi
  if ! process_command_matches "$START_PID" "$APP_PATH/Contents/MacOS/Proma"; then
    echo '健康检查失败：观察期内新版主进程已退出。' >&2; exit 4
  fi
  python3 - "$LOG_FILE" "$STARTED_AT_EPOCH" <<'PY'
from datetime import datetime
from pathlib import Path
import sys
started=int(sys.argv[2]); lines=Path(sys.argv[1]).read_text(encoding='utf-8',errors='replace').splitlines(); starts=[]
for i,line in enumerate(lines):
 if 'personal main process started' not in line: continue
 try: stamp=datetime.fromisoformat(line.split()[0].replace('Z','+00:00')).timestamp()
 except ValueError: continue
 if stamp >= started: starts.append(i)
if not starts: raise SystemExit('new personal startup marker missing after launch time')
if any('[FATAL]' in line for line in lines[starts[-1]+1:]): raise SystemExit('fatal event after latest personal startup')
PY
  python3 "$ROOT/scripts/personal/health-snapshot.py" "$DATA_DIR" --output "$AFTER_SNAPSHOT" >/dev/null || { echo '健康检查失败：启动后健康快照不完整。' >&2; exit 4; }
  python3 "$ROOT/scripts/personal/health-snapshot.py" --compare "$BEFORE_SNAPSHOT" "$AFTER_SNAPSHOT" || { echo '健康检查失败：会话/Automation/渠道/格式版本/链接数与备份快照不同。' >&2; exit 4; }
  if [[ -n "$REMOTE_PORT" ]]; then
    owners="$(port_listeners "$REMOTE_PORT")"
    own_listener=0
    for pid in $owners; do
      if process_command_matches "$pid" "$APP_PATH/Contents/MacOS/Proma"; then own_listener=1; fi
    done
    if (( own_listener == 0 )); then echo "健康检查失败：手机访问端口 $REMOTE_PORT 未由新版 Proma 监听。" >&2; exit 4; fi
  fi
fi

ROLLBACK_COMPLETE=1
ROLLBACK_ARMED=0
printf '安装成功: %s\n' "$APP_PATH"
printf '个人版版本: %s\n' "$NEW_VERSION"
printf '备份快照: %s\n' "$BACKUP/health-snapshot-before.json"
echo "失败包若发生后续人工回滚会保留为 Proma.failed-*.app；旧包为 ${PREVIOUS_PATH}（可自行移到废纸篓清空）。"
echo "官方更新缓存可手动移动到：$BACKUP_ROOT/updater-caches-$STAMP/（脚本不自动移动）。"
# 旧备份归档：安装已成功，以下任何失败都只提示、不影响安装结果，且绝不在校验通过前删除本机副本。
trap - ERR
set +e
archive_old_backups() {
  local all old item target
  all="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort -r)"
  old="$(printf '%s\n' "$all" | sed '/^$/d' | tail -n +"$((KEEP_LOCAL + 1))")"
  [[ -n "$old" ]] || { echo "旧备份归档：本机更新前备份不超过 ${KEEP_LOCAL} 份，无需归档。"; return 0; }
  if [[ -z "$ARCHIVE_DIR" ]]; then
    echo "旧备份归档：已关闭；本机保留全部备份：$(printf '%s\n' "$all" | tr '\n' ' ')"; return 0
  fi
  local vol
  vol="$(python3 -c 'import sys;p=sys.argv[1].split("/");print("/".join(p[:3]) if len(p)>2 and p[1]=="Volumes" else "")' "$ARCHIVE_DIR")"
  if [[ -n "$vol" && ! -d "$vol" ]]; then
    echo "旧备份归档：外置硬盘未挂载（${vol}）；本机保留 $(printf '%s\n' "$old" | wc -l | tr -d ' ') 份旧备份，下次安装或手动再归档。"; return 0
  fi
  mkdir -p "$ARCHIVE_DIR" || { echo "旧备份归档：无法创建 ${ARCHIVE_DIR}；本机保留旧备份。" >&2; return 0; }
  while IFS= read -r item; do
    [[ -n "$item" ]] || continue
    target="$ARCHIVE_DIR/$(basename "$item")"
    if [[ -e "$target" ]]; then
      echo "旧备份归档：目标已存在，跳过（本机保留）：$target" >&2; continue
    fi
    echo "旧备份归档：$item -> $target"
    if ! ditto "$item" "$target"; then
      echo "旧备份归档：复制失败，本机保留：$item" >&2; rm -rf "$target"; continue
    fi
    if python3 "$ROOT/scripts/personal/verify-backup.py" --preset proma-backup "$item" "$target" >/dev/null 2>&1; then
      rm -rf "$item" && echo "旧备份归档：校验通过，已删除本机副本：$(basename "$item")"
    else
      echo "旧备份归档：校验未通过，本机与归档副本均保留，请人工检查：$item / $target" >&2
    fi
  done <<< "$old"
}
archive_old_backups
