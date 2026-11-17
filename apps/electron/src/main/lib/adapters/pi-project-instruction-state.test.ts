import { spawnSync } from 'node:child_process'
import { afterEach, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { canonicalizeProjectPath } from '../project-instruction-resolver'
import {
  PROJECT_INSTRUCTION_STATE_TYPE, MAX_PROJECT_INSTRUCTION_SCOPES,
  readProjectInstructionDirectories, recordProjectInstructionDirectories,
} from './pi-project-instruction-state'

// Another repository suite globally mocks the SDK package. Run this real-SDK
// suite in its own Bun process so no test can silently substitute fake storage.
if (process.env.PROMA_PROJECT_INSTRUCTION_TEST_FILE !== import.meta.path) {
  test('real SDK project-instruction suite (isolated from global SDK mocks)', () => {
    const result = spawnSync(process.execPath, ['test', import.meta.path], {
      env: { ...process.env, PROMA_PROJECT_INSTRUCTION_TEST_FILE: import.meta.path },
      encoding: 'utf8', timeout: 60_000,
    })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.error) throw result.error
    expect(result.status).toBe(0)
  }, 65_000)
} else {

  const temporary: string[] = []
  afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })
  function fixture() {
    const base = mkdtempSync(join(tmpdir(), 'proma-instruction-state-'))
    temporary.push(base)
    const root = canonicalizeProjectPath(join(base, 'project'))
    mkdirSync(root)
    const session = SessionManager.create(root, join(base, 'sessions'))
    session.appendMessage({ role: 'assistant', content: [], timestamp: Date.now(), stopReason: 'stop' } as any)
    return { base, root, session }
  }
  function data(root: string, directories: unknown = ['child']) {
    return { version: 1, ownerSessionId: 'owner', projectRoot: root, directories }
  }

  test('state is a bounded deduplicated reference-only SDK custom entry, not model context', () => {
    const { root, session } = fixture()
    recordProjectInstructionDirectories(session, 'owner', root, ['a', 'b'])
    recordProjectInstructionDirectories(session, 'owner', root, ['b', 'a'])
    expect(session.getBranch().filter((entry) => entry.type === 'custom')).toHaveLength(1)
    expect(session.buildSessionContext().messages.some((message) => JSON.stringify(message).includes(PROJECT_INSTRUCTION_STATE_TYPE))).toBe(false)
    expect(readFileSync(session.getSessionFile()!, 'utf8')).toContain('"directories":["a","b"]')
    const reopened = SessionManager.open(session.getSessionFile()!)
    expect(readProjectInstructionDirectories(reopened, 'owner', root)).toEqual(['a', 'b'])
    expect(readProjectInstructionDirectories(reopened, 'different-owner', root)).toEqual([])
    expect(readProjectInstructionDirectories(reopened, 'owner', join(root, 'other'))).toEqual([])
    const state = reopened.getBranch().find((entry) => entry.type === 'custom')
    expect(Object.keys((state as any).data).sort()).toEqual(['directories', 'ownerSessionId', 'projectRoot', 'version'])
  })

  test.each([
    null, [], 'bad', {}, { version: 2 }, { directories: [] },
  ].map((value) => ({ value })))('rejects malformed state %j rather than considering it delivered', ({ value }) => {
    const { root, session } = fixture()
    session.appendCustomEntry(PROJECT_INSTRUCTION_STATE_TYPE, value)
    expect(() => readProjectInstructionDirectories(session, 'owner', root)).toThrow('状态无效')
  })

  test.each([
    ['/absolute'], ['../outside'], ['a/../../outside'], ['a/../b'], ['a//b'], ['a/./b'], [''], ['a/'],
    ['C:/absolute'], ['C:\\absolute'], ['a\\b'], ['a\0b'], ['a\nb'], ['a'.repeat(1025)], ['a', 'a'], [42],
  ].map((directories) => ({ directories })))('rejects path attack or invalid directory references %j', ({ directories }) => {
    const { root, session } = fixture()
    session.appendCustomEntry(PROJECT_INSTRUCTION_STATE_TYPE, data(root, directories))
    expect(() => readProjectInstructionDirectories(session, 'owner', root)).toThrow('状态无效')
  })

  test('rejects unknown version and extra body/allow/hash fields even for matching owners', () => {
    const { root, session } = fixture()
    for (const patch of [{ version: 2 }, { allow: true }, { content: 'Tampered rule' }, { delivered: ['hash'] }]) {
      session.appendCustomEntry(PROJECT_INSTRUCTION_STATE_TYPE, { ...data(root), ...patch })
      expect(() => readProjectInstructionDirectories(session, 'owner', root)).toThrow('schema')
    }
  })

  test('old invalid ancestor snapshots do not poison a later valid replacement on the same branch', () => {
    const { root, session } = fixture()
    session.appendCustomEntry(PROJECT_INSTRUCTION_STATE_TYPE, null)
    session.appendCustomEntry(PROJECT_INSTRUCTION_STATE_TYPE, data(root))
    expect(readProjectInstructionDirectories(session, 'owner', root)).toEqual(['child'])
  })

  test('getBranch is used exclusively and sibling branches stay isolated on reopen', () => {
    const { root, session } = fixture()
    const before = session.getLeafId()!
    recordProjectInstructionDirectories(session, 'owner', root, ['only-on-other-branch'])
    const discoveredLeaf = session.getLeafId()!
    session.branch(before)
    session.appendMessage({ role: 'user', content: [{ type: 'text', text: 'Independent branch' }], timestamp: Date.now() })
    expect(readProjectInstructionDirectories(SessionManager.open(session.getSessionFile()!), 'owner', root)).toEqual([])
    session.branch(discoveredLeaf)
    expect(readProjectInstructionDirectories({ getBranch: () => session.getBranch(), appendCustomEntry: () => { throw new Error('not used') } }, 'owner', root)).toEqual(['only-on-other-branch'])
  })

  test('directory symlinks to outside or new aliases are not restored', () => {
    const { root, base, session } = fixture()
    mkdirSync(join(base, 'outside'))
    mkdirSync(join(root, 'inside'))
    for (const [link, target] of [['escape', join(base, 'outside')], ['alias', join(root, 'inside')]]) {
      symlinkSync(target!, join(root, link!))
      session.appendCustomEntry(PROJECT_INSTRUCTION_STATE_TYPE, data(root, [link]))
      expect(() => readProjectInstructionDirectories(session, 'owner', root)).toThrow('真实路径')
    }
  })

  // Simulate Windows lookup/canonical casing without requiring a case-insensitive
  // host volume. Only the lowercase reference is mapped; real links still follow
  // the host's actual realpath. This is not a Windows kernel/SDK integration test.
  function withCanonicalCasing<T>(root: string, platform: 'win32' | 'linux', run: () => T): T {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
    const nativeRealpath = realpathSync.native
    const realpathSpy = spyOn(realpathSync, 'native').mockImplementation(((path: Parameters<typeof realpathSync.native>[0]) => {
      return nativeRealpath(path === join(root, 'feature') ? join(root, 'Feature') : path)
    }) as typeof realpathSync.native)
    try {
      Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform })
      return run()
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform)
      realpathSpy.mockRestore()
    }
  }

  test('Windows casing simulation accepts feature references canonicalized to Feature and reopens SDK state', () => {
    const { root, session } = fixture()
    mkdirSync(join(root, 'Feature'))
    withCanonicalCasing(root, 'win32', () => {
      expect(() => recordProjectInstructionDirectories(session, 'owner', root, ['feature'])).not.toThrow()
      expect(readProjectInstructionDirectories(SessionManager.open(session.getSessionFile()!), 'owner', root)).toEqual(['feature'])
      recordProjectInstructionDirectories(session, 'owner', root, ['feature'])
      expect(session.getBranch().filter((entry) => entry.type === 'custom')).toHaveLength(1)
    })
  })

  test.each(['inside', 'outside'] as const)('Windows casing simulation still rejects real symlink redirection %s', (destination) => {
    const { root, base, session } = fixture()
    const target = join(destination === 'inside' ? root : base, 'DifferentTarget')
    mkdirSync(target)
    symlinkSync(target, join(root, 'Feature'))
    session.appendCustomEntry(PROJECT_INSTRUCTION_STATE_TYPE, data(root, ['feature']))
    withCanonicalCasing(root, 'win32', () => {
      expect(() => readProjectInstructionDirectories(session, 'owner', root)).toThrow('真实路径')
      expect(() => recordProjectInstructionDirectories(session, 'owner', root, ['feature'])).toThrow('真实路径')
      expect(session.getBranch().filter((entry) => entry.type === 'custom')).toHaveLength(1)
    })
  })

  test('non-Windows comparison remains case-sensitive for already canonical relative paths', () => {
    const { root, session } = fixture()
    mkdirSync(join(root, 'Feature'))
    withCanonicalCasing(root, 'linux', () => {
      expect(() => recordProjectInstructionDirectories(session, 'owner', root, ['feature'])).toThrow('真实路径')
      expect(session.getBranch().filter((entry) => entry.type === 'custom')).toHaveLength(0)
    })
  })

  test('scope count and serialized state bytes are bounded; failed additions do not append entries', () => {
    const { root, session } = fixture()
    const directories = Array.from({ length: MAX_PROJECT_INSTRUCTION_SCOPES }, (_, index) => `scope-${index}`)
    recordProjectInstructionDirectories(session, 'owner', root, directories)
    expect(readProjectInstructionDirectories(session, 'owner', root)).toHaveLength(MAX_PROJECT_INSTRUCTION_SCOPES)
    expect(() => recordProjectInstructionDirectories(session, 'owner', root, ['too-many'])).toThrow('大小')
    expect(session.getBranch().filter((entry) => entry.type === 'custom')).toHaveLength(1)
    const huge = directories.map((directory) => `${directory}-${'x'.repeat(300)}`)
    session.appendCustomEntry(PROJECT_INSTRUCTION_STATE_TYPE, data(root, huge))
    expect(() => readProjectInstructionDirectories(session, 'owner', root)).toThrow('大小')
  })

  test('a real SDK append failure is surfaced (including SDK in-memory mutation before throw)', () => {
    const { root, session } = fixture()
    const file = session.getSessionFile()!
    // Synthetic fixture only: force EISDIR at the SDK append boundary, never user storage.
    rmSync(file)
    mkdirSync(file)
    expect(() => recordProjectInstructionDirectories(session, 'owner', root, ['child'])).toThrow('无法保存')
  })
}
