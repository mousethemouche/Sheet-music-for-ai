# Design system: tokens, primitives and the player theme

The visual language of the web app (`apps/web`) and of the shared ScorePlayer
(`packages/score-ui`), also shown inside the MCP View. Direction: sober and
neutral. A clean SaaS look in white and grey with one accent color (indigo),
system fonts, very subtle shadows, light and dark.

| Path                              | Role                                                                   |
| --------------------------------- | ---------------------------------------------------------------------- |
| `apps/web/src/styles/tokens.css`  | Every design token (§1) and the `--smp-*` mapping of the player (§4)   |
| `apps/web/src/styles/base.css`    | Imports the tokens; reset, typography, focus, motion, `.ui-*` (§2, §3) |
| `apps/web/src/main.tsx`           | Imports `./styles/base.css` once. No other file imports CSS            |
| `packages/score-ui/src/theme.ts`  | Player palettes (the same values as the tokens) and the renderer theme |
| `packages/score-ui/src/styles.ts` | The player's own stylesheet, rendered by ScorePlayer (§4)              |

Rules:

- Colors, sizes and radii come from tokens only. No hex value outside
  `tokens.css` (web) and `theme.ts` (player).
- Plain CSS, no CSS-in-JS library and no new dependency. The web CSS is
  bundled by Vite (CSP `style-src 'self' 'unsafe-inline'`). No web font: the
  CSP allows only `font-src 'self' data:` and the app works offline.
- Tests select roles, labels and text, never classes (MCP_VIEW.md §6). A class
  may change without touching a test; an accessible name or visible string may
  not.

## 1. Tokens

All tokens are custom properties on `:root`. Light is the default; dark
applies under `@media (prefers-color-scheme: dark)`. `color-scheme: light
dark` lets native controls and scrollbars follow.

### 1.1 Colors

| Token                   | Light                    | Dark                     | Use                                                       |
| ----------------------- | ------------------------ | ------------------------ | --------------------------------------------------------- |
| `--ui-bg`               | `#ffffff`                | `#0f0f11`                | page background                                           |
| `--ui-surface`          | `#f7f7f8`                | `#17171a`                | subtle surfaces: chips, controls bar, code                |
| `--ui-surface-elevated` | `#ffffff`                | `#1c1c20`                | cards, inputs, secondary buttons                          |
| `--ui-surface-hover`    | `#f4f4f5`                | `#232328`                | hover of secondary/ghost buttons and nav links            |
| `--ui-header-bg`        | `rgb(255 255 255 / .88)` | `rgb(15 15 17 / .85)`    | translucent sticky header                                 |
| `--ui-border`           | `#e4e4e7`                | `#2a2a30`                | dividers, cards                                           |
| `--ui-border-control`   | `#d4d4d8`                | `#3a3a42`                | secondary buttons, chip hover, slider track               |
| `--ui-border-strong`    | `#8b8b94`                | `#6b6b76`                | input boundaries, switch off (3:1 against bg and surface) |
| `--ui-text`             | `#18181b`                | `#f4f4f5`                | text                                                      |
| `--ui-text-muted`       | `#71717a`                | `#a1a1aa`                | secondary text, meta, placeholders                        |
| `--ui-accent`           | `#4f46e5`                | `#818cf8`                | primary buttons, links, focus ring, selection             |
| `--ui-accent-hover`     | `#4338ca`                | `#a5b4fc`                | hover of the above                                        |
| `--ui-accent-soft`      | `#eef2ff`                | `rgb(129 140 248 / .14)` | info alert, selected chip                                 |
| `--ui-accent-border`    | `#c7d2fe`                | `rgb(129 140 248 / .35)` | border of the above                                       |
| `--ui-on-accent`        | `#ffffff`                | `#0f0f11`                | text on accent fills                                      |
| `--ui-danger`           | `#dc2626`                | `#f87171`                | invalid input border, danger icon                         |
| `--ui-danger-text`      | `#b91c1c`                | `#fca5a5`                | error text (on bg and on the soft background)             |
| `--ui-danger-soft`      | `#fef2f2`                | `rgb(248 113 113 / .12)` | error alert background                                    |
| `--ui-danger-border`    | `#fecaca`                | `rgb(248 113 113 / .35)` | error alert border                                        |
| `--ui-success`          | `#16a34a`                | `#4ade80`                | success icon                                              |
| `--ui-success-text`     | `#15803d`                | `#86efac`                | success text                                              |
| `--ui-success-soft`     | `#f0fdf4`                | `rgb(74 222 128 / .12)`  | success alert background                                  |
| `--ui-success-border`   | `#bbf7d0`                | `rgb(74 222 128 / .3)`   | success alert border                                      |
| `--ui-focus-ring`       | `var(--ui-accent)`       | `var(--ui-accent)`       | 2 px focus outline                                        |

