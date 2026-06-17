import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { recognizeCurrentSong } from './recognitionService'
import type { RecognitionStatus } from './types'

export function useRecognition() {
  const [status, setStatus] = useState<RecognitionStatus>('idle')
  const [level, setLevel] = useState(0)

  const mutation = useMutation({
    mutationFn: () =>
      recognizeCurrentSong({
        onLevel: setLevel,
        onPhase: (phase) => {
          setStatus(phase)
        },
      }),
    onMutate: () => {
      setStatus('listening')
    },
    onSuccess: () => {
      setStatus('matched')
      setLevel(0)
    },
    onError: () => {
      setStatus('failed')
      setLevel(0)
    },
  })

  return {
    status,
    level,
    recognize: mutation.mutateAsync,
    error: mutation.error,
    isWorking: mutation.isPending,
  }
}
