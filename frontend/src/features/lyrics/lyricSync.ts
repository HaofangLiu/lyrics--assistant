import type { SongMatch } from '../recognition/types'
import type { LyricsDocument } from './types'

export function getCurrentPositionMs(song: SongMatch, offsetMs: number) {
  const startedAt = new Date(song.playbackStartedAt).getTime()
  const elapsed = Date.now() - startedAt
  return Math.max(0, song.estimatedPositionMs + elapsed + offsetMs)
}

export function findActiveLyricIndex(
  document: LyricsDocument,
  positionMs: number,
  durationSec?: number,
) {
  if (document.lines.length === 0) {
    return 0
  }

  if (!document.synced) {
    if (!durationSec || durationSec <= 0 || document.lines.length === 1) {
      return 0
    }

    const durationMs = durationSec * 1000
    const progress = Math.min(1, Math.max(0, positionMs / durationMs))
    return Math.min(document.lines.length - 1, Math.floor(progress * document.lines.length))
  }

  const index = document.lines.findIndex((line, currentIndex) => {
    const next = document.lines[currentIndex + 1]
    return positionMs >= line.startMs && (!next || positionMs < next.startMs)
  })

  if (index >= 0) {
    return index
  }

  return positionMs < document.lines[0]?.startMs ? 0 : document.lines.length - 1
}