Contrast (WCAG 2.2 AA), light / dark, measured on `--ui-bg`: text
17.7:1 / 17.4:1, muted 4.8:1 / 7.5:1 (4.5:1 on the light `--ui-surface`),
accent as text 6.3:1 / 6.4:1, danger text 6.5:1 / 10.1:1, success text
5.0:1 (light). Two deliberate departures from the brief, both for AA:

- **Text on accent is dark in dark mode.** White on `#818cf8` is 3.0:1;
  `#0f0f11` on it is 6.4:1. Light mode keeps white on `#4f46e5` (6.3:1).
- **Error and success text use a darker shade** (`--ui-danger-text`,
  `--ui-success-text`): `#dc2626` on `#fef2f2` is 4.4:1 and `#16a34a` on
  white 3.3:1, both below 4.5:1 (the darker shades give 5.9:1 and 4.8:1 on
  their soft backgrounds). The brief's hues stay for borders and icons.

`--ui-border` (1.3:1) is decorative only. A boundary that identifies a
control (an input, the Loop switch) uses `--ui-border-strong` (3.4:1 light,
3.2:1 dark on elevated surfaces), WCAG 1.4.11.

### 1.2 Type, space, shape, motion

| Token                                                    | Value                                                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--ui-font-sans`                                         | `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |
| `--ui-font-mono`                                         | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`                    |
| `--ui-text-xs` / `-sm` / `-base` / `-md` / `-lg` / `-xl` | 12 / 13 / **15 (body)** / 16 (inputs on phones) / 18 (h2) / 24 px (h1)                                      |
| `--ui-leading` / `--ui-leading-tight`                    | 1.5 / 1.25                                                                                                  |
| `--ui-tracking-tight` / `--ui-tracking-title`            | -0.011em (headings) / -0.02em (h1)                                                                          |
| `--ui-weight-medium` / `--ui-weight-semibold`            | 500 (labels, buttons) / 600 (headings)                                                                      |
| `--ui-space-1` … `--ui-space-7`                          | 4 / 8 / 12 / 16 / 24 / 32 / 48 px                                                                           |
| `--ui-radius` / `--ui-radius-lg` / `--ui-radius-full`    | 8 px (controls) / 12 px (cards) / 999 px (chips, switch)                                                    |
| `--ui-control-height` / `--ui-control-height-sm`         | 40 / 32 px (the small one is 40 px at 640 px and below: touch targets)                                      |
| `--ui-header-height`                                     | 56 px                                                                                                       |
| `--ui-container-width` / `--ui-gutter`                   | 1040 px content width / 24 px side padding (16 px at 640 px and below)                                      |
| `--ui-auth-width`                                        | 400 px                                                                                                      |
| `--ui-shadow-sm` / `--ui-shadow` / `--ui-shadow-hover`   | hairline / card / interactive card hover (stronger alpha in dark)                                           |
| `--ui-duration` / `--ui-ease`                            | 120 ms / `cubic-bezier(0.2, 0, 0, 1)`                                                                       |

Dates and numbers use tabular figures (`time` elements and `.ui-tabular`).

## 2. Base rules (base.css)

- **Reset.** `box-sizing: border-box` everywhere; zero margins on headings,
  paragraphs, lists and figures: spacing comes from layout gaps
  (`.ui-stack`, `.ui-cluster`) or `.ui-prose`, never from element margins.
  `#root` is a column that fills the viewport, so `.ui-main` pushes the
  footer down.
