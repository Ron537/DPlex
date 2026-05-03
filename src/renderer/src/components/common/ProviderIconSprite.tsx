import type { JSX } from 'react'

/**
 * Inline SVG sprite mounted once at the app root.
 * Holds <symbol> defs for provider marks (copilot/claude/gemini/codex/bot)
 * and status motifs (running spinner, thinking dots, waiting "i", idle dot,
 * attention exclaim).
 *
 * Symbol ids match the preview file's defs so the same paths render in code
 * and in the design preview.
 */
export function ProviderIconSprite(): JSX.Element {
  return (
    <svg
      width="0"
      height="0"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
      aria-hidden="true"
      data-testid="provider-icon-sprite"
    >
      <defs>
        {/* GitHub Copilot — minimalist robot head */}
        <symbol id="dplex-i-copilot" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M11.5 2.75c0-.41.34-.75.75-.75s.75.34.75.75v1.79h2.51a4.5 4.5 0 0 1 4.4 3.55l.41 1.93a3 3 0 0 1 1.68 2.7v2.06c0 .9-.4 1.71-1.03 2.27v1.45a4.25 4.25 0 0 1-4.25 4.25H7.28a4.25 4.25 0 0 1-4.25-4.25v-1.45A3 3 0 0 1 2 14.78v-2.06a3 3 0 0 1 1.68-2.7l.41-1.93A4.5 4.5 0 0 1 8.49 4.54H11.5V2.75ZM7.5 12.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm9 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z"
          />
        </symbol>
        {/* Anthropic Claude — sunburst spark */}
        <symbol id="dplex-i-claude" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M12 2.25c.4 0 .73.3.75.7l.34 5.07 3.78-3.36a.75.75 0 0 1 1.06.07c.27.3.24.77-.06 1.04l-3.78 3.4 5.04.42a.75.75 0 0 1 0 1.5l-5.04.42 3.78 3.4c.3.27.33.74.06 1.04a.75.75 0 0 1-1.06.07l-3.78-3.36-.34 5.07a.75.75 0 0 1-1.5 0l-.34-5.07-3.78 3.36a.75.75 0 0 1-1.06-.07.74.74 0 0 1 .06-1.04l3.78-3.4-5.04-.42a.75.75 0 0 1 0-1.5l5.04-.42-3.78-3.4a.74.74 0 0 1-.06-1.04.75.75 0 0 1 1.06-.07l3.78 3.36.34-5.07c.02-.4.35-.7.75-.7Z"
          />
        </symbol>
        {/* Google Gemini — 4-point diamond */}
        <symbol id="dplex-i-gemini" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M12 2.5c.32 0 .59.21.69.51 1.07 3.16 1.83 4.3 2.84 5.32 1.02 1.01 2.16 1.77 5.32 2.84.3.1.51.37.51.69s-.21.59-.51.69c-3.16 1.07-4.3 1.83-5.32 2.84-1.01 1.02-1.77 2.16-2.84 5.32-.1.3-.37.51-.69.51s-.59-.21-.69-.51c-1.07-3.16-1.83-4.3-2.84-5.32-1.02-1.01-2.16-1.77-5.32-2.84a.73.73 0 0 1-.51-.69c0-.32.21-.59.51-.69 3.16-1.07 4.3-1.83 5.32-2.84 1.01-1.02 1.77-2.16 2.84-5.32.1-.3.37-.51.69-.51Z"
          />
        </symbol>
        {/* OpenAI Codex / Codex CLI — hex sparkle */}
        <symbol id="dplex-i-codex" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M12 1.75l9.25 5.34v9.82L12 22.25l-9.25-5.34V7.09L12 1.75Zm0 1.74L4.25 7.96v8.08L12 20.51l7.75-4.47V7.96L12 3.49Zm0 4.6a3.91 3.91 0 1 1 0 7.82 3.91 3.91 0 0 1 0-7.82Z"
          />
        </symbol>
        {/* Generic GPT / fallback bot */}
        <symbol id="dplex-i-bot" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M11 1.75h2v2.5h4.25A3.75 3.75 0 0 1 21 8v8.25A3.75 3.75 0 0 1 17.25 20H6.75A3.75 3.75 0 0 1 3 16.25V8a3.75 3.75 0 0 1 3.75-3.75H11v-2.5ZM8.5 11.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm7 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z"
          />
        </symbol>

        {/* Status motifs — used by StatusAvatar/StatusIcon. */}
        <symbol id="dplex-i-status-running" viewBox="0 0 24 24">
          <circle
            cx="12"
            cy="12"
            r="8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeDasharray="22 16"
            strokeLinecap="round"
          />
        </symbol>
        <symbol id="dplex-i-status-thinking" viewBox="0 0 24 24">
          <circle cx="6" cy="12" r="2" fill="currentColor" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <circle cx="18" cy="12" r="2" fill="currentColor" />
        </symbol>
        <symbol id="dplex-i-status-waiting" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm-1 5h2v6h-2Zm0 8h2v2h-2Z"
          />
        </symbol>
        <symbol id="dplex-i-status-idle" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3.5" fill="currentColor" />
        </symbol>
        <symbol id="dplex-i-status-attn" viewBox="0 0 24 24">
          <path fill="currentColor" d="M12 2 22 20H2Zm-1 7h2v6h-2Zm0 8h2v2h-2Z" />
        </symbol>
      </defs>
    </svg>
  )
}
