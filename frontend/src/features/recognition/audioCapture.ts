import { RecognitionError } from './types'

type CaptureOptions = {
  durationMs: number
  keepStreamAlive?: boolean
}

let activeMicrophoneStream: MediaStream | null = null

export async function captureAudioSample({
  durationMs,
  keepStreamAlive = false,
}: CaptureOptions): Promise<Blob | undefined> {
  const stream = await getMicrophoneStream()
  const recorder = createRecorder(stream)

  if (!recorder) {
    if (!keepStreamAlive) releaseMicrophoneStream()
    return undefined
  }

  const chunks: BlobPart[] = []
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data)
    }
  })

  try {
    recorder.start()
    await wait(durationMs)

    if (recorder.state === 'recording') {
      recorder.stop()
      await waitForStop(recorder)
    }

    return chunks.length ? new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }) : undefined
  } finally {
    if (recorder.state === 'recording') {
      recorder.stop()
      await waitForStop(recorder).catch(() => {})
    }
    if (!keepStreamAlive) {
      releaseMicrophoneStream()
    }
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
