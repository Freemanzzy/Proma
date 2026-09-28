#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ELECTRON="$ROOT/apps/electron"
export PATH="$HOME/.bun/bin:$PATH"
export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:7897}"
# Fixed local code-signing identity (self-signed, in the login keychain). A stable
# identity keeps macOS TCC (Files & Folders) and Keychain grants across builds;
# ad-hoc signatures change every build and re-trigger those prompts.
SIGN_IDENTITY="${PROMA_PERSONAL_SIGN_IDENTITY:-Proma Personal Code Signing}"

# Fail early (before the long build) if the signing identity is missing. Never fall back to ad-hoc.
if ! security find-identity -p codesigning 2>/dev/null | grep -qF "\"$SIGN_IDENTITY\""; then
  echo "ERROR: code-signing identity not found in keychain: $SIGN_IDENTITY" >&2
  echo "       Create it (Keychain Access > Certificate Assistant, type Code Signing) or set PROMA_PERSONAL_SIGN_IDENTITY." >&2
  exit 1
fi
printf 'SIGN_IDENTITY=%s\n' "$SIGN_IDENTITY"

cd "$ROOT"
printf '\n== bun install ==\n'
bun install
printf '\n== typecheck ==\n'
bun run typecheck
printf '\n== full tests (baseline limit: 0 failures, 0 errors) ==\n'
TEST_LOG="$(mktemp -t proma-personal-tests.XXXXXX)"
set +e
bun test --no-color 2>&1 | tee "$TEST_LOG"
TEST_RC=${PIPESTATUS[0]}
set -e
python3 - "$TEST_LOG" "$TEST_RC" <<'PY'
import re, sys
text = open(sys.argv[1], encoding='utf-8', errors='replace').read()
rc = int(sys.argv[2])
def count(label):
    suffix = 's?' if label in ('fail', 'error') else ''
    found = re.findall(rf'(?m)^\s*(\d+)\s+{label}{suffix}\b', text)
    return int(found[-1]) if found else 0
failed, errors = count('fail'), count('error')
print(f'Parsed test result: fail={failed}, error={errors}, exit={rc}')
if failed > 0 or errors > 0:
    raise SystemExit('Test regressions exceed the recorded baseline (0 failures, 0 errors).')
if rc not in (0, 1):
    raise SystemExit(f'Unexpected bun test exit code: {rc}')
PY
rm -f "$TEST_LOG"

printf '\n== full Electron build (includes web preload) ==\n'
cd "$ELECTRON"
bun run build
printf '\n== runtime dependencies and native module ==\n'
bun run sync:runtime-deps
bun run rebuild:node-pty

printf '\n== macOS arm64 directory package ==\n'
PROMA_PERSONAL_BUILD=1 CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac dir --arm64
APP="$ELECTRON/out/mac-arm64/Proma.app"
if [[ ! -d "$APP" ]]; then
  APP="$(find "$ELECTRON/out" -maxdepth 3 -type d -name Proma.app -print -quit)"
fi
[[ -n "$APP" && -d "$APP" ]] || { echo 'ERROR: Proma.app output not found' >&2; exit 1; }

printf '\n== packaged mobile selector integrity ==\n'
node "$ROOT/scripts/personal/check-packaged-mobile-selectors.cjs" "$APP/Contents/Resources/app.asar"

printf '\n== thin bundled serve-sim helpers to arm64 ==\n'
SERVE_SIM_RESOURCE="$APP/Contents/Resources/serve-sim/node_modules/serve-sim/dist"
SERVE_SIM_HELPERS=(
  "$SERVE_SIM_RESOURCE/simax/serve-sim-ax-settings"
  "$SERVE_SIM_RESOURCE/simduo/serve-sim-duo-render"
  "$SERVE_SIM_RESOURCE/simcam/libSimCameraInjector.dylib"
)
for helper in "${SERVE_SIM_HELPERS[@]}"; do
  [[ -f "$helper" ]] || { echo "ERROR: bundled serve-sim helper missing: ${helper##*/}" >&2; exit 1; }
  helper_archs="$(lipo -archs "$helper")"
  grep -qw arm64 <<<"$helper_archs" || { echo "ERROR: serve-sim helper lacks arm64 slice: ${helper##*/}" >&2; exit 1; }
  if grep -qw x86_64 <<<"$helper_archs"; then
    lipo -thin arm64 "$helper" -output "$helper.arm64"
    mv "$helper.arm64" "$helper"
  fi
done

printf '\n== code signature (%s) ==\n' "$SIGN_IDENTITY"
codesign --force --deep --sign "$SIGN_IDENTITY" "$APP"
codesign --verify --deep --strict "$APP"
for helper in "${SERVE_SIM_HELPERS[@]}"; do codesign --verify --strict "$helper"; done

