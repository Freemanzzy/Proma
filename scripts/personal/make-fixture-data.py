#!/usr/bin/env python3
"""Create a synthetic, isolated Proma development dataset for Web Remote tests."""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

FIXTURE_NAME = '.proma-dev-fixture'
CHANNEL_ID = 'a0c08014-4065-4d2a-8db5-f27f1eb09ab9'
CHANNEL_NAME = 'clipproxyapi'
CHANNEL_PROVIDER = 'anthropic'
SAFE_STORAGE_PREFIX = b'v10'


def fail(message: str) -> "NoReturn":
    print(f'错误：{message}', file=sys.stderr)
    raise SystemExit(2)


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        fail(f'无法读取 JSON 配置（{path.name}）：{exc}')
    if not isinstance(value, dict):
        fail(f'JSON 根节点格式错误：{path.name}')
    return value


def secure_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    path.chmod(0o600)


def fixture_uuid(label: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f'proma-fixture:{label}'))


def write_jsonl(path: Path, rows: list[dict]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    payload = ''.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n' for row in rows)
    path.write_text(payload, encoding='utf-8')
    path.chmod(0o600)
    return path.stat().st_size


def validate_target(target_arg: str, home: Path) -> Path:
    target = Path(target_arg).expanduser().absolute()
    fixture_target = (home / FIXTURE_NAME).absolute()
    tmp_root = Path('/tmp').resolve()
    if target == fixture_target:
        if target.is_symlink() or target.resolve(strict=False) != fixture_target.resolve(strict=False):
            fail('fixture 目标不能是指向其他位置的符号链接')
    else:
        resolved = target.resolve(strict=False)
        if not resolved.is_relative_to(tmp_root):
            fail(f'目标只允许为 {fixture_target} 或 /tmp 下的目录')
        if target.is_symlink():
            fail('fixture 目标不能是符号链接')
    if target == Path('/') or target == home or target == Path('/tmp'):
        fail('拒绝使用根目录或数据根目录作为 fixture 目标')
    return target


def load_sources(source_root: Path) -> tuple[dict, dict]:
    channels_doc = read_json(source_root / 'channels.json')
    channels = channels_doc.get('channels')
    if not isinstance(channels, list):
        fail('channels.json 缺少 channels 列表')
    matches = [channel for channel in channels if isinstance(channel, dict)
               and channel.get('id') == CHANNEL_ID
               and channel.get('name') == CHANNEL_NAME
               and channel.get('provider') == CHANNEL_PROVIDER]
    if len(matches) != 1:
        fail('dev channels.json 中必须恰有一个 clipproxyapi Anthropic 渠道')
    channel = matches[0]
    encoded = channel.get('apiKey')
    if not isinstance(encoded, str) or not encoded:
        fail('clipproxyapi 渠道没有可复制的 API Key 密文')
    try:
        encrypted = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error):
        fail('clipproxyapi API Key 不是 safeStorage Base64 密文；未复制任何渠道')
    if not encrypted.startswith(SAFE_STORAGE_PREFIX):
        fail('clipproxyapi API Key 缺少 macOS safeStorage v10 标记；未复制任何渠道')

    web_remote = read_json(source_root / 'web-remote' / 'config.json')
    origin = web_remote.get('allowedOrigin')
    logins = web_remote.get('allowedTailscaleLogins')
    if not isinstance(origin, str) or not origin.startswith('https://'):
        fail('dev Web Remote 配置缺少 HTTPS allowedOrigin')
    if not isinstance(logins, list) or not all(isinstance(item, str) for item in logins):
        fail('dev Web Remote 配置缺少 allowedTailscaleLogins 列表')
    trusted = [str(n) for n in (web_remote.get('trustedTailscaleNodes') or []) if isinstance(n, str)]
    return channels_doc, {'allowedOrigin': origin, 'allowedTailscaleLogins': logins, 'trustedTailscaleNodes': trusted, 'channel': channel}


def synthetic_message(session_id: str, role: str, index: int, text: str, now_ms: int) -> dict:
    block_type = 'user' if role == 'user' else 'assistant'
    return {
        'type': block_type,
        'uuid': f'{session_id}-{role}-{index}',
        'timestamp': datetime.fromtimestamp(now_ms / 1000, timezone.utc).isoformat(),
        'message': {'content': [{'type': 'text', 'text': text}]},
        'parent_tool_use_id': None,
    }


def small_history(session_id: str, title: str, now_ms: int) -> list[dict]:
    return [
        synthetic_message(session_id, 'user', 1, f'合成测试消息：{title} 的第一轮问题。', now_ms),
        synthetic_message(session_id, 'assistant', 1, f'这是 {title} 的合成回复，不包含真实用户数据。', now_ms),
        synthetic_message(session_id, 'user', 2, '请总结这段 fixture 对话。', now_ms),
        synthetic_message(session_id, 'assistant', 2, 'fixture 会话已就绪，可用于隔离的界面回归。', now_ms),
    ]


