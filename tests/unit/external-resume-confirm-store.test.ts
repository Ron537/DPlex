import { afterEach, describe, expect, it, vi } from 'vitest'

const resumeOrFocusSession = vi.fn()
const hasOpenTab = vi.fn(() => false)
vi.mock('../../src/renderer/src/utils/sessionTabs', () => ({
  resumeOrFocusSession: (...args: unknown[]) => resumeOrFocusSession(...args),
  hasOpenTab: (...args: unknown[]) => hasOpenTab(...args)
}))

import {
  useExternalResumeConfirmStore,
  resumeSessionGuarded,
  type GuardableSession
} from '../../src/renderer/src/stores/externalResumeConfirmStore'

const external: GuardableSession = {
  id: 'sess-1',
  aiTool: 'copilot-cli',
  displayName: 'Debug PTY resize',
  cwd: '/Users/me/repo',
  status: 'active'
}

afterEach(() => {
  useExternalResumeConfirmStore.setState({ pending: null })
  resumeOrFocusSession.mockClear()
  hasOpenTab.mockReset()
  hasOpenTab.mockReturnValue(false)
})

describe('externalResumeConfirmStore', () => {
  it('request stores the pending session without resuming', () => {
    useExternalResumeConfirmStore.getState().request(external)
    expect(useExternalResumeConfirmStore.getState().pending).toEqual(external)
    expect(resumeOrFocusSession).not.toHaveBeenCalled()
  })

  it('cancel clears the pending session without resuming', () => {
    useExternalResumeConfirmStore.getState().request(external)
    useExternalResumeConfirmStore.getState().cancel()
    expect(useExternalResumeConfirmStore.getState().pending).toBeNull()
    expect(resumeOrFocusSession).not.toHaveBeenCalled()
  })

  it('confirm resumes the pending session and clears it', () => {
    useExternalResumeConfirmStore.getState().request(external)
    useExternalResumeConfirmStore.getState().confirm()
    expect(resumeOrFocusSession).toHaveBeenCalledTimes(1)
    expect(resumeOrFocusSession).toHaveBeenCalledWith(external)
    expect(useExternalResumeConfirmStore.getState().pending).toBeNull()
  })

  it('confirm with nothing pending is a no-op', () => {
    useExternalResumeConfirmStore.getState().confirm()
    expect(resumeOrFocusSession).not.toHaveBeenCalled()
  })
})

describe('resumeSessionGuarded', () => {
  it('prompts (does not resume) for an active session with no open tab', () => {
    hasOpenTab.mockReturnValue(false)
    resumeSessionGuarded(external)
    expect(useExternalResumeConfirmStore.getState().pending).toEqual(external)
    expect(resumeOrFocusSession).not.toHaveBeenCalled()
  })

  it('resumes directly (no prompt) when an open tab already backs the session', () => {
    hasOpenTab.mockReturnValue(true)
    resumeSessionGuarded(external)
    expect(useExternalResumeConfirmStore.getState().pending).toBeNull()
    expect(resumeOrFocusSession).toHaveBeenCalledWith(external)
  })

  it('resumes directly (no prompt) for an idle session', () => {
    hasOpenTab.mockReturnValue(false)
    resumeSessionGuarded({ ...external, status: 'idle' })
    expect(useExternalResumeConfirmStore.getState().pending).toBeNull()
    expect(resumeOrFocusSession).toHaveBeenCalledTimes(1)
  })
})
