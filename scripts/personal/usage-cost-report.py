#!/usr/bin/env python3
"""Read-only token, cache and relative-cost report for local Proma sessions."""
from __future__ import annotations
import argparse
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path
from collections import defaultdict

CACHE_REBUILD_MIN_TOKENS = 300_000
COST_WEIGHTS = {'input': 1.0, 'cacheWrite': 1.25, 'cacheRead': 0.1, 'output': 5.0}
# 这是按 Anthropic 官方价格比例折算的相对指数，不是账单；订阅渠道不产生按量费用。
COST_NOTE = '这是按 Anthropic 官方价格比例折算的相对指数，不是账单；订阅渠道不产生按量费用。'
FIELDS = ('requests', 'requestsWithoutUsage', 'input', 'output', 'cacheRead', 'cacheWrite', 'largeCacheRebuilds', 'relativeCostIndex')
ALIASES = {
    'input': ('input_tokens', 'inputTokens', 'prompt_tokens'),
    'output': ('output_tokens', 'outputTokens', 'completion_tokens'),
    'cacheRead': ('cache_read_input_tokens', 'cacheReadInputTokens', 'cached_tokens'),
    'cacheWrite': ('cache_creation_input_tokens', 'cacheCreationInputTokens', 'cache_creation_tokens'),
}


def number(value):
    try:
        return max(0, int(value or 0))
    except (ValueError, TypeError, OverflowError):
        return 0


def usage_values(usage):
    usage = usage if isinstance(usage, dict) else {}
    details = usage.get('prompt_tokens_details') or usage.get('input_tokens_details') or {}
    result = {}
    for key, aliases in ALIASES.items():
        val = next((usage[name] for name in aliases if name in usage), None)
        if val is None and key == 'cacheRead' and isinstance(details, dict):
            val = details.get('cached_tokens')
        result[key] = number(val)
    return result


def empty():
    return {k: 0 for k in FIELDS}


def add_request(bucket, usage, has_usage):
    bucket['requests'] += 1
    if not has_usage:
        bucket['requestsWithoutUsage'] += 1
        return
    for key, value in usage.items():
        bucket[key] += value
    bucket['relativeCostIndex'] += (usage['input'] * COST_WEIGHTS['input'] + usage['cacheWrite'] * COST_WEIGHTS['cacheWrite'] + usage['cacheRead'] * COST_WEIGHTS['cacheRead'] + usage['output'] * COST_WEIGHTS['output'])
    if usage['cacheWrite'] >= CACHE_REBUILD_MIN_TOKENS:
        bucket['largeCacheRebuilds'] += 1


def cache_rate(row):
    denom = row['input'] + row['cacheRead'] + row['cacheWrite']
    return row['cacheRead'] / denom if denom else 0.0


def read_json(path, default):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return default


def display_title(text):
    clean = ' '.join(str(text or '(无标题)').replace('\n', ' ').split())
    return clean[:40] + ('…' if len(clean) > 40 else '')