- **Typography.** Body 15 px / 1.5 on `--ui-bg`; `h1` 24 px, `h2` 18 px,
  `h3`/`h4` 15 px, all semibold with tight tracking and balanced wrapping.
  Links in running text are underlined (subtle underline, full on hover);
  standalone links use `.ui-link`. `code` is a small mono chip.
- **Focus.** `:focus-visible` draws a 2 px `--ui-focus-ring` outline at 2 px
  offset (1 px on inputs). Nothing removes it without a replacement.
- **Motion.** Under `prefers-reduced-motion: reduce`, animations and
  transitions end at once: spinners become a static ring and skeletons stop
  shimmering.
- `img` and `video` are fluid. `svg` is left alone: the notation SVG must not
  shrink, its container scrolls instead.

## 3. Primitives (`.ui-*` classes)

Compose these; add a page-specific class only for layout the primitives do
not cover. Modifiers use `--`, parts use `__`.

### 3.1 Layout and shell

| Class                                                                            | What it is                                                                    |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `.ui-container`                                                                  | centered content, max 1040 px + gutters                                       |
| `.ui-header` + `.ui-header__inner`                                               | sticky 56 px translucent header; put `.ui-container` on the inner element     |
| `.ui-brand` + `.ui-brand__mark`                                                  | product link; the mark holds `♪` in an accent square (`aria-hidden="true"`)   |
| `.ui-nav` + `.ui-nav__link`                                                      | nav links; the active one is styled by `aria-current="page"` (NavLink)        |
| `.ui-header__end`                                                                | right side of the header (account)                                            |
| `.ui-header__email`                                                              | muted, truncated; hidden at 560 px and below                                  |
| `.ui-main`                                                                       | page body: grows, 32 px top / 48 px bottom padding                            |
| `.ui-footer`                                                                     | small muted footer with a top border; its links inherit the muted color       |
| `.ui-stack` (`--xs/--sm/--md/--lg/--xl`)                                         | vertical flex with gap 16 (4/8/12/24/32) px                                   |
| `.ui-cluster` (`--between`)                                                      | wrapping row, gap 8 px, centered                                              |
| `.ui-grow`                                                                       | flex item that takes the free space                                           |
| `.ui-prose`                                                                      | long text (About page): 68ch, paragraph and heading spacing restored          |
| `.ui-page-header` + `__titles`                                                   | title block and actions, wrapping                                             |
| `.ui-page-title` / `.ui-page-subtitle`                                           | h1 with room for a `.ui-badge` / muted subtitle                               |
| `.ui-badge`                                                                      | neutral count pill (tabular)                                                  |
| `.ui-back-link`                                                                  | small muted link (40 px target on phones); arrow in markup: `aria-hidden` `←` |
| `.ui-meta`                                                                       | small muted tabular line (dates, revision)                                    |
| `.ui-divider`                                                                    | 1 px rule (`<hr>`)                                                            |
| `.ui-visually-hidden`, `.ui-muted`, `.ui-small`, `.ui-tabular`, `.ui-list-reset` | utilities                                                                     |

### 3.2 Controls

| Class                                     | What it is                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `.ui-button`                              | 40 px bordered (secondary) button, also on `<a>`                                                  |
| `.ui-button--primary`                     | accent fill, `--ui-on-accent` text                                                                |
| `.ui-button--secondary`                   | explicit alias of the base look                                                                   |
| `.ui-button--ghost`                       | no border or fill until hover                                                                     |
| `.ui-button--link`                        | a button that looks like a link                                                                   |
| `.ui-button--sm` / `--block`              | 32 px (40 px on phones) / full width                                                              |
| `.ui-link`                                | standalone link: accent, medium weight, underline on hover                                        |
| `.ui-form`                                | form column, gap 16 px                                                                            |
| `.ui-field`                               | label above, control, then help or error below (gap 6 px)                                         |
| `.ui-label`, `.ui-help`, `.ui-error-text` | 13 px medium label / muted help / danger text                                                     |
| `.ui-input`                               | 40 px input (also `textarea`, `select`); invalid via `aria-invalid="true"`; 16 px font on phones  |
| `.ui-toolbar`                             | wrapping row of a `.ui-field` (grows, min 240 px) and buttons, bottom-aligned                     |
| `.ui-actions` (`--stretch`)               | button row; `--stretch` gives each button an equal share                                          |
| `.ui-chip-list` + `.ui-chip`              | 24 px pill tags; on `<li>` (static) or `<button>` (32 px with a 40 px `::after` target on phones) |
| `.ui-chip--selected`                      | active filter (also `aria-pressed="true"`); `.ui-chip__remove` for an `aria-hidden` `×`           |

