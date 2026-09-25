import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '../..')
const electronRoot = resolve(repoRoot, 'apps/electron')
const outfile = resolve(electronRoot, 'dist/renderer/preload.js')
const shim = resolve(electronRoot, 'src/main/lib/web-remote/full-ui/web-electron-shim.ts')

await mkdir(dirname(outfile), { recursive: true })
await build({
  entryPoints: [resolve(electronRoot, 'src/preload/index.ts')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  outfile,
  alias: { electron: shim },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  logLevel: 'info',
})
console.log(`web preload written: ${outfile}`)