printf '\n== packaged serve-sim ESM dependency check ==\n'
PACKAGED_ELECTRON="$APP/Contents/MacOS/Proma"
SERVE_SIM_ROOT="$APP/Contents/Resources/serve-sim/node_modules/serve-sim/dist"
[[ -x "$PACKAGED_ELECTRON" && -f "$SERVE_SIM_ROOT/serve-sim.js" && -f "$SERVE_SIM_ROOT/middleware.js" ]] || {
  echo 'ERROR: packaged serve-sim runtime resources are incomplete' >&2; exit 1;
}
ELECTRON_RUN_AS_NODE=1 "$PACKAGED_ELECTRON" --input-type=module -e 'await import(process.argv[1]); console.log("serve-sim middleware import OK")' "$(python3 -c 'import pathlib,sys;print(pathlib.Path(sys.argv[1]).resolve().as_uri())' "$SERVE_SIM_ROOT/middleware.js")"
# Exercise the real CLI entry via its non-mutating --help path, which loads its static ESM dependency graph.
ELECTRON_RUN_AS_NODE=1 "$PACKAGED_ELECTRON" "$SERVE_SIM_ROOT/serve-sim.js" --help >/dev/null
printf 'serve-sim entry and middleware ESM imports passed\n'

BOOTED_UDID="$(/usr/bin/xcrun simctl list devices available -j | python3 -c 'import json,sys; data=json.load(sys.stdin); print(next((d["udid"] for group in data.get("devices",{}).values() for d in group if d.get("state")=="Booted" and d.get("udid")), ""))')"
if [[ -n "$BOOTED_UDID" ]]; then
  SMOKE_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
  SMOKE_LOG="$(mktemp -t proma-serve-sim-smoke.XXXXXX)"
  SMOKE_PID=""
  cleanup_serve_sim_smoke() {
    ELECTRON_RUN_AS_NODE=1 "$PACKAGED_ELECTRON" "$SERVE_SIM_ROOT/serve-sim.js" --kill "$BOOTED_UDID" >/dev/null 2>&1 || true
    if [[ -n "$SMOKE_PID" ]] && kill -0 "$SMOKE_PID" 2>/dev/null; then
      kill -TERM "$SMOKE_PID" 2>/dev/null || true
      wait "$SMOKE_PID" 2>/dev/null || true
    fi
    rm -f "$SMOKE_LOG"
  }
  trap cleanup_serve_sim_smoke EXIT
  ELECTRON_RUN_AS_NODE=1 "$PACKAGED_ELECTRON" "$SERVE_SIM_ROOT/serve-sim.js" --host 127.0.0.1 --port "$SMOKE_PORT" --fit --panes none -q "$BOOTED_UDID" >"$SMOKE_LOG" 2>&1 &
  SMOKE_PID=$!
  SMOKE_OK=0
  for _ in {1..10}; do
    if curl --silent --show-error --fail "http://127.0.0.1:$SMOKE_PORT/" >/dev/null 2>&1; then SMOKE_OK=1; break; fi
    if ! kill -0 "$SMOKE_PID" 2>/dev/null; then break; fi
    sleep 1
  done
  if (( SMOKE_OK == 0 )); then
    echo 'ERROR: bundled serve-sim simulator smoke test did not return HTTP 200' >&2
    exit 1
  fi
  sleep 5
  cleanup_serve_sim_smoke
  trap - EXIT
  printf 'serve-sim simulator smoke passed: HTTP 200; ran 5 seconds; stopped by UDID\n'
else
  printf 'serve-sim simulator smoke skipped: no Booted simulator found\n'
fi

if codesign -dv "$APP" 2>&1 | grep -q '^Signature=adhoc'; then
  echo 'ERROR: package ended up ad-hoc signed' >&2; exit 1
fi
if ! codesign -d -r- "$APP" 2>&1 | grep -q 'certificate leaf'; then
  echo 'ERROR: designated requirement does not pin the signing certificate' >&2; exit 1
fi
printf '\n== packaged app metadata ==\n'
printf 'APP_PATH=%s\n' "$APP"
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" | sed 's/^/VERSION=/'
cat "$APP/Contents/Resources/personal-build.json"
if [[ -e "$APP/Contents/Resources/app-update.yml" ]]; then
  echo 'ERROR: personal build still contains app-update.yml' >&2
  exit 1
else
  echo 'APP_UPDATE_YML=absent (electron-updater has no official feed configuration)'
fi
codesign -dv --verbose=2 "$APP" 2>&1 | grep -E '^(Executable|Identifier|Format|CodeDirectory|Signature|Authority|TeamIdentifier|Sealed Resources)' || true
codesign -d -r- "$APP" 2>&1 | grep '^designated' || true
printf '\nPackage complete. The packaged app was not launched.\n'
