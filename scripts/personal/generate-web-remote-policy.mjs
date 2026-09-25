#!/usr/bin/env node
/** Generate the reviewed IPC-channel draft from source constants.
 *
 * This intentionally emits a conservative draft only. channel-policy.ts contains
 * the checked-in human-reviewed classifications and rationale used at runtime.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const roots = [resolve(root, 'packages/shared/src/types'), resolve(root, 'apps/electron/src/types'), resolve(root, 'apps/electron/src/main/lib/updater')]
const files = []
function collect(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) collect(path)
    else if (/\.ts$/.test(name)) files.push(path)
  }
}
for (const dir of roots) collect(dir)

const channels = new Map()
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const declaration = /export\s+const\s+(\w*IPC_CHANNELS)\s*=\s*\{([\s\S]*?)\}\s*(?:as const)?/g
  for (const match of source.matchAll(declaration)) {
    for (const value of match[2].matchAll(/:\s*(['"])([^'"\n]+)\1/g)) {
      channels.set(value[2], { level: 'denied', rationale: `初稿：${match[1]}，待人工复核；来源 ${file.replace(`${root}/`, '')}` })
    }
  }
}
const draft = Object.fromEntries([...channels.entries()].sort((a, b) => a[0].localeCompare(b[0])))
const out = process.argv[2] ? resolve(process.argv[2]) : ''
if (out) writeFileSync(out, `${JSON.stringify(draft, null, 2)}\n`)
else process.stdout.write(`${JSON.stringify(draft, null, 2)}\n`)
console.error(`generated ${Object.keys(draft).length} channel drafts`)
