#!/usr/bin/env python3
"""Read-only weekly summary of Agent request diagnostics.

Counts the `event=provider-request` / `event=image-budget` lines that the personal
build writes to main.log, plus per-request prompt-cache rewrites from session JSONL usage, and
reports which backlog follow-up triggers fired (see docs/personal/backlog.md,
"图片与请求诊断后续").

The script only reads files. It never prints message content, image data, paths
inside sessions, or credentials. Output is a single JSON object on stdout.

Usage:
  request-diagnostics-summary.py [--log-dir DIR] [--sessions-dir DIR] [--days N] [--now EPOCH]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

MIB = 1024 * 1024
# Trigger thresholds. Keep in sync with docs/personal/backlog.md.
LARGE_BODY_BYTES = 8 * MIB          # text-dominated body considered "large"
LARGE_BODY_MAX_IMAGE_BYTES = 4 * MIB  # images already within the budget LOW watermark
SLOW_TTFB_MS = 60_000
LARGE_BODY_MIN_HITS = 3
SMALL_BODY_BYTES = 2 * MIB
TIMEOUT_RECOVERY_WINDOW_S = 10 * 60
LONG_STALL_MS = 290_000
CACHE_REBUILD_MIN_TOKENS = 300_000
CACHE_REBUILD_MIN_HITS = 2

LINE_RE = re.compile(r'^(?P<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) .*?message=event=(?P<event>provider-request|image-budget)(?P<rest>.*)$')
PAIR_RE = re.compile(r'([A-Za-z][A-Za-z0-9]*)=(\S+)')


def parse_ts(value: str) -> float:
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def to_value(raw: str):
    if raw in ('true', 'false'):
        return raw == 'true'
    if re.fullmatch(r'-?\d+', raw):
        return int(raw)
    return raw


def iter_log_events(log_dir: Path, since: float):
    files = sorted(log_dir.glob('main.log*'), key=lambda p: p.name, reverse=True)
    for path in files:
        if not path.is_file() or path.stat().st_mtime < since:
            continue
        with path.open('r', encoding='utf-8', errors='replace') as handle:
            for line in handle:
                if 'message=event=' not in line:
                    continue
                match = LINE_RE.match(line.rstrip('\n'))
                if not match:
                    continue
                ts = parse_ts(match['ts'])
                if ts < since:
                    continue
                fields = {key: to_value(value) for key, value in PAIR_RE.findall(match['rest'])}
                yield ts, match['event'], fields


def iter_cache_rebuilds(sessions_dir: Path, since: float):
    """Yield single provider requests that rewrote a very large prompt cache.

    Uses per-request usage on assistant lines (not turn totals on result lines,
    which add up many small cache writes inside one long agentic turn).
    """
    if not sessions_dir.is_dir():
        return
    for path in sessions_dir.glob('*.jsonl'):
        try:
            if path.stat().st_mtime < since:
                continue
        except OSError:
            continue
        with path.open('r', encoding='utf-8', errors='replace') as handle:
            for line in handle:
                if not line.startswith('{"type":"assistant"') or '"cache_creation_input_tokens"' not in line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                created = record.get('_createdAt')
                if not isinstance(created, (int, float)) or created / 1000 < since:
                    continue
                usage = (record.get('message') or {}).get('usage') or {}
                cache_creation = usage.get('cache_creation_input_tokens') or 0
                if cache_creation >= CACHE_REBUILD_MIN_TOKENS:
                    yield {'session': path.stem[:8], 'cacheCreationTokens': int(cache_creation)}


def summarize(log_dir: Path, sessions_dir: Path, days: int, now: float) -> dict:
    since = now - days * 86400
    requests = []
    budgets = []
    for ts, event, fields in iter_log_events(log_dir, since):
        (requests if event == 'provider-request' else budgets).append((ts, fields))

    protected = [f for _, f in budgets if f.get('overBudgetProtected') is True]
    large_text = [f for _, f in requests
                  if f.get('approxBodyBytes', 0) > LARGE_BODY_BYTES
                  and f.get('imageBytes', 0) <= LARGE_BODY_MAX_IMAGE_BYTES
                  and f.get('ttfbMs', -1) > SLOW_TTFB_MS]
    timeouts = [(ts, f) for ts, f in requests if f.get('errorKind') == 'timeout']
    small_timeouts = [f for _, f in timeouts if f.get('approxBodyBytes', 0) < SMALL_BODY_BYTES]
    recovered = 0
    for ts, f in timeouts:
        session = f.get('session')
        if any(other.get('session') == session and other.get('outcome') == 'done' and 0 < other_ts - ts <= TIMEOUT_RECOVERY_WINDOW_S
               for other_ts, other in requests):
            recovered += 1
    codex_stalls = [f for _, f in requests
                    if f.get('provider') == 'openai-codex' and f.get('durationMs', 0) >= LONG_STALL_MS
                    and f.get('outcome') in ('error', 'aborted')]
    rebuilds = list(iter_cache_rebuilds(sessions_dir, since))

    triggers = {
        'protectedZoneGap': len(protected) >= 1,
        'byteBasedCompaction': len(large_text) >= LARGE_BODY_MIN_HITS or len(rebuilds) >= CACHE_REBUILD_MIN_HITS,
        'timeoutRetryPolicy': len(small_timeouts) >= 1 or recovered >= 1,
        'piRetryVisibility': len(codex_stalls) >= 1,
    }
    return {
        'windowDays': days,
        'diagnosticsPresent': bool(requests or budgets),
        'providerRequests': len(requests),
        'imageBudgetEvents': len(budgets),
        'overBudgetProtected': len(protected),
        'largeTextSlowRequests': len(large_text),
        'timeouts': len(timeouts),
        'smallBodyTimeouts': len(small_timeouts),
        'timeoutsRecoveredWithin10m': recovered,
        'codexLongStalls': len(codex_stalls),
        'expensiveCacheRebuilds': len(rebuilds),
        'expensiveCacheRebuildSamples': rebuilds[:5],
        'maxApproxBodyBytes': max((f.get('approxBodyBytes', 0) for _, f in requests), default=0),
        'maxTtfbMs': max((f.get('ttfbMs', -1) for _, f in requests), default=-1),
        'triggers': triggers,
        'anyTriggered': any(triggers.values()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--log-dir', default=str(Path.home() / 'Library/Logs/@proma/electron'))
    parser.add_argument('--sessions-dir', default=str(Path.home() / '.proma/agent-sessions'))
    parser.add_argument('--days', type=int, default=7)
    parser.add_argument('--now', type=float, default=None, help='testing only: override current epoch seconds')
    args = parser.parse_args()
    if args.days <= 0:
        parser.error('--days must be positive')
    log_dir = Path(os.path.expanduser(args.log_dir))
    if not log_dir.is_dir():
        print(json.dumps({'error': 'log_dir_missing'}), flush=True)
        return 2
    now = args.now if args.now is not None else dt.datetime.now(dt.timezone.utc).timestamp()
    print(json.dumps(summarize(log_dir, Path(os.path.expanduser(args.sessions_dir)), args.days, now), ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
