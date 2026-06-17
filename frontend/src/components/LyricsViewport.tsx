import type { CSSProperties } from 'react'
import type { LyricLine } from '../features/lyrics/types'

type LyricsViewportProps = {
  lines: LyricLine[]
  activeIndex: number
  fontScale: number
  onSelectLine?: (line: LyricLine) => void
}

export function LyricsViewport({ lines, activeIndex, fontScale, onSelectLine }: LyricsViewportProps) {
  if (lines.length === 0) {
    return <div className="lyrics-empty">暂无歌词</div>
  }

  const start = Math.max(0, activeIndex - 2)
  const end = Math.min(lines.length, activeIndex + 3)
  const visibleLines = lines.slice(start, end)

  return (
    <div className="lyrics-viewport" style={{ '--lyric-scale': fontScale } as CSSProperties}>
      {visibleLines.map((line, index) => {
        const absoluteIndex = start + index
        const distance = Math.abs(absoluteIndex - activeIndex)
        const className = [
          'lyric-line',
          absoluteIndex === activeIndex ? 'active' : '',
          distance > 2 ? 'far' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <button
            className={className}
            disabled={!onSelectLine}
            key={line.id}
            type="button"
            onClick={() => onSelectLine?.(line)}
          >
            {line.text}
          </button>
        )
      })}
    </div>
  )
}