Disabled buttons fade to 50% and show `not-allowed`; `aria-disabled="true"`
also disables pointer events.

Touch targets (640 px and below): every control is at least 40 px tall.
Small buttons, nav links and the brand grow to 40 px; the back link and the
footer link grow to 40 px with a negative block margin (no extra room in the
flow); button chips stay 32 px with an invisible `::after` that extends the
target to 40 px (chip rows keep 8 px apart, so targets do not overlap).
Links inside running text keep their size (WCAG 2.5.8 inline exception).

### 3.3 Containers and states

| Class                                            | What it is                                                                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `.ui-card`                                       | elevated surface, 1 px border, 12 px radius, subtle shadow, 24 px padding (16 px on phones)                                                     |
| `.ui-card--roomy` / `--flat`                     | 32 px padding / no shadow                                                                                                                       |
| `.ui-card--interactive` + `.ui-card__link`       | whole card clickable through its one real link (stretched `::after`); the card shows the link's focus ring; other buttons inside stay clickable |
| `.ui-card__title` / `.ui-card__meta`             | 16 px semibold title / muted tabular meta                                                                                                       |
| `.ui-card-grid`                                  | responsive list of cards (`<ul>`): `auto-fill, minmax(min(100%, 300px), 1fr)`                                                                   |
| `.ui-alert` + `--info` / `--error` / `--success` | soft background, tinted border, 14 px: `__icon`, `__body` (the `role="alert"`), optional `__dismiss`; use the `Alert` component (shell)         |
| `.ui-state` (`--bordered`)                       | centered empty/loading/error block; `__icon` (`--danger` for errors), `__title`, `__text`, `__actions`                                          |
| `.ui-spinner` (`--sm`)                           | 20 (14) px ring spinner, static under reduced motion                                                                                            |
| `.ui-skeleton` (`--title`)                       | shimmering placeholder bar; mark it `aria-hidden="true"`                                                                                        |
| `.ui-auth` + `.ui-auth__card`                    | centered column, max 400 px (put `.ui-card` on the card)                                                                                        |
| `.ui-auth__header` / `__subtitle` / `__links`    | title block / muted subtitle / centered secondary links                                                                                         |
| `.ui-scope-list`                                 | bordered list of requested OAuth scopes with a CSS check mark (no text)                                                                         |

Decorative glyphs (`♪`, `←`, `×`) go in markup with `aria-hidden="true"`,
never in CSS `content`, so accessible names and the texts tests assert stay
unchanged.

Page patterns:

- **Failed requests** (`ApiFailureAlert`) are a `.ui-state--bordered` with the
  danger icon, the message as the title (body color, not red), one
  regular-size action (`Try again`, `Sign in again` or, for a missing score,
  `Back to your library`, the page then drops its own back link) and the
  support reference in small muted print: the same shape as the empty and
  no-match states.
- **Account errors** (a failed sign-out) show as an `Alert` at the top of the
  page, in the flow, with a Dismiss button; never floating over content.
- **No repetition.** The header hides the account email on pages that show
  it (library, OAuth consent) and the action of the current page (`Sign in`
  on sign-in, `Create account` on sign-up). The library shows its count in
  the status line only, and an empty library shows its empty state without
  the search form.
- **Score page.** The player sits on the page without a card: the notation
  paper and the controls bar are the only frames. The score ID is a quiet
  row under a divider, its code one box that wraps inside itself.

## 4. The ScorePlayer's styling

