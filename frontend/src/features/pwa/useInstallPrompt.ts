import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function useInstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const handleBeforeInstallPrompt = (installEvent: Event) => {
      installEvent.preventDefault()
      setEvent(installEvent as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  }, [])

  return {
    canInstall: Boolean(event),
    install: async () => {
      if (!event) {
        return
      }

      await event.prompt()
      await event.userChoice.catch(() => undefined)
      setEvent(null)
    },
  }
}
