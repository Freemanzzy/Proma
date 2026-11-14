import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Pi 0.87 does not export path-utils through its package exports. Keep this
// equivalent to resolveToCwd/normalizePath; differential tests pin that contract.
export function normalizePiPath(input: string, toolPath = true): string {
  let path = toolPath ? input.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ') : input
  if (toolPath && path.startsWith('@')) path = path.slice(1)
  if (process.platform === 'win32' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')) {
    const match = path.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i)
    if (match) path = `${match[1]!.toUpperCase()}:\\${match[2]?.replaceAll('/', '\\') ?? ''}`
  }
  if (path === '~') return homedir()
  if (path.startsWith('~/') || (process.platform === 'win32' && path.startsWith('~\\'))) return join(homedir(), path.slice(2))
  return /^file:\/\//.test(path) ? fileURLToPath(path) : path
}

export function resolvePiPath(path: string, cwd: string): string {
  return resolve(normalizePiPath(cwd, false), normalizePiPath(path))
}

export function realPathThroughParent(path: string): string {
  let cursor = resolve(path)
  const missing: string[] = []
  while (!existsSync(cursor)) {
    // A dangling symlink is not a missing directory: fail closed.
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error('Dangling symlink') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error('No existing parent')
    missing.unshift(basename(cursor))
    cursor = parent
  }
  return resolve(realpathSync(cursor), ...missing)
}

/** Validate a final absolute filesystem path without Pi input normalization. */
export function absolutePathWithinRoots(path: string, roots: string[]): boolean {
  if (!isAbsolute(path) || path.includes('\0') || roots.length === 0) return false
  try {
    const target = realPathThroughParent(path)
    return roots.some((root) => pathWithinRoot(target, realPathThroughParent(root)))
  } catch { return false }
}

export function pathWithinRoot(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

export function piPathWithinRoots(path: string, roots: string[], cwd: string): boolean {
  if (!path.trim() || path.includes('\0')) return false
  try { return absolutePathWithinRoots(resolvePiPath(path, cwd), roots) } catch { return false }
}

// Pi Read also tries macOS screenshot filename variants before opening a file.
export function resolvePiReadPath(path: string, cwd: string): string {
  const resolved = resolvePiPath(path, cwd)
  const nfd = resolved.normalize('NFD')
  return [resolved, resolved.replace(/ (AM|PM)\./gi, '\u202F$1.'), nfd,
    resolved.replace(/'/g, '\u2019'), nfd.replace(/'/g, '\u2019')].find((p) => existsSync(p)) ?? resolved
}
