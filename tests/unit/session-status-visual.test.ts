import { describe, expect, it } from 'vitest'
import {
  labelForVisual,
  visualForStatus
} from '../../src/renderer/src/utils/sessionStatusVisual'

describe('visualForStatus', () => {
  it('maps every SessionStatus to a visual', () => {
    expect(visualForStatus('idle')).toBe('idle')
    expect(visualForStatus('thinking')).toBe('thinking')
    expect(visualForStatus('executingTool')).toBe('running')
    expect(visualForStatus('waitingForUser')).toBe('waiting')
    expect(visualForStatus('awaitingApproval')).toBe('attn')
  })

  it('falls back to idle for undefined', () => {
    expect(visualForStatus(undefined)).toBe('idle')
  })
})

describe('labelForVisual', () => {
  it('returns a human-readable label for every visual', () => {
    expect(labelForVisual('idle')).toBe('Idle')
    expect(labelForVisual('thinking')).toBe('Thinking')
    expect(labelForVisual('running')).toBe('Running')
    expect(labelForVisual('waiting')).toBe('Waiting for input')
    expect(labelForVisual('attn')).toBe('Needs approval')
  })
})
