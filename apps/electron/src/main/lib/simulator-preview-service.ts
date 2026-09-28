import { execFile as execFileCallback, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:net'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAgentSessionWorkspacePath } from './config-paths'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import type { SimulatorDevice, SimulatorPreviewStatus, SimulatorPreviewStream } from '@proma/shared'

const execFile = promisify(execFileCallback)
const SERVE_SIM = 'serve-sim@0.1.47'
const FIRST_PORT = 3200

interface ServeSimInvocation { command: string; scriptPath?: string; env: NodeJS.ProcessEnv }

function findBundledServeSimScript(): string | undefined {
  const require = createRequire(__filename)
  const searchPaths = require.resolve.paths('serve-sim') ?? []
  const candidates = searchPaths.map((nodeModules) => join(nodeModules, 'serve-sim', 'dist', 'serve-sim.js'))
  const packagedResource = process.resourcesPath
    ? join(process.resourcesPath, 'serve-sim', 'node_modules', 'serve-sim', 'dist', 'serve-sim.js')
    : undefined
  // Packaged ESM dependencies live together under Resources/serve-sim, outside ASAR.
  // The standard app/node_modules candidates remain for development builds.
  const unpacked = candidates.map((candidate) => candidate.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'))
  return [packagedResource, ...unpacked, ...candidates].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))
}

async function getServeSimInvocation(): Promise<ServeSimInvocation> {
  const bundledScript = findBundledServeSimScript()
  if (bundledScript) {
    return {
      command: process.execPath,
      scriptPath: bundledScript,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    }
  }
  return { command: await verifyNode(), env: { ...process.env } }
}

function invocationArgs(invocation: ServeSimInvocation, args: string[]): string[] {
  const cliArgs = args[0] === '--yes' && args[1] === SERVE_SIM ? args.slice(2) : args
  return invocation.scriptPath ? [invocation.scriptPath, ...cliArgs] : args
}

async function runServeSim(args: string[], timeout = 15_000): Promise<void> {
  const invocation = await getServeSimInvocation()
  await execFile(invocation.command, invocationArgs(invocation, args), { env: invocation.env, timeout })
}
export function buildServeSimArgs(udid: string, port: number): string[] { return ['--yes', SERVE_SIM, '--host', '127.0.0.1', '--port', String(port), '--fit', '--panes', 'none', '-q', udid] }
export function buildKillArgs(udid: string): string[] {
  if (!udid) throw new Error('停止 serve-sim 必须指定模拟器 UDID。')
  return ['--yes', SERVE_SIM, '--kill', udid]
}
export function terminateOwnedChild(proc: Pick<ChildProcess, 'pid' | 'exitCode' | 'kill'> | null): void {
  if (!proc?.pid || proc.exitCode !== null) return
  proc.kill('SIGTERM')
}
let child: ChildProcess | null = null
let current: SimulatorPreviewStatus = { running: false }
let currentUdid: string | undefined

export function choosePort(isAvailable: (port: number) => Promise<boolean>, start = FIRST_PORT): Promise<number> {
  return (async () => { for (let port = start; port < start + 100; port++) if (await isAvailable(port)) return port; throw new Error('找不到可用的模拟器预览端口（3200–3299）。') })()
}

async function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => { const server = createServer(); server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => server.close(() => resolve(true))) })
}

function commandPath(command: string): string {
  const paths = (process.env.PATH ?? '').split(':')
  const found = paths.map((path) => join(path, command)).find((path) => existsSync(path))
  if (!found) throw new Error(`未找到 ${command}。请安装 Node.js 20 或更新版本，并确保其位于登录 shell 的 PATH 中。`)
  return found
}

async function verifyNode(): Promise<string> {
  const node = commandPath('node')
  const { stdout } = await execFile(node, ['--version'])
  const major = Number(stdout.trim().replace(/^v/, '').split('.')[0])
  if (!Number.isFinite(major) || major < 20) throw new Error(`serve-sim 需要 Node.js 20 或更新版本；当前版本为 ${stdout.trim() || '未知'}。`)
  return commandPath('npx')
}

