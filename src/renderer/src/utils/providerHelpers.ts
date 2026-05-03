/**
 * Helpers for the adaptive provider-badge logic in SessionItem and the
 * pure functions used by ProviderGlyph for icon-id + tint-class lookup.
 *
 * The mixed-list rule: a session row shows its provider corner badge ONLY
 * when the surrounding list contains more than one provider. Solo-tool
 * users get a clean status-driven rail; mixed-tool users get provenance.
 */

interface MaybeAITool {
  aiTool: string
}

export type ProviderId = 'copilot' | 'claude' | 'gemini' | 'codex' | 'gpt' | string

/**
 * Returns true when the list contains sessions from more than one provider.
 * Empty and single-provider lists return false. Stable on shallow ordering
 * changes — order doesn't affect the result.
 */
export function isMixedProviderList(items: readonly MaybeAITool[]): boolean {
  if (items.length < 2) return false
  const seen = new Set<string>()
  for (const item of items) {
    if (!item.aiTool) continue
    seen.add(item.aiTool)
    if (seen.size > 1) return true
  }
  return false
}

/**
 * Map a session.aiTool / provider id to the sprite symbol id mounted by
 * ProviderIconSprite. Falls back to the generic bot mark for unknown providers.
 */
export function providerSymbolId(providerId: ProviderId): string {
  const id = providerId.toLowerCase()
  if (id.includes('copilot')) return 'dplex-i-copilot'
  if (id.includes('claude')) return 'dplex-i-claude'
  if (id.includes('gemini')) return 'dplex-i-gemini'
  if (id.includes('codex')) return 'dplex-i-codex'
  return 'dplex-i-bot'
}

/**
 * Per-provider tint class used by .dplex-pg.* and .dplex-sav-corner rules.
 * Returns the empty string for unknown providers (uses the dim default).
 */
export function providerTintClass(providerId: ProviderId): string {
  const id = providerId.toLowerCase()
  if (id.includes('copilot')) return 'dplex-pg-copilot'
  if (id.includes('claude')) return 'dplex-pg-claude'
  if (id.includes('gemini')) return 'dplex-pg-gemini'
  if (id.includes('codex')) return 'dplex-pg-codex'
  if (id.includes('gpt')) return 'dplex-pg-gpt'
  return ''
}
