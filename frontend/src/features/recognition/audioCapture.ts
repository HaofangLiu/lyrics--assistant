import { RecognitionError, type AudioSample } from './types'

type CaptureOptions = {
  durationMs: number
  onLevel?: (level: number) => void
}

export async function captureAudioSample({
  durationMs,
  onLevel,
}: CaptureOptions): Promise<AudioSample> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new RecognitionError('microphone-unavailable', '当前浏览器不支持麦克风')
  }

  let stream: MediaStream

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
  } catch {
    throw new RecognitionError('permission-denied', '麦克风权限未开启')
  }

  const audioContext = new AudioContext()
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 512

  const source = audioContext.createMediaStreamSource(stream)
  source.connect(analyser)

  const recorder = createRecorder(stream)
  const chunks: BlobPart[] = []
  let peakLevel = 0
  let animationFrame = 0
  const data = new Uint8Array(analyser.frequencyBinCount)

  const tick = () => {
    analyser.getByteFrequencyData(data)
    const sum = data.reduce((total, value) => total + value, 0)
    const level = Math.min(1, sum / data.length / 128)
    peakLevel = Math.max(peakLevel, level)
    onLevel?.(level)
    animationFrame = requestAnimationFrame(tick)
  }

  if (recorder) {
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data)
      }
    })
    recorder.start()
  }

  tick()

  await wait(durationMs)

  cancelAnimationFrame(animationFrame)
  if (recorder?.state === 'recording') {
    recorder.stop()
    await waitForStop(recorder)
  }

  stream.getTracks().forEach((track) => track.stop())
  source.disconnect()
  await audioContext.close()
  onLevel?.(0)

  return {
    blob: chunks.length ? new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }) : undefined,
    durationSec: durationMs / 1000,
    peakLevel,
  }
}

function createRecorder(stream: MediaStream) {
  if (!('MediaRecorder' in window)) {
    return undefined
  }

  const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type))

  return new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function waitForStop(recorder: MediaRecorder) {
  return new Promise<void>((resolve) => {
    recorder.addEventListener('stop', () => resolve(), { once: true })
  })
}
