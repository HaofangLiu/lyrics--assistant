import { useSyncExternalStore } from 'react'
import { readJson, writeJson } from '../storage/localStore'

const SETTINGS_KEY = 'lyrics-assistant-settings'
export const SAMPLE_DURATION_OPTIONS = [8, 12, 15] as const
export const FOLLOW_CHECK_INTERVAL_OPTIONS = [60, 90, 120] as const

export type AppSettings = {
  sampleDurationSec: number
  autoFollowEnabled: boolean
  followCheckIntervalSec: number
  fontScale: number
  keepScreenAwake: boolean
}

const defaultSettings: AppSettings = {
  sampleDurationSec: 8,
  autoFollowEnabled: true,
  followCheckIntervalSec: 90,
  fontScale: 1,
  keepScreenAwake: true,
}

let currentSettings = normalizeSettings(readJson<Partial<AppSettings>>(SETTINGS_KEY, defaultSettings))
const listeners = new Set<() => void>()

export function getSettings() {
  return currentSettings
}

export function updateSettings(patch: Partial<AppSettings>) {
  currentSettings = normalizeSettings({
    ...currentSettings,
    ...patch,
  })
  writeJson(SETTINGS_KEY, currentSettings)
  listeners.forEach((listener) => listener())
}

export function useSettings() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => currentSettings,
    () => defaultSettings,
  )
}

function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  return {
    sampleDurationSec: normalizeNumberOption(
      settings.sampleDurationSec,
      SAMPLE_DURATION_OPTIONS,
      defaultSettings.sampleDurationSec,
    ),
    autoFollowEnabled: settings.autoFollowEnabled ?? defaultSettings.autoFollowEnabled,
    followCheckIntervalSec: normalizeNumberOption(
      settings.followCheckIntervalSec,
      FOLLOW_CHECK_INTERVAL_OPTIONS,
      defaultSettings.followCheckIntervalSec,
    ),
    fontScale: Math.min(1.4, Math.max(0.8, settings.fontScale ?? defaultSettings.fontScale)),
    keepScreenAwake: settings.keepScreenAwake ?? defaultSettings.keepScreenAwake,
  }
}

function normalizeNumberOption(
  value: number | undefined,
  options: readonly number[],
  fallback: number,
) {
  return typeof value === 'number' && options.includes(value) ? value : fallback
}
