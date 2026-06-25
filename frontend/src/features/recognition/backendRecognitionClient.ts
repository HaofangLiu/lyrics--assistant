import { RecognitionError, type AudioSample, type RecognitionResult } from './types'

type BackendError = {
  detail?: string
}

const REQUEST_TIMEOUT_MS = 20_000
const MAX_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 800

export async function recognizeWithBackend(sample: AudioSample): Promise<RecognitionResult> {
  if (!sample.blob) {
    throw new RecognitionError('audio-unavailable', '没有可上传的录音')
  }

  let lastError: RecognitionError | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await sendRecognizeRequest(sample)
    } catch (error) {
      const recognitionError = toRecognitionError(error)

      // 没匹配 / 没录音是确定性结果，重试也没意义，直接抛出
      if (
        recognitionError.code === 'recognition-no-match' ||
        recognitionError.code === 'audio-unavailable'
      ) {
        throw recognitionError
      }

      lastError = recognitionError
      if (attempt < MAX_ATTEMPTS) {
        // 网络抖动（车内移动网络常见）退避后重试，而不是直接 load fail
        await wait(RETRY_BASE_DELAY_MS * attempt)
      }
    }
  }

  throw lastError ?? new RecognitionError('network', '后端识曲失败')
}

async function sendRecognizeRequest(sample: AudioSample): Promise<RecognitionResult> {
  const formData = new FormData()
  formData.append('audio', sample.blob!, getFileName(sample.blob!.type))

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${getApiBaseUrl()}/recognize`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    })
  } catch (error) {
    // 原生 fetch 在网络失败 / abort 时抛 TypeError，这里统一包装成可识别的网络错误
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new RecognitionError('network', '识曲请求超时')
    }
    throw new RecognitionError('network', '网络异常，无法连接识曲服务')
  } finally {
    window.clearTimeout(timeout)
  }

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as BackendError
    throw new RecognitionError(
      response.status === 404 ? 'recognition-no-match' : 'network',
      error.detail || '后端识曲失败',
    )
  }

  return (await response.json()) as RecognitionResult
}

function toRecognitionError(error: unknown): RecognitionError {
  if (error instanceof RecognitionError) {
    return error
  }
  return new RecognitionError('network', '后端识曲失败')
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
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
