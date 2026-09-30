#!/usr/bin/env python3
"""Copy one workspace's session index and JSONL transcripts from a local backup.

This intentionally does not restore the rest of ~/.proma. The destination must
not exist; callers must first preserve an existing development directory.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import sys


def fail(message: str) -> "NoReturn":
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(2)


def secure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path, 0o700)


def secure_write_json(path: Path, value: object) -> None:
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(data)
        handle.write(b"\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="backup's proma data directory")
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--destination", type=Path, default=Path.home() / ".proma-dev")
    parser.add_argument("--apply", action="store_true", help="perform the restricted copy; default is dry-run")
    args = parser.parse_args()

    home = Path.home().resolve()
    source = args.source.expanduser().resolve(strict=True)
    allowed_backup_root = (home / ".proma-switch-backups").resolve()
    destination = args.destination.expanduser().absolute()
    expected_destination = home / ".proma-dev"
    if not source.is_dir() or not source.is_relative_to(allowed_backup_root):
        fail("source must be a directory inside ~/.proma-switch-backups")
    if destination != expected_destination:
        fail("destination is restricted to ~/.proma-dev")
    if args.apply and destination.exists():
        fail("destination already exists; preserve it by renaming before import")
    source_index = source / "agent-sessions.json"
    source_workspaces = source / "agent-workspaces.json"
    source_jsonls = source / "agent-sessions"
    if not source_index.is_file() or not source_workspaces.is_file() or not source_jsonls.is_dir():
        fail("backup is missing required session/workspace indexes")

    index = json.loads(source_index.read_text(encoding="utf-8"))
    workspace_index = json.loads(source_workspaces.read_text(encoding="utf-8"))
    workspaces = [w for w in workspace_index.get("workspaces", []) if w.get("id") == args.workspace_id]
    if len(workspaces) != 1:
        fail("workspace id must match exactly one backup workspace")
    sessions = [s for s in index.get("sessions", []) if s.get("workspaceId") == args.workspace_id]
    if not sessions:
        fail("selected workspace has no sessions")

    jobs: list[tuple[Path, int]] = []
    total_bytes = 0
    for session in sessions:
        session_id = session.get("id")
        if not isinstance(session_id, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,128}", session_id):
            fail("backup contains an invalid session id")
        path = source_jsonls / f"{session_id}.jsonl"
        if path.is_file() and not path.is_symlink():
            size = path.stat().st_size
            jobs.append((path, size))
            total_bytes += size

    if not args.apply:
        print(f"DRY-RUN: workspace_sessions={len(sessions)} transcripts={len(jobs)} transcript_bytes={total_bytes}")
        print("DRY-RUN: will copy only agent-sessions.json, agent-workspaces.json (one workspace), and matching JSONL files")
        print("DRY-RUN: will not copy credentials, channels, automations, bridges, MCP, OAuth, keychain, device/push data, or workspace project files")
        return 0

    secure_dir(destination)
    secure_dir(destination / "agent-sessions")
    secure_dir(destination / "agent-workspaces")
    # Replace profile references recursively in metadata too; imported session metadata
    # can contain runtime artifact paths even though those artifacts are not copied.
    official = str(home / ".proma").encode()
    backup_root = str(source).encode()
    dev_root = str(destination).encode()
    replacements = ((official, dev_root), (backup_root, dev_root))

    def rewrite_value(value: object) -> object:
        if isinstance(value, str):
            raw = value.encode("utf-8")
            for old, new in replacements:
                raw = raw.replace(old, new)
            raw = re.sub(rb"\.proma(?=$|[/\\\s\"'])", b".proma-dev", raw)
            return raw.decode("utf-8")
        if isinstance(value, list):
            return [rewrite_value(item) for item in value]
        if isinstance(value, dict):
            return {key: rewrite_value(item) for key, item in value.items()}
        return value

    imported_index = rewrite_value({**index, "sessions": sessions})
    secure_write_json(destination / "agent-sessions.json", imported_index)
    secure_write_json(destination / "agent-workspaces.json", rewrite_value({**workspace_index, "workspaces": workspaces}))

    copied = 0
    path_pattern = re.compile(rb"\.proma(?=$|[/\\\s\"'])")
    for source_path, size in jobs:
        raw = source_path.read_bytes()
        if len(raw) != size:
            fail("source transcript changed during import")
        for old, new in replacements:
            raw = raw.replace(old, new)
        raw = path_pattern.sub(b".proma-dev", raw)
        output = destination / "agent-sessions" / source_path.name
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(raw)
        copied += 1
    for directory, subdirs, files in os.walk(destination):
        os.chmod(directory, 0o700)
        for filename in files:
            os.chmod(Path(directory) / filename, 0o600)
    print(f"IMPORTED: workspace_sessions={len(sessions)} transcripts={copied} transcript_bytes={total_bytes}")
    print("IMPORTED: sensitive configuration and unrelated workspace/session data were not copied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
