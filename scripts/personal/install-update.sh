#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TIMEOUT=120
HEALTH_SECONDS=10
DRY_RUN=0
TEST_MODE=0
SIMULATE_FAILURE=0
APPS_DIR="/Applications"
DATA_DIR="$HOME/.proma"
BACKUP_ROOT="$HOME/.proma-switch-backups"
usage() {
  cat <<'EOF'
用法: install-update.sh NEW_APP [--timeout SEC] [--apps-dir DIR] [--data-dir DIR]
       [--backup-root DIR] [--health-seconds SEC] [--dry-run] [--test-mode]
       [--simulate-health-failure]
默认目标为 /Applications 与 ~/.proma。--test-mode 仅用于临时假应用目录，跳过启动但执行安装/回滚流程。
EOF
}
NEW_APP=""
while (($#)); do
  case "$1" in
    --timeout) TIMEOUT="$2"; shift 2;;
    --apps-dir) APPS_DIR="$2"; shift 2;;
    --data-dir) DATA_DIR="$2"; shift 2;;
    --backup-root) BACKUP_ROOT="$2"; shift 2;;
    --health-seconds) HEALTH_SECONDS="$2"; shift 2;;
    --dry-run) DRY_RUN=1; shift;;
    --test-mode) TEST_MODE=1; shift;;
    --simulate-health-failure) SIMULATE_FAILURE=1; shift;;
    -h|--help) usage; exit 0;;
    --*) echo "未知参数: $1" >&2; usage >&2; exit 2;;
    *) if [[ -n "$NEW_APP" ]]; then echo '只允许一个新应用路径' >&2; exit 2; fi; NEW_APP="$1"; shift;;
  esac
done
[[ -n "$NEW_APP" ]] || { usage >&2; exit 2; }
NEW_APP="$(cd "$(dirname "$NEW_APP")" && pwd)/$(basename "$NEW_APP")"
APPS_DIR="$(python3 -c 'import os,sys;print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$APPS_DIR")"
DATA_DIR="$(python3 -c 'import os,sys;print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$DATA_DIR")"
BACKUP_ROOT="$(python3 -c 'import os,sys;print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$BACKUP_ROOT")"
APP_PATH="$APPS_DIR/Proma.app"
PREVIOUS_PATH="$APPS_DIR/Proma.previous.app"

[[ -d "$NEW_APP" ]] || { echo "ERROR: 新应用不存在: $NEW_APP" >&2; exit 2; }
MARKER="$NEW_APP/Contents/Resources/personal-build.json"
[[ -f "$MARKER" ]] || { echo 'ERROR: 新应用缺少 personal-build.json，拒绝安装' >&2; exit 2; }
python3 - "$MARKER" <<'PY'
import json,sys
try:
 d=json.load(open(sys.argv[1],encoding='utf-8'))
 assert d.get('personal') is True and isinstance(d.get('version'),str) and isinstance(d.get('commit'),str)
except Exception:
 print('ERROR: personal-build.json 无效',file=sys.stderr); raise SystemExit(2)
PY
if [[ "$DRY_RUN" == 1 ]]; then
  printf 'DRY-RUN validated personal app: %s\n' "$NEW_APP"
  printf 'DRY-RUN install target: %s\n' "$APP_PATH"
  printf 'DRY-RUN data backup: %s/<timestamp>/proma\n' "$BACKUP_ROOT"
  exit 0
fi
mkdir -p "$APPS_DIR" "$BACKUP_ROOT"
[[ -d "$DATA_DIR" ]] || { echo "ERROR: 数据目录不存在: $DATA_DIR" >&2; exit 2; }

# Wait politely for a running installed Proma process; never signal or kill it.
if [[ "$TEST_MODE" != 1 ]]; then
  deadline=$((SECONDS + TIMEOUT))
  while ps -axo pid=,command= | awk -v app="$APP_PATH/Contents/MacOS/Proma" '$0 ~ app && $0 !~ /awk/ {found=1} END {exit !found}'; do
    if (( SECONDS >= deadline )); then echo "ERROR: Proma 仍在运行；请退出应用后重试（等待 ${TIMEOUT}s）" >&2; exit 3; fi
    echo 'Proma 仍在运行，请手动退出；脚本继续等待……'
    sleep 2
  done
fi

STAMP="$(date +%Y%m%d-%H%M%S)-$$"
BACKUP="$BACKUP_ROOT/$STAMP"
[[ ! -e "$BACKUP" ]] || { echo "ERROR: 备份目录已存在: $BACKUP" >&2; exit 2; }
mkdir -p "$BACKUP"
echo "备份数据: $DATA_DIR -> $BACKUP/proma"
cp -a "$DATA_DIR" "$BACKUP/proma"
python3 "$ROOT/scripts/personal/verify-backup.py" "$DATA_DIR" "$BACKUP/proma"

# Non-secret object counts are captured before starting the replacement.
COUNTS="$BACKUP/object-counts.json"
python3 - "$BACKUP/proma" "$COUNTS" <<'PY'
import json, pathlib, sqlite3, sys
root=pathlib.Path(sys.argv[1]); out={}
def load(name):
 try: return json.loads((root/name).read_text(encoding='utf-8'))
 except Exception: return None