score-ui must look right in the web app and in the single-file MCP View
without depending on either's stylesheet. ScorePlayer therefore renders its
own stylesheet (`PLAYER_CSS`, `styles.ts`) as a React 19 hoisted
`<style href="sheet-music-score-player" precedence="sheet-music">`: React
moves it to `<head>` once per document, however many players mount. It needs
no bundler CSS support and fits both CSPs (`style-src 'unsafe-inline'`).

- Every rule is scoped under `.smp-player` (two classes), so it wins over a
  host's element or role selectors (the View document styles `p` and
  `[role='alert']`).
- Geometry stays inline, where the controller and the tests read it: the
  scroll container (`position: relative; overflow-x: auto; width: 100%`),
  the annotation overlay and its stacks (`left`, `width`, `bottom`,
  `visibility`) and each label's `paddingLeft` and `color`.
- The notation takes the player's full width: nothing between the player's
  edge and the scroll container has horizontal padding or border (the
  paper's border is an inset `box-shadow`; the renderer keeps its own 12 px
  margins). The MCP-UI suite checks `svg width = root width - root padding`
  (the View's `#root` has 16 px side padding, 8 px at 400 px and below).
- **Sideways scrolling cue.** When the notation is wider than its pane (a
  score's minimum engraving width on a phone), the sheet gets
  `data-overflow-start` / `data-overflow-end` from the scroll position and
  shows a 32 px fade to the paper color on that side; annotation stacks
  keep to the visible width (`placeAnnotations`' `visibleWidth`), so their
  text wraps where it can be read.
- **Playback band.** Behind the sounding notes, one rectangle per system
  (`placePlaybackBands`, `playback-band.ts`): from the notes' x/width, across
  the system's staves, padded 6 / 8 px, `--_smp-accent-soft` with a faint
  accent edge, 6 px radius. It is painted before the notation (the notation
  element is positioned), unanimated, and carries `data-playback-band`. The
  notehead recolor stays: position reads by shape, not by hue alone, even
  when teaching colors are close to the accent.
- **Annotation labels.** Text in the paper's ink (inline `color`, AA on the
  paper whatever the teaching color), medium weight, after an 8 px
  `aria-hidden` swatch in the teaching color (inline `backgroundColor`).
  Noteheads and marks keep the stored teaching color.
- **Controls position.** `controlsPosition="top"` puts the controls bar,
  status line and problems above the notation (in the DOM too, so focus
  order follows); the MCP View uses it because its host grows the frame to
  the content, which would leave Play below the fold. The web keeps the
  default `bottom`.

Player classes (internal to score-ui; hosts do not use them):
`.smp-player` (`--dark`, `--controls-top`), `.smp-sheet` (`[data-blank]`:
empty paper with faint staff lines while nothing is drawn;
`[data-overflow-start|end]`: fades), `.smp-scroll`, `.smp-notation`,
`.smp-playback-band`, `.smp-annotation` + `.smp-annotation-swatch`,
`.smp-controls`, `.smp-button` (`--primary`: Play/Pause with icon;
`--secondary`: Retry audio), `.smp-icon`, `.smp-tempo`, `.smp-field`,
`.smp-range`, `.smp-tempo-value`, `.smp-switch` (the Loop checkbox drawn as a
switch, still `role=checkbox`), `.smp-status` (`[data-state=idle|loading|
playing|problem]`) with `.smp-status-dot`, `.smp-alert` (boxed only when not
empty; it stays in the tree as the live region).

Controls: Play/Pause is a 40 px primary button with a decorative SVG icon
(`aria-hidden`, so the name stays `Play`/`Pause`); the Tempo and Loop labels
are 40 px tall targets and the slider input itself is 40 px tall; the tempo
slider is a 4 px track filled up to the value (`--_smp-fill`, set inline)
with a 16 px thumb;
the readout follows it in tabular muted text; Loop sits at the end of the
bar. The bar wraps: one row from about 500 px, three rows at 375 px.
Focus-visible rings, `forced-colors` (native controls) and reduced motion are
handled.

### 4.1 Theming variables (`--smp-*`)

A host themes the player chrome by setting these on any ancestor. Each
defaults to the palette of the `theme` prop (`PALETTES` in `theme.ts`, equal
to the light or dark tokens), so the View, which sets none, still looks right.

| Variable               | Default light / dark                 | Web mapping (`tokens.css`) |
| ---------------------- | ------------------------------------ | -------------------------- |
| `--smp-text`           | `#18181b` / `#f4f4f5`                | `--ui-text`                |
| `--smp-muted`          | `#71717a` / `#a1a1aa`                | `--ui-text-muted`          |
| `--smp-surface`        | `#f7f7f8` / `#17171a`                | `--ui-surface`             |
| `--smp-elevated`       | `#ffffff` / `#1c1c20`                | `--ui-surface-elevated`    |
| `--smp-hover`          | `#f4f4f5` / `#232328`                | `--ui-surface-hover`       |
| `--smp-border`         | `#e4e4e7` / `#2a2a30`                | `--ui-border`              |
| `--smp-border-control` | `#d4d4d8` / `#3a3a42`                | `--ui-border-control`      |
| `--smp-border-strong`  | `#8b8b94` / `#6b6b76`                | `--ui-border-strong`       |
| `--smp-accent`         | `#4f46e5` / `#818cf8`                | `--ui-accent`              |
| `--smp-accent-hover`   | `#4338ca` / `#a5b4fc`                | `--ui-accent-hover`        |
| `--smp-accent-soft`    | `#eef2ff` / `rgb(129 140 248 / .14)` | `--ui-accent-soft`         |
| `--smp-on-accent`      | `#ffffff` / `#0f0f11`                | `--ui-on-accent`           |
| `--smp-danger`         | `#dc2626` / `#f87171`                | `--ui-danger`              |
| `--smp-danger-text`    | `#b91c1c` / `#fca5a5`                | `--ui-danger-text`         |
| `--smp-danger-soft`    | `#fef2f2` / `rgb(248 113 113 / .12)` | `--ui-danger-soft`         |
| `--smp-focus`          | the accent                           | `--ui-focus-ring`          |
| `--smp-radius`         | `8px`                                | `--ui-radius`              |
| `--smp-radius-lg`      | `12px`                               | `--ui-radius-lg`           |

Internally each resolves once, on `.smp-player`, as
`--_smp-<name>: var(--smp-<name>, <default>)`; `--_smp-*` names are private.
The web mapping is declared on `:root` next to the tokens, so the player's
chrome follows the app's light/dark switch with no code.

The MCP View maps the same `--smp-*` to its copy of the tokens
(`apps/mcp/view/src/view.css`, kept equal by `view-tokens.test.ts`) on its
shell, whose light/dark class follows the host theme.

## 5. Decision: the notation surface follows the theme

The notation "paper" and its ink are one pair taken from the player's
`theme` prop, never from host CSS:

| `theme` | Paper (`--_smp-paper`) | Ink (`RenderTheme.ink`) | Playback highlight |
| ------- | ---------------------- | ----------------------- | ------------------ |
| `light` | `#ffffff`              | `#18181b`               | `#4f46e5` + band   |
| `dark`  | `#1c1c20`              | `#f4f4f5`               | `#818cf8` + band   |

The highlight recolors the sounding noteheads and draws the playback band
(§4) behind them in `--smp-accent-soft`.

Why dark paper in dark mode rather than white paper everywhere:

- It keeps the renderer theme contract (RENDER_PLAYBACK_PORTS.md §2.6: the UI
  maps the host's light or dark theme to `ink`; UI-05 checks that the dark
  ink differs), and the View already passes the host theme.
- A white block inside a dark conversation glares; the dark paper equals the
  dark elevated surface, so the player reads as one card.
- Teaching colors are drawn as stored in both themes (unchanged).

Why the paper is not a `--smp-*` variable: the ink is a JavaScript value
given to the renderer, so a host that mapped only the paper could put dark
ink on dark paper. Tying both to `theme` keeps the notation readable whatever
the host maps; `score-ui` provides the paper (the "page provides the
background" of §2.6).

Consequence for the web app: `ScorePage` passes
`theme={prefersDark ? 'dark' : 'light'}` (`usePrefersDark`, from
`matchMedia('(prefers-color-scheme: dark)')` and its `change` event), like
the View's initial theme. The View: host theme in, same paper rule.
