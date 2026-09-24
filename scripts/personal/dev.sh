#!/usr/bin/env bash
# Proma Personal development launcher.
# 开发版使用 ~/.proma-dev；官方版继续使用 ~/.proma，二者可长期并存。
set -euo pipefail

export PATH="$HOME/.bun/bin:$PATH"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEV_DATA="$HOME/.proma-dev"
OFFICIAL_DATA="$HOME/.proma"

if [[ "$DEV_DATA" == "$OFFICIAL_DATA" || "$DEV_DATA" == "$OFFICIAL_DATA"/* ]]; then
  echo "拒绝启动：开发版数据目录不能是官方 ~/.proma 或其子目录" >&2
  exit 2
fi

personal_pids="$(ps -axo pid=,command= | grep 'proma-personal/node_modules/electron' | grep -vE 'grep|awk|sleep |import-proma-backup|scripts/personal/dev.sh' | awk '{print $1}' || true)"
if [[ -n "$personal_pids" ]]; then
  echo "拒绝启动：已有 Proma Personal Electron 进程运行中: $personal_pids" >&2
  exit 3
fi

official_pids="$(ps -axo pid=,command= | grep -E '^ *[0-9]+ +/Applications/Proma\.app/Contents/MacOS/Proma( |$)' | awk '{print $1}' || true)"
if [[ -n "$official_pids" ]]; then
  echo "隔离检查通过：官方 Proma PID=${official_pids}；开发版将使用 ${DEV_DATA}"
else
  echo "提示：未检测到官方 Proma 主进程；开发版仍将使用 ${DEV_DATA}"
fi

cd "$REPO_ROOT"
exec bun run dev
