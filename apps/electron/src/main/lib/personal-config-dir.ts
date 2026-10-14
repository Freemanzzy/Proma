const DEV_CONFIG_DIR_NAME_PATTERN = /^\.proma-dev-[a-z0-9-]+$/

export interface PersonalConfigDirResolution {
  name: '.proma' | '.proma-dev' | string
  warning?: string
}

/** Resolve the config root without allowing a dev override to escape its namespace. */
export function resolvePersonalConfigDirName(
  isPackaged: boolean,
  requestedName: string | undefined,
): PersonalConfigDirResolution {
  if (isPackaged) {
    return {
      name: '.proma',
      ...(requestedName === undefined ? {} : { warning: 'PROMA_DEV_DATA_DIR_NAME 在打包版中被忽略，打包版始终使用 ~/.proma/' }),
    }
  }

  if (requestedName !== undefined) {
    if (DEV_CONFIG_DIR_NAME_PATTERN.test(requestedName)) return { name: requestedName }
    return {
      name: '.proma-dev',
      warning: 'PROMA_DEV_DATA_DIR_NAME 无效（仅允许匹配 ^\\.proma-dev-[a-z0-9-]+$），已回退到 ~/.proma-dev/',
    }
  }

  return { name: '.proma-dev' }
}
