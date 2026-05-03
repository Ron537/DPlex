import type { JSX, ReactNode } from 'react'

export interface SegmentedOption<TValue extends string> {
  value: TValue
  label: ReactNode
  /** Optional leading icon node, rendered before the label inside the segment. */
  icon?: ReactNode
  /** Optional trailing badge — typically a count. */
  trailing?: ReactNode
  ariaLabel?: string
}

interface SegmentedProps<TValue extends string> {
  value: TValue
  onChange: (next: TValue) => void
  options: SegmentedOption<TValue>[]
  className?: string
}

/**
 * Two-or-more segment switcher. Used by the SidePanel to swap Projects ⇄ Sessions
 * and reused inside Settings for inline mode toggles.
 *
 * Visual mirrors the preview's `.seg` rule in main.css.
 */
export function Segmented<TValue extends string>({
  value,
  onChange,
  options,
  className
}: SegmentedProps<TValue>): JSX.Element {
  return (
    <div className={`dplex-seg ${className ?? ''}`} role="tablist">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={opt.ariaLabel}
            className={active ? 'dplex-seg-active' : ''}
            onClick={() => onChange(opt.value)}
          >
            {opt.icon}
            {opt.label}
            {opt.trailing}
          </button>
        )
      })}
    </div>
  )
}
