import { useEffect, useRef, useState } from 'react'
import { recognizeCurrentSong } from '../recognition/recognitionService'
import { releaseMicrophoneStream } from '../recognition/audioCapture'
import { RecognitionError, type SongMatch } from '../recognition/types'

// 提前 12 秒触发识别，给录音 8s + 网络 ~2s 留余量
const LEAD_TIME_MS = 12_000
// 两次检查之间的最小间隔，防止结尾处连续识别烧配额
const MIN_CHECK_DELAY_MS = 5_000
// 没识别到（多半是歌间隙 / 广告），7 秒后重试
const NO_MATCH_RETRY_MS = 7_000
// 连续没识别到最多重试 3 次就放弃，靠用户手动按按钮
const MAX_NO_MATCH_RETRIES = 3
// 网络等错误时的重试间隔
const ERROR_RETRY_MS = 8_000

export type SingAlongStatus =
  | 'idle'
  | 'waiting'
  | 'listening'
  | 'recognizing'
  | 'same-song'
  | 'new-song'
  | 'no-match'
  | 'failed'

type UseSingAlongSessionArgs = {
  enabled: boolean
  currentSong?: SongMatch
  onSongChange: (song: SongMatch) => void
  onReanchor?: (song: SongMatch) => void
  fallbackIntervalSec?: number
}

export function useSingAlongSession({
  enabled,
  currentSong,
  onSongChange,
  onReanchor,
  fallbackIntervalSec = 90,
}: UseSingAlongSessionArgs) {
  const [status, setStatus] = useState<SingAlongStatus>('idle')
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null)

  const onSongChangeRef = useRef(onSongChange)
  const onReanchorRef = useRef(onReanchor)
  onSongChangeRef.current = onSongChange
  onReanchorRef.current = onReanchor

  useEffect(() => {
    if (!enabled || !currentSong) {
      setStatus('idle')
      return
    }

    let cancelled = false
    let timer: number | undefined
    let retryCount = 0

    const scheduleCheck = () => {
      if (cancelled) return

      const song = currentSong
      let delay: number

      if (song.durationSec) {
        // 有歌曲时长：算出距结尾还剩多久，提前 LEAD_TIME 触发
        const remainingMs = song.durationSec * 1000 - getEstimatedPositionMs(song)
        delay = Math.max(MIN_CHECK_DELAY_MS, remainingMs - LEAD_TIME_MS)
      } else {
        // 没有时长：无法预测结束点，退化为固定间隔
        delay = fallbackIntervalSec * 1000
      }

      setStatus('waiting')
      timer = window.setTimeout(runCheck, delay)
    }

    const runCheck = async () => {
      if (cancelled) return

      try {
        setStatus('listening')
        const result = await recognizeCurrentSong({
          onPhase: (phase) => {
            if (!cancelled) setStatus(phase === 'listening' ? 'listening' : 'recognizing')
          },
        })

        if (cancelled) return

        setLastCheckedAt(new Date().toISOString())
        retryCount = 0

        if (result.song.id !== currentSong.id) {
          // 切歌了：交给上层导航，effect 会因 songId 变化重启
          setStatus('new-song')
          onSongChangeRef.current(result.song)
        } else {
          // 同一首歌：re-anchor 校正漂移，effect 因 playbackStartedAt 变化重启，
          // 自动用新位置重新排定下一次检查
          setStatus('same-song')
          onReanchorRef.current?.(result.song)
        }
      } catch (error) {
        if (cancelled) return

        setLastCheckedAt(new Date().toISOString())

        if (error instanceof RecognitionError && error.code === 'recognition-no-match') {
          retryCount += 1
          if (retryCount <= MAX_NO_MATCH_RETRIES) {
            setStatus('no-match')
            timer = window.setTimeout(runCheck, NO_MATCH_RETRY_MS)
          } else {
            setStatus('idle')
          }
        } else {
          setStatus('failed')
          timer = window.setTimeout(runCheck, ERROR_RETRY_MS)
        }
      }
    }

    scheduleCheck()

    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [currentSong?.id, currentSong?.durationSec, currentSong?.playbackStartedAt, enabled, fallbackIntervalSec])

  useEffect(() => () => releaseMicrophoneStream(), [])

  return { status, lastCheckedAt }
}

function getEstimatedPositionMs(song: SongMatch) {
  const startedAt = new Date(song.playbackStartedAt).getTime()
  const elapsed = Date.now() - startedAt
  return Math.max(0, song.estimatedPositionMs + elapsed)
}
