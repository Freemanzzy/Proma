import { execFile as execFileCallback, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:net'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getAgentSessionWorkspacePath } from './config-paths'
import type { SimulatorDevice, SimulatorPreviewStatus } from '@proma/shared'

const execFile = promisify(execFileCallback)
const SERVE_SIM = 'serve-sim@0.1.47'
const FIRST_PORT = 3200
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
  const found = paths.map((path) => join(path, command)).find((path) => require('node:fs').existsSync(path))
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

export async function getSimulatorPreviewStatus(): Promise<SimulatorPreviewStatus> { return { ...current } }

export async function startSimulatorPreview(udid: string): Promise<SimulatorPreviewStatus> {
  if (!/^[A-Fa-f0-9-]{20,}$/.test(udid)) throw new Error('模拟器 UDID 无效。')
  if (child && current.running && current.udid === udid) return { ...current }
  if (child) await stopSimulatorPreview()
  const devices = await listSimulatorDevices()
  const device = devices.find((item) => item.udid === udid)
  if (!device) throw new Error('找不到该 iOS 模拟器。')
  if (device.state !== 'Booted') await execFile('/usr/bin/xcrun', ['simctl', 'boot', udid])
  const npx = await verifyNode()
  const port = await choosePort(portAvailable)
  const proc = spawn(npx, buildServeSimArgs(udid, port), { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  child = proc
  currentUdid = udid
  const url = `http://127.0.0.1:${port}`
  let output = ''
  proc.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
  proc.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
  proc.once('exit', (code) => { if (child === proc) { child = null; current = { running: false, error: `serve-sim 已退出（${code ?? '未知'}）：${output.trim().slice(-500)}` } } })
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (child !== proc) throw new Error(current.error || 'serve-sim 启动失败。')
    try { const response = await fetch(url); if (response.ok) { current = { running: true, udid, url }; return { ...current } } } catch { /* wait for server */ }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  await stopSimulatorPreview()
  throw new Error(`serve-sim 启动超时。${output.trim().slice(-500)}`)
}

export async function stopSimulatorPreview(udid = currentUdid): Promise<void> {
  const ownChild = child
  if (udid) {
    try { const npx = await verifyNode(); await execFile(npx, buildKillArgs(udid), { timeout: 15_000 }) } catch { /* PID fallback below */ }
  }
  if (ownChild?.pid && child === ownChild) {
    terminateOwnedChild(ownChild)
    await new Promise((resolve) => setTimeout(resolve, 800))
    if (ownChild.exitCode === null && ownChild.pid) ownChild.kill('SIGKILL')
  }
  child = null; currentUdid = undefined; current = { running: false }
}

export async function pressSimulatorHome(udid: string): Promise<void> {
  const npx = await verifyNode(); await execFile(npx, ['--yes', SERVE_SIM, 'button', 'home', '--device', udid], { timeout: 15_000 })
}

export async function captureSimulatorScreenshot(udid: string, sessionId: string, workspaceSlug: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId) || !/^[A-Za-z0-9_-]+$/.test(workspaceSlug)) throw new Error('会话或工作区标识无效。')
  const dir = join(getAgentSessionWorkspacePath(workspaceSlug, sessionId), 'attachments')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `simulator-${Date.now()}.png`)
  await execFile('/usr/bin/xcrun', ['simctl', 'io', udid, 'screenshot', path], { timeout: 30_000 })
  return path
}

export async function cleanupSimulatorPreview(): Promise<void> { if (child) await stopSimulatorPreview(currentUdid) }
