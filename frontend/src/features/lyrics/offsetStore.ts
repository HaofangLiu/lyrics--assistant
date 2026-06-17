import { readJson, writeJson } from '../storage/localStore'

const OFFSET_KEY = 'lyrics-assistant-sync-offsets'

type OffsetMap = Record<string, number>

export function getLyricOffset(songId: string) {
  return readJson<OffsetMap>(OFFSET_KEY, {})[songId] ?? 0
}

export function saveLyricOffset(songId: string, offsetMs: number) {
  const offsets = readJson<OffsetMap>(OFFSET_KEY, {})
  writeJson(OFFSET_KEY, {
    ...offsets,
    [songId]: Math.round(offsetMs),
  })
}
