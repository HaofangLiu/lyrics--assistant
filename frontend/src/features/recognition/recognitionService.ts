import { getSettings } from '../settings/settingsStore'
import { captureAudioSample } from './audioCapture'
import { recognizeWithBackend } from './backendRecognitionClient'
import type { RecognitionResult } from './types'

type RecognizeOptions = {
  onLevel?: (level: number) => void
  onPhase?: (phase: 'listening' | 'recognizing') => void
}

export async function recognizeCurrentSong({
  onLevel,
  onPhase,
}: RecognizeOptions = {}): Promise<RecognitionResult> {
  const settings = getSettings()

  onPhase?.('listening')
  const sample = await captureAudioSample({
    durationMs: settings.sampleDurationSec * 1000,
    onLevel,
  })

  onPhase?.('recognizing')

  return await recognizeWithBackend(sample)
}
