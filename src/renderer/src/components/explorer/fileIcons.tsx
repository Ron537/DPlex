import React from 'react'
import {
  File as FileIcon,
  FileCode,
  FileJson,
  FileText,
  FileType,
  FileImage,
  FileArchive,
  FileCog,
  Braces,
  Hash
} from 'lucide-react'

/**
 * Pick a lucide icon for a file by extension. Lucide-only per project policy;
 * this is intentionally a coarse mapping (no per-language brand icons).
 */
export function fileIconFor(name: string, size = 14): React.JSX.Element {
  const lower = name.toLowerCase()
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  const common = { size, className: 'flex-shrink-0' }
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'cjs':
    case 'mjs':
    case 'mts':
    case 'cts':
    case 'py':
    case 'rb':
    case 'go':
    case 'rs':
    case 'java':
    case 'kt':
    case 'swift':
    case 'php':
    case 'c':
    case 'h':
    case 'cpp':
    case 'cc':
    case 'hpp':
    case 'cs':
      return <FileCode {...common} style={{ color: 'var(--dplex-accent, #60a5fa)' }} />
    case 'json':
    case 'jsonc':
      return <FileJson {...common} style={{ color: 'var(--dplex-status-warning, #fbbf24)' }} />
    case 'css':
    case 'scss':
    case 'less':
      return <Hash {...common} style={{ color: 'var(--dplex-accent, #60a5fa)' }} />
    case 'html':
    case 'htm':
    case 'xml':
    case 'svg':
      return <Braces {...common} style={{ color: 'var(--dplex-status-warning, #fbbf24)' }} />
    case 'md':
    case 'markdown':
    case 'txt':
    case 'rst':
      return <FileText {...common} style={{ color: 'var(--dplex-text-muted)' }} />
    case 'yml':
    case 'yaml':
    case 'toml':
    case 'ini':
    case 'env':
    case 'conf':
      return <FileCog {...common} style={{ color: 'var(--dplex-text-muted)' }} />
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'ico':
    case 'bmp':
      return <FileImage {...common} style={{ color: 'var(--dplex-status-success, #4ade80)' }} />
    case 'zip':
    case 'tar':
    case 'gz':
    case 'tgz':
    case 'rar':
    case '7z':
      return <FileArchive {...common} style={{ color: 'var(--dplex-text-muted)' }} />
    case 'lock':
      return <FileType {...common} style={{ color: 'var(--dplex-text-dim)' }} />
    default:
      return <FileIcon {...common} style={{ color: 'var(--dplex-text-muted)' }} />
  }
}