def large_history(session_id: str, now_ms: int) -> list[dict]:
    rows: list[dict] = []
    long_user = '合成的大历史用户文本。用于测试分页、滚动与长会话渲染；内容不是实际用户数据。' * 44
    long_assistant = '合成的大历史助手回复。文本只由 fixture 生成，不包含任何真实会话、密钥或外部文件内容。' * 44
    for turn in range(1, 301):
        rows.append(synthetic_message(session_id, 'user', turn, f'第 {turn} 轮：{long_user}', now_ms + turn * 1000))
        assistant = synthetic_message(session_id, 'assistant', turn, f'第 {turn} 轮答复：{long_assistant}', now_ms + turn * 1000 + 1)
        if turn % 30 == 0:
            tool_id = f'{session_id}-tool-{turn}'
            assistant['message']['content'].append({
                'type': 'tool_use', 'id': tool_id, 'name': 'read',
                'input': {'path': f'/fixture/{turn}.md'},
            })
            rows.append(assistant)
            rows.append({
                'type': 'user', 'uuid': f'{session_id}-tool-result-{turn}',
                'timestamp': datetime.fromtimestamp((now_ms + turn * 1000 + 2) / 1000, timezone.utc).isoformat(),
                'message': {'content': [{'type': 'tool_result', 'tool_use_id': tool_id,
                                         'content': f'合成工具结果 {turn}：fixture-only'}]},
                'parent_tool_use_id': None,
            })
        else:
            rows.append(assistant)
    return rows


