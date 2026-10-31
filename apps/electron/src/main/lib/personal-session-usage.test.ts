import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { getPersonalSessionUsageCachedOffset, getPersonalSessionUsageFromPaths, resetPersonalSessionUsageCache } from './personal-session-usage'

const dir = mkdtempSync(join(tmpdir(), 'session-usage-test-'))
afterEach(() => resetPersonalSessionUsageCache())
function paths(id = 'root-session') { return { id, file: join(dir, `${id}.jsonl`), index: join(dir, 'agent-sessions.json') } }
function assistant(id: string, usage: unknown, type = 'assistant') { return JSON.stringify(type === 'assistant' ? { type, message: { id, usage } } : { type, usage: { input_tokens: 999999 } }) }
function index(sessions: unknown[] = []) { writeFileSync(join(dir, 'agent-sessions.json'), JSON.stringify({ sessions })) }

describe('personal session usage incremental reader', () => {
  test('only reads appended byte range and preserves totals', () => {
    const p = paths(); index(); const first = assistant('a', { input_tokens: 100, output_tokens: 2 }) + '\n'; writeFileSync(p.file, first)
    expect(getPersonalSessionUsageFromPaths(p.id, p.file, p.index).session).toMatchObject({ requests: 1, input: 100, output: 2 })
    const offset = getPersonalSessionUsageCachedOffset(p.id); const second = assistant('b', { input_tokens: 20, output_tokens: 1 }) + '\n'; appendFileSync(p.file, second)
    expect(getPersonalSessionUsageFromPaths(p.id, p.file, p.index).session).toMatchObject({ requests: 2, input: 120, output: 3 })
    expect(getPersonalSessionUsageCachedOffset(p.id)).toBe(offset! + Buffer.byteLength(second))
  })
  test('truncated/replaced file is recomputed rather than retaining old totals', () => {
    const p = paths(); index(); writeFileSync(p.file, assistant('old', { input_tokens: 99 }) + '\n'); getPersonalSessionUsageFromPaths(p.id, p.file, p.index)
    writeFileSync(p.file, assistant('new', { input_tokens: 7 }) + '\n')
    expect(getPersonalSessionUsageFromPaths(p.id, p.file, p.index).session).toMatchObject({ requests: 1, input: 7 })
  })
  test('replaced inode is recomputed even when the new file is longer', () => {
    const p = paths(); index(); writeFileSync(p.file, assistant('old', { input_tokens: 1 }) + '\n'); getPersonalSessionUsageFromPaths(p.id, p.file, p.index)
    const replacement = join(dir, 'replacement.jsonl'); writeFileSync(replacement, assistant('replacement', { input_tokens: 123456 }) + '\n'); renameSync(replacement, p.file)
    expect(getPersonalSessionUsageFromPaths(p.id, p.file, p.index).session).toMatchObject({ requests: 1, input: 123456 })
  })
  test('keeps an incomplete trailing line until its newline arrives', () => {
    const p = paths(); index(); const line = assistant('partial', { input_tokens: 11 }); writeFileSync(p.file, line.slice(0, 30))
    expect(getPersonalSessionUsageFromPaths(p.id, p.file, p.index).session.requests).toBe(0)
    appendFileSync(p.file, line.slice(30) + '\n')
    expect(getPersonalSessionUsageFromPaths(p.id, p.file, p.index).session).toMatchObject({ requests: 1, input: 11 })
  })
  test('deduplicates repeated response snapshots across appends; result rows are ignored', () => {
    const p = paths(); index(); const row = assistant('same', { input_tokens: 9, cache_read_input_tokens: 3 }) + '\n'; writeFileSync(p.file, row + assistant('', null, 'result') + '\n')
    appendFileSync(p.file, row)
    expect(getPersonalSessionUsageFromPaths(p.id, p.file, p.index).session).toMatchObject({ requests: 1, input: 9, cacheRead: 3 })
  })
  test('OpenAI prompt_tokens subtracts cached tokens; exact aggregate and cost', () => {
    const p = paths(); index(); writeFileSync(p.file, assistant('openai', { prompt_tokens: 20, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 3 } }) + '\n')
    expect(getPersonalSessionUsageFromPaths(p.id, p.file, p.index).session).toEqual({ requests: 1, input: 17, output: 4, cacheRead: 3, cacheWrite: 0, largeCacheRebuilds: 0, relativeCostIndex: 37.3, cacheHitRate: 3 / 20 })
  })
  test('includes child sessions discovered by parentSessionId or rootSessionId', () => {
    const p = paths(); const child = join(dir, 'child.jsonl'); index([{ id: 'child-a', parentSessionId: p.id }, { id: 'child-b', rootSessionId: p.id }]); writeFileSync(p.file, assistant('own', { input_tokens: 1 }) + '\n'); writeFileSync(child, assistant('child', { input_tokens: 2, cache_creation_input_tokens: 300000 }) + '\n')
    const summary = getPersonalSessionUsageFromPaths(p.id, p.file, p.index, id => id === p.id ? p.file : child)
    expect(summary.children).toMatchObject({ requests: 2, input: 4, cacheWrite: 600000, largeCacheRebuilds: 2, relativeCostIndex: 750004 })
  })
  test('ignores assistant messages without usage, and gives latest request cache details', () => {
    const p = paths(); index(); writeFileSync(p.file, JSON.stringify({ type: 'assistant', message: { id: 'none' } }) + '\n' + assistant('first', { input_tokens: 2, cache_read_input_tokens: 1 }) + '\n' + assistant('last', { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 300000 }) + '\n')
    const summary = getPersonalSessionUsageFromPaths(p.id, p.file, p.index)
    expect(summary.session).toMatchObject({ requests: 2, input: 12, cacheRead: 6, cacheWrite: 300000, largeCacheRebuilds: 1, cacheHitRate: 6 / 300018 })
    expect(summary.lastRequest).toEqual({ cacheWrite: 300000, cacheHitRate: 5 / 300015, largeCacheRebuild: true })
  })
  test('matches Python report on the same JSONL fixture', () => {
    const p = paths(); const now = Date.now(); index([{ id: p.id }]);
    const mk = (id: string, usage: object) => JSON.stringify({ type: 'assistant', _createdAt: now, message: { id, model: 'test', usage } })
    writeFileSync(p.file, [mk('one', { input_tokens: 20, output_tokens: 4, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 }), mk('two', { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } }), mk('three', { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 300000 }), JSON.stringify({ type: 'result', usage: { input_tokens: 777777 } })].join('\n') + '\n')
    const ts = getPersonalSessionUsageFromPaths(p.id, p.file, p.index).session
    const root = join(import.meta.dir, '../../../../..')
    const output = execFileSync('python3', [join(root, 'scripts/personal/usage-cost-report.py'), '--sessions-dir', dir, '--index', p.index, '--automations', join(dir, 'missing.json'), '--days', '7', '--now', String(now / 1000), '--format', 'json'], { encoding: 'utf8' })
    const report = JSON.parse(output); const py = report.bySession[0]
    expect({ requests: ts.requests, input: ts.input, output: ts.output, cacheRead: ts.cacheRead, cacheWrite: ts.cacheWrite, largeCacheRebuilds: ts.largeCacheRebuilds, relativeCostIndex: ts.relativeCostIndex }).toEqual({ requests: py.requests, input: py.input, output: py.output, cacheRead: py.cacheRead, cacheWrite: py.cacheWrite, largeCacheRebuilds: py.largeCacheRebuilds, relativeCostIndex: py.relativeCostIndex })
    expect(ts).toMatchObject({ requests: 3, input: 27, output: 7, cacheRead: 7, cacheWrite: 300002, largeCacheRebuilds: 1, relativeCostIndex: 375065.2 })
  })
})