def summarize(sessions_dir: Path, index_path: Path, automations_path: Path, days: int, now: float):
    since = now - days * 86400
    index = read_json(index_path, {})
    sessions = index.get('sessions', []) if isinstance(index, dict) else []
    session_meta = {str(s.get('id')): s for s in sessions if isinstance(s, dict) and s.get('id')}
    automation_data = read_json(automations_path, {})
    automation_rows = automation_data.get('automations', []) if isinstance(automation_data, dict) else []
    automation_names = {str(a.get('id')): str(a.get('name') or '') for a in automation_rows if isinstance(a, dict) and a.get('id')}
    aggregates = {'total': empty(), **{name: {} for name in ('byDay', 'byAutomation', 'bySession', 'byChannelModel')}}
    child_total = empty()
    files_scanned = files_skipped = requests = no_usage = 0
    # Each JSONL assistant message id identifies one persisted API response. Repeated
    # snapshots with the same id + normalized usage are one request; distinct IDs count.
    for path in sessions_dir.glob('*.jsonl') if sessions_dir.is_dir() else ():
        try:
            if path.stat().st_mtime < since:
                files_skipped += 1
                continue
        except OSError:
            continue
        files_scanned += 1
        sid = path.stem
        meta = session_meta.get(sid, {})
        source_auto = meta.get('sourceAutomationId')
        parent_id = meta.get('rootSessionId') if meta.get('parentSessionId') else None
        root_meta = session_meta.get(str(parent_id), {}) if parent_id else {}
        if source_auto:
            taskname = automation_names.get(str(source_auto)) or str(source_auto)[:8]
            ownership = ('automation', taskname)
        elif parent_id:
            ownership = ('session', str(parent_id))
        else:
            ownership = ('session', sid)
        title_meta = root_meta if parent_id else meta
        title = display_title(title_meta.get('title') or ('子 Agent 根会话' if parent_id else '(无标题)'))
        provider_default = meta.get('provider') or meta.get('channelProvider') or 'unknown'
        model_default = meta.get('modelId') or 'unknown'
        channel_default = meta.get('channelId') or 'unknown'
        seen_responses = set()
        try:
            handle = path.open('r', encoding='utf-8', errors='replace')
        except OSError:
            continue
        with handle:
            for line in handle:
                if not line.startswith('{"type":"assistant"'):
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if record.get('type') != 'assistant':
                    continue
                created = record.get('_createdAt')
                if not isinstance(created, (int, float)) or created / 1000 < since or created / 1000 > now:
                    continue
                message = record.get('message') if isinstance(record.get('message'), dict) else {}
                raw_usage = message.get('usage')
                has_usage = isinstance(raw_usage, dict) and bool(raw_usage)
                vals = usage_values(raw_usage) if has_usage else {k: 0 for k in ('input', 'output', 'cacheRead', 'cacheWrite')}
                # SDK/session serialization may persist repeated snapshots of the same response.
                msgid = message.get('id')
                fingerprint = (msgid, tuple(vals.items()), has_usage) if msgid else None
                if fingerprint is not None and fingerprint in seen_responses:
                    continue
                if fingerprint is not None:
                    seen_responses.add(fingerprint)
                requests += 1
                no_usage += not has_usage
                when = dt.datetime.fromtimestamp(created / 1000, dt.timezone.utc)
                day = when.date().isoformat()
                provider = str(record.get('_channelProvider') or provider_default)
                model = str(record.get('_channelModelId') or message.get('model') or model_default)
                channel = str(record.get('_channelId') or channel_default)
                # Channel ID is intentionally abbreviated; no credential/config data is read.
                channel_label = channel[:8]
                group_key = f'{provider} / {model} / {channel_label}'
                target_map = aggregates['byAutomation'] if ownership[0] == 'automation' else aggregates['bySession']
                target = target_map.setdefault(ownership[1], empty())
                for bucket in (aggregates['total'], aggregates['byDay'].setdefault(day, empty()), target, aggregates['byChannelModel'].setdefault(group_key, empty())):
                    add_request(bucket, vals, has_usage)
                if meta.get('parentSessionId'):
                    add_request(child_total, vals, has_usage)

    def rows_for(name, labels):
        result = []
        source = aggregates[name]
        for key, values in source.items():
            row = dict(values)
            if name == 'bySession':
                m = session_meta.get(key, {})
                row.update({'sessionId': key[:8], 'title': display_title(m.get('title') or '(无标题)')})
            else:
                row['name' if name == 'byAutomation' else 'key'] = key
            row['cacheHitRate'] = cache_rate(row)
            result.append(row)
        result.sort(key=lambda x: (x['relativeCostIndex'], x['requests']), reverse=True)
        return result
    total = dict(aggregates['total']); total['cacheHitRate'] = cache_rate(total)
    child = dict(child_total); child['cacheHitRate'] = cache_rate(child)
    by_day = rows_for('byDay', None); by_day.sort(key=lambda x: x['key'])
    return {
        'windowDays': days,
        'generatedAt': dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(),
        'elapsedSeconds': 0,
        'scan': {'filesScanned': files_scanned, 'filesSkippedByMtime': files_skipped, 'requests': requests, 'requestsWithoutUsage': no_usage},
        'costNote': COST_NOTE,
        'costWeights': COST_WEIGHTS,
        'overview': total,
        'byDay': by_day,
        'byAutomation': rows_for('byAutomation', None),
        'bySession': rows_for('bySession', None),
        'childAgentTotal': child,
        'byChannelModel': rows_for('byChannelModel', None),
    }


