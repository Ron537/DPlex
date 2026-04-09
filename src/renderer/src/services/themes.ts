import type { ITheme } from '@xterm/xterm'

export interface AppTheme {
  id: string
  name: string
  terminal: ITheme
  ui: {
    bg: string
    bgAlt: string
    border: string
    text: string
    textMuted: string
    accent: string
  }
}

export const THEMES: Record<string, AppTheme> = {
  'midnight': {
    id: 'midnight',
    name: 'Midnight',
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
    ui: { bg: '#1a1a2e', bgAlt: '#16162a', border: '#2a2a4a', text: '#e0e0e0', textMuted: '#888', accent: '#74c0fc' }
  },
  'dracula': {
    id: 'dracula',
    name: 'Dracula',
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
    ui: { bg: '#282a36', bgAlt: '#21222c', border: '#44475a', text: '#f8f8f2', textMuted: '#6272a4', accent: '#bd93f9' }
  },
  'monokai': {
    id: 'monokai',
    name: 'Monokai',
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
    ui: { bg: '#272822', bgAlt: '#1e1f1c', border: '#49483e', text: '#f8f8f2', textMuted: '#75715e', accent: '#a6e22e' }
  },
  'nord': {
    id: 'nord',
    name: 'Nord',
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
    ui: { bg: '#2e3440', bgAlt: '#272c36', border: '#3b4252', text: '#d8dee9', textMuted: '#4c566a', accent: '#88c0d0' }
  },
  'solarized-dark': {
    id: 'solarized-dark',
    name: 'Solarized Dark',
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
    ui: { bg: '#002b36', bgAlt: '#001f27', border: '#073642', text: '#839496', textMuted: '#586e75', accent: '#268bd2' }
  },
  'github-dark': {
    id: 'github-dark',
    name: 'GitHub Dark',
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
    ui: { bg: '#0d1117', bgAlt: '#010409', border: '#21262d', text: '#c9d1d9', textMuted: '#484f58', accent: '#79c0ff' }
  }
}

export function getTheme(id: string): AppTheme {
  return THEMES[id] || THEMES['midnight']
}

export function getThemeList(): { id: string; name: string }[] {
  return Object.values(THEMES).map((t) => ({ id: t.id, name: t.name }))
}
