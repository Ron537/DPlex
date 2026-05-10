import { describe, expect, it } from 'vitest'
import {
  anchorFor,
  escapeHtml,
  parseChangelog,
  renderInline,
  renderLatestReleasesPreview,
  renderReleasesHtml,
  renderSitemap,
  renderTocHtml
} from '../../scripts/build-changelog.mjs'

const FIXTURE = `# Changelog

All notable changes to DPlex are documented in this file.

## [Unreleased]

## [0.13.0] — 2026-05-10

### Features

- AI session tabs now show a live status dot — the same colors used in
  the sidebar — so you can tell at a glance whether a background tab is
  thinking, running a tool, or waiting on you.

## [0.12.0] — 2026-05-09

### Features

- New global search palette (Cmd/Ctrl+P) for finding things.
- Cmd/Ctrl+Shift+P opens a command runner.

### Bug Fixes

- Fixed a thing that was \`broken\` with **bold emphasis**.

## [0.1.0] — Initial public release

First public release of DPlex.

### Features

- Tabbed terminal multiplexer.

[Unreleased]: https://github.com/Ron537/DPlex/compare/v0.13.0...HEAD
[0.13.0]: https://github.com/Ron537/DPlex/compare/v0.12.0...v0.13.0
`

describe('escapeHtml', () => {
  it('escapes the five core characters', () => {
    expect(escapeHtml(`<a href="x">'&y'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;y&#39;&lt;/a&gt;'
    )
  })

  it('coerces non-strings safely', () => {
    expect(escapeHtml(42)).toBe('42')
  })
})

describe('renderInline', () => {
  it('renders backtick code', () => {
    expect(renderInline('use `npm test` to run')).toContain('<code>npm test</code>')
  })

  it('renders bold', () => {
    expect(renderInline('this is **important** text')).toContain('<strong>important</strong>')
  })

  it('escapes HTML before applying markdown', () => {
    expect(renderInline('<script>alert(1)</script>')).not.toContain('<script>')
  })

  it('does not turn ** inside code into bold', () => {
    const out = renderInline('`a**b**c`')
    expect(out).toContain('<code>a**b**c</code>')
    expect(out).not.toContain('<strong>')
  })
})

describe('anchorFor', () => {
  it('produces stable anchors for SemVer', () => {
    expect(anchorFor('0.13.0')).toBe('v0-13-0')
  })

  it('handles non-version labels', () => {
    expect(anchorFor('Unreleased')).toBe('vunreleased')
  })
})

describe('parseChangelog', () => {
  it('parses every documented release with correct dates', () => {
    const releases = parseChangelog(FIXTURE)
    expect(releases.map((r) => r.version)).toEqual(['0.13.0', '0.12.0', '0.1.0'])
    expect(releases[0].date).toBe('2026-05-10')
    expect(releases[2].date).toBe('Initial public release')
  })

  it('drops Unreleased when it has no bullets', () => {
    const releases = parseChangelog(FIXTURE)
    expect(releases.find((r) => r.version.toLowerCase() === 'unreleased')).toBeUndefined()
  })

  it('keeps Unreleased when it has at least one bullet', () => {
    const md = `## [Unreleased]\n\n### Features\n\n- Something queued up.\n\n## [0.1.0] — 2024-01-01\n\n### Features\n\n- First.\n`
    const releases = parseChangelog(md)
    expect(releases[0].version).toBe('Unreleased')
    expect(releases[0].sections[0].bullets).toEqual(['Something queued up.'])
  })

  it('keeps section ordering and groups bullets by section', () => {
    const releases = parseChangelog(FIXTURE)
    const v012 = releases.find((r) => r.version === '0.12.0')!
    expect(v012.sections.map((s) => s.title)).toEqual(['Features', 'Bug Fixes'])
    expect(v012.sections[0].bullets).toHaveLength(2)
    expect(v012.sections[1].bullets).toHaveLength(1)
  })

  it('joins continuation lines of a multi-line bullet into one entry', () => {
    const releases = parseChangelog(FIXTURE)
    const v013 = releases.find((r) => r.version === '0.13.0')!
    expect(v013.sections[0].bullets).toHaveLength(1)
    expect(v013.sections[0].bullets[0]).toMatch(/AI session tabs.*waiting on you\.$/)
  })

  it('ignores link-reference footer block', () => {
    const releases = parseChangelog(FIXTURE)
    expect(releases.every((r) => !/https:/.test(r.version))).toBe(true)
  })

  it('returns an empty array for an empty input', () => {
    expect(parseChangelog('')).toEqual([])
  })
})

describe('renderReleasesHtml', () => {
  it('emits one <article> per release with a stable id', () => {
    const html = renderReleasesHtml(parseChangelog(FIXTURE))
    expect(html.match(/<article /g)).toHaveLength(3)
    expect(html).toContain('id="v0-13-0"')
    expect(html).toContain('id="v0-12-0"')
    expect(html).toContain('id="v0-1-0"')
  })

  it('renders inline `code` and **bold** inside bullets', () => {
    const html = renderReleasesHtml(parseChangelog(FIXTURE))
    expect(html).toContain('<code>broken</code>')
    expect(html).toContain('<strong>bold emphasis</strong>')
  })

  it('renders section-specific class names for theming', () => {
    const html = renderReleasesHtml(parseChangelog(FIXTURE))
    expect(html).toContain('release-section--features')
    expect(html).toContain('release-section--bug-fixes')
  })

  it('handles zero releases gracefully', () => {
    expect(renderReleasesHtml([])).toContain('No releases yet')
  })

  it('escapes HTML in malicious version labels', () => {
    const html = renderReleasesHtml([
      { version: '<img src=x onerror=alert(1)>', date: null, sections: [] }
    ])
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('preserves $& and $$ literally in bullet text (no replacement-pattern interpretation)', () => {
    const releases = [
      {
        version: '1.0.0',
        date: '2026-01-01',
        sections: [{ title: 'Features', bullets: ['use $& and $$ in shell scripts'] }]
      }
    ]
    const html = renderReleasesHtml(releases)
    expect(html).toContain('use $&amp; and $$ in shell scripts')
  })
})

describe('renderTocHtml', () => {
  it('renders a list of version links matching the parsed releases', () => {
    const releases = parseChangelog(FIXTURE)
    const toc = renderTocHtml(releases)
    expect(toc).toContain('href="#v0-13-0"')
    expect(toc).toContain('href="#v0-12-0"')
    expect(toc).toContain('href="#v0-1-0"')
    expect(toc.match(/<li>/g)).toHaveLength(3)
  })

  it('returns empty string when there are no releases', () => {
    expect(renderTocHtml([])).toBe('')
  })
})

describe('renderSitemap', () => {
  it('emits home + changelog URLs with the given lastmod', () => {
    const xml = renderSitemap('https://ron537.github.io/DPlex', '2026-05-10')
    expect(xml).toContain('<loc>https://ron537.github.io/DPlex/</loc>')
    expect(xml).toContain('<loc>https://ron537.github.io/DPlex/changelog/</loc>')
    expect(xml).toContain('<lastmod>2026-05-10</lastmod>')
  })
})

describe('renderLatestReleasesPreview', () => {
  it('renders the top N releases by default', () => {
    const html = renderLatestReleasesPreview(parseChangelog(FIXTURE))
    expect((html.match(/whats-new-card/g) || []).length).toBeGreaterThanOrEqual(3)
  })

  it('respects the count option', () => {
    const html = renderLatestReleasesPreview(parseChangelog(FIXTURE), { count: 1 })
    expect((html.match(/<a class="whats-new-card"/g) || []).length).toBe(1)
    expect(html).toContain('href="./changelog/#v0-13-0"')
  })

  it('skips the [Unreleased] section', () => {
    const md = `## [Unreleased]\n\n### Features\n\n- Queued.\n\n## [1.0.0] — 2026-01-01\n\n### Features\n\n- Real release.\n`
    const html = renderLatestReleasesPreview(parseChangelog(md))
    expect(html).toContain('href="./changelog/#v1-0-0"')
    expect(html).not.toContain('Unreleased')
    expect(html).not.toContain('Queued.')
  })

  it('prefers Features over Improvements over Bug Fixes when picking bullets', () => {
    const md = `## [1.0.0] — 2026-01-01\n\n### Bug Fixes\n\n- Fixed.\n\n### Improvements\n\n- Improved.\n\n### Features\n\n- New feature.\n`
    const html = renderLatestReleasesPreview(parseChangelog(md))
    expect(html).toContain('New feature.')
    expect(html).toContain('whats-new-tag--features')
    expect(html).not.toContain('Fixed.')
    expect(html).not.toContain('Improved.')
  })

  it('falls back to whatever section has bullets if no priority section is present', () => {
    const md = `## [1.0.0] — 2026-01-01\n\n### Documentation\n\n- Doc-only update.\n`
    const html = renderLatestReleasesPreview(parseChangelog(md))
    expect(html).toContain('Doc-only update.')
  })

  it('caps bullets per release at the configured maximum', () => {
    const md = `## [1.0.0] — 2026-01-01\n\n### Features\n\n- One.\n- Two.\n- Three.\n- Four.\n`
    const html = renderLatestReleasesPreview(parseChangelog(md), { bulletsPerRelease: 2 })
    expect(html).toContain('One.')
    expect(html).toContain('Two.')
    expect(html).not.toContain('Three.')
  })

  it('returns an empty string when there are no real releases', () => {
    expect(renderLatestReleasesPreview([])).toBe('')
    const md = `## [Unreleased]\n\n### Features\n\n- Queued.\n`
    // Note: parseChangelog keeps Unreleased when it has bullets, but the
    // preview must still skip it.
    expect(renderLatestReleasesPreview(parseChangelog(md))).toBe('')
  })

  it('escapes HTML in bullet content', () => {
    const md = `## [1.0.0] — 2026-01-01\n\n### Features\n\n- A <script>alert(1)</script> bullet.\n`
    const html = renderLatestReleasesPreview(parseChangelog(md))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
