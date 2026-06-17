import { RecognitionError, type AudioSample, type RecognitionResult } from './types'

type BackendError = {
  detail?: string
}

export async function recognizeWithBackend(sample: AudioSample): Promise<RecognitionResult> {
  if (!sample.blob) {
    throw new RecognitionError('audio-unavailable', '没有可上传的录音')
  }

  const formData = new FormData()
  formData.append('audio', sample.blob, getFileName(sample.blob.type))

  const response = await fetch(`${getApiBaseUrl()}/recognize`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as BackendError
    throw new RecognitionError(
      response.status === 404 ? 'recognition-no-match' : 'network',
      error.detail || '后端识曲失败',
    )
  }

  return (await response.json()) as RecognitionResult
}

function getApiBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
}

function getFileName(mimeType: string) {
  if (mimeType.includes('mp4')) {
    return 'sample.mp4'
  }

  if (mimeType.includes('wav')) {
    return 'sample.wav'
  }

  return 'sample.webm'
}
