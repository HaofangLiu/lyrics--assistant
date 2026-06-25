import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Mic, RefreshCcw, Sparkles } from 'lucide-react'
import { getLyricsForSong } from '../features/lyrics/lyricsService'
import { useRecognition } from '../features/recognition/useRecognition'
import { updateSettings } from '../features/settings/settingsStore'
import { saveCurrentSong } from '../features/storage/currentSongStore'

const statusText = {
  idle: '待识曲',
  'permission-needed': '需要麦克风',
  listening: '正在听',
  recognizing: '正在识别',
  matched: '已识别',
  'lyrics-loading': '加载歌词',
  ready: '准备好了',
  failed: '识别失败',
}

export function HomeRoute() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const recognition = useRecognition()

  const startRecognition = async () => {
    updateSettings({ autoFollowEnabled: true })
    let result
    try {
      result = await recognition.recognize()
    } catch {
      return
    }
    saveCurrentSong(result.song)
    queryClient.prefetchQuery({
      queryKey: ['lyrics', result.song.id],
      queryFn: () => getLyricsForSong(result.song),
    })
    navigate({ to: '/song/$songId', params: { songId: result.song.id } })
  }

  const isWorking = recognition.isWorking
  const label = isWorking ? statusText[recognition.status] : '开启跟唱'

  return (
    <section className="home-screen">
      <h1 className="home-title">跟唱屏</h1>

      <button
        className={isWorking ? 'circle-start-button working' : 'circle-start-button'}
        disabled={isWorking}
        type="button"
        onClick={startRecognition}
        aria-label={label}
      >
        {isWorking ? <Sparkles size={58} aria-hidden="true" /> : <Mic size={64} aria-hidden="true" />}
        <span>{label}</span>
      </button>

      {recognition.error ? (
        <div className="error-strip">
          <span>{recognition.error instanceof Error ? recognition.error.message : '识别失败'}</span>
          <button type="button" onClick={startRecognition}>
            <RefreshCcw size={20} aria-hidden="true" />
            重试
          </button>
        </div>
      ) : null}
    </section>
  )
}
