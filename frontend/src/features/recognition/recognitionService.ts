import { getSettings } from '../settings/settingsStore'
import { captureAudioSample } from './audioCapture'
import { recognizeWithBackend } from './backendRecognitionClient'
import type { RecognitionResult } from './types'

type RecognizeOptions = {
  durationMs?: number
  onLevel?: (level: number) => void
  onPhase?: (phase: 'listening' | 'recognizing') => void
}

export async function recognizeCurrentSong({
  durationMs,
  onLevel,
  onPhase,
}: RecognizeOptions = {}): Promise<RecognitionResult> {
  const settings = getSettings()
  const sampleDurationMs = durationMs ?? settings.sampleDurationSec * 1000

  onPhase?.('listening')
  const recordingStartedAt = Date.now()
  const sample = await captureAudioSample({
    durationMs: sampleDurationMs,
    onLevel,
    keepStreamAlive: false,
  })

  onPhase?.('recognizing')
  const result = await recognizeWithBackend(sample)

  // ACRCloud 的 play_offset_ms 是录音那一刻的歌曲位置。
  // 把 playbackStartedAt 设为录音开始时间，这样 elapsed 自动包含
  // 录音时长 + 网络耗时，歌词位置 = play_offset_ms + elapsed，和实际播放对齐。
  result.song.playbackStartedAt = new Date(recordingStartedAt).toISOString()

  return result
}
