import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ChevronLeft, Clock3, Minus, Pause, Play, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { LyricsViewport } from '../components/LyricsViewport'
import { StatusPill } from '../components/StatusPill'
import { getLyricsForSong } from '../features/lyrics/lyricsService'
import { findActiveLyricIndex, getCurrentPositionMs } from '../features/lyrics/lyricSync'
import { getLyricOffset, saveLyricOffset } from '../features/lyrics/offsetStore'
import type { LyricLine } from '../features/lyrics/types'
import { useWakeLock } from '../features/pwa/useWakeLock'
import { useSingAlongSession, type SingAlongStatus } from '../features/singAlong/useSingAlongSession'
import { getCurrentSong, saveCurrentSong } from '../features/storage/currentSongStore'
import { updateSettings, useSettings } from '../features/settings/settingsStore'

export function SongRoute() {
  const { songId } = useParams({ from: '/song/$songId' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const song = useMemo(() => {
    const currentSong = getCurrentSong()
    return currentSong?.id === songId ? currentSong : null
  }, [songId])
  const settings = useSettings()
  const [offsetMs, setOffsetMs] = useState(() => getLyricOffset(songId))
  const [positionMs, setPositionMs] = useState(0)

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
    saveLyricOffset(songId, offsetMs)
  }, [offsetMs, songId])

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
    ? '接近结束时检查下一首'
    : `未知时长每 ${fallbackIntervalSec} 秒检查`
}
