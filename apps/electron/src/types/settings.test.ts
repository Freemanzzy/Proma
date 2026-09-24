import { describe, expect, test } from 'bun:test'
import { CURRENT_ONBOARDING_VERSION, hasCompletedCurrentOnboarding, normalizeThemeSettings, THEME_MODE_OPTIONS } from './settings'

describe('Onboarding completion version', () => {
  test('Given an existing completed installation without a version When checking Then requires the new onboarding', () => {
    expect(hasCompletedCurrentOnboarding({ onboardingCompleted: true })).toBe(false)
  })

  test('Given the current version is completed When checking Then does not show onboarding again', () => {
    expect(hasCompletedCurrentOnboarding({
      onboardingCompleted: true,
      onboardingVersion: CURRENT_ONBOARDING_VERSION,
    })).toBe(true)
  })

  test('Given a newer version is completed When checking after a rollback Then does not show an older onboarding', () => {
    expect(hasCompletedCurrentOnboarding({
      onboardingCompleted: true,
      onboardingVersion: CURRENT_ONBOARDING_VERSION + 1,
    })).toBe(true)
  })

  test('Given the current version is not completed When checking Then shows onboarding', () => {
    expect(hasCompletedCurrentOnboarding({
      onboardingCompleted: false,
      onboardingVersion: CURRENT_ONBOARDING_VERSION,
    })).toBe(false)
  })
})

describe('Theme settings migration', () => {
  test('Given legacy special mode When normalizing Then uses system mode and default style', () => {
    expect(normalizeThemeSettings('special', 'forest-light')).toEqual({
      themeMode: 'system',
      themeStyle: 'default',
    })
  })

  test('Given a non-default cached style When normalizing Then uses system mode and default style', () => {
    expect(normalizeThemeSettings('dark', 'ocean-dark')).toEqual({
      themeMode: 'system',
      themeStyle: 'default',
    })
  })

  test('Given the three supported modes When listing options Then no special mode is exposed', () => {
    expect(THEME_MODE_OPTIONS.map((option) => option.value)).toEqual(['light', 'dark', 'system'])
  })
})
