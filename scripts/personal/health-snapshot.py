#!/usr/bin/env python3
"""Read-only, secret-free snapshot of Proma data counts and format versions."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys
from typing import Any


def load_json(root: Path, filename: str, errors: list[str]) -> Any:
    path = root / filename
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        errors.append(f"missing:{filename}")
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        errors.append(f"invalid:{filename}:{type(exc).__name__}")
    return None


def list_field(value: Any, key: str) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        value = value.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def count_symlinks(root: Path) -> int:
    count = 0
    for base, dirs, files in os.walk(root, followlinks=False):
        current = Path(base)
        for name in dirs + files:
            try:
                if (current / name).is_symlink():
                    count += 1
            except OSError:
                continue
    return count


def snapshot(root: Path) -> dict[str, Any]:
    errors: list[str] = []
    if not root.is_dir():
        raise ValueError(f"DATA_DIR is not a directory: {root}")
    channels_doc = load_json(root, "channels.json", errors)
    sessions_doc = load_json(root, "agent-sessions.json", errors)
    automation_doc = load_json(root, "automations.json", errors)
    settings_doc = load_json(root, "settings.json", errors)
    channels = list_field(channels_doc, "channels")
    sessions = list_field(sessions_doc, "sessions")
    automations = list_field(automation_doc, "automations")
    versions = {}
    for filename, document in (
        ("channels.json", channels_doc),
        ("agent-sessions.json", sessions_doc),
        ("automations.json", automation_doc),
        ("settings.json", settings_doc),
    ):
        raw_version = document.get("version") if isinstance(document, dict) else None
        versions[filename] = raw_version if isinstance(raw_version, int) and not isinstance(raw_version, bool) else None
    channel_map = {
        str(item.get("id", "")): {
            "name": str(item.get("name", "")),
            "provider": str(item.get("provider", "")),
            "enabled": item.get("enabled") is True,
        }
        for item in channels if item.get("id") is not None
    }
    automation_map = {
        str(item.get("id", "")): {"active": item.get("active") is True}
        for item in automations if item.get("id") is not None
    }
    planning_user_version = None
    db_path = root / "planning.db"
    if db_path.exists():
        try:
            connection = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True, timeout=2)
            try:
                planning_user_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
            finally:
                connection.close()
        except sqlite3.Error as exc:
            errors.append(f"invalid:planning.db:{type(exc).__name__}")
    else:
        errors.append("missing:planning.db")
    return {
        "schema": 1,
        "versions": versions,
        "sessions": {
            "count": len(sessions),
            "ids": sorted(str(item["id"]) for item in sessions if item.get("id") is not None),
        },
        "automations": {"count": len(automations), "by_id": automation_map},
        "channels": {"count": len(channels), "by_id": channel_map},
        "symlinks": count_symlinks(root),
        "planning_user_version": planning_user_version,
        "errors": errors,
    }


def _drop_ids_if_legacy(left: dict[str, Any], right: dict[str, Any]) -> bool:
    """Snapshots written before 2026-10-08 have no sessions.ids; compare such pairs by counts only."""
    ls, rs = left.get("sessions"), right.get("sessions")
    if not isinstance(ls, dict) or not isinstance(rs, dict):
        return False
    if ("ids" in ls) == ("ids" in rs):
        return False
    ls.pop("ids", None)
    rs.pop("ids", None)
    return True


def compare(before: Path, after: Path, allow_draft_cleanup_dir: Path | None = None, since: float | None = None) -> int:
    try:
        left = json.loads(before.read_text(encoding="utf-8"))
        right = json.loads(after.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"SNAPSHOT COMPARE ERROR: {exc}", file=sys.stderr)
        return 2
    legacy_ids = _drop_ids_if_legacy(left, right)
    if left == right:
        print("SNAPSHOT MATCH (legacy snapshot without sessions.ids; compared counts only)" if legacy_ids else "SNAPSHOT MATCH")
        return 0
    if allow_draft_cleanup_dir is not None:
        reason = draft_cleanup_match(left, right, allow_draft_cleanup_dir, since)
        if reason is None:
            before_count = left.get("sessions", {}).get("count", 0)
            after_count = right.get("sessions", {}).get("count", 0)
            print(f"SNAPSHOT MATCH (draft cleanup): removed={before_count - after_count} backups={reason_backups}")
            return 0
        print(f"SNAPSHOT DIFF (draft cleanup rejected): {reason}")
    print("SNAPSHOT DIFF")
    for key in sorted(left.keys() | right.keys()):
        if left.get(key) != right.get(key):
            print(f"{key}: before={json.dumps(left.get(key), ensure_ascii=False, sort_keys=True)} after={json.dumps(right.get(key), ensure_ascii=False, sort_keys=True)}")
    return 1


def draft_cleanup_match(left: dict[str, Any], right: dict[str, Any], backup_dir: Path, since: float | None) -> str | None:
    global reason_backups
    if since is None:
        return "missing --since"
    before_sessions, after_sessions = left.get("sessions"), right.get("sessions")
    if not isinstance(before_sessions, dict) or not isinstance(after_sessions, dict):
        return "session snapshot is invalid"
    before_ids, after_ids = before_sessions.get("ids"), after_sessions.get("ids")
    if not isinstance(before_ids, list) or not isinstance(after_ids, list):
        return "session ID lists are unavailable"
    if any(not isinstance(item, str) for item in before_ids + after_ids):
        return "session ID list contains invalid values"
    old, new = set(before_ids), set(after_ids)
    removed = old - new
    if new - old:
        return "new session IDs appeared"
    if after_sessions.get("count") != before_sessions.get("count", 0) - len(removed):
        return "session count does not match the removed ID set"
    ignored = {"sessions"}
    for key in left.keys() | right.keys():
        if key not in ignored and left.get(key) != right.get(key):
            return f"non-session field changed: {key}"
    if not isinstance(left.get("sessions"), dict) or not isinstance(right.get("sessions"), dict):
        return "session snapshot is invalid"
    for key in left["sessions"].keys() | right["sessions"].keys():
        if key not in {"count", "ids"} and left["sessions"].get(key) != right["sessions"].get(key):
            return f"session field changed beyond count/IDs: {key}"
    backups: list[Path] = []
    backed_ids: set[str] = set()
    try:
        files = sorted(backup_dir.glob("draft-cleanup-*.json"))
        for path in files:
            stamp = path.stat().st_mtime
            # mtime is authoritative; the filename timestamp is a fallback for copied/restored files.
            if stamp <= since:
                import re
                from datetime import datetime, timezone
                match = re.match(r"draft-cleanup-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z", path.name)
                if not match:
                    continue
                parts = [int(x) for x in match.groups()]
                filename_time = datetime(*parts[:6], parts[6] * 1000, tzinfo=timezone.utc).timestamp()
                if filename_time <= since:
                    continue
            payload = json.loads(path.read_text(encoding="utf-8"))
            entries = payload.get("sessions") if isinstance(payload, dict) else payload
            if not isinstance(entries, list) or any(not isinstance(entry, dict) for entry in entries):
                return f"invalid backup format: {path.name}"
            for entry in entries:
                if entry.get("isDraft") is not True:
                    return f"backup contains a non-draft entry: {path.name}"
                if entry.get("id") is None:
                    return f"backup entry has no ID: {path.name}"
                backed_ids.add(str(entry["id"]))
            backups.append(path)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        return f"cannot read draft backup: {type(exc).__name__}"
    if removed != backed_ids:
        return f"removed IDs do not exactly match eligible backup IDs (removed={len(removed)} backed={len(backed_ids)})"
    reason_backups = len(backups)
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_dir", type=Path, nargs="?")
    parser.add_argument("--output", type=Path, help="write snapshot JSON here; DATA_DIR is opened read-only")
    parser.add_argument("--compare", nargs=2, type=Path, metavar=("BEFORE", "AFTER"), help="compare two snapshot JSON files")
    parser.add_argument("--allow-draft-cleanup-dir", type=Path, help="allow only session removals backed by post-since draft-cleanup backups")
    parser.add_argument("--since", type=float, help="Unix timestamp; only newer draft-cleanup backups qualify")
    args = parser.parse_args()
    if args.compare:
        if args.data_dir or args.output:
            parser.error("--compare cannot be combined with DATA_DIR or --output")
        if bool(args.allow_draft_cleanup_dir) != (args.since is not None):
            parser.error("--allow-draft-cleanup-dir and --since must be provided together")
        return compare(*args.compare, args.allow_draft_cleanup_dir, args.since)
    if args.allow_draft_cleanup_dir is not None or args.since is not None:
        parser.error("draft-cleanup comparison options require --compare")
    if args.data_dir is None:
        parser.error("DATA_DIR is required unless --compare is used")
    try:
        result = snapshot(args.data_dir.expanduser().resolve())
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    text = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.expanduser().write_text(text, encoding="utf-8")
    print(text, end="")
    if result["errors"]:
        print("SNAPSHOT WARNINGS: " + ", ".join(result["errors"]), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
