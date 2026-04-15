import type {
  SessionProvider,
  DiscoveredSession,
  ResolvedSession,
  ProviderInfo
} from './types'

/**
 * Central registry of AI tool providers.
 * All session operations route through here.
 */
export class ProviderRegistry {
  private providers = new Map<string, SessionProvider>()

  register(provider: SessionProvider): void {
    this.providers.set(provider.id, provider)
  }

  getProvider(id: string): SessionProvider | undefined {
    return this.providers.get(id)
  }

  getAllProviders(): SessionProvider[] {
    return Array.from(this.providers.values())
  }

  getProviderInfoList(): ProviderInfo[] {
    return this.getAllProviders().map((p) => ({
      id: p.id,
      name: p.name,
      command: p.command,
      icon: p.icon
    }))
  }

  /** Discover sessions from a specific provider, or all providers if no ID given. */
  async discoverSessions(providerId?: string): Promise<DiscoveredSession[]> {
    if (providerId) {
      const provider = this.providers.get(providerId)
      if (!provider) return []
      return provider.discoverSessions()
    }

    const results: DiscoveredSession[] = []
    for (const provider of this.providers.values()) {
      const sessions = await provider.discoverSessions()
      results.push(...sessions)
    }
    return results.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }

  /** Close a session — tries the specified provider, or searches all. */
  async closeSession(sessionId: string, providerId?: string): Promise<boolean> {
    if (providerId) {
      const provider = this.providers.get(providerId)
      return provider ? provider.closeSession(sessionId) : false
    }
    for (const provider of this.providers.values()) {
      const closed = await provider.closeSession(sessionId)
      if (closed) return true
    }
    return false
  }

  /** Delete a session — tries the specified provider, or searches all. */
  async deleteSession(sessionId: string, providerId?: string): Promise<void> {
    if (providerId) {
      const provider = this.providers.get(providerId)
      if (provider) await provider.deleteSession(sessionId)
      return
    }
    for (const provider of this.providers.values()) {
      try {
        await provider.deleteSession(sessionId)
        return
      } catch {
        // Try next provider
      }
    }
  }

  /** Resolve a session by PID — tries all providers until one matches. */
  async resolveSessionByPid(pid: number): Promise<ResolvedSession | null> {
    for (const provider of this.providers.values()) {
      const result = await provider.resolveSessionByPid(pid)
      if (result) return result
    }
    return null
  }

  /** Resolve a session by CWD — tries all providers, returns best match. */
  async resolveSessionByCwd(cwd: string): Promise<ResolvedSession | null> {
    for (const provider of this.providers.values()) {
      const result = await provider.resolveSessionByCwd(cwd)
      if (result) return result
    }
    return null
  }

  /** Get resume command from the appropriate provider. */
  getResumeCommand(providerId: string, sessionId: string): string | null {
    const provider = this.providers.get(providerId)
    return provider ? provider.getResumeCommand(sessionId) : null
  }

  /** Get new session command from the appropriate provider. */
  getNewSessionCommand(providerId: string): string | null {
    const provider = this.providers.get(providerId)
    return provider ? provider.getNewSessionCommand() : null
  }
}
