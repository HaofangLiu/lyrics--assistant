import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

type BigActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  label: string
  detail?: string
  busy?: boolean
  tone?: 'primary' | 'danger' | 'neutral'
}

export function BigActionButton({
  icon: Icon,
  label,
  detail,
  busy = false,
  tone = 'primary',
  className,
  ...props
}: BigActionButtonProps) {
  const buttonClass = ['big-action-button', `tone-${tone}`, busy ? 'busy' : '', className ?? '']
    .filter(Boolean)
    .join(' ')

  return (
    <button className={buttonClass} type="button" {...props}>
      <span className="big-action-icon">
        <Icon size={34} aria-hidden="true" />
      </span>
      <span className="big-action-text">
        <span>{label}</span>
        {detail ? <small>{detail}</small> : null}
      </span>
    </button>
  )
}
