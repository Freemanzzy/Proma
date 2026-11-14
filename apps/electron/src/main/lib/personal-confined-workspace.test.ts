import type { BeforeAgentStartEvent, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { normalizePiPath, resolvePiPath } from './personal-confined-paths'
import { buildConfinedDynamicContext, buildConfinedSystemPrompt, confinedBridgeWorkspaceId, confinedShellEnvironment, CONFINED_COMMAND_DENIED, isConfinedBridgeCommandAllowed, isConfinedToolNameAllowed, quoteConfinedWord, readConfinedPolicy, resolveConfinedToolDecision, tokenizeConfinedCommand } from './personal-confined-workspace'
import { resolveExternalWorkspaceToolDecision } from './workspace-readonly-policy'
import { displayToolName, normalizePermissionInput, restorePiInput } from './adapters/pi-message-adapter'

let home: string; let workspace: string; let project: string; let session: string; let outside: string
let previousHome: string | undefined
let homeSpy: ReturnType<typeof spyOn>
beforeEach(() => {
  previousHome = process.env.HOME
  home = mkdtempSync(join(tmpdir(), 'confined-'))
  // homedir() in both Pi and our resolver consults HOME; no real user data is used.
  process.env.HOME = home
  homeSpy = spyOn(os, 'homedir').mockImplementation(() => home)
  workspace = join(home, 'workspace'); project = join(workspace, 'workspace-files'); session = join(workspace, 'session-1'); outside = join(home, 'outside')
  for (const path of [workspace, project, session, outside, join(workspace, 'session-2')]) mkdirSync(path, { recursive: true })
})
afterEach(() => {
  homeSpy.mockRestore()
  if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})
const ctx = () => ({ roots: [project, session], cwd: project, workspacePath: workspace })
const decision = (tool: string, input: Record<string, unknown>) => resolveConfinedToolDecision(tool, input, ctx())
const policy = (extra: object = {}) => writeFileSync(join(workspace, 'confined-policy.json'), JSON.stringify({ version: 1, commands: ['/approved/entry'], ...extra }))

for (const tool of ['Read', 'Write', 'Edit', 'MultiEdit', 'Grep', 'Glob', 'LS']) {
  test(`${tool}: allows project and own workbench; rejects workspace root, sibling session and outside`, () => {
    for (const root of [project, session]) {
      expect(decision(tool, { file_path: join(root, 'new', 'file'), path: join(root, 'new', 'file'), pattern: '*.ts' }).behavior).toBe('allow')
    }
    for (const path of [workspace, join(workspace, 'mcp.json'), join(workspace, 'memory', 'x'), join(workspace, 'skills', 'x'), join(workspace, 'AGENTS.md'), join(workspace, 'confined-policy.json'), join(workspace, 'session-2', 'x'), outside, '../AGENTS.md', '~/.zshrc', '@~/.zshrc', pathToFileURL(join(outside, 'file')).href]) {
      expect(decision(tool, { file_path: path, path, pattern: '*.ts' }).behavior).toBe('deny')
    }
  })
  test(`${tool}: rejects symlink and dangling symlink escapes including nonexistent descendants`, () => {
    symlinkSync(outside, join(project, 'escape'))
    symlinkSync(join(outside, 'missing'), join(project, 'dangling'))
    for (const path of ['escape', 'escape/new/file', 'dangling/new/file']) {
      expect(decision(tool, { path, file_path: path, pattern: '*.ts' }).behavior).toBe('deny')
    }
  })
}
for (const tool of ['Grep', 'Glob']) {
  test(`${tool}: checks both path and pattern/glob escape forms`, () => {
    for (const key of (tool === 'Grep' ? ['glob'] : ['pattern', 'glob'])) {
      for (const pattern of ['/etc/*', '~/*', '../*', 'a/../../x', '@~/x', 'file:///etc/x']) {
        expect(decision(tool, { path: project, pattern: 'test', [key]: pattern }).behavior).toBe('deny')
      }
    }
    expect(decision(tool, { pattern: '**/*.ts', glob: '*.ts' }).behavior).toBe('allow')
    expect(resolveConfinedToolDecision(tool, { pattern: '*.ts' }, { ...ctx(), cwd: outside }).behavior).toBe('deny')
  })
}
test('LS default path uses confined cwd, rejects an external cwd', () => {
  expect(decision('LS', {}).behavior).toBe('allow')
  expect(resolveConfinedToolDecision('LS', {}, { ...ctx(), cwd: outside }).behavior).toBe('deny')
})
test('Read checks Pi macOS filename fallback symlinks, including images', () => {
  writeFileSync(join(outside, 'secret.png'), 'secret')
  symlinkSync(join(outside, 'secret.png'), join(project, "capture\u2019.png"))
  expect(decision('Read', { file_path: "capture'.png" }).behavior).toBe('deny')
  writeFileSync(join(project, 'ok.png'), 'image')
  expect(decision('Read', { file_path: 'ok.png' }).behavior).toBe('allow')
})
test('Pi path resolver differential contract: tilde, at-prefix, file URLs, Unicode spaces and traversal', () => {
  // SDK exports intentionally do not expose path-utils. Import its installed file
  // in a separate process so unrelated suite SDK mocks cannot affect this test.
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))))
  const piFile = join(packageRoot, 'dist/core/tools/path-utils.js')
  const paths = ['~', '~/x', '@~/x', '@@x', '@./x', '../x', './a/../b', pathToFileURL(join(outside, 'x y')).href, 'a\u00a0b', 'a\u202fb', 'a\u3000b']
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import { resolveToCwd } from ${JSON.stringify(pathToFileURL(piFile).href)}; console.log(JSON.stringify(${JSON.stringify(paths)}.map(p=>resolveToCwd(p,${JSON.stringify(project)}))))`], { env: { ...process.env, HOME: home }, encoding: 'utf8' })
  expect(result.status).toBe(0)
  expect(paths.map((p) => resolvePiPath(p, project))).toEqual(JSON.parse(result.stdout))
  expect(normalizePiPath('@~/x')).toBe(join(home, 'x'))
})
for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
  test(`read-only regression ${tool}: rejects Pi tilde/at/file URL escape even with bypassPermissions`, () => {
    for (const path of ['~/.zshrc', '@~/.zshrc', pathToFileURL(join(home, 'x')).href, '../outside/file']) {
      expect(resolveExternalWorkspaceToolDecision('bypassPermissions', tool, { file_path: path, notebook_path: path }, [project], project)?.behavior).toBe('deny')
    }
    expect(resolveExternalWorkspaceToolDecision('bypassPermissions', tool, { file_path: 'x', notebook_path: 'x' }, [project], project)?.behavior).toBe('allow')
  })
}

describe('policy schema fail closed', () => {
  test('missing or invalid policy denies Bash with readable reason', () => {
    expect(decision('Bash', { command: '/approved/entry' })).toEqual({ behavior: 'deny', message: CONFINED_COMMAND_DENIED })
    for (const invalid of ['{', 'null', '[]', '{}', '{"version":2,"commands":[]}', '{"version":1,"commands":["relative"]}', '{"version":1,"commands":[],"unknown":true}', '{"version":1,"commands":[],"env":["A=x"]}', '{"version":1,"commands":[],"allowGroupChatHistory":"false"}', '{"version":1,"commands":[],"env":{}}']) {
      writeFileSync(join(workspace, 'confined-policy.json'), invalid)
      expect(readConfinedPolicy(workspace)).toBeNull()
      expect(decision('Bash', { command: '/approved/entry' }).behavior).toBe('deny')
      expect(decision('Read', { file_path: 'x' }).behavior).toBe('allow')
    }
  })
  test('commands outside roots are accepted only for the executable; policy edits take effect immediately', () => {
    policy()
    expect(decision('Bash', { command: '/approved/entry ok' }).behavior).toBe('allow')
    policy({ commands: [] })
    expect(decision('Bash', { command: '/approved/entry ok' }).behavior).toBe('deny')
  })
})
for (const command of ['/approved/entry a b', '/approved/entry ""', '/approved/entry "a b"', '/approved/entry sql "SELECT COUNT(*) FROM t WHERE d >= \'2026-11-01\'"', "/approved/entry 'a*?[]{}()<>!#'", '/approved/entry "a\'b"']) {
  test(`Bash tokenizer allows and rewrites exact argv: ${command}`, () => {
    policy()
    const words = tokenizeConfinedCommand(command)
    expect(words).not.toBeNull()
    const result = decision('Bash', { command, timeout: 10 })
    expect(result.behavior).toBe('allow')
    if (result.behavior === 'allow') {
      expect(result.updatedInput.command).toContain("'/usr/bin/env' '-i'")
      expect(String(result.updatedInput.command).endsWith(words!.map(quoteConfinedWord).join(' '))).toBe(true)
      expect(result.updatedInput.timeout).toBe(10)
    }
  })
}
for (const command of ['', 'X=y /approved/entry', '/approved/entry $HOME', '/approved/entry `id`', '/approved/entry $(id)', '/approved/entry a\\ b', '/approved/entry\n/approved/entry', '/approved/entry\rfoo', '/approved/entry; id', '/approved/entry & id', '/approved/entry | id', '/approved/entry > out', '/approved/entry < in', '/approved/entry (x)', '/approved/entry *', '/approved/entry ?', '/approved/entry [x]', '/approved/entry {a,b}', '/approved/entry #x', '/approved/entry !x', '/approved/entry "unterminated', '/approved/entry "$(id)"', '/approved/entry "a;b"']) {
  test(`Bash tokenizer rejects forbidden syntax ${JSON.stringify(command)}`, () => {
    policy()
    expect(tokenizeConfinedCommand(command)).toBeNull()
    expect(decision('Bash', { command }).behavior).toBe('deny')
  })
}
test('Bash denies nonallowlisted executable and external argument paths including --key=value', () => {
  policy()
  for (const command of ['cat ~/.zshrc', 'ls ~', 'node -e "1"', 'entry ok', '/approved/entry-other ok', '/approved/entry ~/x', '/approved/entry --file=/etc/x', '/approved/entry --file=~/x', '/approved/entry ../../x']) {
    expect(decision('Bash', { command }).behavior).toBe('deny')
  }
  for (const arg of [join(project, 'file'), join(session, 'file'), `--file=${join(project, 'file')}`, 'sub/../file', '@~/x', 'file:///etc/x']) {
    expect(decision('Bash', { command: `/approved/entry ${quoteConfinedWord(arg)}` }).behavior).toBe('allow')
  }
})
test('Bash rejects alternate inputs, nonfinite and oversized timeout and external cwd', () => {
  policy()
  for (const extra of [{ cwd: outside }, { env: {} }, { shell: '/bin/sh' }, { timeout: NaN }, { timeout: Infinity }, { timeout: -1 }, { timeout: '10' }, { timeout: 2_147_484 }]) {
    expect(decision('Bash', { command: '/approved/entry', ...extra }).behavior).toBe('deny')
  }
  expect(resolveConfinedToolDecision('Bash', { command: '/approved/entry' }, { ...ctx(), cwd: outside }).behavior).toBe('deny')
})
test('Bash env -i contains only fixed defaults and explicit policy env; no inherited secrets', () => {
  process.env.CONFINED_TEST_SECRET = 'secret-value'
  process.env.CONFINED_TEST_PUBLIC = "public'value"
  try {
    policy({ env: ['CONFINED_TEST_PUBLIC', 'PATH'] })
    const result = decision('Bash', { command: '/approved/entry ok' })
    expect(result.behavior).toBe('allow')
    if (result.behavior === 'allow') {
      expect(result.updatedInput.command).toContain("'CONFINED_TEST_PUBLIC=public'\\''value'")
      expect(result.updatedInput.command).not.toContain('SECRET')
      expect(result.updatedInput.command).not.toContain('secret-value')
      expect(result.updatedInput.command).toContain("'PATH=/usr/bin:/bin:/usr/sbin:/sbin'")
    }
    expect(Object.keys(confinedShellEnvironment()).sort()).toEqual(['HOME', 'LANG', 'PATH', 'TMPDIR', 'TZ'])
  } finally { delete process.env.CONFINED_TEST_SECRET; delete process.env.CONFINED_TEST_PUBLIC }
})
test('Bash quoting survives a real shell as exact argv with no shell expansion', () => {
  const words = ['hello world', '', "a'b", 'SELECT COUNT(*) WHERE n > 1', '[x] * ?']
  const command = ['printf', '%s\\0', ...words].map(quoteConfinedWord).join(' ')
  const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', command], { env: confinedShellEnvironment(), encoding: 'utf8' })
  expect(result.status).toBe(0)
  expect(result.stdout.split('\0').slice(0, -1)).toEqual(words)
})
for (const tool of ['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoRead', 'CompactContext']) {
  test(`session-only tool allowed: ${tool}`, () => expect(decision(tool, {}).behavior).toBe('allow'))
}
for (const tool of ['EgoBrowser', 'VisionRelay', 'WebSearch', 'WebFetch', 'mcp__test__read', 'mcp__planning__list_todos', 'mcp__automation__list_automations', 'mcp__collaboration__delegate_agent', 'proma_workspace_configure_mcp_server', 'TerminalOpen', 'TerminalExecute', 'TerminalList', 'TerminalRead', 'TerminalInterrupt', 'TerminalClose', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'SelectWorktree', 'InstallWindowsShell', 'PowerShell', 'REPL', 'Workflow', 'NotebookEdit', 'FutureUnknownTool']) {
  test(`default deny product/MCP/unknown tool: ${tool}`, () => {
    expect(decision(tool, {}).behavior).toBe('deny')
    expect(isConfinedToolNameAllowed(tool)).toBe(false)
  })
}
test('bound group history defaults allowed and policy false disables it', () => {
  expect(decision('mcp__feishu_chat__fetch_group_chat_history', {}).behavior).toBe('allow')
  policy({ allowGroupChatHistory: false })
  expect(decision('mcp__feishu_chat__fetch_group_chat_history', {}).behavior).toBe('deny')
})
test('Pi tool name/input normalization and updatedInput restore preserve the actual confined decision', () => {
  policy()
  for (const [name, args] of [['read', { path: '~/.zshrc' }], ['write', { path: '~/x', content: 'x' }], ['edit', { path: '~/x', edits: [{ oldText: 'a', newText: 'b' }, { oldText: 'c', newText: 'd' }] }], ['ls', { path: '~' }], ['find', { path: '.', pattern: '../*' }], ['grep', { path: '~', pattern: 'x' }], ['bash', { command: 'node -e "1"' }]] as Array<[string, Record<string, unknown>]>) {
    expect(decision(displayToolName(name, args), normalizePermissionInput(name, args)).behavior).toBe('deny')
  }
  const args = { command: '/approved/entry ok' }
  const result = decision('Bash', args)
  if (result.behavior !== 'allow') throw new Error('expected allow')
  expect(restorePiInput('bash', args, result.updatedInput).command).toContain("'/usr/bin/env' '-i'")
})
test('Bridge confined defaults override old binding; bound confined locks without bot default', () => {
  const ws = (id: string) => ({ id, externalAccess: id === 'customer' ? 'confined' : 'read-write' })
  expect(confinedBridgeWorkspaceId('customer', 'admin', ws)).toBe('customer')
  expect(confinedBridgeWorkspaceId('admin', 'customer', ws)).toBe('customer')
  expect(confinedBridgeWorkspaceId(undefined, 'customer', ws)).toBe('customer')
  expect(confinedBridgeWorkspaceId('admin', 'admin', ws)).toBeUndefined()
  for (const cmd of ['/help', '/h', '/new', '/n', '/stop', '/s', '/list', '/ls', '/switch', '/sw', '/NEW']) expect(isConfinedBridgeCommandAllowed(cmd)).toBe(true)
  for (const cmd of ['/workspace', '/ws', '/model', '/m', '/now', '/mirror', '/unknown']) expect(isConfinedBridgeCommandAllowed(cmd)).toBe(false)
})
test('confined prompts do not contain ambient paths or capabilities', () => {
  const prompt = buildConfinedSystemPrompt('Project rule: answer concisely') + buildConfinedDynamicContext()
  expect(prompt).toContain('Project rule: answer concisely')
  for (const text of [home, 'Vault', 'ego', 'MCP', 'Skills', 'memory/', 'agent-workspaces', '附加目录']) expect(prompt).not.toContain(text)
})

test('Pi structured system prompt cwd is redacted without changing execution cwd', async () => {
  const { createConfinedPromptExtension } = await import('./personal-confined-workspace')
  let handler: ((event: BeforeAgentStartEvent) => void) | undefined
  await createConfinedPromptExtension()({ on: (name: string, fn: (event: BeforeAgentStartEvent) => void) => { if (name === 'before_agent_start') handler = fn } } as unknown as ExtensionAPI)
  const event: BeforeAgentStartEvent = { type: 'before_agent_start', prompt: '', systemPrompt: '',
    systemPromptOptions: { cwd: outside, customPrompt: buildConfinedSystemPrompt('rules'), selectedTools: [], toolSnippets: {}, toolGuidelines: {}, promptGuidelines: [], appendSystemPrompt: '', sections: {}, contextFiles: [], skills: [] } }
  handler!(event)
  expect(event.systemPromptOptions.cwd).toBe('.')
  expect(event.systemPromptOptions.customPrompt).toContain('rules')
})

test('actual Pi Bash executes rewritten argv with clean shell startup and no inherited secret', () => {
  const entry = join(workspace, 'echo.sh'); const startup = join(workspace, 'startup.sh'); const marker = join(workspace, 'startup-ran')
  writeFileSync(entry, '#!/bin/sh\nprintf "ARG:%s\\n" "$@"\nprintf "SECRET:%s\\n" "${CONFINED_TEST_SECRET-unset}"\n', { mode: 0o700 })
  writeFileSync(startup, `touch '${marker}'\n`)
  policy({ commands: [entry] })
  const result = decision('Bash', { command: `${entry} "a b" "a'b"`, timeout: 10 })
  if (result.behavior !== 'allow') throw new Error('expected allow')
  const sdkPath = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))
  const script = `import { createBashToolDefinition } from ${JSON.stringify(pathToFileURL(sdkPath).href)};
    const tool = createBashToolDefinition(${JSON.stringify(project)}, { shellPath: '/bin/bash', spawnHook: ({ command, cwd }) => ({ command, cwd, env: ${JSON.stringify(confinedShellEnvironment())} }) });
    console.log(JSON.stringify(await tool.execute('test', ${JSON.stringify(result.updatedInput)}, new AbortController().signal)));`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, HOME: home, BASH_ENV: startup, CONFINED_TEST_SECRET: 'not-in-child' }, encoding: 'utf8' })
  expect(run.status).toBe(0)
  expect(run.stdout).toContain('ARG:a b')
  expect(run.stdout).toContain("ARG:a'b")
  expect(run.stdout).toContain('SECRET:unset')
  expect(existsSync(marker)).toBe(false)
})

test('actual Pi resource loader exposes no ambient or explicit Skills in confined configuration', () => {
  const agentDir = join(home, 'agent')
  for (const base of [join(agentDir, 'skills'), join(project, '.pi', 'skills')]) {
    const dir = join(base, 'must-not-load')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: must-not-load\ndescription: private ambient skill\n---\nAMBIENT_SECRET_CANARY\n')
  }
  const sdkPath = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))
  const script = `import { DefaultResourceLoader, SettingsManager } from ${JSON.stringify(pathToFileURL(sdkPath).href)};
    const loader = new DefaultResourceLoader({ cwd: ${JSON.stringify(project)}, agentDir: ${JSON.stringify(agentDir)}, settingsManager: SettingsManager.inMemory(),
      noContextFiles: true, noExtensions: true, noSkills: true, noPromptTemplates: true, appendSystemPrompt: [], additionalSkillPaths: [],
      agentsFilesOverride: () => ({ agentsFiles: [] }), skillsOverride: () => ({ skills: [], diagnostics: [] }), systemPromptOverride: () => 'Confined assistant' });
    await loader.reload(); console.log(JSON.stringify({ skills: loader.getSkills().skills, agents: loader.getAgentsFiles().agentsFiles, systemPrompt: loader.getSystemPrompt() }));`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, HOME: home }, encoding: 'utf8' })
  expect(run.status).toBe(0)
  const result = JSON.parse(run.stdout.trim().split('\n').at(-1)!)
  expect(result.skills).toEqual([])
  expect(result.agents).toEqual([])
  expect(result.systemPrompt).toBe('Confined assistant')
  expect(run.stdout).not.toContain('AMBIENT_SECRET_CANARY')
})

// Review round 2: these cases were first run against 915f5ca7 and failed.
test('R2 Bash validates every raw relative argv and option value through realpath', () => {
  policy()
  symlinkSync(outside, join(project, 'escape'))
  symlinkSync(join(outside, 'absent'), join(project, 'dangling'))
  symlinkSync(outside, join(project, 'narrow\u202Fspace'))
  for (const arg of ['escape/secret', '--file=escape/secret', 'dangling/child', 'narrow\u202Fspace/secret', '~literal']) {
    expect(decision('Bash', { command: `/approved/entry ${quoteConfinedWord(arg)}` }).behavior).toBe('deny')
  }
  for (const arg of ['hello world', "SELECT COUNT(*) FROM t WHERE d >= '2026-11-01'", '--file=local']) {
    expect(decision('Bash', { command: `/approved/entry ${JSON.stringify(arg)}` }).behavior).toBe('allow')
  }
})
test('R2 Read validates final macOS fallback name without renormalizing Unicode spaces', () => {
  writeFileSync(join(outside, 'secret.txt'), 'secret')
  symlinkSync(join(outside, 'secret.txt'), join(project, 'capture\u202FPM.txt'))
  expect(decision('Read', { file_path: 'capture PM.txt' }).behavior).toBe('deny')
})
test('R2 Read returns the selected final Unicode path in updatedInput', () => {
  const actual = join(project, 'ok\u202FPM.txt')
  writeFileSync(actual, 'ok')
  const result = decision('Read', { file_path: 'ok PM.txt' })
  expect(result.behavior).toBe('allow')
  if (result.behavior === 'allow') expect(result.updatedInput.file_path).toBe(actual)
})
test('R2 entrypoint cannot be executable from or overwritten inside either writable root', () => {
  for (const root of [project, session]) {
    const entry = join(root, 'entry.sh')
    writeFileSync(entry, '#!/bin/sh\nprintf ok', { mode: 0o755 })
    policy({ commands: [entry] })
    for (const [tool, input] of [['Bash', { command: entry }], ['Write', { file_path: entry, content: 'bad' }], ['Edit', { file_path: entry, old_string: 'ok', new_string: 'bad' }], ['MultiEdit', { file_path: entry, edits: [] }]] as Array<[string, Record<string, unknown>]>) {
      const result = decision(tool, input)
      expect(result.behavior).toBe('deny')
      if (result.behavior === 'deny') expect(result.message).toContain('入口及其依赖必须放在客户工作区之外')
    }
    const alias = join(outside, `entry-${root === project ? 'project' : 'session'}`)
    symlinkSync(entry, alias)
    policy({ commands: [alias] })
    expect(decision('Bash', { command: alias }).behavior).toBe('deny')
    expect(decision('Write', { file_path: entry, content: 'bad' }).behavior).toBe('deny')
  }
})
test('R2 Grep body regex is not a filesystem path', () => {
  for (const pattern of ['/etc/passwd', '../', '~/', 'file:///etc/x']) {
    expect(decision('Grep', { path: project, pattern }).behavior).toBe('allow')
    expect(decision('Grep', { path: project, pattern, glob: '../*' }).behavior).toBe('deny')
    expect(decision('Glob', { path: project, pattern }).behavior).toBe('deny')
  }
})
