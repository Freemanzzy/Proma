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
LOGS_DIR="$HOME/Library/Logs/Proma"
usage() {
  cat <<'EOF'
用法: install-update.sh NEW_APP [--timeout SEC] [--health-seconds SEC]
       [--apps-dir DIR] [--data-dir DIR] [--backup-root DIR] [--logs-dir DIR]
       [--dry-run] [--test-mode] [--simulate-health-failure] [--simulate-copy-failure]
默认目标为 /Applications 与 ~/.proma；--test-mode 仅允许配合临时目录使用，跳过真实应用启动。
演练参数 --simulate-health-failure / --simulate-copy-failure 必须同时指定 --test-mode。
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
[[ "$TIMEOUT" =~ ^[0-9]+$ && "$HEALTH_SECONDS" =~ ^[0-9]+$ ]] || { echo 'ERROR: timeout 与 health-seconds 必须是非负整数。' >&2; exit 2; }
if (( SIMULATE_FAILURE || SIMULATE_COPY_FAILURE )) && (( ! TEST_MODE )); then
  echo 'ERROR: 模拟故障参数只允许与 --test-mode 一起使用。' >&2; exit 2
fi
NEW_APP="$(cd "$(dirname "$NEW_APP")" && pwd)/$(basename "$NEW_APP")"
APPS_DIR="$(python3 -c 'import os,sys;print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$APPS_DIR")"
DATA_DIR="$(python3 -c 'import os,sys;print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$DATA_DIR")"
BACKUP_ROOT="$(python3 -c 'import os,sys;print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$BACKUP_ROOT")"
LOGS_DIR="$(python3 -c 'import os,sys;print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$LOGS_DIR")"
if (( TEST_MODE )); then
  python3 - "$NEW_APP" "$APPS_DIR" "$DATA_DIR" "$BACKUP_ROOT" <<'PY'
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
PREVIOUS_PATH="$APPS_DIR/Proma.previous.app"

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
mkdir -p "$APPS_DIR" "$BACKUP_ROOT"
[[ -d "$DATA_DIR" ]] || { echo "ERROR: 数据目录不存在: $DATA_DIR" >&2; exit 2; }

STAMP="$(date +%Y%m%d-%H%M%S)-$$"
STAGING_PATH=""
BACKUP="$BACKUP_ROOT/$STAMP"
ROTATED_PREVIOUS_PATH=""
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
      echo 'ERROR: 新版进程在 20 秒内未退出；为避免移动正在运行的 bundle，保留原版于 Proma.previous.app，并停止自动文件回滚。' >&2
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
  if [[ -n "$ROTATED_PREVIOUS_PATH" && -e "$ROTATED_PREVIOUS_PATH" && ! -e "$PREVIOUS_PATH" ]]; then
    mv "$ROTATED_PREVIOUS_PATH" "$PREVIOUS_PATH"
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
process_tree_pids() {
  python3 - "$@" <<'PY'
import subprocess,sys
roots={int(x) for x in sys.argv[1:] if x.isdigit()}
try: rows=subprocess.check_output(['ps','-axo','pid=,ppid=,command='],text=True,stderr=subprocess.DEVNULL).splitlines()
except Exception: raise SystemExit(0)
children={}
for row in rows:
 parts=row.strip().split(None,2)
 if len(parts)<2: continue
 try: pid,ppid=int(parts[0]),int(parts[1])
 except ValueError: continue
 children.setdefault(ppid,[]).append(pid)
seen=set()
def visit(pid):
 for child in children.get(pid,[]):
  if child not in seen: seen.add(child); visit(child)
for root in roots: visit(root)
# signal descendants before their tracked app parent
for pid in sorted(seen,reverse=True): print(pid)
for pid in roots: print(pid)
PY
}
stop_new_process_tree() {
  local expected_binary="$1" roots="$2" pid all_pids="" elapsed=0 current
  for pid in $roots; do
    if process_command_matches "$pid" "$expected_binary"; then all_pids+=" $pid"; fi
  done
  [[ -n "$all_pids" ]] || return 0
  local descendants pid_alive=0
  descendants="$(process_tree_pids $all_pids)"
  for pid in $descendants; do kill -TERM "$pid" 2>/dev/null || true; done
  while (( elapsed < 20 )); do
    pid_alive=0
    for pid in $descendants; do if kill -0 "$pid" 2>/dev/null; then pid_alive=1; fi; done
    current="$(find_app_pids "$expected_binary")"
    [[ -z "$current" && "$pid_alive" == 0 ]] && return 0
    sleep 1; elapsed=$((elapsed + 1))
  done
  current="$(find_app_pids "$expected_binary")"
  pid_alive=0
  for pid in $descendants; do if kill -0 "$pid" 2>/dev/null; then pid_alive=1; fi; done
  if [[ -n "$current" || "$pid_alive" == 1 ]]; then echo "ERROR: SIGTERM 后等待 20 秒仍运行的新包进程/子进程 PID：${current:-$descendants}" >&2; return 1; fi
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
      echo "ERROR: TCP 端口 $port 已被非当前 Proma 应用进程占用（PID $pid）；请先退出开发实例/其他服务后重试。" >&2
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

mkdir -p "$APPS_DIR"
if [[ -e "$PREVIOUS_PATH" ]]; then
  ROTATED_PREVIOUS_PATH="$APPS_DIR/Proma.previous.$STAMP.app"
fi
HAD_APP=0
[[ -e "$APP_PATH" ]] && HAD_APP=1
STAGING_PATH="$APPS_DIR/.Proma.installing-$STAMP.app"
[[ ! -e "$STAGING_PATH" ]] || { echo "ERROR: staging 路径已存在：$STAGING_PATH" >&2; exit 2; }

# All writes happen in a sibling staging directory on the same volume. Arm recovery before any app-bundle rename.
ROLLBACK_ARMED=1
if [[ -n "$ROTATED_PREVIOUS_PATH" ]]; then mv "$PREVIOUS_PATH" "$ROTATED_PREVIOUS_PATH"; fi
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
echo "失败包若发生后续人工回滚会保留为 Proma.failed-*.app；旧包为 Proma.previous.app。"
echo "官方更新缓存可手动移动到：$BACKUP_ROOT/updater-caches-$STAMP/（脚本不自动移动）。"
old_backups="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort -r)"
old_count="$(printf '%s\n' "$old_backups" | sed '/^$/d' | wc -l | tr -d ' ')"
if (( old_count > 5 )); then echo "提示：更新备份共 ${old_count} 份；全部保留，最近 5 份为：$(printf '%s\n' "$old_backups" | head -5 | tr '\n' ' ')；更早备份请人工审核后再清理。"; fi
