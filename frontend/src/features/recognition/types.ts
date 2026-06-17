export type RecognitionStatus =
  | 'idle'
  | 'permission-needed'
  | 'listening'
  | 'recognizing'
  | 'matched'
  | 'lyrics-loading'
  | 'ready'
  | 'failed'

export type SongMatch = {
  id: string
  recognitionId: string
  musicBrainzRecordingId?: string
  title: string
  artist: string
  album?: string
  durationSec?: number
  score: number
  matchedAt: string
  playbackStartedAt: string
  estimatedPositionMs: number
  artworkColor: string
}

export type RecognitionResult = {
  song: SongMatch
  source: 'acrcloud'
}

export type AudioSample = {
  blob?: Blob
  durationSec: number
  peakLevel: number
}

export type RecognitionErrorCode =
  | 'permission-denied'
  | 'microphone-unavailable'
  | 'audio-unavailable'
  | 'recognition-no-match'
  | 'network'
  | 'unknown'

export class RecognitionError extends Error {
  code: RecognitionErrorCode

  constructor(code: RecognitionErrorCode, message: string) {
    super(message)
    this.name = 'RecognitionError'
    this.code = code
  }
}
