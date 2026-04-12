export type { SessionProvider, DiscoveredSession, ActiveProjectSession, ResolvedSession, ProviderInfo } from './types'
export { ProviderRegistry } from './registry'
export { CopilotProvider } from './copilotProvider'

import { ProviderRegistry } from './registry'
import { CopilotProvider } from './copilotProvider'

/** Create and return the default registry with all built-in providers. */
export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry()
  registry.register(new CopilotProvider())
  // Register additional providers here:
  // registry.register(new ClaudeProvider())
  // registry.register(new CodexProvider())
  return registry
}
