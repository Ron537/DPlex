/**
 * Format a relative "time ago" label for session timestamps.
 *
 * Two variants share the same thresholds so a row that switches between
 * compact and full forms reads consistently:
 *
 * - Default ("just now", "5m", "3h", "2d", "1mo", "1y") — used by
 *   `SessionItem` rows where there's room for a slightly longer label.
 * - Compact (`short: true` → "now", "5m", "3h", "2d", "1mo", "1y") — used
 *   by the slim `RecentSessionRow` where the timestamp is the right-most
 *   element in a tight horizontal layout.
 */
export function timeAgo(date: Date | string | number, opts: { short?: boolean } = {}): string {
  const ms = typeof date === 'object' ? date.getTime() : new Date(date).getTime()
  const seconds = Math.floor((Date.now() - ms) / 1000)
  if (seconds < 60) return opts.short ? 'now' : 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.floor(months / 12)}y`
}
