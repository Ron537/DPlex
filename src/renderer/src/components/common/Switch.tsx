import type { JSX } from 'react'

interface SwitchProps {
  checked: boolean
  onChange: (next: boolean) => void
  ariaLabel?: string
  disabled?: boolean
}

/**
 * Themed toggle. Same dimensions and colors as the preview's `.switch`.
 * Renders as a <button role="switch"> for keyboard + screen-reader support;
 * the visual indicator is fully driven by CSS in main.css (`.dplex-switch`).
 */
export function Switch({ checked, onChange, ariaLabel, disabled }: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`dplex-switch ${checked ? 'dplex-switch-on' : ''}`}
      style={{ opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
    />
  )
}
