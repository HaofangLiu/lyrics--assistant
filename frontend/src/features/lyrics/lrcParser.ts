import type { LyricLine } from './types'

const timeTagPattern = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?]/g

export function parseLrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = []

  raw.split(/\r?\n/).forEach((row) => {
    const matches = [...row.matchAll(timeTagPattern)]
    const text = row.replace(timeTagPattern, '').trim()

    if (!matches.length || !text) {
      return
    }

    matches.forEach((match) => {
      const minutes = Number(match[1])
      const seconds = Number(match[2])
      const fraction = match[3] ?? '0'
      const ms = Number(fraction.padEnd(3, '0').slice(0, 3))

      lines.push({
        id: `${minutes}-${seconds}-${ms}-${text}`,
        startMs: minutes * 60_000 + seconds * 1000 + ms,
        text,
      })
    })
  })

  return lines
    .sort((a, b) => a.startMs - b.startMs)
    .map((line, index, all) => ({
      ...line,
      endMs: all[index + 1]?.startMs,
    }))
}

export function plainTextToLyrics(raw: string): LyricLine[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text, index) => ({
      id: `plain-${index}`,
      startMs: index * 5000,
      text,
    }))
}
