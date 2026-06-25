import type { SongMatch } from '../recognition/types'
import { getAppAuthHeaders } from '../recognition/backendRecognitionClient'
import { getCachedLyrics, saveLyrics } from './lyricsCache'
import { parseLrc, plainTextToLyrics } from './lrcParser'
import type { LyricsDocument } from './types'

const LRCLIB_API_BASE_URL = 'https://lrclib.net/api'
const FETCH_TIMEOUT_MS = 12_000

type LrcLibResponse = {
  id: number
  trackName?: string
  artistName?: string
  albumName?: string | null
  duration?: number | null
  syncedLyrics?: string | null
  plainLyrics?: string | null
}

type LyricsQueryCandidate = {
  artistName: string
  trackName: string
  albumName?: string | null
  durationSec?: number | null
  source: 'exact' | 'relaxed' | 'local' | 'ai'
}

type AiLyricsCandidateResponse = {
  candidates?: Array<{
    artistName?: string
    trackName?: string
    albumName?: string | null
    durationSec?: number | null
  }>
}

export async function getLyricsForSong(song: SongMatch): Promise<LyricsDocument> {
  const cached = getCachedLyrics(song.id)
  if (cached) {
    return cached
  }

  const remoteLyrics = await fetchLrcLibLyrics(song).catch(() => undefined)
  if (remoteLyrics) {
    saveLyrics(remoteLyrics)
    return remoteLyrics
  }

  const emptyLyrics: LyricsDocument = {
    songId: song.id,
    source: 'empty',
    synced: false,
    offsetMs: 0,
    cachedAt: new Date().toISOString(),
    lines: [
      {
        id: 'empty',
        startMs: 0,
        text: '没有找到歌词',
      },
    ],
  }

  saveLyrics(emptyLyrics)
  return emptyLyrics
}

async function fetchLrcLibLyrics(song: SongMatch): Promise<LyricsDocument | undefined> {
  const localLyrics = await findLyricsForCandidates(
    song,
    dedupeCandidates(getLocalLyricsQueryCandidates(song)),
  )
  if (localLyrics) {
    return localLyrics
  }

  const aiCandidates = dedupeCandidates(await fetchAiLyricsCandidates(song).catch(() => []))
  if (aiCandidates.length === 0) {
    return undefined
  }

  return findLyricsForCandidates(song, aiCandidates)
}

async function findLyricsForCandidates(
  song: SongMatch,
  candidates: LyricsQueryCandidate[],
): Promise<LyricsDocument | undefined> {
  for (const candidate of candidates) {
    const exactLyrics = await fetchLrcLibGet(song, candidate)
    if (exactLyrics) {
      return exactLyrics
    }
  }

  for (const candidate of candidates) {
    const searchLyrics = await fetchLrcLibSearch(song, candidate)
    if (searchLyrics) {
      return searchLyrics
    }
  }

  return undefined
}

async function fetchAiLyricsCandidates(song: SongMatch): Promise<LyricsQueryCandidate[]> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/lyrics/candidates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAppAuthHeaders(),
    },
    body: JSON.stringify({
      song: {
        title: song.title,
        artist: song.artist,
        album: song.album,
        durationSec: song.durationSec,
      },
    }),
  })

  if (!response.ok) {
    return []
  }

  const data = (await response.json()) as AiLyricsCandidateResponse
  return (data.candidates ?? [])
    .filter((candidate) => candidate.artistName && candidate.trackName)
    .map((candidate) => ({
      artistName: candidate.artistName!,
      trackName: candidate.trackName!,
      albumName: candidate.albumName,
      durationSec: candidate.durationSec,
      source: 'ai',
    }))
}

async function fetchLrcLibGet(
  song: SongMatch,
  candidate: LyricsQueryCandidate,
): Promise<LyricsDocument | undefined> {
  const response = await fetchWithTimeout(`${LRCLIB_API_BASE_URL}/get?${buildLrcLibParams(candidate)}`)
  if (!response.ok) {
    return undefined
  }

  const data = (await response.json()) as LrcLibResponse
  return createLyricsDocument(song, data)
}

async function fetchLrcLibSearch(
  song: SongMatch,
  candidate: LyricsQueryCandidate,
): Promise<LyricsDocument | undefined> {
  const params = new URLSearchParams({
    artist_name: candidate.artistName,
    track_name: candidate.trackName,
  })
  const response = await fetchWithTimeout(`${LRCLIB_API_BASE_URL}/search?${params}`)
  if (!response.ok) {
    return undefined
  }

  const results = ((await response.json()) as LrcLibResponse[])
    .filter((item) => item.syncedLyrics || item.plainLyrics)
    .map((item) => ({
      item,
      score: scoreLrcLibResult(item, candidate),
    }))
    .sort((left, right) => right.score - left.score)

  const best = results[0]
  if (!best || best.score < 35) {
    return undefined
  }

  return createLyricsDocument(song, best.item)
}