for filename,key,label in [('channels.json','channels','channels'),('agent-sessions.json','sessions','sessions'),('automations.json','automations','automations')]:
 obj=load(filename)
 if isinstance(obj,dict): arr=obj.get(key,[])
 else: arr=obj
 out[label]=len(arr) if isinstance(arr,list) else 0
try:
 db=sqlite3.connect(f'file:{root / "planning.db"}?mode=ro',uri=True)
 out['planning_db_tables']=db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone()[0]; db.close()
except Exception: out['planning_db_tables']=0
pathlib.Path(sys.argv[2]).write_text(json.dumps(out,sort_keys=True)+'\n')
print('备份数据对象计数:',', '.join(f'{k}={v}' for k,v in out.items()))
PY

if [[ -e "$PREVIOUS_PATH" ]]; then
  OLD_PREVIOUS="$APPS_DIR/Proma.previous.$STAMP.app"
  echo "保留已存在的 previous: $PREVIOUS_PATH -> $OLD_PREVIOUS"
  mv "$PREVIOUS_PATH" "$OLD_PREVIOUS"
fi
HAD_APP=0
if [[ -e "$APP_PATH" ]]; then
  HAD_APP=1
  mv "$APP_PATH" "$PREVIOUS_PATH"
fi

rollback() {
  echo '健康检查失败：自动回滚应用包。数据目录未自动还原。' >&2
  if [[ -e "$APP_PATH" ]]; then mv "$APP_PATH" "$APPS_DIR/Proma.failed-$STAMP.app"; fi
  if [[ "$HAD_APP" == 1 && -e "$PREVIOUS_PATH" ]]; then mv "$PREVIOUS_PATH" "$APP_PATH"; fi
  echo "如需用户授权后手动恢复本次备份的数据，可执行：cp -a '$BACKUP/proma' '$DATA_DIR'（先保留当前数据目录再操作）。" >&2
  exit 4
}
if ! cp -a "$NEW_APP" "$APP_PATH"; then
  echo 'ERROR: 新应用复制失败。' >&2
  rollback
fi

if [[ "$SIMULATE_FAILURE" == 1 ]]; then
  echo 'SIMULATION: 故意触发健康检查失败。'
  rollback
fi
if [[ "$TEST_MODE" == 1 ]]; then
  echo 'TEST-MODE: 已跳过应用启动；使用临时假包模拟健康检查成功。'
else
  open -na "$APP_PATH"
  sleep "$HEALTH_SECONDS"
  if ! ps -axo pid=,command= | awk -v app="$APP_PATH/Contents/MacOS/Proma" '$0 ~ app && $0 !~ /awk/ {found=1} END {exit !found}'; then
    echo '健康检查失败：启动后未发现 Proma 进程。' >&2; rollback
  fi
  LATEST_LOG="$(find "$DATA_DIR/logs" -type f -maxdepth 2 -print 2>/dev/null | xargs -r ls -t 2>/dev/null | head -1 || true)"
  if [[ -n "$LATEST_LOG" ]] && grep -iE '(^|[^a-z])fatal([^a-z]|$)' "$LATEST_LOG" | tail -1; then
    echo '健康检查失败：最新日志发现 fatal。' >&2; rollback
  fi
  python3 - "$DATA_DIR" "$COUNTS" <<'PY' || { echo '健康检查失败：数据对象数量与备份不一致。' >&2; rollback; }
import json,pathlib,sqlite3,sys
root=pathlib.Path(sys.argv[1]); expected=json.loads(pathlib.Path(sys.argv[2]).read_text()); actual={}
def load(name):
 try:return json.loads((root/name).read_text(encoding='utf-8'))
 except Exception:return None
for filename,key,label in [('channels.json','channels','channels'),('agent-sessions.json','sessions','sessions'),('automations.json','automations','automations')]:
 obj=load(filename); arr=obj.get(key,[]) if isinstance(obj,dict) else obj
 actual[label]=len(arr) if isinstance(arr,list) else 0
try:
 db=sqlite3.connect(f'file:{root / "planning.db"}?mode=ro',uri=True); actual['planning_db_tables']=db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone()[0]; db.close()
except Exception: actual['planning_db_tables']=0
print('启动后数据对象计数:',', '.join(f'{k}={v}' for k,v in actual.items()))
if actual != {k:expected.get(k,0) for k in actual}: raise SystemExit(1)
PY
  if python3 - "$DATA_DIR/web-remote/config.json" <<'PY'
import json,sys
try: raise SystemExit(0 if json.load(open(sys.argv[1])).get('enabled') is True else 1)
except Exception: raise SystemExit(1)
PY
  then
    port="$(python3 - "$DATA_DIR/web-remote/config.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1])).get('port',17888))
PY
)"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null || { echo "健康检查失败：手机访问端口 $port 未监听。" >&2; rollback; }
  fi
fi

printf '安装成功: %s\n' "$APP_PATH"
printf '个人版版本: '; python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$MARKER"
old_count="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
if (( old_count > 5 )); then echo "提示：现有更新备份共 ${old_count} 份，已保留全部；请人工审核后决定是否清理超过最近 5 份的旧备份。"; fi