def markdown(report, top):
    def table(rows, columns):
        lines = ['| ' + ' | '.join(label for _, label in columns) + ' |', '| ' + ' | '.join('---' for _ in columns) + ' |']
        for row in rows:
            lines.append('| ' + ' | '.join(str(row.get(key, '')) for key, _ in columns) + ' |')
        return '\n'.join(lines)
    cols = [('requests','请求'),('requestsWithoutUsage','无用量'),('input','Input'),('output','Output'),('cacheRead','Cache Read'),('cacheWrite','Cache Write'),('cacheHitRate','命中率'),('largeCacheRebuilds','大额重建'),('relativeCostIndex','相对成本指数')]
    fmtrows = lambda rs: [{**r,'cacheHitRate':f"{r['cacheHitRate']:.1%}",'relativeCostIndex':f"{r['relativeCostIndex']:.1f}"} for r in rs]
    lines = [f"# 成本与缓存看板（最近 {report['windowDays']} 天）", '', report['costNote'], f"", f"生成耗时：{report['elapsedSeconds']:.2f} 秒；扫描文件 {report['scan']['filesScanned']}，按 mtime 跳过 {report['scan']['filesSkippedByMtime']}。", '', '## 总览', table(fmtrows([report['overview']]), cols), '', '## 按天', table(fmtrows(report['byDay']), [('key','UTC 日期')]+cols), '', '## 定时任务 Top N', table(fmtrows(report['byAutomation'][:top]), [('name','定时任务')]+cols), '', '## 交互会话 Top N（会话按 ID 前 8 位与标题显示）', table(fmtrows(report['bySession'][:top]), [('sessionId','会话 ID 前 8 位'),('title','标题')]+cols), '', '**子 Agent 合计**', table(fmtrows([report['childAgentTotal']]), cols), '', '## 渠道 / 模型', table(fmtrows(report['byChannelModel']), [('key','Provider / 模型 / 渠道 ID 前 8 位')]+cols), '', f"成本权重：input×{COST_WEIGHTS['input']:g} + cacheWrite×{COST_WEIGHTS['cacheWrite']:g} + cacheRead×{COST_WEIGHTS['cacheRead']:g} + output×{COST_WEIGHTS['output']:g}。" ]
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--days', type=int, default=7)
    parser.add_argument('--sessions-dir', default=str(Path.home()/'.proma/agent-sessions'))
    parser.add_argument('--index', default=str(Path.home()/'.proma/agent-sessions.json'))
    parser.add_argument('--automations', default=str(Path.home()/'.proma/automations.json'))
    parser.add_argument('--format', choices=('markdown','json'), default='markdown')
    parser.add_argument('--top', type=int, default=10)
    parser.add_argument('--now', type=float, default=None)
    args = parser.parse_args()
    if args.days <= 0 or args.top < 0:
        parser.error('--days must be positive and --top cannot be negative')
    started = time.monotonic()
    now = args.now if args.now is not None else time.time()
    result = summarize(Path(os.path.expanduser(args.sessions_dir)), Path(os.path.expanduser(args.index)), Path(os.path.expanduser(args.automations)), args.days, now)
    result['elapsedSeconds'] = round(time.monotonic()-started, 3)
    if args.format == 'json':
        print(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
    else:
        print(markdown(result, args.top), end='')
    return 0

if __name__ == '__main__':
    sys.exit(main())