export async function listSimulatorDevices(): Promise<SimulatorDevice[]> {
  const { stdout } = await execFile('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'available', '-j'])
  const data = JSON.parse(stdout) as { devices?: Record<string, Array<{ udid: string; name: string; state: string }>> }
  return Object.entries(data.devices ?? {}).filter(([runtime]) => /\.iOS-|\.iPadOS-/i.test(runtime)).flatMap(([runtime, devices]) => devices.map(({ udid, name, state }) => ({ udid, name, state, runtime })))
}

/** serve-sim 在 $TMPDIR/serve-sim/server-<udid>.json 登记每个流；只取本进程拉起的 serve-sim（按 PID 过滤）。 */
export async function readServeSimStreams(pid: number, dir = join(tmpdir(), 'serve-sim')): Promise<string[]> {
  let names: string[] = []
  try { names = await readdir(dir) } catch { return [] }
  const devices: string[] = []
  for (const name of names) {
    if (!/^server-.+\.json$/.test(name)) continue
    try {
      const entry = JSON.parse(await readFile(join(dir, name), 'utf8')) as { pid?: number; device?: string }
      if (entry.pid === pid && typeof entry.device === 'string') devices.push(entry.device)
    } catch { /* 忽略不完整的状态文件 */ }
  }
  return devices
}

/** 实际显示的设备：优先启动时指定且仍在运行的设备，否则取流中第一个已启动的设备。 */
export function pickActiveDevice(launched: string | undefined, streams: SimulatorPreviewStream[]): string | undefined {
  if (launched && streams.some((stream) => stream.udid === launched && stream.booted)) return launched
  return streams.find((stream) => stream.booted)?.udid ?? launched
}

export async function getSimulatorPreviewStatus(): Promise<SimulatorPreviewStatus> {
  if (!current.running || !child?.pid) return { ...current }
  const devices = await readServeSimStreams(child.pid)
  if (!devices.length) return { ...current }
  const booted = new Set((await listSimulatorDevices().catch(() => [])).filter((device) => device.state === 'Booted').map((device) => device.udid))
  const streams = devices.map((udid) => ({ udid, booted: booted.has(udid) }))
  return { ...current, udid: pickActiveDevice(currentUdid, streams), streams }
}

export function shouldRetryBundledServeSim(isBundled: boolean, exitCode: number | null, output: string): boolean {
  return isBundled && (exitCode !== 0 || /ERR_MODULE_NOT_FOUND|Cannot find package/i.test(output))
}

function firstSafeErrorLine(output: string): string {
  const line = output.split(/\r?\n/).find((value) => value.trim())?.trim() || '未提供错误详情'
  return line.replace(/\/Users\/[^/\s]+/g, '[用户路径]').slice(0, 240)
}

export async function startSimulatorPreview(udid: string): Promise<SimulatorPreviewStatus> {
  if (!/^[A-Fa-f0-9-]{20,}$/.test(udid)) throw new Error('模拟器 UDID 无效。')
  if (child && current.running && current.udid === udid) return { ...current }
  if (child) await stopSimulatorPreview()
  const devices = await listSimulatorDevices()
  const device = devices.find((item) => item.udid === udid)
  if (!device) throw new Error('找不到该 iOS 模拟器。')
  if (device.state !== 'Booted') await execFile('/usr/bin/xcrun', ['simctl', 'boot', udid])
  const bundledInvocation = await getServeSimInvocation()
  const port = await choosePort(portAvailable)
  const env = { ...bundledInvocation.env }
  if (!env.HTTPS_PROXY && !env.https_proxy) { const proxy = await getEffectiveProxyUrl().catch(() => undefined); if (proxy) { env.HTTPS_PROXY = proxy; env.HTTP_PROXY = env.HTTP_PROXY ?? proxy } }
  const url = `http://127.0.0.1:${port}`
  let invocation = bundledInvocation
  let isBundled = Boolean(bundledInvocation.scriptPath)
  let retried = false
  let output = ''
  let exitCode: number | null = null
  let launchAt = Date.now()
  let proc: ChildProcess
  const launch = (next: ServeSimInvocation): ChildProcess => {
    launchAt = Date.now()
    output = ''
    exitCode = null
    const launched = spawn(next.command, invocationArgs(next, buildServeSimArgs(udid, port)), { env: next.env, stdio: ['ignore', 'pipe', 'pipe'] })
    child = launched
    launched.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    launched.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    launched.once('exit', (code) => {
      exitCode = code
      if (child === launched) {
        child = null
        current = { running: false, udid, error: `serve-sim 启动失败（退出码 ${code ?? '未知'}）：${firstSafeErrorLine(output)}` }
      }
    })
    return launched
  }
  proc = launch(invocation)
  currentUdid = udid
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (child !== proc) {
      if (!retried && Date.now() - launchAt <= 10_000 && shouldRetryBundledServeSim(isBundled, exitCode, output)) {
        retried = true
        isBundled = false
        try { invocation = { command: await verifyNode(), env: { ...env } } }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          current = { running: false, udid, error: `内置 serve-sim 启动失败，且无法启用 npx 回退（退出码 ${exitCode ?? '未知'}）：${firstSafeErrorLine(output || message)}` }
          throw new Error(current.error)
        }
        proc = launch(invocation)
        continue
      }
      const error = `serve-sim 启动失败（退出码 ${exitCode ?? '未知'}）：${firstSafeErrorLine(output)}`
      current = { running: false, udid, error }
      throw new Error(error)
    }
    try { const response = await fetch(url); if (response.ok) { current = { running: true, udid, url }; return { ...current } } } catch { /* wait for server */ }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  await stopSimulatorPreview()
  const error = `serve-sim 启动超时（120 秒）：${firstSafeErrorLine(output)}`
  current = { running: false, udid, error }
  throw new Error(error)
}

