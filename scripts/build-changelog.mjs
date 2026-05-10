#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type --
   This is a Node build script, not application TypeScript. JSDoc types
   are provided for editor IntelliSense; the explicit-function-return-type
   rule applies to .ts/.tsx files. */
// Build-time CHANGELOG renderer.
//
// Reads CHANGELOG.md from the repo root and emits two artifacts:
//   1) An HTML changelog page rendered into a template (default:
//      site/changelog.html.template -> _site/changelog/index.html).
//   2) A sitemap.xml listing the home page and changelog page.
//
// Zero npm dependencies on purpose — only node:fs / node:path / node:url.
// The parser handles exactly the format documented in
// .github/copilot-instructions.md ("Changelog content rules"):
//
//   ## [x.y.z] — YYYY-MM-DD       (top-level release; em-dash is allowed)
//   ### Features|Improvements|Bug Fixes|Performance
//   - bullet
//   - second bullet …
//
// Inline `code` and **bold** are supported in bullets. Anything outside the
// known grammar (raw paragraphs under a version, the link-reference block
// at the bottom of the file, the `[Unreleased]` placeholder) is skipped
// gracefully so the page never breaks.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const HEADING_RE = /^##\s+\[([^\]]+)\](?:\s+[—–-]\s+(.+))?\s*$/
const SUBHEADING_RE = /^###\s+(.+?)\s*$/
const BULLET_RE = /^[-*]\s+(.+)$/

/**
 * Escape user-supplied text before embedding into HTML.
 * @param {unknown} input
 * @returns {string}
 */
export function escapeHtml(input) {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Render inline markdown for a bullet: backticks become <code>, **bold**
 * and *italic* become <strong>/<em>. Input is fully HTML-escaped first so
 * untrusted text cannot inject markup.
 * @param {string} input
 * @returns {string}
 */
export function renderInline(input) {
  const codeSpans = []
  let s = escapeHtml(input).replace(/`([^`]+)`/g, (_, body) => {
    const idx = codeSpans.push(`<code>${body}</code>`) - 1
    return `\uE000CODE${idx}\uE001`
  })
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  s = s.replace(/\uE000CODE(\d+)\uE001/g, (_, idx) => codeSpans[Number(idx)])
  return s
}

/**
 * Convert a release identifier ("0.13.0") into a stable HTML anchor id.
 * @param {string} version
 * @returns {string}
 */
export function anchorFor(version) {
  return (
    'v' +
    String(version)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  )
}

/**
 * @typedef {{ title: string, bullets: string[] }} ReleaseSection
 * @typedef {{ version: string, date: string | null, sections: ReleaseSection[] }} Release
 */

/**
 * Parse CHANGELOG.md text into a normalized array of release objects.
 * The `[Unreleased]` placeholder is dropped if it has no bullets.
 * @param {string} markdown
 * @returns {Release[]}
 */
export function parseChangelog(markdown) {
  const lines = markdown.split(/\r?\n/)
  /** @type {Release[]} */
  const releases = []
  /** @type {Release | null} */
  let current = null
  /** @type {ReleaseSection | null} */
  let currentSection = null
  /** @type {string | null} */
  let collectingBullet = null

  /** @returns {void} */
  const flushBullet = () => {
    if (collectingBullet != null && currentSection) {
      currentSection.bullets.push(collectingBullet.trim())
    }
    collectingBullet = null
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '')

    const headingMatch = line.match(HEADING_RE)
    if (headingMatch) {
      flushBullet()
      currentSection = null
      const version = headingMatch[1].trim()
      const date = headingMatch[2] ? headingMatch[2].trim() : null
      current = { version, date, sections: [] }
      releases.push(current)
      continue
    }

    if (!current) continue

    const subMatch = line.match(SUBHEADING_RE)
    if (subMatch) {
      flushBullet()
      currentSection = { title: subMatch[1].trim(), bullets: [] }
      current.sections.push(currentSection)
      continue
    }

    const bulletMatch = line.match(BULLET_RE)
    if (bulletMatch && currentSection) {
      flushBullet()
      collectingBullet = bulletMatch[1]
      continue
    }

    if (line.startsWith('  ') && collectingBullet != null) {
      collectingBullet += ' ' + line.trim()
      continue
    }

    if (line.trim() === '') {
      flushBullet()
      continue
    }
  }
  flushBullet()

  return releases.filter((r) => {
    if (r.version.toLowerCase() === 'unreleased') {
      return r.sections.some((s) => s.bullets.length > 0)
    }
    return true
  })
}

/**
 * Render the parsed releases into the HTML fragment for the changelog page.
 * @param {Release[]} releases
 * @returns {string}
 */
export function renderReleasesHtml(releases) {
  if (releases.length === 0) {
    return '<p class="empty">No releases yet.</p>'
  }
  const parts = []
  for (const release of releases) {
    const id = anchorFor(release.version)
    const versionLabel = escapeHtml(release.version)
    const dateLabel = release.date ? escapeHtml(release.date) : ''
    parts.push(`<article class="release" id="${id}">`)
    parts.push('<header class="release-head">')
    parts.push(
      `<h2><a href="#${id}" class="anchor" aria-label="Permalink to version ${versionLabel}">#</a>` +
        `<span class="version">${versionLabel}</span></h2>`
    )
    if (dateLabel) {
      parts.push(`<time class="release-date">${dateLabel}</time>`)
    }
    parts.push('</header>')

    if (release.sections.length === 0) {
      parts.push('<p class="release-empty">No itemized notes for this release.</p>')
    } else {
      for (const section of release.sections) {
        const sectionTitle = escapeHtml(section.title)
        const sectionSlug = section.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        parts.push(`<section class="release-section release-section--${sectionSlug}">`)
        parts.push(`<h3>${sectionTitle}</h3>`)
        if (section.bullets.length === 0) {
          parts.push('<p class="release-empty">—</p>')
        } else {
          parts.push('<ul>')
          for (const bullet of section.bullets) {
            parts.push(`<li>${renderInline(bullet)}</li>`)
          }
          parts.push('</ul>')
        }
        parts.push('</section>')
      }
    }
    parts.push('</article>')
  }
  return parts.join('\n')
}

