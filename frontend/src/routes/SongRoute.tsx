import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ChevronLeft, Clock3, Minus, Pause, Play, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { LyricsViewport } from '../components/LyricsViewport'
import { StatusPill } from '../components/StatusPill'
import { getLyricsForSong } from '../features/lyrics/lyricsService'
import { findActiveLyricIndex, getCurrentPositionMs } from '../features/lyrics/lyricSync'
import { getLyricOffset, saveLyricOffset } from '../features/lyrics/offsetStore'
import type { LyricLine } from '../features/lyrics/types'
import { useWakeLock } from '../features/pwa/useWakeLock'
import { useSingAlongSession, type SingAlongStatus } from '../features/singAlong/useSingAlongSession'
import type { SongMatch } from '../features/recognition/types'
import { getCurrentSong, saveCurrentSong } from '../features/storage/currentSongStore'
import { updateSettings, useSettings } from '../features/settings/settingsStore'

export function SongRoute() {
  const { songId } = useParams({ from: '/song/$songId' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [song, setSong] = useState<SongMatch | null>(() => {
    const currentSong = getCurrentSong()
    return currentSong?.id === songId ? currentSong : null
  })

  useEffect(() => {
    const currentSong = getCurrentSong()
    setSong(currentSong?.id === songId ? currentSong : null)
  }, [songId])

  const settings = useSettings()
  const [offsetMs, setOffsetMs] = useState(() => getLyricOffset(songId))
  const [offsetSongId, setOffsetSongId] = useState(songId)
  const [positionMs, setPositionMs] = useState(0)

  // 切歌时 TanStack Router 复用同一组件实例，offsetMs 这类 state 不会自动重置。
  // 在渲染期同步把 offset 切换成新歌自己的存档，避免：
  // 1) 上一首的校准值串到新歌的歌词显示；
  // 2) 下面的持久化 effect 把旧 offset 写进新歌的存储 key，破坏用户校准数据。
  if (offsetSongId !== songId) {
    setOffsetSongId(songId)
    setOffsetMs(getLyricOffset(songId))
  }

  useWakeLock(settings.keepScreenAwake)

  const lyricsQuery = useQuery({
    queryKey: ['lyrics', songId],
    queryFn: () => getLyricsForSong(song!),
    enabled: Boolean(song),
  })

  const singAlong = useSingAlongSession({
    enabled: Boolean(song && settings.autoFollowEnabled),
    currentSong: song ?? undefined,
    onSongChange: (nextSong) => {
      saveCurrentSong(nextSong)
      queryClient.prefetchQuery({
        queryKey: ['lyrics', nextSong.id],
        queryFn: () => getLyricsForSong(nextSong),
      })
      navigate({ to: '/song/$songId', params: { songId: nextSong.id } })
    },
    onReanchor: (reanchoredSong) => {
      saveCurrentSong(reanchoredSong)
      setSong(reanchoredSong)
    },
  })

  useEffect(() => {
    if (!song) {
      return
    }

    const update = () => setPositionMs(getCurrentPositionMs(song, offsetMs))
    update()
    const timer = window.setInterval(update, 250)

    return () => window.clearInterval(timer)
  }, [offsetMs, song])

  useEffect(() => {
    // offsetSongId 与 songId 一致才说明 offset 已是当前歌的值，可安全持久化；
    // 切歌的过渡渲染里两者不等，跳过写入以防覆盖新歌的校准存档
    if (offsetSongId !== songId) {
      return
    }
    saveLyricOffset(songId, offsetMs)
  }, [offsetMs, offsetSongId, songId])

  if (!song) {
    return (
      <section className="empty-state">
        <StatusPill label="没有歌曲" tone="warning" />
        <h1>请先识曲</h1>
        <Link className="text-link" to="/">
          返回识曲
        </Link>
      </section>
    )
  }

  const lyrics = lyricsQuery.data
  const activeIndex = lyrics ? findActiveLyricIndex(lyrics, positionMs, song.durationSec) : 0

  const setLineAsCurrent = (line: LyricLine) => {
    const elapsed = Date.now() - new Date(song.playbackStartedAt).getTime()
    setOffsetMs(line.startMs - song.estimatedPositionMs - elapsed)
  }

  return (
    <section className="song-screen">
      <header className="song-header">
        <Link className="song-back" to="/" aria-label="返回识曲">
          <ChevronLeft size={30} aria-hidden="true" />
          <span>返回</span>
        </Link>
        <div className="song-title-block">
          <p>{song.artist}</p>
          <h1>{song.title}</h1>
        </div>
        <button
          className={settings.autoFollowEnabled ? 'follow-status on' : 'follow-status'}
          type="button"
          onClick={() => updateSettings({ autoFollowEnabled: !settings.autoFollowEnabled })}
        >
          {settings.autoFollowEnabled ? (
            <Pause size={22} aria-hidden="true" />
          ) : (
            <Play size={22} aria-hidden="true" />
          )}
          <span>{getSingAlongLabel(singAlong.status, settings.autoFollowEnabled)}</span>
        </button>
      </header>

      <div className="song-meta-line">
        <span>{lyrics?.synced ? '同步歌词' : lyricsQuery.isLoading ? '加载歌词' : '纯歌词估算'}</span>
        <span>{formatTime(positionMs)}</span>
        <span>
          {singAlong.lastCheckedAt
            ? `上次检查 ${new Date(singAlong.lastCheckedAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}`
            : getFollowHint(song, settings.followCheckIntervalSec)}
        </span>
      </div>

      {lyricsQuery.isLoading ? (
        <div className="lyrics-loading">
          <Clock3 size={34} aria-hidden="true" />
          <span>正在加载歌词</span>
        </div>
      ) : (
        <LyricsViewport
          activeIndex={activeIndex}
          fontScale={settings.fontScale}
          lines={lyrics?.lines ?? []}
          onSelectLine={lyrics?.synced ? setLineAsCurrent : undefined}
        />
      )}

      <div className="song-controls" aria-label="歌词校准">
        <button
          className="nudge-button"
          type="button"
          onClick={() => setOffsetMs((value) => value - 1000)}
        >
          <Minus size={24} aria-hidden="true" />
          <span>1 秒</span>
        </button>
        <div className="sync-readout">
          <strong>{formatTime(positionMs)}</strong>
          <span>
            {offsetMs === 0 ? '已校准' : `${offsetMs > 0 ? '+' : ''}${(offsetMs / 1000).toFixed(1)}s`}
          </span>
        </div>
        <button
          className="nudge-button"
          type="button"
          onClick={() => setOffsetMs((value) => value + 1000)}
        >
          <Plus size={24} aria-hidden="true" />
          <span>1 秒</span>
        </button>
      </div>
    </section>
  )
}

function getSingAlongLabel(status: SingAlongStatus, enabled: boolean) {
  if (!enabled) {
    return '已暂停'
  }

  const labels: Record<SingAlongStatus, string> = {
    idle: '跟唱中',
    waiting: '跟唱中',
    listening: '跟唱中',
    recognizing: '跟唱中',
    'same-song': '跟唱中',
    'new-song': '切换中',
    failed: '跟唱中',
  }

  return labels[status]
}

function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function getFollowHint(song: { durationSec?: number }, fallbackIntervalSec: number) {
  return song.durationSec
    ? '结束后自动检查下一首'
    : `未知时长每 ${fallbackIntervalSec} 秒检查`
}