function createLyricsDocument(
  song: SongMatch,
  data: LrcLibResponse,
): LyricsDocument | undefined {
  if (data.syncedLyrics) {
    return {
      songId: song.id,
      source: 'lrclib',
      synced: true,
      offsetMs: 0,
      raw: data.syncedLyrics,
      cachedAt: new Date().toISOString(),
      lines: parseLrc(data.syncedLyrics),
    }
  }

  if (!data.plainLyrics) {
    return undefined
  }

  return {
    songId: song.id,
    source: 'plain',
    synced: false,
    offsetMs: 0,
    raw: data.plainLyrics,
    cachedAt: new Date().toISOString(),
    lines: plainTextToLyrics(data.plainLyrics),
  }
}

function getLocalLyricsQueryCandidates(song: SongMatch): LyricsQueryCandidate[] {
  const candidates: LyricsQueryCandidate[] = [
    {
      artistName: song.artist,
      trackName: song.title,
      albumName: song.album,
      durationSec: song.durationSec,
      source: 'exact',
    },
    {
      artistName: song.artist,
      trackName: song.title,
      source: 'relaxed',
    },
  ]

  const cleanedTitle = cleanTrackTitle(song.title)
  if (cleanedTitle !== song.title) {
    candidates.push({
      artistName: song.artist,
      trackName: cleanedTitle,
      durationSec: song.durationSec,
      source: 'local',
    })
  }

  const styleArtist = extractInStyleArtist(`${song.title} ${song.album ?? ''}`)
  if (styleArtist) {
    candidates.push({
      artistName: styleArtist,
      trackName: cleanedTitle,
      durationSec: song.durationSec,
      source: 'local',
    })
  }

  return candidates
}

function buildLrcLibParams(candidate: LyricsQueryCandidate) {
  const params = new URLSearchParams({
    artist_name: candidate.artistName,
    track_name: candidate.trackName,
  })

  if (candidate.albumName) {
    params.set('album_name', candidate.albumName)
  }

  if (candidate.durationSec) {
    params.set('duration', String(candidate.durationSec))
  }

  return params
}

function scoreLrcLibResult(result: LrcLibResponse, candidate: LyricsQueryCandidate) {
  const resultTitle = normalizeForCompare(result.trackName ?? '')
  const resultArtist = normalizeForCompare(result.artistName ?? '')
  const targetTitle = normalizeForCompare(candidate.trackName)
  const targetArtist = normalizeForCompare(candidate.artistName)
  let score = 0

  if (resultTitle === targetTitle) {
    score += 70
  } else if (resultTitle.includes(targetTitle) || targetTitle.includes(resultTitle)) {
    score += 36
  }

  if (resultArtist === targetArtist) {
    score += 30
  } else if (resultArtist.includes(targetArtist) || targetArtist.includes(resultArtist)) {
    score += 16
  }

  if (candidate.durationSec && result.duration) {
    const delta = Math.abs(candidate.durationSec - result.duration)
    if (delta <= 3) {
      score += 20
    } else if (delta <= 10) {
      score += 8
    }
  }

  if (result.syncedLyrics) {
    score += 8
  }

  return score
}

function dedupeCandidates(candidates: LyricsQueryCandidate[]) {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = [
      normalizeForCompare(candidate.artistName),
      normalizeForCompare(candidate.trackName),
      normalizeForCompare(candidate.albumName ?? ''),
      candidate.durationSec ?? '',
    ].join('|')
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function cleanTrackTitle(title: string) {
  return title
    .replace(/\([^)]*(karaoke|backing track|instrumental|in the style of|cover)[^)]*\)/gi, '')
    .replace(/\[[^\]]*(karaoke|backing track|instrumental|in the style of|cover)[^\]]*]/gi, '')
    .replace(/\s+-\s+(karaoke|backing track|instrumental|cover).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractInStyleArtist(text: string) {
  const match = text.match(/in the style of ([^)\\\]]+)/i)
  if (!match?.[1]) {
    return undefined
  }

  return match[1]
    .replace(/\s*&\s*/g, ' / ')
    .replace(/\s+and\s+/gi, ' / ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeForCompare(value: string) {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*]/g, '')
    .replace(/feat\.?|ft\.?/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getApiBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
}

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timeout)
  }
}
