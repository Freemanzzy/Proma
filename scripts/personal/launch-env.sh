# shellcheck shell=bash
# 个人版：用与 Dock/Finder 启动一致的环境启动 Proma（由 install-update.sh source）。
#
# 背景（2026-11-08 安装 3a2da9d6 时发现）：`open` 会把调用者 shell 的环境变量带给新进程。
# 维护会话若在 `launchctl setenv PROMA_…` 之后启动，即使之后已 `launchctl unsetenv`，
# 它的 shell 里仍有这个变量，新装的 Proma 会被它悄悄打开对应开关。
# 这里清除调用者环境中的所有 PROMA_* 变量（以及已知的个人版/开发开关），
# 只沿用 launchd 当前确实设置的值，使结果与从 Dock 启动一致。

PERSONAL_KNOWN_ENV_FLAGS="PROMA_PERSONAL_GOAL_MEMORY PROMA_PERSONAL_GOAL_DATA_DIR PROMA_DEV PROMA_DEV_DATA_DIR_NAME PROMA_DEV_INSTANCE PROMA_DEV_REMOTE_DEBUGGING_PORT PROMA_WEB_REMOTE PROMA_WEB_REMOTE_ALLOW_PROD PROMA_WEB_REMOTE_HEAVY_SESSION_BASELINE PROMA_AGENT_RUNTIME"
LAUNCH_ENV_LAUNCHCTL="${LAUNCH_ENV_LAUNCHCTL:-/bin/launchctl}"
LAUNCH_ENV_PS="${LAUNCH_ENV_PS:-/bin/ps}"

# 需要清除的变量名：已知开关 + 调用者环境中的全部 PROMA_*
launch_env_names() {
  { printf '%s\n' $PERSONAL_KNOWN_ENV_FLAGS; compgen -e | grep '^PROMA_' || true; } | sort -u
}

# 结果写入 LAUNCH_ENV_ARGS（供 `env` 使用）与 LAUNCH_ENV_FROM_LAUNCHD（沿用的变量名，空格分隔）
build_launch_env_args() {
  LAUNCH_ENV_ARGS=()
  LAUNCH_ENV_FROM_LAUNCHD=""
  LAUNCH_ENV_CLEARED=""
  local name value assignments=()
  for name in $(launch_env_names); do
    LAUNCH_ENV_ARGS+=(-u "$name")
    if [[ -n "${!name+x}" ]]; then LAUNCH_ENV_CLEARED="$LAUNCH_ENV_CLEARED $name"; fi
    value="$("$LAUNCH_ENV_LAUNCHCTL" getenv "$name" 2>/dev/null || true)"
    if [[ -n "$value" ]]; then
      assignments+=("$name=$value")
      LAUNCH_ENV_FROM_LAUNCHD="$LAUNCH_ENV_FROM_LAUNCHD $name"
    fi
  done
  # env 的 -u 选项必须全部在 NAME=VALUE 之前，否则其后的 -u 会被当成要执行的命令
  LAUNCH_ENV_ARGS+=(${assignments[@]+"${assignments[@]}"})
  printf '启动环境：清除调用者 shell 中的 PROMA_* 变量:%s；沿用 launchctl:%s\n' "${LAUNCH_ENV_CLEARED:- 无}" "${LAUNCH_ENV_FROM_LAUNCHD:- 无}"
}

# 启动后用 ps eww 自检新进程环境，只打印变量名与来源，不打印值
report_launch_env() {
  local pid="$1" command names name
  command="$("$LAUNCH_ENV_PS" eww -o command= -p "$pid" 2>/dev/null || true)"
  if [[ -z "$command" ]]; then
    printf '启动环境自检：无法读取 PID %s 的环境（ps eww 无输出）\n' "$pid"
    return 0
  fi
  names="$(printf '%s\n' "$command" | tr ' ' '\n' | grep -oE '^PROMA_[A-Z0-9_]+=' | sed 's/=$//' | sort -u || true)"
  if [[ -z "$names" ]]; then
    printf '启动环境自检：PID %s 进程环境不含 PROMA_* 变量\n' "$pid"
    return 0
  fi
  for name in $names; do
    if [[ " $LAUNCH_ENV_FROM_LAUNCHD " == *" $name "* ]]; then
      printf '启动环境自检：PID %s 含 %s（来自 launchctl，与 Dock 启动一致）\n' "$pid" "$name"
    else
      printf 'WARN 启动环境自检：PID %s 含非预期的 %s（不是 launchctl 设置的；请检查启动方式）\n' "$pid" "$name"
    fi
  done
  return 0
}