export async function stopSimulatorPreview(udid = currentUdid): Promise<void> {
  const ownChild = child
  // serve-sim 会跟随切换的设备登记多个流（同一 PID）；逐个按 UDID 停止，绝不使用无参 --kill。
  const targets = new Set<string>(udid ? [udid] : [])
  if (ownChild?.pid) for (const device of await readServeSimStreams(ownChild.pid)) targets.add(device)
  if (targets.size) {
    try { for (const target of targets) await runServeSim(buildKillArgs(target), 15_000).catch(() => undefined) } catch { /* PID fallback below */ }
  }
  if (ownChild?.pid && child === ownChild) {
    terminateOwnedChild(ownChild)
    await new Promise((resolve) => setTimeout(resolve, 800))
    if (ownChild.exitCode === null && ownChild.pid) ownChild.kill('SIGKILL')
  }
  child = null; currentUdid = undefined; current = { running: false }
}

export async function pressSimulatorHome(udid: string): Promise<void> {
  await runServeSim(['--yes', SERVE_SIM, 'button', 'home', '--device', udid], 15_000)
}

export async function captureSimulatorScreenshot(udid: string, sessionId: string, workspaceSlug: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId) || !/^[A-Za-z0-9_-]+$/.test(workspaceSlug)) throw new Error('会话或工作区标识无效。')
  const dir = join(getAgentSessionWorkspacePath(workspaceSlug, sessionId), 'attachments')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `simulator-${Date.now()}.png`)
  await execFile('/usr/bin/xcrun', ['simctl', 'io', udid, 'screenshot', path], { timeout: 30_000 })
  return path
}

/** 关闭模拟器本身（释放内存）；若正在预览该设备，先停止预览。 */
export async function shutdownSimulator(udid: string): Promise<void> {
  if (!/^[A-Fa-f0-9-]{20,}$/.test(udid)) throw new Error('模拟器 UDID 无效。')
  const status = await getSimulatorPreviewStatus()
  if (status.running && (status.udid === udid || status.streams?.some((stream) => stream.udid === udid))) await stopSimulatorPreview()
  await execFile('/usr/bin/xcrun', ['simctl', 'shutdown', udid], { timeout: 60_000 }).catch((error: { stderr?: string }) => {
    if (!/current state: Shutdown/i.test(error?.stderr ?? '')) throw error
  })
}

export async function cleanupSimulatorPreview(): Promise<void> { if (child) await stopSimulatorPreview(currentUdid) }
