/**
 * 主题状态原子
 *
 * 管理应用主题模式（浅色/深色/跟随系统/特殊风格）和特殊风格。
 * - themeModeAtom: 用户选择的主题模式，持久化到 ~/.proma/settings.json
 * - themeStyleAtom: 特殊风格主题
 * - systemIsDarkAtom: 系统当前是否为深色模式
 * - resolvedThemeAtom: 派生的最终主题（light | dark）
 *
 * 使用 localStorage 作为缓存，避免页面加载时闪烁。
 */

import { atom } from 'jotai'
import { THEME_STYLES, normalizeThemeSettings, type ThemeMode, type ThemeStyle } from '../../types'

/** localStorage 缓存键 */
const THEME_CACHE_KEY = 'proma-theme-mode'
const THEME_STYLE_CACHE_KEY = 'proma-theme-style'

/** 从 localStorage 读取并迁移主题设置；特殊风格永远不会参与首帧渲染。 */
function getCachedThemeSettings(): { themeMode: ThemeMode; themeStyle: ThemeStyle } {
  try {
    return normalizeThemeSettings(
      localStorage.getItem(THEME_CACHE_KEY),
      localStorage.getItem(THEME_STYLE_CACHE_KEY),
    )
  } catch {
    return normalizeThemeSettings(undefined, undefined)
  }
}

function getCachedThemeMode(): ThemeMode {
  return getCachedThemeSettings().themeMode
}

function getCachedThemeStyle(): ThemeStyle {
  return getCachedThemeSettings().themeStyle
}

/** 缓存主题模式到 localStorage */
function cacheThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, normalizeThemeSettings(mode, 'default').themeMode)
  } catch {
    // localStorage 不可用时忽略
  }
}

/** 缓存特殊风格到 localStorage；个人版始终写入默认风格。 */
function cacheThemeStyle(style: ThemeStyle): void {
  try {
    localStorage.setItem(THEME_STYLE_CACHE_KEY, normalizeThemeSettings('system', style).themeStyle)
  } catch {
    // localStorage 不可用时忽略
  }
}

/** 用户选择的主题模式 */
export const themeModeAtom = atom<ThemeMode>(getCachedThemeMode())

/** 用户选择的特殊风格 */
export const themeStyleAtom = atom<ThemeStyle>(getCachedThemeStyle())

/** 系统当前是否为深色模式 */
export const systemIsDarkAtom = atom<boolean>(true)

/** 派生：最终解析的主题（light | dark） */
export const resolvedThemeAtom = atom<'light' | 'dark'>((get) => {
  const normalized = normalizeThemeSettings(get(themeModeAtom), get(themeStyleAtom))
  if (normalized.themeMode === 'system') {
    return get(systemIsDarkAtom) ? 'dark' : 'light'
  }
  return normalized.themeMode === 'dark' ? 'dark' : 'light'
})

/** 所有特殊风格 class（用于清理旧值）— 从 THEME_STYLES 单一源派生，排除 'default' */
const ALL_THEME_STYLE_CLASSES = THEME_STYLES
  .filter((style) => style !== 'default')
  .map((style) => `theme-${style}` as const)

/**
 * 应用主题到 DOM
 *
 * 在 <html> 元素上切换 dark 类名和特殊风格类名。
 *
 * 幂等实现：先计算目标 class 状态，与当前 DOM 对比，一致时直接 return，
 * 不触发任何 classList mutation。避免与 vibrancy 合成层叠加
 * 导致 Chromium 重建合成层造成的全屏闪烁。
 */
export function applyThemeToDOM(themeMode: ThemeMode, themeStyle: ThemeStyle = 'default', systemIsDark: boolean = true): void {
  const html = document.documentElement

  // 计算目标状态；旧特殊风格一律迁移为 system/default。
  const normalized = normalizeThemeSettings(themeMode, themeStyle)
  let targetStyleClass: string | null = null
  let targetIsDark: boolean

  if (normalized.themeMode === 'system') {
    targetIsDark = systemIsDark
  } else {
    targetIsDark = normalized.themeMode === 'dark'
  }

  // 读取当前状态
  const currentIsDark = html.classList.contains('dark')
  const currentStyleClass = ALL_THEME_STYLE_CLASSES.find((c) => html.classList.contains(c)) ?? null

  // 与目标一致 → 直接跳过，避免触发 CSS 重新级联
  if (currentIsDark === targetIsDark && currentStyleClass === targetStyleClass) {
    return
  }

  // [FLASH-DEBUG] 仅在真正发生 DOM 变更时打印
  console.log(
    `[FLASH-DEBUG] applyThemeToDOM apply: mode=${themeMode}, style=${themeStyle}, systemIsDark=${systemIsDark}, diff={dark: ${currentIsDark}→${targetIsDark}, style: ${currentStyleClass}→${targetStyleClass}}`
  )

  // 只修改确实需要变的 class
  if (currentStyleClass !== targetStyleClass) {
    if (currentStyleClass) {
      html.classList.remove(currentStyleClass)
    }
    if (targetStyleClass) {
      html.classList.add(targetStyleClass)
    }
  }
  if (currentIsDark !== targetIsDark) {
    html.classList.toggle('dark', targetIsDark)
  }
}

/**
 * 初始化主题系统
 *
 * 从主进程加载设置，监听系统主题变化。
 * 返回清理函数。
 */
export async function initializeTheme(
  setThemeMode: (mode: ThemeMode) => void,
  setSystemIsDark: (isDark: boolean) => void,
  setThemeStyle?: (style: ThemeStyle) => void,
): Promise<() => void> {
  // 从主进程加载持久化设置
  const settings = await window.electronAPI.getSettings()
  const normalized = normalizeThemeSettings(settings.themeMode, settings.themeStyle)
  setThemeMode(normalized.themeMode)
  cacheThemeMode(normalized.themeMode)
  if (setThemeStyle) {
    setThemeStyle(normalized.themeStyle)
    cacheThemeStyle(normalized.themeStyle)
  }

  // 获取系统主题
  const isDark = await window.electronAPI.getSystemTheme()
  setSystemIsDark(isDark)

  // 监听系统主题变化
  const cleanupSystem = window.electronAPI.onSystemThemeChanged((newIsDark) => {
    setSystemIsDark(newIsDark)
  })

  // 监听用户手动切换主题（跨窗口同步，如 Quick Task 面板）
  const cleanupThemeSettings = window.electronAPI.onThemeSettingsChanged((payload) => {
    const normalized = normalizeThemeSettings(payload.themeMode, payload.themeStyle)
    setThemeMode(normalized.themeMode)
    cacheThemeMode(normalized.themeMode)
    if (setThemeStyle) {
      setThemeStyle(normalized.themeStyle)
      cacheThemeStyle(normalized.themeStyle)
    }
  })

  return () => {
    cleanupSystem()
    cleanupThemeSettings()
  }
}

/**
 * 更新主题模式并持久化
 *
 * 同时更新 localStorage 缓存和主进程配置文件。
 */
export async function updateThemeMode(mode: ThemeMode): Promise<void> {
  const normalized = normalizeThemeSettings(mode, 'default')
  cacheThemeMode(normalized.themeMode)
  cacheThemeStyle(normalized.themeStyle)
  await window.electronAPI.updateSettings(normalized)
}

/**
 * 更新特殊风格并持久化
 */
export async function updateThemeStyle(style: ThemeStyle): Promise<void> {
  const normalized = normalizeThemeSettings('system', style)
  cacheThemeStyle(normalized.themeStyle)
  await window.electronAPI.updateSettings({ themeStyle: normalized.themeStyle })
}
