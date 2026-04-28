/**
 * Monaco lazy bootstrapper.
 *
 * Monaco adds ~5–7 MB to the bundle, so we keep its imports behind a single
 * dynamic `import()` and only call `loadMonaco()` from the diff editor pane
 * when a diff tab is actually rendered.
 *
 * Vite's `?worker` suffix turns each language worker into a constructable
 * `Worker` class. We wire them into `MonacoEnvironment.getWorker` so Monaco
 * uses local workers instead of trying to fetch them from a CDN — required
 * for Electron's `file://` renderer where remote loads are blocked.
 */

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

type MonacoModule = typeof import('monaco-editor')

let cached: Promise<MonacoModule> | null = null

interface MonacoWorkerEnvironment {
  getWorker: (workerId: string, label: string) => Worker
}

export function loadMonaco(): Promise<MonacoModule> {
  if (cached)
    return cached
    // Set up the worker factory BEFORE importing monaco — Monaco reads
    // `self.MonacoEnvironment` synchronously when its workers are first needed.
  ;(globalThis as unknown as { MonacoEnvironment: MonacoWorkerEnvironment }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      switch (label) {
        case 'json':
          return new JsonWorker()
        case 'css':
        case 'scss':
        case 'less':
          return new CssWorker()
        case 'html':
        case 'handlebars':
        case 'razor':
          return new HtmlWorker()
        case 'typescript':
        case 'javascript':
          return new TsWorker()
        default:
          return new EditorWorker()
      }
    }
  }
  cached = import('monaco-editor')
  return cached
}

/**
 * Map a file path to a Monaco language id. Unknown extensions fall back to
 * `plaintext` so the diff still renders without highlighting.
 */
export function languageIdForPath(filePath: string): string {
  const lower = filePath.toLowerCase()
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'cts':
    case 'mts':
      return 'typescript'
    case 'js':
    case 'jsx':
    case 'cjs':
    case 'mjs':
      return 'javascript'
    case 'json':
    case 'jsonc':
      return 'json'
    case 'css':
      return 'css'
    case 'scss':
      return 'scss'
    case 'less':
      return 'less'
    case 'html':
    case 'htm':
      return 'html'
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'py':
      return 'python'
    case 'rs':
      return 'rust'
    case 'go':
      return 'go'
    case 'java':
      return 'java'
    case 'kt':
    case 'kts':
      return 'kotlin'
    case 'swift':
      return 'swift'
    case 'rb':
      return 'ruby'
    case 'php':
      return 'php'
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell'
    case 'yml':
    case 'yaml':
      return 'yaml'
    case 'toml':
      return 'toml'
    case 'xml':
    case 'xsd':
    case 'svg':
      return 'xml'
    case 'sql':
      return 'sql'
    case 'c':
    case 'h':
      return 'c'
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
    case 'hh':
      return 'cpp'
    case 'cs':
      return 'csharp'
    case 'dockerfile':
      return 'dockerfile'
    default:
      // Special filenames without extensions
      if (lower.endsWith('/dockerfile') || lower === 'dockerfile') return 'dockerfile'
      if (lower.endsWith('/makefile') || lower === 'makefile') return 'shell'
      return 'plaintext'
  }
}
