import type { ITheme } from '@xterm/xterm'

export interface AppTheme {
  id: string
  name: string
  variant: 'dark' | 'light'
  terminal: ITheme
  ui: {
    bg: string
    bgAlt: string
    border: string
    text: string
    textMuted: string
    accent: string
    /** Optional richer-than-bg surface for cards / sidebar / panels. Falls back to bgAlt. */
    bgPanel?: string
    /** Optional elevated surface (popovers, segmented "active" pill). Falls back to bg shifted lighter. */
    bgElev?: string
    /** Optional secondary accent used for gradient pairs (e.g. button gradient). Falls back to accent. */
    accent2?: string
    /** Optional stronger border for elevated surfaces. Falls back to border. */
    borderStrong?: string
    /** Optional dimmer text level — between text-muted and bg. Falls back to a desaturated mix. */
    textDim?: string
    hover?: string
    scrollbar?: string
    scrollbarHover?: string
  }
}

export const THEMES: Record<string, AppTheme> = {
  dplex: {
    id: 'dplex',
    name: 'DPlex',
    variant: 'dark',
    terminal: {
      background: '#0e0e13',
      foreground: '#e8e8ee',
      cursor: '#a78bfa',
      cursorAccent: '#0e0e13',
      selectionBackground: '#3b3560',
      black: '#0e0e13',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#facc15',
      blue: '#818cf8',
      magenta: '#c084fc',
      cyan: '#67e8f9',
      white: '#e8e8ee',
      brightBlack: '#5d5d6e',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde68a',
      brightBlue: '#a5b4fc',
      brightMagenta: '#d8b4fe',
      brightCyan: '#a5f3fc',
      brightWhite: '#ffffff'
    },
    ui: {
      bg: '#0e0e13',
      bgAlt: '#0a0a0f',
      bgPanel: '#131319',
      bgElev: '#181822',
      border: '#23232f',
      borderStrong: '#2e2e3d',
      text: '#e8e8ee',
      textMuted: '#8a8a99',
      textDim: '#5d5d6e',
      accent: '#a78bfa',
      accent2: '#8b5cf6',
      hover: 'rgba(255,255,255,0.04)',
      scrollbar: 'rgba(255,255,255,0.12)',
      scrollbarHover: 'rgba(255,255,255,0.22)'
    }
  },
  'dplex-light': {
    id: 'dplex-light',
    name: 'DPlex Light',
    variant: 'light',
    terminal: {
      background: '#fafafa',
      foreground: '#1f1f1f',
      cursor: '#7c3aed',
      cursorAccent: '#fafafa',
      selectionBackground: '#ddd6fe',
      black: '#1f1f1f',
      red: '#dc2626',
      green: '#16a34a',
      yellow: '#ca8a04',
      blue: '#4f46e5',
      magenta: '#9333ea',
      cyan: '#0891b2',
      white: '#1f1f1f',
      brightBlack: '#6b7280',
      brightRed: '#ef4444',
      brightGreen: '#22c55e',
      brightYellow: '#eab308',
      brightBlue: '#6366f1',
      brightMagenta: '#a855f7',
      brightCyan: '#06b6d4',
      brightWhite: '#111111'
    },
    ui: {
      bg: '#fafafa',
      bgAlt: '#f1f1f1',
      border: '#e2e2e2',
      text: '#1f1f1f',
      textMuted: '#6b7280',
      accent: '#7c3aed',
      hover: 'rgba(124,58,237,0.08)',
      scrollbar: 'rgba(0,0,0,0.15)',
      scrollbarHover: 'rgba(0,0,0,0.25)'
    }
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    variant: 'dark',
    terminal: {
      background: '#1a1a2e',
      foreground: '#e0e0e0',
      cursor: '#e0e0e0',
      cursorAccent: '#1a1a2e',
      selectionBackground: '#3a3a5e',
      black: '#1a1a2e',
      red: '#ff6b6b',
      green: '#51cf66',
      yellow: '#ffd43b',
      blue: '#74c0fc',
      magenta: '#cc5de8',
      cyan: '#66d9e8',
      white: '#e0e0e0',
      brightBlack: '#555577',
      brightRed: '#ff8787',
      brightGreen: '#69db7c',
      brightYellow: '#ffe066',
      brightBlue: '#91d5ff',
      brightMagenta: '#da77f2',
      brightCyan: '#99e9f2',
      brightWhite: '#ffffff'
    },
    ui: {
      bg: '#1a1a2e',
      bgAlt: '#16162a',
      border: '#2a2a4a',
      text: '#e0e0e0',
      textMuted: '#888',
      accent: '#74c0fc'
    }
  },
  dracula: {
    id: 'dracula',
    name: 'Dracula',
    variant: 'dark',
    terminal: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorAccent: '#282a36',
      selectionBackground: '#44475a',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff'
    },
    ui: {
      bg: '#282a36',
      bgAlt: '#21222c',
      border: '#44475a',
      text: '#f8f8f2',
      textMuted: '#6272a4',
      accent: '#bd93f9'
    }
  },
  monokai: {
    id: 'monokai',
    name: 'Monokai',
    variant: 'dark',
    terminal: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      cursorAccent: '#272822',
      selectionBackground: '#49483e',
      black: '#272822',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#f4bf75',
      blue: '#66d9ef',
      magenta: '#ae81ff',
      cyan: '#a1efe4',
      white: '#f8f8f2',
      brightBlack: '#75715e',
      brightRed: '#f92672',
      brightGreen: '#a6e22e',
      brightYellow: '#f4bf75',
      brightBlue: '#66d9ef',
      brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4',
      brightWhite: '#f9f8f5'
    },
    ui: {
      bg: '#272822',
      bgAlt: '#1e1f1c',
      border: '#49483e',
      text: '#f8f8f2',
      textMuted: '#75715e',
      accent: '#a6e22e'
    }
  },
  nord: {
    id: 'nord',
    name: 'Nord',
    variant: 'dark',
    terminal: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      cursorAccent: '#2e3440',
      selectionBackground: '#434c5e',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4'
    },
    ui: {
      bg: '#2e3440',
      bgAlt: '#272c36',
      border: '#3b4252',
      text: '#d8dee9',
      textMuted: '#4c566a',
      accent: '#88c0d0'
    }
  },
  'solarized-dark': {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    variant: 'dark',
    terminal: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#839496',
      cursorAccent: '#002b36',
      selectionBackground: '#073642',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#586e75',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3'
    },
    ui: {
      bg: '#002b36',
      bgAlt: '#001f27',
      border: '#073642',
      text: '#839496',
      textMuted: '#586e75',
      accent: '#268bd2'
    }
  },
  'github-dark': {
    id: 'github-dark',
    name: 'GitHub Dark',
    variant: 'dark',
    terminal: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#c9d1d9',
      cursorAccent: '#0d1117',
      selectionBackground: '#264f78',
      black: '#0d1117',
      red: '#ff7b72',
      green: '#7ee787',
      yellow: '#d29922',
      blue: '#79c0ff',
      magenta: '#d2a8ff',
      cyan: '#a5d6ff',
      white: '#c9d1d9',
      brightBlack: '#484f58',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#a5d6ff',
      brightWhite: '#f0f6fc'
    },
    ui: {
      bg: '#0d1117',
      bgAlt: '#010409',
      border: '#21262d',
      text: '#c9d1d9',
      textMuted: '#484f58',
      accent: '#79c0ff'
    }
  },
  'github-light': {
    id: 'github-light',
    name: 'GitHub Light',
    variant: 'light',
    terminal: {
      background: '#ffffff',
      foreground: '#24292f',
      cursor: '#24292f',
      cursorAccent: '#ffffff',
      selectionBackground: '#b6d7ff',
      black: '#24292f',
      red: '#cf222e',
      green: '#116329',
      yellow: '#4d2d00',
      blue: '#0969da',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: '#6e7781',
      brightBlack: '#57606a',
      brightRed: '#a40e26',
      brightGreen: '#1a7f37',
      brightYellow: '#633c01',
      brightBlue: '#218bff',
      brightMagenta: '#a475f9',
      brightCyan: '#3192aa',
      brightWhite: '#8c959f'
    },
    ui: {
      bg: '#ffffff',
      bgAlt: '#f6f8fa',
      border: '#d0d7de',
      text: '#24292f',
      textMuted: '#57606a',
      accent: '#0969da',
      hover: 'rgba(0,0,0,0.06)',
      scrollbar: 'rgba(0,0,0,0.15)',
      scrollbarHover: 'rgba(0,0,0,0.25)'
    }
  },
  'solarized-light': {
    id: 'solarized-light',
    name: 'Solarized Light',
    variant: 'light',
    terminal: {
      background: '#fdf6e3',
      foreground: '#657b83',
      cursor: '#657b83',
      cursorAccent: '#fdf6e3',
      selectionBackground: '#eee8d5',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#002b36',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3'
    },
    ui: {
      bg: '#fdf6e3',
      bgAlt: '#eee8d5',
      border: '#d3cbb7',
      text: '#657b83',
      textMuted: '#93a1a1',
      accent: '#268bd2',
      hover: 'rgba(0,0,0,0.06)',
      scrollbar: 'rgba(0,0,0,0.15)',
      scrollbarHover: 'rgba(0,0,0,0.25)'
    }
  },
  'quiet-light': {
    id: 'quiet-light',
    name: 'Quiet Light',
    variant: 'light',
    terminal: {
      background: '#f5f5f5',
      foreground: '#333333',
      cursor: '#333333',
      cursorAccent: '#f5f5f5',
      selectionBackground: '#c9d0d9',
      black: '#333333',
      red: '#aa3731',
      green: '#448c27',
      yellow: '#cb9000',
      blue: '#325cc0',
      magenta: '#7a3e9d',
      cyan: '#0083b2',
      white: '#f5f5f5',
      brightBlack: '#777777',
      brightRed: '#aa3731',
      brightGreen: '#448c27',
      brightYellow: '#cb9000',
      brightBlue: '#325cc0',
      brightMagenta: '#7a3e9d',
      brightCyan: '#0083b2',
      brightWhite: '#ffffff'
    },
    ui: {
      bg: '#f5f5f5',
      bgAlt: '#e8e8e8',
      border: '#d1d1d1',
      text: '#333333',
      textMuted: '#777777',
      accent: '#325cc0',
      hover: 'rgba(0,0,0,0.06)',
      scrollbar: 'rgba(0,0,0,0.15)',
      scrollbarHover: 'rgba(0,0,0,0.25)'
    }
  }
}

export function getTheme(id: string): AppTheme {
  return THEMES[id] || THEMES['dplex']
}

export function getThemeList(): { id: string; name: string }[] {
  return Object.values(THEMES).map((t) => ({ id: t.id, name: t.name }))
}

export function getThemesByVariant(): { dark: AppTheme[]; light: AppTheme[] } {
  const all = Object.values(THEMES)
  return {
    dark: all.filter((t) => t.variant === 'dark'),
    light: all.filter((t) => t.variant === 'light')
  }
}
