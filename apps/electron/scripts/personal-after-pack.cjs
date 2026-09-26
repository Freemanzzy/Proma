const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (process.env.PROMA_PERSONAL_BUILD !== '1') return
  const projectDir = context.packager.projectDir
  const resources = join(context.appOutDir, 'Proma.app', 'Contents', 'Resources')
  mkdirSync(resources, { recursive: true })
  let commit = 'unknown'
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectDir, encoding: 'utf8' }).trim()
  } catch {}
  const version = require(join(projectDir, 'package.json')).version
  const marker = { personal: true, version, commit, builtAt: new Date().toISOString() }
  writeFileSync(join(resources, 'personal-build.json'), `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o644 })
  // electron-builder emits this because upstream's publish provider is configured.
  // Personal builds never read it; remove it as defense in depth.
  const updateConfig = join(resources, 'app-update.yml')
  if (existsSync(updateConfig)) rmSync(updateConfig)
}
