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
        "sessions": {"count": len(sessions)},
        "automations": {"count": len(automations), "by_id": automation_map},
        "channels": {"count": len(channels), "by_id": channel_map},
        "symlinks": count_symlinks(root),
        "planning_user_version": planning_user_version,
        "errors": errors,
    }


def compare(before: Path, after: Path) -> int:
    try:
        left = json.loads(before.read_text(encoding="utf-8"))
        right = json.loads(after.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"SNAPSHOT COMPARE ERROR: {exc}", file=sys.stderr)
        return 2
    if left == right:
        print("SNAPSHOT MATCH")
        return 0
    print("SNAPSHOT DIFF")
    for key in sorted(left.keys() | right.keys()):
        if left.get(key) != right.get(key):
            print(f"{key}: before={json.dumps(left.get(key), ensure_ascii=False, sort_keys=True)} after={json.dumps(right.get(key), ensure_ascii=False, sort_keys=True)}")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_dir", type=Path, nargs="?")
    parser.add_argument("--output", type=Path, help="write snapshot JSON here; DATA_DIR is opened read-only")
    parser.add_argument("--compare", nargs=2, type=Path, metavar=("BEFORE", "AFTER"), help="compare two snapshot JSON files")
    args = parser.parse_args()
    if args.compare:
        if args.data_dir or args.output:
            parser.error("--compare cannot be combined with DATA_DIR or --output")
        return compare(*args.compare)
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
