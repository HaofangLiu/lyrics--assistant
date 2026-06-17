import type { SongMatch } from '../recognition/types'
import { readJson, writeJson } from './localStore'

const CURRENT_SONG_KEY = 'lyrics-assistant-current-song'

export function getCurrentSong() {
  return readJson<SongMatch | null>(CURRENT_SONG_KEY, null)
}

export function saveCurrentSong(song: SongMatch) {
  writeJson(CURRENT_SONG_KEY, song)
}
