import { readJson, writeJson } from '../storage/localStore'
import type { LyricsDocument } from './types'

const CACHE_KEY = 'lyrics-assistant-lyrics-cache'
const MAX_ENTRIES = 50
const EMPTY_TTL_MS = 30 * 60 * 1000

type LyricsCache = Record<string, LyricsDocument>

export function getCachedLyrics(songId: string) {
  const cache = readJson<LyricsCache>(CACHE_KEY, {})
  const doc = cache[songId]
  if (!doc) {
    return undefined
  }

  if (doc.source === 'empty') {
    const age = Date.now() - new Date(doc.cachedAt).getTime()
    if (age > EMPTY_TTL_MS) {
      return undefined
    }
  }

  return doc
}

export function saveLyrics(document: LyricsDocument) {
  const cache = readJson<LyricsCache>(CACHE_KEY, {})
  cache[document.songId] = document

  const keys = Object.keys(cache)
  if (keys.length > MAX_ENTRIES) {
    const toRemove = keys
      .sort((a, b) => {
        const aTime = new Date(cache[a].cachedAt).getTime()
        const bTime = new Date(cache[b].cachedAt).getTime()
        return aTime - bTime
      })
      .slice(0, keys.length - MAX_ENTRIES)
    for (const key of toRemove) {
      delete cache[key]
    }
  }

  writeJson(CACHE_KEY, cache)
}
