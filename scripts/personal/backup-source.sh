#!/usr/bin/env bash
# Personal edition source & dependency backup.
#
# 1) Push every local branch, tag and the upstream (official) refs to the private,
#    non-fork mirror remote `archive` (upstream refs land under refs/heads/upstream/*).
# 2) If the backup directory is reachable, write a full `git bundle` when any ref changed.
# 3) If bun.lock changed since the last dependency snapshot, archive the bun install cache
#    and the Electron download cache so a fresh machine can install offline.
#
# Required:  PROMA_SOURCE_BACKUP_DIR   destination directory (e.g. on an external disk)
# Optional:  PROMA_GIT_PROXY           http proxy for git (e.g. http://127.0.0.1:7897)
#            PROMA_BACKUP_SKIP_DEPS=1  skip step 3
# Never deletes anything. Prints one JSON summary line at the end.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="${PROMA_SOURCE_BACKUP_DIR:-}"
TS="$(date +%Y%m%d-%H%M%S)"
GIT=(git -C "$REPO")
[ -n "${PROMA_GIT_PROXY:-}" ] && GIT+=(-c "http.proxy=$PROMA_GIT_PROXY")
export GIT_TERMINAL_PROMPT=0

run_timeout() { local secs="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$secs" "$@"; }

fetch_status="skipped"; archive_status="skipped"; bundle_status="skipped"; deps_status="skipped"
bundle_file=""; deps_file=""

if run_timeout 180 "${GIT[@]}" fetch -q upstream --tags --prune; then fetch_status="ok"; else fetch_status="failed"; fi

if "${GIT[@]}" remote get-url archive >/dev/null 2>&1; then
  if run_timeout 900 "${GIT[@]}" push -q archive \
      'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*' 'refs/remotes/upstream/*:refs/heads/upstream/*' \
      >/tmp/proma-backup-archive-push.log 2>&1; then
    archive_status="ok"
  else
    archive_status="failed"
  fi
else
  archive_status="no_archive_remote"
fi

if [ -z "$DEST" ]; then
  bundle_status="no_dest"; deps_status="no_dest"
elif [ ! -d "$DEST" ]; then
  bundle_status="dest_unavailable"; deps_status="dest_unavailable"
else
  refs_sig="$("${GIT[@]}" for-each-ref --format='%(objectname) %(refname)' | shasum -a 256 | cut -d' ' -f1)"
  last_sig="$(cat "$DEST/.last-refs.sha256" 2>/dev/null || true)"
  if [ "$refs_sig" = "$last_sig" ]; then
    bundle_status="unchanged"
  else
    bundle_file="$DEST/proma-personal-$TS.bundle"
    if run_timeout 600 "${GIT[@]}" bundle create "$bundle_file" --all >/dev/null 2>&1 \
        && run_timeout 300 "${GIT[@]}" bundle verify "$bundle_file" >/dev/null 2>&1; then
      printf '%s\n' "$refs_sig" > "$DEST/.last-refs.sha256"
      bundle_status="ok"
    else
      bundle_status="failed"
    fi
  fi

  if [ "${PROMA_BACKUP_SKIP_DEPS:-0}" = "1" ]; then
    deps_status="skipped"
  else
    lock_sig="$(shasum -a 256 "$REPO/bun.lock" | cut -d' ' -f1)"
    last_lock="$(cat "$DEST/.last-bun-lock.sha256" 2>/dev/null || true)"
    if [ "$lock_sig" = "$last_lock" ]; then
      deps_status="unchanged"
    else
      deps_file="$DEST/deps-bun-cache-$TS.tar.gz"
      if [ -d "$HOME/.bun/install/cache" ] \
          && run_timeout 1800 tar -czf "$deps_file" -C "$HOME/.bun/install" cache \
          && { [ ! -d "$HOME/Library/Caches/electron" ] || run_timeout 600 tar -czf "$DEST/deps-electron-cache-$TS.tar.gz" -C "$HOME/Library/Caches" electron; }; then
        {
          echo "bun $("$HOME/.bun/bin/bun" --version 2>/dev/null || echo unknown)"
          echo "node $(node --version 2>/dev/null || echo unknown)"
          echo "commit $("${GIT[@]}" rev-parse HEAD)"
          echo "bun.lock $lock_sig"
        } > "$DEST/deps-$TS-manifest.txt"
        printf '%s\n' "$lock_sig" > "$DEST/.last-bun-lock.sha256"
        deps_status="ok"
      else
        deps_status="failed"
      fi
    fi
  fi
fi

printf '{"event":"proma-source-backup","fetch":"%s","archive":"%s","bundle":"%s","deps":"%s","head":"%s","bundleFile":"%s","depsFile":"%s"}\n' \
  "$fetch_status" "$archive_status" "$bundle_status" "$deps_status" "$("${GIT[@]}" rev-parse --short personal)" \
  "$(basename "$bundle_file")" "$(basename "$deps_file")"
case "$archive_status $bundle_status $deps_status" in *failed*) exit 1 ;; esac
exit 0
