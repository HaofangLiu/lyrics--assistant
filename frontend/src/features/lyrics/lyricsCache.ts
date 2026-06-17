import { readJson, writeJson } from '../storage/localStore'
import type { LyricsDocument } from './types'

const CACHE_KEY = 'lyrics-assistant-lyrics-cache'

type LyricsCache = Record<string, LyricsDocument>

export function getCachedLyrics(songId: string) {
  return readJson<LyricsCache>(CACHE_KEY, {})[songId]
}

export function saveLyrics(document: LyricsDocument) {
  const cache = readJson<LyricsCache>(CACHE_KEY, {})
  writeJson(CACHE_KEY, {
    ...cache,
    [document.songId]: document,
  })
}
