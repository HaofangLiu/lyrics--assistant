import { useEffect, useRef, useState } from 'react'
import { getSettings } from '../settings/settingsStore'
import { recognizeCurrentSong } from '../recognition/recognitionService'
import type { SongMatch } from '../recognition/types'

const END_CHECK_LEAD_MS = 12_000
const AFTER_END_RETRY_MS = 10_000
const MIN_DURATION_CHECK_DELAY_MS = 8_000

export type SingAlongStatus =
  | 'idle'
  | 'waiting'
  | 'listening'
  | 'recognizing'
  | 'same-song'
  | 'new-song'
  | 'failed'

type UseSingAlongSessionArgs = {
  enabled: boolean
  currentSong?: SongMatch
  onSongChange: (song: SongMatch) => void
}

export function useSingAlongSession({
  enabled,
  currentSong,
  onSongChange,
}: UseSingAlongSessionArgs) {
  const [status, setStatus] = useState<SingAlongStatus>('idle')
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null)
  const currentSongRef = useRef(currentSong)
  const onSongChangeRef = useRef(onSongChange)

  currentSongRef.current = currentSong
  onSongChangeRef.current = onSongChange

  useEffect(() => {
    if (!enabled || !currentSong) {
      setStatus('idle')
      return
    }

    let cancelled = false

    const run = async () => {
      while (!cancelled) {
        const settings = getSettings()
        setStatus('waiting')
        await wait(getNextCheckDelayMs(currentSongRef.current, settings.followCheckIntervalSec))

        if (cancelled) {
          return
        }

        try {
          setStatus('listening')
          const result = await recognizeCurrentSong({
            onPhase: (phase) => setStatus(phase === 'listening' ? 'listening' : 'recognizing'),
          })

          if (cancelled) {
            return
          }

          setLastCheckedAt(new Date().toISOString())

          if (result.song.id !== currentSongRef.current?.id) {
            setStatus('new-song')
            onSongChangeRef.current(result.song)
          } else {
            setStatus('same-song')
          }
        } catch {
          if (!cancelled) {
            setStatus('failed')
            setLastCheckedAt(new Date().toISOString())
          }
        }
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [currentSong?.id, enabled])

  return {
    status,
    lastCheckedAt,
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function getNextCheckDelayMs(song: SongMatch | undefined, fallbackIntervalSec: number) {
  if (!song?.durationSec) {
    return fallbackIntervalSec * 1000
  }

  const remainingMs = song.durationSec * 1000 - getEstimatedPositionMs(song)
  if (remainingMs <= 0) {
    return AFTER_END_RETRY_MS
  }

  return Math.max(MIN_DURATION_CHECK_DELAY_MS, remainingMs - END_CHECK_LEAD_MS)
}

function getEstimatedPositionMs(song: SongMatch) {
  const startedAt = new Date(song.playbackStartedAt).getTime()
  const elapsed = Date.now() - startedAt
  return Math.max(0, song.estimatedPositionMs + elapsed)
}
