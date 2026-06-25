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
  const recordingEndedAt = Date.now()

  onPhase?.('recognizing')
  const result = await recognizeWithBackend(sample)

  // ACRCloud 的 play_offset_ms 对应录音结束那一刻的歌曲位置。
  // 把 playbackStartedAt 设为录音结束时间，这样：
  //   position = play_offset_ms + (now - recordingEndedAt)
  // 只包含网络/识别耗时（约 1-2s），残余误差用 ±1s 校准按钮微调。
  result.song.playbackStartedAt = new Date(recordingEndedAt).toISOString()

  return result
}
