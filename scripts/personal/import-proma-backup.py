#!/usr/bin/env python3
"""Import a Proma backup into an isolated development data directory.

The importer never reads from or writes to the official ~/.proma directory.  It
only consumes the supplied backup archive and writes an isolated target.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from typing import Any
import zipfile

MAX_REWRITE_BYTES = 50 * 1024 * 1024
TEXT_SUFFIXES = {
    ".json", ".jsonl", ".md", ".txt", ".yaml", ".yml", ".sh", ".py",
    ".mjs", ".js", ".ts", ".tsx", ".jsx", ".toml", ".ini", ".cfg",
    ".conf", ".xml", ".html", ".css", ".scss", ".env", ".csv",
}
EXCLUDED_FILES = {"cloud-auth.json", "sync-state.json"}
EXCLUDED_DIRS = {"logs", "fc-bridge", "fc-bridge-group"}
KNOWN_CONFIGS = {"automations.json", "feishu.json", "wechat.json", "settings.json"}
OTHER_BRIDGE_CONFIGS = {"dingtalk.json", "slack.json"}


def fail(message: str) -> "NoReturn":
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", required=True, type=Path, help="Proma backup zip")
    parser.add_argument("--target", type=Path, default=Path.home() / ".proma-dev")
    parser.add_argument("--replace", action="store_true", help="rename a non-empty target to target.bak-<timestamp>")
    parser.add_argument("--dry-run", action="store_true", help="print actions and statistics without writing")
    parser.add_argument("--verify-only", action="store_true", help="verify an existing target without importing")
    return parser.parse_args()


def resolved_target(raw: Path) -> Path:
    target = raw.expanduser().resolve(strict=False)
    official = (Path.home() / ".proma").resolve(strict=False)
    try:
        target.relative_to(official)
    except ValueError:
        return target
    fail(f"拒绝使用官方数据目录或其子目录作为 target: {target}")


def personal_dev_running() -> list[tuple[str, str]]:
    try:
        result = subprocess.run(
            ["ps", "-axo", "pid=,command="],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        fail(f"无法检查开发版进程: {exc}")
    matches: list[tuple[str, str]] = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line or "proma-personal/node_modules/electron" not in line:
            continue
        # Ignore a shell/grep probe that merely contains the safety-check pattern;
        # an actual Electron executable is not a grep/awk/sleep/import command.
        if any(marker in line for marker in ("grep", "awk", "sleep ", "import-proma-backup")):
            continue
        fields = line.split(None, 1)
        matches.append((fields[0], fields[1] if len(fields) > 1 else ""))
    return matches


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def path_parts(name: str) -> tuple[str, ...]:
    return tuple(part for part in Path(name).parts if part not in ("", "."))


def is_workspace_files(parts: tuple[str, ...]) -> bool:
    return len(parts) >= 3 and parts[0] == "agent-workspaces" and parts[2] == "workspace-files"


def region_for(parts: tuple[str, ...]) -> str:
    if not parts:
        return "root-config"
    if parts[0] == "agent-workspaces":
        return "agent-workspaces"
    if len(parts) == 1:
        return "root-config"
    return parts[0]


def excluded_reason(parts: tuple[str, ...]) -> str | None:
    if not parts:
        return None
    if parts[-1] in EXCLUDED_FILES:
        return parts[-1]
    if any(part in EXCLUDED_DIRS for part in parts):
        return next(part for part in parts if part in EXCLUDED_DIRS)
    if any(".bak" in part for part in parts):
        return "filename-contains-.bak"
    return None


def replacement_pattern() -> re.Pattern[str]:
    home = re.escape(str(Path.home()))
    # The negative lookahead protects existing .proma-dev/.proma-personal paths.
    return re.compile(
        rf"(?:{home}/\.proma|~/\.proma|\$HOME/\.proma|<HOME>/\.proma)(?![-A-Za-z0-9])"
    )


def active_automations(data: Any) -> list[dict[str, str]]:
    if not isinstance(data, dict) or not isinstance(data.get("automations"), list):
        return []
    result = []
    for item in data["automations"]:
        if isinstance(item, dict) and item.get("active") is True:
            result.append({"id": str(item.get("id", "")), "name": str(item.get("name", ""))})
    return result


def disable_json_config(name: str, data: Any, disabled: list[dict[str, Any]]) -> tuple[Any, list[dict[str, str]]]:
    actions: list[dict[str, str]] = []
    if name == "automations.json" and isinstance(data, dict) and isinstance(data.get("automations"), list):
        before = active_automations(data)
        for item in data["automations"]:
            if isinstance(item, dict) and item.get("active") is not False:
                item["active"] = False
        disabled.append({"file": name, "action": "all automation active=false", "count": len(data["automations"])})
        actions.append({"file": name, "action": "all automation active=false", "count": str(len(data["automations"]))})
        return data, actions
    if name == "feishu.json" and isinstance(data, dict) and isinstance(data.get("bots"), list):
        count = 0
        for bot in data["bots"]:
            if isinstance(bot, dict) and bot.get("enabled") is not False:
                bot["enabled"] = False
                count += 1
        disabled.append({"file": name, "action": "bots[].enabled=false", "count": count})
        actions.append({"file": name, "action": "bots[].enabled=false", "count": str(count)})
        return data, actions
    if name == "wechat.json" and isinstance(data, dict):
        was_enabled = data.get("enabled") is True
        data["enabled"] = False
        disabled.append({"file": name, "action": "enabled=false", "count": int(was_enabled)})
        actions.append({"file": name, "action": "enabled=false", "count": str(int(was_enabled))})
        return data, actions
    if name == "settings.json" and isinstance(data, dict):
        mirror = data.get("feishuSessionMirror")
        if isinstance(mirror, dict):
            mirror["mode"] = "off"
            disabled.append({"file": name, "action": "feishuSessionMirror.mode=off", "count": 1})
            actions.append({"file": name, "action": "feishuSessionMirror.mode=off", "count": "1"})
        elif "feishuSessionMirror" in data:
            del data["feishuSessionMirror"]
            disabled.append({"file": name, "action": "remove feishuSessionMirror", "count": 1})
            actions.append({"file": name, "action": "remove feishuSessionMirror", "count": "1"})
        return data, actions
    if name in OTHER_BRIDGE_CONFIGS and isinstance(data, dict):
        count = 0
        if "enabled" in data:
            data["enabled"] = False
            count += 1
        if isinstance(data.get("bots"), list):
            for bot in data["bots"]:
                if isinstance(bot, dict) and bot.get("enabled") is not False:
                    bot["enabled"] = False
                    count += 1
        if count:
            disabled.append({"file": name, "action": "external bridge disabled", "count": count})
            actions.append({"file": name, "action": "external bridge disabled", "count": str(count)})
    return data, actions


def should_rewrite_path(parts: tuple[str, ...]) -> bool:
    return not is_workspace_files(parts)


def rewrite_planning_db(db_path: Path, target: Path, pattern: re.Pattern[str], stats: dict[str, Any]) -> None:
    """Rewrite path-bearing text values in the copied SQLite planning database.

    SQLite is a binary container, so it is not handled by the text-file pass.
    The imported copy is opened and only string columns are updated; the
    official database is never opened by this function.
    """
    if not db_path.is_file():
        return
    replacements = 0
    try:
        connection = sqlite3.connect(str(db_path))
        connection.execute("PRAGMA foreign_keys=ON")
        tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        for table in tables:
            columns = connection.execute(f'PRAGMA table_info("{table.replace(chr(34), chr(34) * 2)}")').fetchall()
            for column in columns:
                column_name = column[1]
                quoted_table = '"' + table.replace('"', '""') + '"'
                quoted_column = '"' + column_name.replace('"', '""') + '"'
                try:
                    rows = connection.execute(
                        f"SELECT rowid, {quoted_column} FROM {quoted_table} WHERE typeof({quoted_column})='text'"
                    ).fetchall()
                except sqlite3.OperationalError:
                    continue
                for rowid, value in rows:
                    if not isinstance(value, str):
                        continue
                    updated, count = pattern.subn(str(target), value)
                    if count:
                        connection.execute(
                            f"UPDATE {quoted_table} SET {quoted_column}=? WHERE rowid=?",
                            (updated, rowid),
                        )
                        replacements += count
        connection.commit()
        try:
            connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except sqlite3.DatabaseError:
            pass
        connection.close()
    except sqlite3.DatabaseError as exc:
        fail(f"无法安全处理导入副本 planning.db: {exc}")
    if replacements:
        stats["path_replacements"] += replacements
        stats["rewritten_files"] += 1
        bucket = stats["regions"].setdefault("root-config", {"files": 0, "replacements": 0})
        bucket["files"] += 1
        bucket["replacements"] += replacements


def format_stats(stats: dict[str, Any]) -> None:
    print(f"archive_files={stats['archive_files']}")
    print(f"copied_files={stats['copied_files']}")
    print(f"excluded_files={stats['excluded_files']}")
    print(f"rewritten_files={stats['rewritten_files']}")
    print(f"path_replacements={stats['path_replacements']}")
    print(f"skipped_over_50mb={stats['skipped_over_50mb']}")
    print(f"skipped_non_utf8={stats['skipped_non_utf8']}")
    print("rewrite_regions:")
    for region, values in sorted(stats["regions"].items()):
        print(f"  {region}: files={values['files']} replacements={values['replacements']}")


def is_file_info(info: zipfile.ZipInfo) -> bool:
    return not info.is_dir() and not info.filename.endswith("/")


def json_name_for(parts: tuple[str, ...]) -> str | None:
    if len(parts) != 1:
        return None
    return parts[0] if parts[0] in KNOWN_CONFIGS | OTHER_BRIDGE_CONFIGS else None


def import_backup(zip_path: Path, target: Path, replace: bool, dry_run: bool) -> dict[str, Any]:
    if not zip_path.is_file():
        fail(f"备份 zip 不存在: {zip_path}")
    digest = sha256_file(zip_path)
    stats: dict[str, Any] = {
        "archive_files": 0, "copied_files": 0, "excluded_files": 0,
        "rewritten_files": 0, "path_replacements": 0,
        "skipped_over_50mb": 0, "skipped_non_utf8": 0,
        "skipped_files": {"over_50mb": [], "non_utf8": []},
        "regions": {}, "excluded_by_reason": {},
    }
    active_before: list[dict[str, str]] = []
    disabled: list[dict[str, Any]] = []
    pattern = replacement_pattern()
    destination = target
    temp_dir: Path | None = None
    if not dry_run:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and (not target.is_dir() or any(target.iterdir())):
            if not replace:
                fail(f"target 已存在且非空，需显式传入 --replace: {target}")
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            backup_target = target.with_name(f"{target.name}.bak-{stamp}")
            suffix = 1
            while backup_target.exists():
                backup_target = target.with_name(f"{target.name}.bak-{stamp}-{suffix}")
                suffix += 1
            print(f"ACTION rename existing target -> {backup_target}")
            target.rename(backup_target)
        elif target.exists() and target.is_dir():
            target.rmdir()
        temp_dir = Path(tempfile.mkdtemp(prefix=f".{target.name}.import-", dir=target.parent))
        destination = temp_dir
    print(f"ACTION import {zip_path} -> {target}{' (dry-run)' if dry_run else ''}")
    try:
        with zipfile.ZipFile(zip_path) as archive:
            infos = [info for info in archive.infolist() if is_file_info(info)]
            stats["archive_files"] = len(infos)
            for info in infos:
                parts = path_parts(info.filename)
                if not parts:
                    continue
                reason = excluded_reason(parts)
                if reason:
                    stats["excluded_files"] += 1
                    stats["excluded_by_reason"][reason] = stats["excluded_by_reason"].get(reason, 0) + 1
                    continue
                raw = archive.read(info)
                output = raw
                path_replacements = 0
                if should_rewrite_path(parts):
                    if info.file_size > MAX_REWRITE_BYTES:
                        stats["skipped_over_50mb"] += 1
                        stats["skipped_files"]["over_50mb"].append(info.filename)
                    else:
                        suffix = Path(parts[-1]).suffix.lower()
                        extensionless_sdk_file = not suffix and parts[0] == "sdk-config"
                        if suffix in TEXT_SUFFIXES or extensionless_sdk_file:
                            try:
                                text = raw.decode("utf-8")
                            except UnicodeDecodeError:
                                stats["skipped_non_utf8"] += 1
                                stats["skipped_files"]["non_utf8"].append(info.filename)
                            else:
                                text, path_replacements = pattern.subn(str(target), text)
                                output = text.encode("utf-8")
                    # Binary files are copied unchanged.
                name = json_name_for(parts)
                actions: list[dict[str, str]] = []
                if name and info.file_size <= MAX_REWRITE_BYTES:
                    try:
                        data = json.loads(output.decode("utf-8"))
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        if name in KNOWN_CONFIGS:
                            fail(f"无法解析配置文件 {info.filename}")
                    else:
                        before = active_automations(data) if name == "automations.json" else []
                        if before:
                            active_before.extend(before)
                        data, actions = disable_json_config(name, data, disabled)
                        if actions:
                            output = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
                if path_replacements:
                    stats["rewritten_files"] += 1
                    stats["path_replacements"] += path_replacements
                    region = region_for(parts)
                    bucket = stats["regions"].setdefault(region, {"files": 0, "replacements": 0})
                    bucket["files"] += 1
                    bucket["replacements"] += path_replacements
                stats["copied_files"] += 1
                if not dry_run and temp_dir is not None:
                    output_path = temp_dir.joinpath(*parts)
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    output_path.write_bytes(output)
        if not dry_run and temp_dir is not None:
            rewrite_planning_db(temp_dir / "planning.db", target, pattern, stats)
        stats["active_before"] = active_before
        stats["disabled"] = disabled
        stats["other_bridge_configs_checked"] = sorted(OTHER_BRIDGE_CONFIGS)
        stats["source_sha256"] = digest
        if not dry_run and temp_dir is not None:
            migration = temp_dir / ".personal-migration"
            migration.mkdir(parents=True, exist_ok=True)
            (migration / "automations-active-before.json").write_text(
                json.dumps(active_before, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            manifest = {
                "source_zip_sha256": digest,
                "imported_at": datetime.now(timezone.utc).isoformat(),
                "target": str(target),
                "excluded": {"files": sorted(EXCLUDED_FILES), "directories": sorted(EXCLUDED_DIRS), "filename_contains": ".bak", "counts": stats["excluded_by_reason"]},
                "rewrite": {"pattern": "official .proma paths outside agent-workspaces/*/workspace-files", "target": str(target), "files": stats["rewritten_files"], "replacements": stats["path_replacements"], "regions": stats["regions"]},
                "disabled": disabled,
                "active_automations_before": active_before,
                "other_bridge_configs_checked": sorted(OTHER_BRIDGE_CONFIGS),
                "skipped": {"over_50mb": stats["skipped_over_50mb"], "non_utf8": stats["skipped_non_utf8"], "files": stats["skipped_files"]},
                "archive_files": stats["archive_files"],
                "copied_files": stats["copied_files"],
            }
            (migration / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            temp_dir.rename(target)
            temp_dir = None
        return stats
    finally:
        if temp_dir is not None:
            shutil.rmtree(temp_dir, ignore_errors=True)


def verify_target(target: Path) -> int:
    checks: list[tuple[str, bool, str]] = []
    official = str(Path.home() / ".proma")
    residual_patterns = [
        re.compile(re.escape(official.encode()) + rb"(?![-A-Za-z0-9])"),
        re.compile(rb"~\\/.proma(?![-A-Za-z0-9])"),
        re.compile(rb"\\$HOME\\/.proma(?![-A-Za-z0-9])"),
        re.compile(rb"<HOME>\\/.proma(?![-A-Za-z0-9])"),
    ]
    skipped_files: set[str] = set()
    try:
        migration = json.loads((target / ".personal-migration" / "manifest.json").read_text(encoding="utf-8"))
        skipped = migration.get("skipped", {}).get("files", {})
        skipped_files.update(str(item) for item in skipped.get("over_50mb", []))
        skipped_files.update(str(item) for item in skipped.get("non_utf8", []))
    except (OSError, ValueError, AttributeError):
        pass
    residuals: list[str] = []
    if target.is_dir():
        for path in target.rglob("*"):
            if not path.is_file():
                continue
            relative = path.relative_to(target)
            relative_name = str(relative)
            if relative_name in skipped_files:
                continue
            relative_parts = path_parts(relative_name)
            if is_workspace_files(relative_parts):
                continue
            if path.name == "planning.db":
                # SQLite text values are rewritten through sqlite3 during import.
                continue
            suffix = path.suffix.lower()
            extensionless_sdk_file = not suffix and relative_parts and relative_parts[0] == "sdk-config"
            if suffix not in TEXT_SUFFIXES and not extensionless_sdk_file:
                continue
            try:
                with path.open("rb") as handle:
                    data = handle.read()
            except OSError:
                continue
            if any(pattern.search(data) for pattern in residual_patterns):
                residuals.append(str(relative))
    checks.append(("no official .proma residual outside workspace-files", not residuals, ", ".join(residuals[:8])))
    automations_ok = False
    automation_detail = "missing or invalid"
    try:
        data = json.loads((target / "automations.json").read_text(encoding="utf-8"))
        tasks = data.get("automations", [])
        active = [str(item.get("name", item.get("id", ""))) for item in tasks if isinstance(item, dict) and item.get("active") is True]
        automations_ok = not active
        automation_detail = f"total={len(tasks)} active={len(active)}" if not active else ", ".join(active[:8])
    except (OSError, ValueError, AttributeError):
        pass
    checks.append(("all automations inactive", automations_ok, automation_detail))
    feishu_ok = False
    feishu_detail = "missing or invalid"
    try:
        data = json.loads((target / "feishu.json").read_text(encoding="utf-8"))
        bots = data.get("bots", [])
        enabled = [str(item.get("name", item.get("id", ""))) for item in bots if isinstance(item, dict) and item.get("enabled") is True]
        feishu_ok = not enabled
        feishu_detail = f"bots={len(bots)} enabled={len(enabled)}" if not enabled else ", ".join(enabled[:8])
    except (OSError, ValueError, AttributeError):
        pass
    checks.append(("feishu bots disabled", feishu_ok, feishu_detail))
    wechat_ok = False
    wechat_detail = "missing or invalid"
    try:
        data = json.loads((target / "wechat.json").read_text(encoding="utf-8"))
        wechat_ok = data.get("enabled") is False
        wechat_detail = f"enabled={data.get('enabled')!r}"
    except (OSError, ValueError, AttributeError):
        pass
    checks.append(("wechat disabled", wechat_ok, wechat_detail))
    excluded_paths = []
    for path in target.rglob("*") if target.is_dir() else []:
        relative = path.relative_to(target)
        if excluded_reason(path_parts(str(relative))):
            excluded_paths.append(str(relative))
    checks.append(("excluded items absent", not excluded_paths, ", ".join(excluded_paths[:8])))
    settings_ok = False
    settings_detail = "missing or invalid"
    try:
        data = json.loads((target / "settings.json").read_text(encoding="utf-8"))
        mirror = data.get("feishuSessionMirror")
        settings_ok = mirror is None or (isinstance(mirror, dict) and mirror.get("mode") == "off")
        settings_detail = f"feishuSessionMirror={mirror.get('mode')!r}" if isinstance(mirror, dict) else "key removed"
    except (OSError, ValueError, AttributeError):
        pass
    checks.append(("feishuSessionMirror off", settings_ok, settings_detail))
    for label, ok, detail in checks:
        print(f"{'PASS' if ok else 'FAIL'} {label}" + (f" ({detail})" if detail else ""))
    return 0 if all(ok for _, ok, _ in checks) else 1


def main() -> int:
    args = parse_args()
    target = resolved_target(args.target)
    running = personal_dev_running()
    if running:
        fail("检测到开发版 Electron 进程正在运行，导入/验证已拒绝: " + "; ".join(pid for pid, _ in running))
    if args.verify_only:
        if not target.is_dir():
            fail(f"target 不存在: {target}")
        print(f"VERIFY target={target}")
        return verify_target(target)
    stats = import_backup(args.zip.expanduser().resolve(), target, args.replace, args.dry_run)
    format_stats(stats)
    if args.dry_run:
        print("DRY-RUN no files written")
    else:
        print(f"IMPORTED target={target}")
    return 0


if __name__ == "__main__":
    main()
