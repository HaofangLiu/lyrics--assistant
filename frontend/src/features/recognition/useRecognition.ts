import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { releaseMicrophoneStream } from './audioCapture'
import { recognizeCurrentSong } from './recognitionService'
import type { RecognitionStatus } from './types'

export function useRecognition() {
  const [status, setStatus] = useState<RecognitionStatus>('idle')

  const mutation = useMutation({
    mutationFn: () =>
      recognizeCurrentSong({
        onPhase: (phase) => setStatus(phase),
      }),
    onMutate: () => {
      setStatus('listening')
    },
    onSuccess: () => {
      setStatus('matched')
    },
    onError: () => {
      setStatus('failed')
      releaseMicrophoneStream()
    },
  })

  return {
    status,
    recognize: mutation.mutateAsync,
    error: mutation.error,
    isWorking: mutation.isPending,
  }
}
