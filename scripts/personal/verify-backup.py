#!/usr/bin/env python3
"""Compare a Proma data directory with a directory or zip backup."""
from __future__ import annotations
import argparse
import fnmatch
import hashlib
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import zipfile

CHUNK = 1024 * 1024

def digest_stream(handle):
    digest = hashlib.sha256(); size = 0
    while True:
        block = handle.read(CHUNK)
        if not block: break
        size += len(block); digest.update(block)
    return size, digest.hexdigest()

def excluded(name: str, rules: list[str]) -> bool:
    return any(fnmatch.fnmatchcase(name, rule) or PurePosixPath(name).match(rule) for rule in rules)

def source_entries(root: Path, rules: list[str]):
    result = {}
    seen = 0
    for base, dirs, files in os.walk(root, followlinks=False):
        base_path = Path(base)
        dirs[:] = sorted(d for d in dirs if not excluded((base_path / d).relative_to(root).as_posix(), rules))
        for name in sorted(dirs + files):
            path = base_path / name
            rel = path.relative_to(root).as_posix()
            if excluded(rel, rules): continue
            seen += 1
            if seen % 1000 == 0: print(f'进度: 已校验 {seen} 条目（{root.name}）', file=sys.stderr)
            try: st = path.lstat()
            except OSError as exc:
                result[rel] = ('error', str(exc)); continue
            mode = stat.S_IMODE(st.st_mode)
            if stat.S_ISLNK(st.st_mode):
                result[rel] = ('link', os.readlink(path))
            elif stat.S_ISREG(st.st_mode):
                with path.open('rb') as f: size, sha = digest_stream(f)
                result[rel] = ('file', size, sha, mode)
            elif stat.S_ISDIR(st.st_mode):
                result[rel] = ('dir', mode)
    if seen and seen % 1000 != 0: print(f'进度: 已校验 {seen} 条目（{root.name}）', file=sys.stderr)
    return result

def zip_entries(path: Path, rules: list[str]):
    result = {}
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        total = len(infos)
        for i, info in enumerate(infos, 1):
            rel = info.filename.rstrip('/')
            if not rel or excluded(rel, rules): continue
            mode = (info.external_attr >> 16) & 0o7777
            kind = stat.S_IFMT(info.external_attr >> 16)
            if info.is_dir() or info.filename.endswith('/'):
                result[rel] = ('dir', mode)
            elif kind == stat.S_IFLNK:
                with archive.open(info) as f: target = f.read().decode('utf-8', errors='surrogateescape')
                result[rel] = ('link', target)
            else:
                with archive.open(info) as f: size, sha = digest_stream(f)
                result[rel] = ('file', size, sha, mode)
            if i % 1000 == 0 or i == total: print(f'进度: {i}/{total} 条目', file=sys.stderr)
    return result

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('src', type=Path)
    p.add_argument('backup', type=Path)
    p.add_argument('--exclude', action='append', default=[], help='glob pattern to exclude (repeatable)')
    args = p.parse_args()
    src = args.src.expanduser().resolve(); backup = args.backup.expanduser().resolve()
    if not src.is_dir(): p.error(f'SRC is not a directory: {src}')
    if not backup.exists(): p.error(f'BACKUP does not exist: {backup}')
    expected = source_entries(src, args.exclude)
    actual = zip_entries(backup, args.exclude) if zipfile.is_zipfile(backup) else source_entries(backup, args.exclude)
    missing = sorted(expected.keys() - actual.keys()); extra = sorted(actual.keys() - expected.keys())
    mismatches = []
    for name in sorted(expected.keys() & actual.keys()):
        if expected[name] != actual[name]: mismatches.append((name, expected[name], actual[name]))
    print(f'source_entries={len(expected)} backup_entries={len(actual)} missing={len(missing)} extra={len(extra)} mismatched={len(mismatches)}')
    for name in missing[:100]: print(f'MISSING {name}')
    for name in extra[:100]: print(f'EXTRA {name}')
    for name, left, right in mismatches[:100]: print(f'DIFF {name}\n  SRC: {left}\n  BACKUP: {right}')
    if len(missing) + len(extra) + len(mismatches) > 100: print('DIFF OUTPUT TRUNCATED at 100 items')
    if missing or extra or mismatches:
        return 1
    print('BACKUP VERIFY PASS')
    return 0
if __name__ == '__main__': raise SystemExit(main())
