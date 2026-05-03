import { describe, expect, it } from 'vitest'
import { isMixedProviderList } from '../../src/renderer/src/utils/providerHelpers'

describe('isMixedProviderList', () => {
  it('returns false for an empty list', () => {
    expect(isMixedProviderList([])).toBe(false)
  })

  it('returns false for a single-item list', () => {
    expect(isMixedProviderList([{ aiTool: 'copilot-cli' }])).toBe(false)
  })

  it('returns false when every item shares the same provider', () => {
    expect(
      isMixedProviderList([
        { aiTool: 'copilot-cli' },
        { aiTool: 'copilot-cli' },
        { aiTool: 'copilot-cli' }
      ])
    ).toBe(false)
  })

  it('returns true as soon as a second provider appears', () => {
    expect(isMixedProviderList([{ aiTool: 'copilot-cli' }, { aiTool: 'claude-code' }])).toBe(true)
  })

  it('handles mixed three-provider lists', () => {
    expect(
      isMixedProviderList([
        { aiTool: 'copilot-cli' },
        { aiTool: 'claude-code' },
        { aiTool: 'gemini-cli' }
      ])
    ).toBe(true)
  })

  it('ignores empty aiTool entries when counting providers', () => {
    expect(
      isMixedProviderList([{ aiTool: 'copilot-cli' }, { aiTool: '' }, { aiTool: 'copilot-cli' }])
    ).toBe(false)
  })

  it('detects mix even when empty entries are present', () => {
    expect(
      isMixedProviderList([{ aiTool: 'copilot-cli' }, { aiTool: '' }, { aiTool: 'claude-code' }])
    ).toBe(true)
  })
})
