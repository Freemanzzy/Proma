import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { getPersonalSessionUsageCachedFileCount, getPersonalSessionUsageCachedOffset, getPersonalSessionUsageFromPaths, getPersonalSessionUsagePeakPendingBytesForTest, resetPersonalSessionUsageCache, setPersonalSessionUsageChunkBytesForTest } from './personal-session-usage'

const dir = mkdtempSync(join(tmpdir(), 'session-usage-test-'))
afterEach(() => { resetPersonalSessionUsageCache(); setPersonalSessionUsageChunkBytesForTest(4 * 1024 * 1024) })
function paths(id = 'root-session') { return { id, file: join(dir, `${id}.jsonl`), index: join(dir, 'agent-sessions.json') } }
function assistant(id: string, usage: unknown, type = 'assistant') { return JSON.stringify(type === 'assistant' ? { type, message: { id, usage } } : { type, usage: { input_tokens: 999999 } }) }
function index(sessions: unknown[] = []) { writeFileSync(join(dir, 'agent-sessions.json'), JSON.stringify({ sessions })) }

describe('personal session usage incremental reader', () => {
  test('only reads appended byte range and preserves totals', async () => {
    const p = paths(); index(); const first = assistant('a', { input_tokens: 100, output_tokens: 2 }) + '\n'; writeFileSync(p.file, first)
    expect((await getPersonalSessionUsageFromPaths(p.id, p.file, p.index)).session).toMatchObject({ requests: 1, input: 100, output: 2 })
    const offset = getPersonalSessionUsageCachedOffset(p.id); const second = assistant('b', { input_tokens: 20, output_tokens: 1 }) + '\n'; appendFileSync(p.file, second)
    expect((await getPersonalSessionUsageFromPaths(p.id, p.file, p.index)).session).toMatchObject({ requests: 2, input: 120, output: 3 })
    expect(getPersonalSessionUsageCachedOffset(p.id)).toBe(offset! + Buffer.byteLength(second))
  })
  test('truncated/replaced file is recomputed rather than retaining old totals', async () => {
    const p = paths(); index(); writeFileSync(p.file, assistant('old', { input_tokens: 99 }) + '\n'); (await getPersonalSessionUsageFromPaths(p.id, p.file, p.index))
    writeFileSync(p.file, assistant('new', { input_tokens: 7 }) + '\n')
    expect((await getPersonalSessionUsageFromPaths(p.id, p.file, p.index)).session).toMatchObject({ requests: 1, input: 7 })
  })
  test('replaced inode is recomputed even when the new file is longer', async () => {
    const p = paths(); index(); writeFileSync(p.file, assistant('old', { input_tokens: 1 }) + '\n'); (await getPersonalSessionUsageFromPaths(p.id, p.file, p.index))
    const replacement = join(dir, 'replacement.jsonl'); writeFileSync(replacement, assistant('replacement', { input_tokens: 123456 }) + '\n'); renameSync(replacement, p.file)
    expect((await getPersonalSessionUsageFromPaths(p.id, p.file, p.index)).session).toMatchObject({ requests: 1, input: 123456 })
  })
  test('keeps an incomplete trailing line until its newline arrives', async () => {
    const p = paths(); index(); const line = assistant('partial', { input_tokens: 11 }); writeFileSync(p.file, line.slice(0, 30))
    expect((await getPersonalSessionUsageFromPaths(p.id, p.file, p.index)).session.requests).toBe(0)
    appendFileSync(p.file, line.slice(30) + '\n')
    expect((await getPersonalSessionUsageFromPaths(p.id, p.file, p.index)).session).toMatchObject({ requests: 1, input: 11 })
  })
  test('deduplicates repeated response snapshots across appends; result rows are ignored', async () => {
    const p = paths(); index(); const row = assistant('same', { input_tokens: 9, cache_read_input_tokens: 3 }) + '\n'; writeFileSync(p.file, row + assistant('', null, 'result') + '\n')
    appendFileSync(p.file, row)
    expect((await getPersonalSessionUsageFromPaths(p.id, p.file, p.index)).session).toMatchObject({ requests: 1, input: 9, cacheRead: 3 })
  })
  test('OpenAI prompt_tokens subtracts cached tokens; exact aggregate and cost', async () => {
    const p = paths(); index(); writeFileSync(p.file, assistant('openai', { prompt_tokens: 20, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 3 } }) + '\n')
    expect((await getPersonalSessionUsageFromPaths(p.id, p.file, p.index)).session).toEqual({ requests: 1, input: 17, output: 4, cacheRead: 3, cacheWrite: 0, largeCacheRebuilds: 0, relativeCostIndex: 37.3, cacheHitRate: 3 / 20 })
  })
  test('includes child sessions discovered by parentSessionId or rootSessionId', async () => {
    const p = paths(); const child = join(dir, 'child.jsonl'); index([{ id: 'child-a', parentSessionId: p.id }, { id: 'child-b', rootSessionId: p.id }]); writeFileSync(p.file, assistant('own', { input_tokens: 1 }) + '\n'); writeFileSync(child, assistant('child', { input_tokens: 2, cache_creation_input_tokens: 300000 }) + '\n')
    const summary = (await getPersonalSessionUsageFromPaths(p.id, p.file, p.index, id => id === p.id ? p.file : child))
    expect(summary.children).toMatchObject({ requests: 2, input: 4, cacheWrite: 600000, largeCacheRebuilds: 2, relativeCostIndex: 750004 })
  })
  test('ignores assistant messages without usage, and gives latest request cache details', async () => {
    const p = paths(); index(); writeFileSync(p.file, JSON.stringify({ type: 'assistant', message: { id: 'none' } }) + '\n' + assistant('first', { input_tokens: 2, cache_read_input_tokens: 1 }) + '\n' + assistant('last', { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 300000 }) + '\n')
    const summary = (await getPersonalSessionUsageFromPaths(p.id, p.file, p.index))
    expect(summary.session).toMatchObject({ requests: 2, input: 12, cacheRead: 6, cacheWrite: 300000, largeCacheRebuilds: 1, cacheHitRate: 6 / 300018 })
    expect(summary.lastRequest).toEqual({ cacheWrite: 300000, cacheHitRate: 5 / 300015, largeCacheRebuild: true })
  })
  test('matches Python report on the same JSONL fixture', async () => {
    const p = paths(); const now = Date.now(); index([{ id: p.id }]);
    const mk = (id: string, usage: object) => JSON.stringify({ type: 'assistant', _createdAt: now, message: { id, model: 'test', usage } })
    writeFileSync(p.file, [mk('one', { input_tokens: 20, output_tokens: 4, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 }), mk('two', { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } }), mk('three', { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 300000 }), JSON.stringify({ type: 'result', usage: { input_tokens: 777777 } })].join('\n') + '\n')
    const ts = (await getPersonalSessionUsageFromPaths(p.id, p.file, p.index)).session
    const root = join(import.meta.dir, '../../../../..')
    const output = execFileSync('python3', [join(root, 'scripts/personal/usage-cost-report.py'), '--sessions-dir', dir, '--index', p.index, '--automations', join(dir, 'missing.json'), '--days', '7', '--now', String(now / 1000), '--format', 'json'], { encoding: 'utf8' })
    const report = JSON.parse(output); const py = report.bySession[0]
    expect({ requests: ts.requests, input: ts.input, output: ts.output, cacheRead: ts.cacheRead, cacheWrite: ts.cacheWrite, largeCacheRebuilds: ts.largeCacheRebuilds, relativeCostIndex: ts.relativeCostIndex }).toEqual({ requests: py.requests, input: py.input, output: py.output, cacheRead: py.cacheRead, cacheWrite: py.cacheWrite, largeCacheRebuilds: py.largeCacheRebuilds, relativeCostIndex: py.relativeCostIndex })
    expect(ts).toMatchObject({ requests: 3, input: 27, output: 7, cacheRead: 7, cacheWrite: 300002, largeCacheRebuilds: 1, relativeCostIndex: 375065.2 })
  })
  test('handles lines split across tiny read chunks and skips huge non-assistant lines', async () => {
    setPersonalSessionUsageChunkBytesForTest(7)
    const p = paths('chunked'); index()
    const huge = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(200_000) } })
    const short = '{"a":1}'
    writeFileSync(p.file, [assistant('c1', { input_tokens: 5, output_tokens: 1 }), huge, short, assistant('c2', { input_tokens: 7, cache_read_input_tokens: 2 })].join('\n') + '\n')
    expect((await getPersonalSessionUsageFromPaths(p.id, p.file, p.index)).session).toMatchObject({ requests: 2, input: 12, output: 1, cacheRead: 2 })
    expect(getPersonalSessionUsageCachedOffset(p.id)).toBe(Buffer.byteLength(require('node:fs').readFileSync(p.file)))
    // 非 assistant 行只看前缀即跳过：最大缓冲量是一条 assistant 行，而不是 200 KB 的 user 行
    expect(getPersonalSessionUsagePeakPendingBytesForTest()).toBeLessThan(1_000)
  })
  test('serializes concurrent reads of the same session', async () => {
    setPersonalSessionUsageChunkBytesForTest(5)
    const p = paths('concurrent'); index()
    // 无 message.id 的行不参与去重，交错读取若重复推进偏移会直接多计
    const row = () => JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 1 } } })
    writeFileSync(p.file, row() + '\n')
    await getPersonalSessionUsageFromPaths(p.id, p.file, p.index)
    // 已有缓存状态后追加，再并发读取：共享同一偏移，必须串行推进
    appendFileSync(p.file, Array.from({ length: 19 }, row).join('\n') + '\n')
    const results = await Promise.all([1, 2, 3].map(() => getPersonalSessionUsageFromPaths(p.id, p.file, p.index)))
    for (const r of results) expect(r.session).toMatchObject({ requests: 20, input: 20 })
  })
  test('caps cached file states', async () => {
    index()
    for (let i = 0; i < 70; i++) { const p = paths(`lru-${i}`); writeFileSync(p.file, assistant(`l${i}`, { input_tokens: 1 }) + '\n'); await getPersonalSessionUsageFromPaths(p.id, p.file, p.index) }
    expect(getPersonalSessionUsageCachedFileCount()).toBe(64)
  })
})
