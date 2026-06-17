import { RecognitionError, type AudioSample } from './types'

type CaptureOptions = {
  durationMs: number
  onLevel?: (level: number) => void
  keepStreamAlive?: boolean
}

let activeMicrophoneStream: MediaStream | null = null

export async function captureAudioSample({
  durationMs,
  onLevel,
  keepStreamAlive = false,
}: CaptureOptions): Promise<AudioSample> {
  const stream = await getMicrophoneStream()

  let audioContext: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let recorder: MediaRecorder | undefined
  const chunks: BlobPart[] = []
  let peakLevel = 0
  let animationFrame = 0

  try {
    audioContext = new AudioContext()
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 512

    source = audioContext.createMediaStreamSource(stream)
    source.connect(analyser)

    recorder = createRecorder(stream)
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

    if (recorder?.state === 'recording') {
      recorder.stop()
      await waitForStop(recorder)
    }

    return {
      blob: chunks.length ? new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }) : undefined,
      durationSec: durationMs / 1000,
      peakLevel,
    }
  } finally {
    cancelAnimationFrame(animationFrame)
    if (recorder?.state === 'recording') {
      recorder.stop()
      await waitForStop(recorder).catch(() => {})
    }
    source?.disconnect()
    if (audioContext?.state !== 'closed') {
      await audioContext?.close().catch(() => {})
    }
    if (!keepStreamAlive) {
      releaseMicrophoneStream()
    }
    onLevel?.(0)
  }
}

export function releaseMicrophoneStream() {
  activeMicrophoneStream?.getTracks().forEach((track) => track.stop())
  activeMicrophoneStream = null
}

async function getMicrophoneStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new RecognitionError('microphone-unavailable', '当前浏览器不支持麦克风')
  }

  if (activeMicrophoneStream && hasLiveAudioTrack(activeMicrophoneStream)) {
    return activeMicrophoneStream
  }

  try {
    activeMicrophoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
  } catch {
    throw new RecognitionError('permission-denied', '麦克风权限未开启')
  }

  activeMicrophoneStream.getAudioTracks().forEach((track) => {
    track.addEventListener('ended', () => {
      if (activeMicrophoneStream?.getAudioTracks().includes(track)) {
        activeMicrophoneStream = null
      }
    })
  })

  return activeMicrophoneStream
}

function hasLiveAudioTrack(stream: MediaStream) {
  return stream.getAudioTracks().some((track) => track.readyState === 'live')
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
