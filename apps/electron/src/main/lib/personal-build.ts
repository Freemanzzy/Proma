import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** The marker is added only to a locally produced personal distribution. */
export function hasPersonalBuildMarker(resourcesPath: string): boolean {
  return existsSync(join(resourcesPath, 'personal-build.json'))
}

export function isPersonalBuild(): boolean {
  return typeof process.resourcesPath === 'string' && hasPersonalBuildMarker(process.resourcesPath)
}
