export type LyricLine = {
  id: string
  startMs: number
  endMs?: number
  text: string
}

export type LyricsDocument = {
  songId: string
  source: 'lrclib' | 'plain' | 'empty'
  synced: boolean
  offsetMs: number
  lines: LyricLine[]
  raw?: string
  cachedAt: string
}
