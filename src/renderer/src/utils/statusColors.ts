import type { SessionStatus } from '../types'

const STATUS_COLORS: Record<SessionStatus, string> = {
  idle: '#6b7280',
  thinking: '#3b82f6',
  executingTool: '#f59e0b',
  awaitingApproval: '#ef4444',
  waitingForUser: '#22c55e'
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  executingTool: 'Running tool',
  awaitingApproval: 'Needs approval',
  waitingForUser: 'Waiting for input'
}

/** Status color for active sessions that haven't been parsed yet. */
const ACTIVE_FALLBACK_COLOR = '#22c55e'

export function getStatusColor(
  detailedStatus?: SessionStatus,
  isActive?: boolean
): string {
  if (detailedStatus) return STATUS_COLORS[detailedStatus]
  if (isActive) return ACTIVE_FALLBACK_COLOR
  return STATUS_COLORS.idle
}

export function getStatusLabel(
  detailedStatus?: SessionStatus,
  isActive?: boolean
): string {
  if (detailedStatus) return STATUS_LABELS[detailedStatus]
  if (isActive) return 'Active'
  return 'Idle'
}

/** Whether a status represents a "working" (non-idle) state. */
export function isWorkingStatus(status?: SessionStatus): boolean {
  return !!status && status !== 'idle'
}
