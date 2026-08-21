# Adding a theme

DPlex themes keep the application chrome and every terminal readable as
one coordinated color system. Theme definitions live in
[`themes.ts`](../src/renderer/src/services/themes.ts), where each entry
in `THEMES` implements the `AppTheme` interface.

## Theme anatomy

An `AppTheme` has five top-level fields:

| Field      | Purpose                                                                           |
| ---------- | --------------------------------------------------------------------------------- |
| `id`       | Stable, unique key saved in user settings. Do not change it later.                |
| `name`     | Human-readable name shown in the theme picker.                                    |
| `variant`  | Either `light` or `dark`; controls native controls and derived colors.            |
| `terminal` | An xterm.js [`ITheme`](https://xtermjs.org/docs/api/terminal/interfaces/itheme/). |
| `ui`       | DPlex surface, text, border, accent, hover, and scrollbar tokens.                 |

The terminal palette should define its background, foreground, cursor,
selection, and all 16 ANSI colors. The UI palette supplies the colors
used by React components through `--dplex-*` CSS custom properties.

### UI regions

The main surface tokens map to the application like this:

```text
+----------------+----------------------+--------------------------------+
| Activity bar   | Side panel           | Editor / terminal              |
| bgActivity     | bgPanel              | bg                              |
|                | search: bgInput      | cards and popovers: bgElev*    |
+----------------+----------------------+--------------------------------+
```

`bgActivity` is the input to the activity-bar color. At runtime it is
mixed slightly toward black for dark themes or white for light themes,
which keeps the narrow rail visually separate from the side panel.

### UI token reference

| Token            | Controls                                                               |
| ---------------- | ---------------------------------------------------------------------- |
| `bg`             | Main editor, terminal surround, and body background.                   |
| `bgAlt`          | Secondary surface and the fallback for most optional backgrounds.      |
| `bgPanel`        | Sidebars, panels, and cards; falls back to `bgAlt`.                    |
| `bgElev`         | Popovers and first-level elevated surfaces; falls back to `bgAlt`.     |
| `bgElev2`        | Stronger elevated or selected surfaces; falls back to `bgElev`.        |
| `bgElev3`        | Hover state on elevated surfaces; falls back to `bgElev2`.             |
| `bgActivity`     | Activity bar and collapsed rail; falls back to `bgPanel`.              |
| `bgInput`        | Search fields and form controls; falls back to `bgAlt`.                |
| `border`         | Default dividers and outlines.                                         |
| `borderStrong`   | Elevated-surface outlines; falls back to `border`.                     |
| `borderSubtle`   | Low-emphasis chrome dividers; falls back to `border`.                  |
| `text`           | Primary text.                                                          |
| `text2`          | Headings and inline emphasis; falls back to `text`.                    |
| `textMuted`      | Secondary labels and descriptions.                                     |
| `textDim`        | Lower-emphasis metadata; falls back to `textMuted`.                    |
| `textFaint`      | Captions and section labels; falls back to `textDim`.                  |
| `accent`         | Primary actions, focus states, and links.                              |
| `accent2`        | Second step in the accent ramp; falls back to `accent`.                |
| `accent3`        | Deepest accent shade; falls back to `accent2`.                         |
| `accentAlt`      | Second color in branded gradients; falls back through the accent ramp. |
| `hover`          | Hover fill on interactive rows and buttons.                            |
| `scrollbar`      | Resting scrollbar thumb.                                               |
| `scrollbarHover` | Hovered scrollbar thumb.                                               |

Define `hover`, `scrollbar`, and `scrollbarHover` explicitly for light
themes. Their generic fallbacks are translucent white and are intended
for dark backgrounds.

## Derived colors

[`applyCssVarsSync`](../src/renderer/src/stores/settingsStore.ts)
turns the selected theme into CSS variables before React renders. It
derives several values so themes stay consistent without duplicating
every state color:

- `accent` produces soft, faint, ring, and glow variants at fixed alpha
  levels. Use `#rgb`, `#rrggbb`, `rgb(...)`, or `rgba(...)` so these
  variants can be calculated.
- `accent` and `accentAlt` form the primary gradient.
- `variant` selects separate light and dark status palettes for idle,
  thinking, executing, approval, waiting, success, warning, error, and
  informational states.
- `variant` also selects the browser's native `color-scheme` and the
  foreground used on accent-filled controls.

Status colors are intentionally not part of `AppTheme`. Do not hardcode
replacement status colors in components or add them to an individual
theme.

## Add a new theme

1. Open `src/renderer/src/services/themes.ts` and add a new entry under
   `THEMES`. Copy an existing light or dark theme as a starting point.
2. Give the theme a unique, stable `id`, a user-facing `name`, and the
   correct `variant`.
3. Choose the neutral surfaces and text colors first, then the accent
   ramp. Complete the xterm terminal palette so ANSI output matches the
   application chrome.
4. Run `npm install` if dependencies are not installed, then start the
   app with `npm run dev`.
5. Open Settings and switch between the new theme and an existing theme.
   Check the activity bar, side panel, editor, inputs, menus, dialogs,
   hover states, focus rings, scrollbars, terminal selection, cursor,
   and all ANSI colors.
6. Run `npm run typecheck`, `npm run lint`, and `npm run test:unit`.

## Check contrast

Use the
[WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
or browser developer tools to test actual foreground/background pairs.
Under
[WCAG 2.2 contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html),
normal text should reach at least **4.5:1**, while large text should
reach at least **3:1**. Interactive controls, focus indicators, and
meaningful graphical boundaries should reach **3:1** against adjacent
colors.

At minimum, verify `text` and `textMuted` against `bg`, `bgPanel`,
`bgElev`, and `bgInput`; accent-filled controls against their derived
foreground; borders against neighboring surfaces; and all terminal ANSI
colors against the terminal background.
