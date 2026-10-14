#!/usr/bin/env python3
"""Wait for a fresh personal main-process startup marker in current/rotated logs."""
from __future__ import annotations
import sys
import time
from datetime import datetime
from pathlib import Path


def marker_time(line: str) -> float | None:
    if 'personal main process started' not in line:
        return None
    try:
        return datetime.fromisoformat(line.split()[0].replace('Z', '+00:00')).timestamp()
    except (ValueError, IndexError):
        return None


def inspect(paths: list[Path], started: float) -> tuple[bool, str | None]:
    markers: list[float] = []
    logs: list[list[str]] = []
    for path in paths:
        try:
            lines = path.read_text(encoding='utf-8', errors='replace').splitlines()
        except FileNotFoundError:
            continue
        logs.append(lines)
        markers.extend(stamp for line in lines if (stamp := marker_time(line)) is not None and stamp >= started)
    if not markers:
        return False, None
    latest_stamp = max(markers)
    for lines in logs:
        for line in lines:
            if '[FATAL]' not in line:
                continue
            stamp = marker_time(line)
            if stamp is None:
                try:
                    stamp = datetime.fromisoformat(line.split()[0].replace('Z', '+00:00')).timestamp()
                except (ValueError, IndexError):
                    continue
            if stamp >= latest_stamp:
                return True, 'fatal event after latest personal startup'
    return True, None


def main() -> int:
    if len(sys.argv) not in (4, 5):
        print('usage: wait-startup-marker.py LOG_FILE STARTED_AT_EPOCH TIMEOUT_SECONDS [POLL_SECONDS]', file=sys.stderr)
        return 2
    log = Path(sys.argv[1])
    started = float(sys.argv[2])
    timeout = float(sys.argv[3])
    poll = float(sys.argv[4]) if len(sys.argv) == 5 else 1.0
    deadline = time.monotonic() + timeout
    paths = [log, Path(f'{log}.1')]
    while True:
        found, error = inspect(paths, started)
        if found:
            if error:
                print(f'健康检查失败：{error}；日志路径：{log}', file=sys.stderr)
                return 1
            print(f'personal startup marker observed: {log} (also checked {log}.1)')
            return 0
        if time.monotonic() >= deadline:
            print(f'健康检查失败：等待启动标记 {timeout:g} 秒仍未发现时间戳不早于启动时刻的标记；日志路径：{log}、{log}.1', file=sys.stderr)
            return 1
        time.sleep(min(poll, max(0, deadline - time.monotonic())))


if __name__ == '__main__':
    raise SystemExit(main())