def build_dataset(root: Path, sources: dict, secret: dict) -> tuple[int, int]:
    root.mkdir(mode=0o700)
    os.chmod(root, 0o700)
    now = int(datetime.now(timezone.utc).timestamp() * 1000)
    old = now - 48 * 60 * 60 * 1000
    channel = secret['channel']
    workspace_rows = [
        {'id': 'fixture-a', 'name': 'Fixture A', 'slug': 'default', 'createdAt': now, 'updatedAt': now},
        {'id': 'fixture-b', 'name': 'Fixture B', 'slug': 'fixture-b', 'createdAt': now, 'updatedAt': now},
    ]
    secure_json(root / 'agent-workspaces.json', {'version': 2, 'workspaces': workspace_rows})
    workspace_root = root / 'agent-workspaces'
    workspace_root.mkdir(mode=0o700)
    for workspace in workspace_rows:
        workspace_dir = workspace_root / workspace['slug']
        workspace_dir.mkdir(mode=0o700)
        files_dir = workspace_dir / 'workspace-files'
        files_dir.mkdir(mode=0o700)
        agents_file = files_dir / 'AGENTS.md'
        agents_file.write_text(f'# {workspace["name"]} synthetic fixture\n\n仅用于隔离的 Web Remote 界面回归，不包含真实项目资料。\n', encoding='utf-8')
        agents_file.chmod(0o600)
    skill_dir = workspace_root / 'default' / 'skills' / 'fixture-skill'
    skill_dir.mkdir(parents=True, mode=0o700)
    skill_file = skill_dir / 'SKILL.md'
    skill_file.write_text('# Fixture Skill\n\n合成技能，仅用于测试技能详情视图。\n', encoding='utf-8')
    skill_file.chmod(0o600)

    sessions: list[dict] = []
    definitions: list[tuple[str, str, str, dict, list[dict], int]] = []
    for i in range(1, 12):
        sid = fixture_uuid(f'regular-{i:02d}')
        ws = 'fixture-a' if i <= 6 else 'fixture-b'
        title = f'Fixture {"A" if ws == "fixture-a" else "B"} / 普通会话 {i:02d}'
        definitions.append((sid, title, ws, {}, small_history(sid, title, now), now))

    parent_id = fixture_uuid('parent')
    definitions.append((parent_id, 'Fixture A / 父会话', 'fixture-a',
                        {'rootSessionId': parent_id}, small_history(parent_id, '委派父会话', now), now))
    for suffix in ('one', 'two'):
        sid = fixture_uuid(f'child-{suffix}')
        definitions.append((sid, f'Fixture A / 子会话 {suffix}', 'fixture-a',
                            {'parentSessionId': parent_id, 'rootSessionId': parent_id,
                             'sourceDelegationId': f'fixture-delegation-{suffix}', 'delegationStatus': 'completed'},
                            small_history(sid, '委派子会话', now), now))

    automation_session_id = fixture_uuid('automation-session')
    definitions.append((automation_session_id, 'Fixture B / Automation 生成会话', 'fixture-b',
                        {'sourceAutomationId': 'fixture-automation-daily'},
                        small_history(automation_session_id, 'Automation 生成会话', now), now))
    for i in (1, 2):
        sid = fixture_uuid(f'archived-{i}')
        definitions.append((sid, f'Fixture B / 已归档会话 {i}', 'fixture-b', {'archived': True},
                            small_history(sid, '已归档会话', now), now))
    pinned_id = fixture_uuid('pinned')
    definitions.append((pinned_id, 'Fixture A / 置顶会话', 'fixture-a', {'pinned': True},
                        small_history(pinned_id, '置顶会话', now), now))
    draft_id = fixture_uuid('draft')
    definitions.append((draft_id, '新 Agent 会话', 'fixture-b', {'isDraft': True},
                        [], old))
    large_id = fixture_uuid('large-history')
    definitions.append((large_id, 'Fixture A / 合成大历史（300 轮）', 'fixture-a', {},
                        large_history(large_id, now), now))

    large_jsonl_bytes = 0
    for sid, title, workspace_id, flags, messages, created_at in definitions:
        updated = created_at if created_at == old else now
        meta = {'id': sid, 'title': title, 'workspaceId': workspace_id,
                'createdAt': created_at, 'updatedAt': updated, 'channelId': channel['id'], **flags}
        sessions.append(meta)
        # Every indexed session has a JSONL file; the old draft is intentionally zero-byte for cleanup eligibility.
        message_bytes = write_jsonl(root / 'agent-sessions' / f'{sid}.jsonl', messages)
        if sid == large_id:
            large_jsonl_bytes = message_bytes

    secure_json(root / 'agent-sessions.json', {'version': 2, 'sessions': sessions})
    inactive_automation = {
        'id': 'fixture-automation-daily', 'name': 'Fixture：停用的每日任务',
        'prompt': '合成 fixture 任务；active=false，禁止调度执行。', 'active': False,
        'scheduleType': 'daily', 'intervalMinutes': 1440, 'timeOfDay': '12:00',
        'channelId': channel['id'], 'workspaceId': 'fixture-a', 'createdAt': now,
        'updatedAt': now, 'nextRunAt': now + 24 * 60 * 60 * 1000, 'runHistory': [],
    }
    paused_automation = {**inactive_automation, 'id': 'fixture-automation-weekly',
                         'name': 'Fixture：停用的每周任务', 'scheduleType': 'weekly',
                         'dayOfWeek': 1, 'workspaceId': 'fixture-b'}
    secure_json(root / 'automations.json', {'version': 4, 'automations': [inactive_automation, paused_automation]})
    # Skip first-run onboarding so the fixture opens the product surface tested by mobile-harness.
    secure_json(root / 'settings.json', {'onboardingCompleted': True, 'onboardingVersion': 2, 'agentWorkspaceId': 'fixture-a'})

    source_channels = sources
    fixture_channels = {'version': source_channels.get('version', 1), 'channels': [channel]}
    if 'appliedPresetModelUpdates' in source_channels:
        fixture_channels['appliedPresetModelUpdates'] = source_channels['appliedPresetModelUpdates']
    secure_json(root / 'channels.json', fixture_channels)

    web_config = {
        'enabled': True, 'fullUi': True, 'port': 17889,
        'allowedOrigin': secret['allowedOrigin'],
        'allowedTailscaleLogins': secret['allowedTailscaleLogins'],
        # 沿用 dev 实例的受信 Tailscale 设备（仅设备名，非密钥），用户的测试手机免配对码。
        'trustedTailscaleNodes': secret['trustedTailscaleNodes'],
        'workspaceScope': 'allowlist', 'allowedWorkspaceIds': ['fixture-a', 'fixture-b'],
    }
    secure_json(root / 'web-remote' / 'config.json', web_config)
    return len(sessions), large_jsonl_bytes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target_dir', help=f'只允许 ~/ {FIXTURE_NAME} 或 /tmp 下目录')
    parser.add_argument('--source-dev-data-dir', type=Path, default=Path.home() / '.proma-dev',
                        help=argparse.SUPPRESS)
    args = parser.parse_args()

    home = Path.home().resolve()
    target = validate_target(args.target_dir, home)
    source_root = args.source_dev_data_dir.expanduser().resolve()
    # Validate both the only permitted channel and Web Remote authorization before moving an existing target.
    source_channels, source_secret = load_sources(source_root)

    backup: Path | None = None
    if target.exists():
        if not target.is_dir():
            fail('已存在的 fixture 目标不是目录；拒绝改名或覆盖')
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        backup = target.with_name(f'{target.name}.prev-{stamp}')
        suffix = 1
        while backup.exists():
            backup = target.with_name(f'{target.name}.prev-{stamp}-{suffix}')
            suffix += 1
        os.rename(target, backup)

    staging = target.with_name(f'{target.name}.tmp-{uuid.uuid4().hex}')
    try:
        session_count, large_bytes = build_dataset(staging, source_channels, source_secret)
        os.rename(staging, target)
    except Exception as exc:
        fail(f'fixture 生成失败；保留旧目录与临时产物以便检查：{exc}')

    print(f'fixture 生成完成：{target}')
    if backup:
        print(f'旧目标已保留：{backup}')
    print(f'工作区：2；会话：{session_count}（普通 11、委派 3、Automation 来源 1、归档 2、置顶 1、草稿 1、大历史 1）；停用 Automation：2；渠道：1（clipproxyapi）')
    print(f'大历史：300 轮；JSONL {large_bytes:,} B')
    print(f"Web Remote：17889；允许工作区 2；受信设备沿用 dev（{len(source_secret['trustedTailscaleNodes'])} 台）；配对设备/推送订阅未复制")


if __name__ == '__main__':
    main()
