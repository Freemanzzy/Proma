/** Read-only diagnostics for suspected development processes. This script never signals processes. */
import { execFileSync } from 'child_process'
import { basename } from 'path'

const lines = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
const matches = lines.flatMap((line) => {
  const match = /^\s*(\d+)\s+(.+)$/.exec(line)
  if (!match) return []
  const pid = match[1]!
  const command = match[2]!
  if (!/(?:electronmon|node_modules\/electron\/dist\/Electron\.app\/Contents\/MacOS\/Electron)/i.test(command)) return []
  if (command.includes('dev-kill.ts')) return []
  const executable = command.split(/\s+/)[0]!
  return [`PID ${pid}: ${basename(executable)}`]
})

if (matches.length) {
  console.log('发现的疑似 dev 进程（只读报告，不结束进程）：')
  for (const item of matches) console.log(item)
} else {
  console.log('未发现疑似 dev 进程（只读检查；未结束任何进程）。')
}
