#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.bun/bin:$PATH"
export PROMA_DEV=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ADMIN="$REPO_ROOT/apps/electron/src/main/lib/web-remote/web-remote-admin.ts"

case "${1:-pair}" in
  pair|devices)
    exec bun run "$ADMIN" "${1:-pair}"
    ;;
  revoke)
    if [[ -z "${2:-}" ]]; then
      echo "用法: $0 revoke <deviceId>" >&2
      exit 2
    fi
    exec bun run "$ADMIN" revoke "$2"
    ;;
  *)
    echo "用法: $0 pair|devices|revoke <deviceId>" >&2
    exit 2
    ;;
esac
