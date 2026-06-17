type StatusPillProps = {
  label: string
  tone?: 'ready' | 'working' | 'warning' | 'quiet'
}

export function StatusPill({ label, tone = 'quiet' }: StatusPillProps) {
  return <span className={`status-pill ${tone}`}>{label}</span>
}
