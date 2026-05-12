import { describe, expect, it } from 'vitest'
import { decideRowClickAction } from '../../src/renderer/src/components/attention/rowClickAction'

describe('decideRowClickAction', () => {
  it('always acknowledges finished events regardless of the setting', () => {
    expect(decideRowClickAction('finished', false)).toBe('acknowledge')
    expect(decideRowClickAction('finished', true)).toBe('acknowledge')
  })

  it('does nothing for waiting events when click-clears-waiting is off (default)', () => {
    expect(decideRowClickAction('waitingForApproval', false)).toBe('none')
    expect(decideRowClickAction('waitingForInput', false)).toBe('none')
  })

  it('dismisses waiting events when click-clears-waiting is on', () => {
    expect(decideRowClickAction('waitingForApproval', true)).toBe('dismiss')
    expect(decideRowClickAction('waitingForInput', true)).toBe('dismiss')
  })
})
