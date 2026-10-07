#!/usr/bin/env bash
# Unified local mobile preview lifecycle for the personal build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TAILSCALE="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
AXE="$HOME/.local/bin/axe"
PID_FILE="/tmp/proma-mobile-preview.pids"
LOG_FILE="/tmp/proma-mobile-preview.log"
DEFAULT_DEVICE="iPhone 17 Pro"
CMD="${1:-status}"
shift || true

fail() { echo "错误：$*" >&2; exit 1; }
require() { command -v "$1" >/dev/null 2>&1 || fail "缺少命令：$1"; }
port_pid() { lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -n 1 || true; }

read_pids() {
  [[ -f "$PID_FILE" ]] || return 0
  # shellcheck disable=SC1090
  source "$PID_FILE"
}

descendants() {
  local parent="$1" child
  for child in $(ps -axo pid=,ppid= | awk -v p="$parent" '$2==p {print $1}'); do
    descendants "$child"
    echo "$child"
  done
}

serve_status() { "$TAILSCALE" serve status 2>&1 || true; }
process_start_time() { ps -o lstart= -p "$1" 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/[[:space:]][[:space:]]*/ /g'; }
close_dev_serve() { "$TAILSCALE" serve --https=8443 off >/dev/null 2>&1 || true; }

start_preview() {
  require lsof
  [[ -x "$TAILSCALE" ]] || fail "Tailscale CLI 不可执行：$TAILSCALE"
  [[ ! -f "$PID_FILE" ]] || fail "发现 PID 记录 $PID_FILE；先运行 status/stop，避免重复启动"
  for port in 17889 5173; do
    local pid
    pid="$(port_pid "$port")"
    [[ -z "$pid" ]] || fail "端口 $port 已被 PID $pid 占用"
  done

  "$TAILSCALE" serve --bg --https=8443 http://127.0.0.1:17889
  cd "$ROOT"
  ( cd "$ROOT" && perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' env PROMA_WEB_REMOTE=1 PROMA_WEB_REMOTE_HEAVY_SESSION_BASELINE="${PROMA_WEB_REMOTE_HEAVY_SESSION_BASELINE:-}" bash scripts/personal/dev.sh ) >"$LOG_FILE" 2>&1 < /dev/null &
  local dev_pid=$! start_time=$SECONDS pid_started_at
  sleep 1
  pid_started_at="$(process_start_time "$dev_pid")"
  [[ -n "$pid_started_at" ]] || fail "无法读取开发进程启动时间（PID=$dev_pid）"
  printf 'DEV_PID=%q\nLOG_FILE=%q\nPID_STARTED_AT=%q\n' "$dev_pid" "$LOG_FILE" "$pid_started_at" > "$PID_FILE"
  chmod 600 "$PID_FILE"

  while (( SECONDS - start_time < 180 )); do
    if grep -q '已启动: 127.0.0.1:17889' "$LOG_FILE" && grep -q '分级覆盖率 100%' "$LOG_FILE"; then
      echo "手机预览已启动；PID=${dev_pid}，日志=${LOG_FILE}"
      grep -E '分级覆盖率 100%|已启动: 127.0.0.1:17889' "$LOG_FILE" | tail -n 4
      echo "Tailscale Serve："
      serve_status
      return 0
    fi
    if ! kill -0 "$dev_pid" 2>/dev/null; then
      tail -n 80 "$LOG_FILE" >&2 || true
      fail "开发实例提前退出（PID=$dev_pid）"
    fi
    sleep 1
  done
  tail -n 80 "$LOG_FILE" >&2 || true
  fail "等待开发实例启动或分级覆盖率 100% 超时"
}

resolve_sim() {
  local selector="$1"
  if [[ "$selector" =~ ^[0-9A-Fa-f-]{36}$ ]]; then echo "$selector"; return; fi
  xcrun simctl list devices available | sed -nE "s/^[[:space:]]*${selector//./\\.} \(([0-9A-Fa-f-]{36})\).*/\\1/p" | head -n 1
}

sim_preview() {
  require xcrun
  [[ -x "$AXE" ]] || fail "缺少 AXe：$AXE"
  local selector="$DEFAULT_DEVICE" udid pair_output code origin ui_desc field_label field_id button_label
  while (($#)); do
    case "$1" in
      --device) (($# >= 2)) || fail "--device 缺少参数"; selector="$2"; shift 2 ;;
      *) fail "未知 sim 参数：$1" ;;
    esac
  done
  udid="$(resolve_sim "$selector")"
  [[ -n "$udid" ]] || fail "找不到可用模拟器：$selector"
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b
  open -a Simulator --args -CurrentDeviceUDID "$udid"

  local config="$HOME/.proma-dev/web-remote/config.json"
  [[ -r "$config" ]] || fail "找不到开发实例 Web Remote 配置：$config"
  origin="$(node -e 'const c=require(process.argv[1]); process.stdout.write(c.allowedOrigin||"")' "$config")"
  [[ "$origin" == https://*:* ]] || fail "allowedOrigin 未含临时 HTTPS 端口（期望 https://host:8443）：$origin"
  pair_output="$(cd "$ROOT" && PROMA_DEV=1 bash scripts/personal/web-remote.sh pair)"
  code="$(printf '%s\n' "$pair_output" | sed -nE 's/^配对码: ([0-9]{6})$/\1/p' | head -n 1)"
  [[ "$code" =~ ^[0-9]{6}$ ]] || fail "未能从配对命令输出解析 6 位配对码"

  xcrun simctl openurl "$udid" "$origin/"
  sleep 4
  # Safari does not include WebKit controls in its full AX dump on this OS, so
  # query the AX element at a grid of points derived from the reported screen
  # frame, then tap the center of the discovered input/button frame (never fixed
  # device coordinates).
  local targets
  targets="$(node - "$AXE" "$udid" <<'NODE'
const { spawnSync } = require('node:child_process')
const [axe, udid] = process.argv.slice(2)
const run = (args) => spawnSync(axe, args, { encoding: 'utf8' })
const root = run(['describe-ui', '--udid', udid])
if (root.status !== 0) throw new Error(root.stderr || 'AXe describe-ui failed')
const tree = JSON.parse(root.stdout)
const frame = tree.frame || tree[0]?.frame
if (!frame?.width || !frame?.height) throw new Error('AXe 未返回模拟器屏幕边界')
const found = { code: null, submit: null }
for (let yi = 20; yi <= 65; yi += 2) {
  const x = Math.round(frame.width / 2)
  const y = Math.round(frame.height * yi / 100)
  const result = run(['describe-ui', '--udid', udid, '--point', `${x},${y}`])
  if (result.status !== 0) continue
  let item
  try { item = JSON.parse(result.stdout) } catch { continue }
  const box = item.frame
  if (!box || !item.enabled) continue
  const center = `${Math.round(box.x + box.width / 2)} ${Math.round(box.y + box.height / 2)}`
  if (item.type === 'TextField' && /配对码|pairing code/i.test(item.AXValue || '') && !found.code) found.code = center
  if (item.type === 'Button' && /配对|pair/i.test(item.AXLabel || '')) found.submit = center
}
if (!found.code || !found.submit) {
  console.log('ALREADY_PAIRED')
  process.exit(0)
}
console.log(`${found.code}\n${found.submit}`)
NODE
)"
  local code_xy button_xy x y
  if [[ "$targets" == "ALREADY_PAIRED" ]]; then
    echo "模拟器已有有效配对态，保留现有配对并验证应用界面。"
  else
    code_xy="$(printf '%s\n' "$targets" | sed -n '1p')"
    button_xy="$(printf '%s\n' "$targets" | sed -n '2p')"
    read -r x y <<< "$code_xy"
    "$AXE" tap -x "$x" -y "$y" --udid "$udid"
    "$AXE" type "$code" --udid "$udid"
    read -r x y <<< "$button_xy"
    "$AXE" tap -x "$x" -y "$y" --udid "$udid"
    sleep 5
  fi
  xcrun simctl openurl "$udid" "$origin/app/"
  sleep 8
  xcrun simctl io "$udid" screenshot /tmp/proma-mobile-preview-sim.png
  local post_ui
  post_ui="$("$AXE" describe-ui --udid "$udid" 2>&1)"
  printf '%s\n' "$post_ui" | grep -E -i 'Proma|会话|新建|New chat|输入|侧栏|Agent' >/dev/null || fail "截图已保存，但 AXe 未确认进入 /app/ 界面"
  echo "配对与 /app/ 验证通过；设备=$selector ($udid)，截图=/tmp/proma-mobile-preview-sim.png"
}

run_tests() {
  local suites=("$@") suite agent="$(dirname "$0")/mobile-harness.mjs" url config origin chrome_pids failed=0
  if ((${#suites[@]} == 0)); then suites=(iphone:panel-probe iphone:smoke iphone:mobile-polish iphone:layout iphone:dead-socket iphone:heavy-session android:smoke android:attachments android:dead-socket); fi
  config="$HOME/.proma-dev/web-remote/config.json"
  [[ -r "$config" ]] || fail "找不到开发实例配置：$config"
  origin="$(node -e 'const c=require(process.argv[1]); process.stdout.write(c.allowedOrigin||"")' "$config")"
  [[ -n "$origin" ]] || fail "allowedOrigin 为空"
  for suite in "${suites[@]}"; do
    local ua name
    ua="${suite%%:*}"; name="${suite#*:}"
    [[ "$ua" != "$suite" ]] || { name="$suite"; ua=iphone; }
    local test_log="/tmp/proma-mobile-preview-${ua}-${name}.log"
    echo "=== ${ua} / ${name} ==="
    if ! (cd "$ROOT" && perl -e 'alarm 600; exec @ARGV' env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u HTTP_ALL_PROXY -u HTTPS_ALL_PROXY bun "$agent" --url "$origin" --suite "$name" --user-agent "$ua") >"$test_log" 2>&1; then
      echo "FAIL ${ua}/${name}（日志：${test_log}）"
      tail -n 16 "$test_log" || true
      failed=1
    else
      local result_json
      result_json="$(sed -nE 's/.*"jsonPath": "([^"]+)".*/\1/p' "$test_log" | tail -n 1)"
      if [[ -z "$result_json" || ! -r "$result_json" ]]; then
        echo "FAIL ${ua}/${name}（未找到 harness 结果 JSON；日志：${test_log}）" >&2
        failed=1
      elif ! node - "$result_json" "$ua" "$name" <<'NODE'
const fs = require('node:fs')
const [path, ua, suite] = process.argv.slice(2)
const result = JSON.parse(fs.readFileSync(path, 'utf8'))
const badSteps = (result.steps || []).filter((step) => step.ok === false && !step.skipped)
const checks = []
if (result.layout) checks.push(`pages=${result.layout.pages.filter((page) => !page.failed).length}/${result.layout.pages.length}`)
if (result.heavySession) {
  const heavy = result.heavySession
  checks.push(`heavy=${Math.round(heavy.syntheticJsonlBytes / 1024 / 1024)}MiB, first=${heavy.firstHistoryMs ?? 'not-visible'}ms, wsDecoded=${heavy.websocketPayloadBytes}B, netEncoded=${heavy.cdpEncodedNetworkBytes}B, new-exceptions=${heavy.newActionExceptions ?? heavy.exceptions}`)
  if (!heavy.baselineMode && (!heavy.historyVisible || heavy.firstHistoryMs === null || heavy.firstHistoryMs >= 20_000 || heavy.visibleMessagesAfterLoadEarlier <= heavy.visibleMessagesBeforeLoadEarlier || !heavy.truncationTextVisible || !heavy.imagePlaceholderVisible || (heavy.newActionExceptions ?? heavy.exceptions) > 0 || !heavy.largeDecodedFrameObserved)) {
    console.error(`FAIL ${ua}/${suite}: 大会话验收字段不完整：${JSON.stringify(heavy)}`)
    process.exit(1)
  }
  if (heavy.baselineMode && heavy.historyVisible && heavy.firstHistoryMs !== null && heavy.firstHistoryMs < 20_000) {
    console.error(`FAIL ${ua}/${suite}: 修复前基线意外在 20 秒内完成：${JSON.stringify(heavy)}`)
    process.exit(1)
  }
}
if (result.sessionSync) {
  const sync = result.sessionSync
  checks.push(`session-sync net=${sync.network?.downloadBitsPerSecond}/${sync.network?.uploadBitsPerSecond}bps@${sync.network?.latencyMs}ms rename=${sync.liveRenameVisibleMs}ms create=${sync.liveCreateVisibleMs}ms archive=${sync.archiveCommandMs}ms/visible=${sync.archiveRemovedMs}ms toggleIPC=${sync.archiveTransport?.toggleArchive?.elapsedMs ?? 'n/a'}ms/${sync.archiveTransport?.toggleArchive?.responseUtf8Bytes ?? 'n/a'}B listCalls=${sync.archiveTransport?.listSessions?.calls ?? 'n/a'} listBytes=${sync.archiveTransport?.listSessions?.responseUtf8Bytes ?? 'n/a'}B wsRx=${sync.archiveTransport?.receivedFramePayloadBytes ?? 'n/a'}B restore=${sync.restoreCommandMs}ms/visible=${sync.restoreVisibleMs}ms delete=${sync.liveDeleteGoneMs}ms reconnect=${sync.afterReconnectCreateVisible ? 'pass' : 'fail'} recovery=${(sync.reconnectRecoveryMs ?? []).join('/')}ms; recovery-frames=${(sync.reconnectFramesReceived ?? []).join('/')}; new-exceptions=${sync.newActionExceptions ?? sync.exceptions}, baseline=${sync.exceptionsBeforeSessionSync}`)
}
if (result.realHistory) {
  const real = result.realHistory
  checks.push(`real-history=${real.sessionCount} sessions/${real.sessionFileBytes}B/${real.firstHistoryMs}ms net=${real.network?.downloadBitsPerSecond}/${real.network?.uploadBitsPerSecond}bps@${real.network?.latencyMs}ms, list=${real.list?.responseUtf8Bytes}B appSent=${real.list?.appSentBytes}B, history=${real.history?.responseUtf8Bytes}B appSent=${real.history?.appSentBytes}B buffered=${real.history?.bufferedAmountPeak}B budgetReads=${JSON.stringify(real.history?.requestOptions ?? [])}, exceptions=${real.exceptionsDuringRealHistory} during / ${real.exceptionsBeforeRealHistory} before`)
  if (real.sessionCount !== 831 || real.sessionFileBytes < 30_000_000 || !real.historyVisible || real.firstHistoryMs === null || (real.newActionExceptions ?? real.exceptionsDuringRealHistory) > 0 || real.list?.calls < 1 || real.history?.calls < 1 || real.history?.wireBytes !== null) {
    console.error(`FAIL ${ua}/${suite}: 真实大会话验收字段不完整：${JSON.stringify(real)}`)
    process.exit(1)
  }
}
if (result.idleSessionSync) {
  const idle = result.idleSessionSync
  checks.push(`idle=${idle.elapsedMs}ms net=${idle.network?.downloadBitsPerSecond}/${idle.network?.uploadBitsPerSecond}bps@${idle.network?.latencyMs}ms, listCalls=${idle.listRequests}, appSent=${idle.appSentBytes}B, bufferPeak=${idle.bufferedAmountPeak}B, initialList=${idle.initialList.calls} calls/${idle.initialList.appSentBytes}B, new-exceptions=${idle.exceptions}, pre-action=${idle.exceptionsBeforeIdle}`)
  if (idle.elapsedMs < 180_000 || idle.listRequests !== 0 || idle.responseUtf8Bytes !== 0 || (idle.newActionExceptions ?? idle.exceptions) > 0) {
    console.error(`FAIL ${ua}/${suite}: 空闲 session 列表发生重复下发：${JSON.stringify(idle)}`)
    process.exit(1)
  }
}
if (result.probe) checks.push(`tabs=${result.probe.filter((item) => item.hitIsTab).length}/${result.probe.length}`)
if (result.attachments) checks.push(`attachments=${result.attachments.textAssistantReplyContainsFirstLine && result.attachments.imageAssistantIdentifiedRed ? 'pass' : 'fail'}`)
if (result.singleTapChecks) checks.push(`singleTap=${result.singleTapSuccess}/${result.singleTapChecks}`)
if (result.steps?.length) checks.push(`steps=${result.steps.filter((step) => step.ok).length}/${result.steps.filter((step) => !step.skipped).length}`)
checks.push(`new-action-exceptions=${result.newActionExceptionCount ?? result.newActionExceptions?.length ?? 0}, known-WASM-CSP-total=${result.knownWebAssemblyCspInitializationExceptions ?? 0}, http-429-status-responses=${result.http429Responses?.length ?? 0}, pre-action=${result.preActionExceptionCount ?? result.pageStartupExceptionCount ?? 0}${result.preActionExceptionCategories?.length ? ` (${[...new Set(result.preActionExceptionCategories)].join('; ')})` : ''}`)
if (result.error || result.revokeError || badSteps.length || result.layout?.passed === false || (result.probe && result.probe.some((item) => !item.hitIsTab)) || (result.singleTapChecks && result.singleTapSuccess !== result.singleTapChecks) || (result.attachments && (!result.attachments.textAssistantReplyContainsFirstLine || !result.attachments.imageAssistantIdentifiedRed)) || !result.revoked || !result.chromeExited || !result.profileRemoved || (result.newActionExceptions?.length ?? 0) > 0) {
  console.error(`FAIL ${ua}/${suite}: ${checks.join(', ')}${result.error ? `; ${result.error}` : ''}`)
  process.exit(1)
}
console.log(`PASS ${ua}/${suite}: ${checks.join(', ')}`)
const skipped = (result.steps || []).filter((step) => step.skipped)
for (const step of skipped) console.log(`SKIP ${step.name}: ${step.skipped}`)
NODE
      then
        failed=1
      fi
    fi
  done
  chrome_pids="$(ps -axo pid=,command= | awk '/proma-mobile-chrome-/ && /--user-data-dir=/ && !/awk/ {print $1}')"
  if [[ -n "$chrome_pids" ]]; then
    echo "残留 proma-mobile-chrome 进程：$chrome_pids" >&2
    failed=1
  else
    echo "Chrome 清理检查：无残留 proma-mobile-chrome 进程"
  fi
  return "$failed"
}

stop_preview() {
  local DEV_PID="" LOG_FILE="" PID_STARTED_AT="" pid current_start
  [[ -f "$PID_FILE" ]] || fail "找不到 PID 记录 $PID_FILE；为避免误杀，不猜测进程"
  read_pids
  [[ "${DEV_PID:-}" =~ ^[0-9]+$ && -n "${PID_STARTED_AT:-}" ]] || fail "PID 记录无效或缺少进程启动时间"
  current_start="$(process_start_time "$DEV_PID")"
  if [[ -n "$current_start" && "$current_start" != "$PID_STARTED_AT" ]]; then
    fail "PID $DEV_PID 启动时间不匹配；拒绝结束进程或修改 Serve 路由"
  fi
  if [[ -n "$current_start" ]] && [[ -z "$(port_pid 17889)" ]]; then
    echo "不健康：开发进程仍运行，但 17889 未监听；不结束进程，仅关闭 8443。"
    close_dev_serve
    serve_status
    return 0
  fi
  # PID identity matches the recorded launcher; only its current descendants are in scope.
  local tree=()
  if [[ -n "$current_start" ]]; then
    while IFS= read -r pid; do [[ -n "$pid" ]] && tree+=("$pid"); done < <(descendants "$DEV_PID")
    tree+=("$DEV_PID")
    for pid in "${tree[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
    sleep 2
    for pid in "${tree[@]}"; do kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true; done
  fi
  "$TAILSCALE" serve --https=8443 off
  local state
  state="$(serve_status)"
  echo "$state"
  if printf '%s\n' "$state" | grep -E 'https://.*:8443|/.*17889' >/dev/null; then fail "Tailscale Serve 仍包含 8443 / 17889 路由"; fi
  rm -f "$PID_FILE"
  echo "已停止记录的开发实例进程树；PID 文件已移除。"
}

show_status() {
  local process_state="未记录" current_start="" expected_start=""
  echo "PID 文件：$([[ -f "$PID_FILE" ]] && echo 存在 || echo 不存在)"
  if [[ -f "$PID_FILE" ]]; then
    local DEV_PID="" LOG_FILE="" PID_STARTED_AT=""
    read_pids
    expected_start="$PID_STARTED_AT"
    echo "开发启动 PID：${DEV_PID:-未知}"
    current_start="$(process_start_time "${DEV_PID:-0}")"
    if [[ -n "$current_start" && "$current_start" != "$expected_start" ]]; then process_state="身份不匹配（拒绝操作）"
    elif [[ -n "$current_start" ]]; then process_state="运行"
    else process_state="未运行"; fi
  fi
  echo "进程：$process_state"
  for port in 17889 5173; do local p; p="$(port_pid "$port")"; echo "端口 ${port}：${p:-未监听}"; done
  if [[ "$process_state" == "运行" && -z "$(port_pid 17889)" ]]; then
    echo "不健康：记录进程仍运行但 17889 未监听；不结束进程，仅关闭 8443。"
    close_dev_serve
  fi
  echo "Tailscale Serve："; serve_status
  echo "已启动 iOS 模拟器："; xcrun simctl list devices | grep -E '\(Booted\)' || true
  local chrome; chrome="$(ps -axo pid=,command= | awk '/proma-mobile-chrome-/ && /--user-data-dir=/ && !/awk/ {print $1}')"
  echo "harness Chrome：${chrome:-无}"
}

case "$CMD" in
  start) start_preview ;;
  sim) sim_preview "$@" ;;
  test) run_tests "$@" ;;
  stop) stop_preview ;;
  status) show_status ;;
  *) fail "用法：$0 {start|sim [--device <name|udid>]|test [suites...]|stop|status}" ;;
esac
