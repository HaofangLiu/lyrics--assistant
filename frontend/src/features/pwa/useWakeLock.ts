import { useEffect } from 'react'

type WakeLockSentinel = {
  release: () => Promise<void>
}

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinel>
  }
}

export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return
    }

    const navigatorWithWakeLock = navigator as NavigatorWithWakeLock
    let sentinel: WakeLockSentinel | undefined
    let cancelled = false

    navigatorWithWakeLock.wakeLock
      ?.request('screen')
      .then((lock) => {
        if (cancelled) {
          lock.release().catch(() => undefined)
          return
        }

        sentinel = lock
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      sentinel?.release().catch(() => undefined)
    }
  }, [enabled])
}
