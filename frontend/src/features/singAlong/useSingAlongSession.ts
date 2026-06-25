import { useEffect, useRef, useState } from 'react'
import { getSettings } from '../settings/settingsStore'
import { recognizeCurrentSong } from '../recognition/recognitionService'
import { releaseMicrophoneStream } from '../recognition/audioCapture'
import { RecognitionError, type SongMatch } from '../recognition/types'

// 跟唱采样时长：比手动稍长一点，提升车内噪声环境下 ACRCloud 命中率
const FOLLOW_SAMPLE_DURATION_MS = 8_000
// 预测歌曲结束前提前一点开始查，避免错过切歌瞬间
const END_LEAD_MS = 4_000
// 边界附近的最小检查间隔（密集轮询切歌）
const MIN_CHECK_INTERVAL_MS = 5_000
// 已知时长时的最大检查间隔：即便 play_offset 估算严重失真（比如返回 0），
// 也保证最多 这么久 就会重新识别一次，绝不会傻等一整首歌而停在上一首
const MAX_CHECK_INTERVAL_MS = 45_000
// 没匹配上（多半是歌曲之间的空隙 / 广告 / 说话）时，很快再试
const NO_MATCH_RETRY_MS = 7_000
// 网络等错误时的重试间隔
const ERROR_RETRY_MS = 8_000

type CheckOutcome = 'matched' | 'no-match' | 'error'

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
    if (!enabled) {
      releaseMicrophoneStream()
    }
  }, [enabled])

  useEffect(() => () => releaseMicrophoneStream(), [])

  useEffect(() => {
    if (!enabled || !currentSong) {
      setStatus('idle')
      return
    }

    let cancelled = false

    const run = async () => {
      // 上一轮检查的结果，用来决定下一轮等多久
      let lastOutcome: CheckOutcome = 'matched'
      // 闭包内独立维护"当前正在跟的歌"，用于排期与切歌判断。
      // 不依赖 currentSongRef（它会在每次重渲染时被 prop 覆盖），
      // 这样同曲命中时重新锚定的播放进度才不会被冲掉。
      let tracked = currentSongRef.current

      while (!cancelled) {
        const settings = getSettings()
        setStatus('waiting')
        await wait(getNextCheckDelayMs(tracked, settings.followCheckIntervalSec, lastOutcome))

        if (cancelled) {
          return
        }

        try {
          setStatus('listening')
          const result = await recognizeCurrentSong({
            durationMs: FOLLOW_SAMPLE_DURATION_MS,
            onPhase: (phase) => setStatus(phase === 'listening' ? 'listening' : 'recognizing'),
          })

          if (cancelled) {
            return
          }

          setLastCheckedAt(new Date().toISOString())
          lastOutcome = 'matched'

          if (result.song.id !== tracked?.id) {
            // 切歌了：交给上层换歌，本轮循环结束，effect 会因 songId 变化重启
            setStatus('new-song')
            onSongChangeRef.current(result.song)
            return
          }

          // 同一首歌：用最新识别结果重新锚定播放进度，消除累积漂移，
          // 让下一轮"剩余时长"的估算重新基于真实 play_offset
          tracked = result.song
          setStatus('same-song')
        } catch (error) {
          if (cancelled) {
            return
          }

          // 区分"没匹配上"和真的失败：没匹配多半是歌曲间隙，应快速重试而非干等
          lastOutcome =
            error instanceof RecognitionError && error.code === 'recognition-no-match'
              ? 'no-match'
              : 'error'
          setStatus('failed')
          setLastCheckedAt(new Date().toISOString())
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

function getNextCheckDelayMs(
  song: SongMatch | undefined,
  fallbackIntervalSec: number,
  lastOutcome: CheckOutcome,
) {
  // 没匹配上：多半处在两首歌之间的空隙 / 广告 / 说话，尽快再试
  if (lastOutcome === 'no-match') {
    return NO_MATCH_RETRY_MS
  }

  // 上一轮出错（网络等）：短暂退避后重试，不要长时间停摆
  if (lastOutcome === 'error') {
    return ERROR_RETRY_MS
  }

  // 时长未知：无法预测结束点，退化为固定间隔轮询
  if (!song?.durationSec) {
    return fallbackIntervalSec * 1000
  }

  const remainingMs = song.durationSec * 1000 - getEstimatedPositionMs(song)

  // 已接近或已超过预测结束点：进入边界密集轮询，抓住切歌瞬间
  if (remainingMs <= END_LEAD_MS) {
    return MIN_CHECK_INTERVAL_MS
  }

  // 提前 END_LEAD_MS 醒来，但关键是封顶 MAX_CHECK_INTERVAL_MS：
  // 即便 play_offset 失真（例如 ACRCloud 返回 0 导致 remaining 看起来还有 4 分钟），
  // 也最多等这么久就重新识别，不会卡在已经被车机切走的上一首歌上。
  return clamp(remainingMs - END_LEAD_MS, MIN_CHECK_INTERVAL_MS, MAX_CHECK_INTERVAL_MS)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getEstimatedPositionMs(song: SongMatch) {
  const startedAt = new Date(song.playbackStartedAt).getTime()
  const elapsed = Date.now() - startedAt
  return Math.max(0, song.estimatedPositionMs + elapsed)
}
