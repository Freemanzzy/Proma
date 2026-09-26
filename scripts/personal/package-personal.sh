#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ELECTRON="$ROOT/apps/electron"
export PATH="$HOME/.bun/bin:$PATH"
export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:7897}"

cd "$ROOT"
printf '\n== bun install ==\n'
bun install
printf '\n== typecheck ==\n'
bun run typecheck
printf '\n== full tests (baseline limit: 5 failures, 1 error) ==\n'
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
    found = re.findall(rf'(?m)^\s*(\d+)\s+{label}\b', text)
    return int(found[-1]) if found else 0
failed, errors = count('fail'), count('error')
print(f'Parsed test result: fail={failed}, error={errors}, exit={rc}')
if failed > 5 or errors > 1:
    raise SystemExit('Test regressions exceed the recorded baseline (5 failures, 1 error).')
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

printf '\n== ad-hoc signature ==\n'
codesign --force --deep --sign - "$APP"
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
printf '\nPackage complete. The packaged app was not launched.\n'