/**
 * Build a release-quicklinks list shown in the sidebar of the changelog page.
 * @param {Release[]} releases
 * @returns {string}
 */
export function renderTocHtml(releases) {
  if (releases.length === 0) return ''
  const items = releases
    .map((r) => {
      const id = anchorFor(r.version)
      const label = escapeHtml(r.version)
      const date = r.date ? `<span class="toc-date">${escapeHtml(r.date)}</span>` : ''
      return `<li><a href="#${id}"><span class="toc-version">${label}</span>${date}</a></li>`
    })
    .join('\n')
  return `<ul class="toc">\n${items}\n</ul>`
}

/**
 * Render the sitemap.xml content. Dates are ISO YYYY-MM-DD.
 * @param {string} baseUrl
 * @param {string} lastmod
 * @returns {string}
 */
export function renderSitemap(baseUrl, lastmod) {
  const urls = [
    { loc: baseUrl + '/', priority: '1.0', changefreq: 'weekly' },
    { loc: baseUrl + '/changelog/', priority: '0.8', changefreq: 'weekly' }
  ]
  const entries = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n` +
        `    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`
}

/**
 * Render a compact "What's new" preview for the home page: top N releases,
 * each shown as a card with version, date, and the first 2 bullets from its
 * highest-priority section. Each card links into the dedicated /changelog/.
 * Order of section preference: Features → Improvements → Bug Fixes → Performance.
 * Skips the [Unreleased] entry.
 *
 * @param {Release[]} releases
 * @param {{ count?: number, bulletsPerRelease?: number }} [opts]
 * @returns {string}
 */
export function renderLatestReleasesPreview(releases, opts = {}) {
  const count = opts.count ?? 3
  const bulletsPerRelease = opts.bulletsPerRelease ?? 2
  const sectionPriority = ['Features', 'Improvements', 'Bug Fixes', 'Performance']

  const recent = releases
    .filter((r) => r.version.toLowerCase() !== 'unreleased')
    .slice(0, count)

  if (recent.length === 0) return ''

  const cards = recent.map((release) => {
    const id = anchorFor(release.version)
    const versionLabel = escapeHtml(release.version)
    const dateLabel = release.date ? escapeHtml(release.date) : ''

    const primary =
      sectionPriority
        .map((name) => release.sections.find((s) => s.title === name))
        .find((s) => s && s.bullets.length > 0) || release.sections.find((s) => s.bullets.length > 0)

    const bullets = primary ? primary.bullets.slice(0, bulletsPerRelease) : []
    const items = bullets.map((b) => `<li>${renderInline(b)}</li>`).join('\n')
    const sectionTag = primary
      ? `<span class="whats-new-tag whats-new-tag--${primary.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')}">${escapeHtml(primary.title)}</span>`
      : ''

    return [
      `<a class="whats-new-card" href="./changelog/#${id}">`,
      `  <header class="whats-new-card-head">`,
      `    <span class="whats-new-version">v${versionLabel}</span>`,
      dateLabel ? `    <time class="whats-new-date">${dateLabel}</time>` : '',
      `  </header>`,
      sectionTag ? `  ${sectionTag}` : '',
      items ? `  <ul class="whats-new-bullets">\n${items}\n  </ul>` : '',
      `</a>`
    ]
      .filter(Boolean)
      .join('\n')
  })

  return cards.join('\n')
}

/** @returns {string} */
function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

/** @returns {void} */
function main() {
  const repoRoot = resolve(__dirname, '..')
  const changelogPath = resolve(repoRoot, 'CHANGELOG.md')
  const templatePath = resolve(repoRoot, 'site', 'changelog.html.template')
  const outDir = resolve(repoRoot, '_site')
  const outChangelogDir = resolve(outDir, 'changelog')
  const outChangelogPath = resolve(outChangelogDir, 'index.html')
  const outIndexPath = resolve(outDir, 'index.html')
  const outSitemapPath = resolve(outDir, 'sitemap.xml')

  if (!existsSync(changelogPath)) {
    console.error(`build-changelog: CHANGELOG.md not found at ${changelogPath}`)
    process.exit(1)
  }
  if (!existsSync(templatePath)) {
    console.error(`build-changelog: template not found at ${templatePath}`)
    process.exit(1)
  }

  const markdown = readFileSync(changelogPath, 'utf8')
  const template = readFileSync(templatePath, 'utf8')

  const releases = parseChangelog(markdown)
  const releasesHtml = renderReleasesHtml(releases)
  const tocHtml = renderTocHtml(releases)
  const latestPreviewHtml = renderLatestReleasesPreview(releases)
  const buildDate = todayIso()
  const latestVersion =
    releases.find((r) => r.version.toLowerCase() !== 'unreleased')?.version || ''

  const html = template
    .replace(/{{RELEASES}}/g, () => releasesHtml)
    .replace(/{{TOC}}/g, () => tocHtml)
    .replace(/{{BUILD_DATE}}/g, () => escapeHtml(buildDate))
    .replace(/{{LATEST_VERSION}}/g, () => escapeHtml(latestVersion))
    .replace(/{{LATEST_ANCHOR}}/g, () => (latestVersion ? anchorFor(latestVersion) : ''))

  mkdirSync(outChangelogDir, { recursive: true })
  writeFileSync(outChangelogPath, html, 'utf8')

  // Patch the home page in-place: only the {{LATEST_RELEASES}} and
  // {{LATEST_VERSION}} tokens. The home page lives at outIndexPath because
  // build-site.mjs already copied site/ → _site/ before this script runs.
  // We attempt the read directly (no separate exists check) so there's no
  // TOCTOU window between check and read.
  let indexHtml
  try {
    indexHtml = readFileSync(outIndexPath, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      indexHtml = null
    } else {
      throw err
    }
  }
  if (indexHtml !== null) {
    const patched = indexHtml
      .replace(/{{LATEST_RELEASES}}/g, () => latestPreviewHtml)
      .replace(/{{LATEST_VERSION}}/g, () => escapeHtml(latestVersion))
    writeFileSync(outIndexPath, patched, 'utf8')
  }

  const sitemap = renderSitemap('https://ron537.github.io/DPlex', buildDate)
  writeFileSync(outSitemapPath, sitemap, 'utf8')

  console.log(
    `build-changelog: wrote ${outChangelogPath} (${releases.length} releases) and sitemap`
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
