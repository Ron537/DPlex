export type {
  SessionProvider,
  DiscoveredSession,
  ResolvedSession,
  ProviderInfo,
  SessionStatus,
  ParsedSessionData,
  SessionPrompt,
  WatcherCallbacks
} from './types'
export { BaseSessionProvider, type SessionEntry } from './baseProvider'
export { ProviderRegistry } from './registry'
export { CopilotProvider } from './copilotProvider'
export { ClaudeCodeProvider } from './claudeCodeProvider'

import { ProviderRegistry } from './registry'
import { CopilotProvider } from './copilotProvider'
import { ClaudeCodeProvider } from './claudeCodeProvider'

/** Create and return the default registry with all built-in providers. */
export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry()
  registry.register(new CopilotProvider())
  registry.register(new ClaudeCodeProvider())
  // Register additional providers here:
  // registry.register(new CodexProvider())
  return registry
}
