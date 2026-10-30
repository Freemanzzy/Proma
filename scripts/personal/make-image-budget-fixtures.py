#!/usr/bin/env python3
"""Create six deterministic 1536x1024 RGB-noise PNGs for the image-budget harness."""
from __future__ import annotations

import random
import struct
import sys
import tempfile
import zlib
from pathlib import Path

WIDTH, HEIGHT = 1536, 1024


def chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload) & 0xFFFFFFFF)


def make_png(seed: int) -> bytes:
    rng = random.Random(seed)
    raw = bytearray()
    for _ in range(HEIGHT):
        raw.append(0)  # PNG filter: None
        raw.extend((rng.randrange(64) * 4 for _ in range(WIDTH * 3)))
    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>2I5B', WIDTH, HEIGHT, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(bytes(raw), level=6))
        + chunk(b'IEND', b'')
    )


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit('必须传入本轮 harness 创建的临时目录')
    target = Path(sys.argv[1]).resolve()
    if target.parent != Path(tempfile.gettempdir()).resolve() or not target.name.startswith('proma-image-budget-'):
        raise SystemExit('拒绝写入 harness 专用临时目录以外的位置')
    target.mkdir(parents=True, exist_ok=True)
    for index in range(1, 7):
        path = target / f'image-{index}.png'
        data = make_png(20261031 + index)
        path.write_bytes(data)
        print(f'{path.name} {len(data)} bytes')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
