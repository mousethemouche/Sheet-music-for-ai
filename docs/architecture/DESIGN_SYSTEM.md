# Design system: tokens, components and the player theme

The visual language of the web app (`apps/web`), the MCP View
(`apps/mcp/view`) and the shared ScorePlayer (`packages/score-ui`), which
both show. Direction: sober and neutral. A clean SaaS look in white and grey
with one accent color (indigo), system fonts, very subtle shadows, light and
dark.

It is built with shadcn/ui components (Radix "new-york" registry, customised)
and Tailwind CSS v4, all in one package, `packages/ui` (`@sheet-music/ui`).
REPO_LAYOUT.md ("CSS and the design system") has the package's exports, the
host build and how to add a component; this page has the design.

| Path                               | Role                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `packages/ui/src/styles/theme.css` | Every design token, light and dark (§1), its Tailwind mapping and base rules    |
| `packages/ui/src/components/`      | The components (§3); each file's header says how and why it differs from shadcn |
| `packages/ui/src/lib/utils.ts`     | `cn`: joins classes; a later Tailwind class wins a conflict                     |
| `apps/web/src/styles/app.css`      | The web's Tailwind entry: theme, `@source`, element defaults (§2)               |
| `apps/web/src/shell/classes.ts`    | Class strings the web pages share where no component fits (§3.2)                |
| `apps/mcp/view/src/view.css`       | The View's Tailwind entry, inlined into its single-file document (§2)           |
| `packages/score-ui/src/theme.ts`   | The notation's paper, ink and highlight per player theme (§5)                   |

Rules:

- Colors, radii, shadows and type sizes come from the tokens, through their
  Tailwind utilities (`bg-primary`, `text-muted-foreground`,
  `border-border-control`, `rounded-xl`, `shadow-sm`, `text-sm`...). No hex
  or oklch value outside `theme.css` and the paper/ink pair of `theme.ts`.
- No `dark:` variant in `packages/ui` or `packages/score-ui`: the theme
  travels only through the tokens, which a `.light` / `.dark` class selects
  (§1). So a light player inside a dark page, or the reverse, stays right.
- Tailwind is compiled by each host's Vite build (`@tailwindcss/vite`); no
  CSS-in-JS and no stylesheet per page. The web CSS is one external file
  (CSP `style-src 'self'`); the View's is inlined (`'unsafe-inline'`, which
  the single-file build already needs). Radix writes only `style`
  attributes (the slider thumb's position) and injects no `<style>`. No web
  font: the CSP allows only `font-src 'self' data:` and the app works
  offline. Tailwind v4 needs Safari 16.4+, Chrome 111+ or Firefox 128+.
- Tests select roles, labels and text, never classes (MCP_VIEW.md §6). A
  class may change without touching a test; an accessible name or visible
  string may not. The exceptions are the guards against an unstyled host
  (§4): MCP-UI-01's computed styles and the web stylesheet test, which
  names one class per scanned source.

## 1. Tokens

`theme.css` declares every token as a custom property with shadcn/ui names:
light on `:root, .light`, dark on `.dark`, each with its `color-scheme`. The
values are written in oklch; each converts back to exactly the hex shown
below (`packages/ui/test/theme-tokens.test.ts`), so the contrast ratios are
those of the hex values. Each color token `--x` is the Tailwind color `x`
(`@theme inline`): `bg-x`, `text-x`, `border-x`, `outline-x`...

Who sets the class: the web's `main.tsx` puts `.light` or `.dark` on
`<html>` from the system preference and follows its changes; the View's
host bridge puts it there from the host context theme (next to ext-apps'
`data-theme`); the ScorePlayer carries the class of its `theme` prop on its
own section (§4). Until a host's script has set the class, its entry CSS
keeps `color-scheme: light dark`, so the page follows the system without a
flash of the light tokens (the web body also takes the system `Canvas`).

Naming: the owner's indigo accent is shadcn's `primary`. shadcn's `accent`
is the neutral hover surface, not indigo.

### 1.1 Colors

| Token                                       | Light              | Dark                | Use                                                                    |
| ------------------------------------------- | ------------------ | ------------------- | ---------------------------------------------------------------------- |
| `--background`                              | `#ffffff`          | `#0f0f11`           | page background                                                        |
| `--foreground`                              | `#18181b`          | `#f4f4f5`           | text                                                                   |
| `--card` (`--card-foreground` = text)       | `#ffffff`          | `#1c1c20`           | cards, inputs, outline buttons, slider thumb; the notation paper       |
| `--popover` (`--popover-foreground`)        | = card             | = card              | reserved for shadcn overlays (none yet)                                |
| `--muted`                                   | `#f7f7f8`          | `#17171a`           | subtle surfaces: chips, controls bar, code, neutral alert, waiting box |
| `--muted-foreground`                        | `#71717a`          | `#a1a1aa`           | secondary text, meta, placeholders, empty states                       |
| `--accent`, `--secondary` (+ `-foreground`) | `#f4f4f5`          | `#232328`           | hover surface of outline/ghost buttons and nav links                   |
| `--primary`                                 | `#4f46e5`          | `#818cf8`           | primary buttons, links, switch on, slider range, selection             |
| `--primary-foreground`                      | `#ffffff`          | `#0f0f11`           | text on primary fills                                                  |
| `--primary-hover`                           | `#4338ca`          | `#a5b4fc`           | hover of the above                                                     |
| `--primary-soft`                            | `#eef2ff`          | primary at 14 %     | info alert, selected chip, playback band                               |
| `--primary-border`                          | `#c7d2fe`          | primary at 35 %     | border of the above                                                    |
| `--destructive`                             | `#dc2626`          | `#f87171`           | invalid input border, danger icons, problem status dot                 |
| `--destructive-text`                        | `#b91c1c`          | `#fca5a5`           | error text (on the background and on the soft background)              |
| `--destructive-soft`                        | `#fef2f2`          | destructive at 12 % | error alert background                                                 |
| `--destructive-border`                      | `#fecaca`          | destructive at 35 % | error alert border                                                     |
| `--success`                                 | `#16a34a`          | `#4ade80`           | success icon                                                           |
| `--success-text`                            | `#15803d`          | `#86efac`           | success text                                                           |
| `--success-soft`                            | `#f0fdf4`          | success at 12 %     | success alert background                                               |
| `--success-border`                          | `#bbf7d0`          | success at 30 %     | success alert border                                                   |
| `--border`                                  | `#e4e4e7`          | `#2a2a30`           | dividers, cards (every element's default border), skeleton bars        |
| `--border-control`                          | `#d4d4d8`          | `#3a3a42`           | outline buttons, chip hover, slider track, spinner ring, dashed frames |
| `--input`                                   | `#8b8b94`          | `#6b6b76`           | control boundaries: input border, switch off (3:1)                     |
| `--ring`                                    | = primary          | = primary           | 2 px focus outline                                                     |
| `--header`                                  | background at 88 % | background at 85 %  | translucent sticky header                                              |

Contrast (WCAG 2.2 AA), light / dark, measured on the background: text
17.7:1 / 17.4:1, muted text 4.8:1 / 7.5:1 (4.5:1 on the light muted
surface), primary as text 6.3:1 / 6.4:1, error text 6.5:1 / 10.1:1, success
text 5.0:1 (light). Two deliberate departures from the brief, both for AA:

- **Text on primary is dark in dark mode.** White on `#818cf8` is 3.0:1;
  `#0f0f11` on it is 6.4:1. Light mode keeps white on `#4f46e5` (6.3:1).
- **Error and success text use a darker shade** (`--destructive-text`,
  `--success-text`): `#dc2626` on `#fef2f2` is 4.4:1 and `#16a34a` on white
  3.3:1, both below 4.5:1 (the darker shades give 5.9:1 and 4.8:1 on their
  soft backgrounds). The brief's hues stay for borders and icons.

`--border` (1.3:1) is decorative only. A boundary that identifies a control
(an input, the Loop switch when off) uses `--input` (3.4:1 light, 3.2:1 dark
on the card), WCAG 1.4.11.

`theme-tokens.test.ts` checks, in both themes: every hex note round-trips,
the dark theme overrides every token but the radius, every color token has
its Tailwind color, and these pairs reach AA (translucent surfaces
composited over the background): foreground on background, card and muted;
muted-foreground on background, muted and card; primary-foreground on
primary; primary on background and primary-soft; destructive-text on
background and destructive-soft; success-text on success-soft;
secondary- and accent-foreground on their surfaces (all 4.5:1); input on
card, background and muted, ring on background, primary on muted (3:1).

### 1.2 Type, space, shape, motion

| Token / utility                                | Value                                                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `font-sans`                                    | `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |
| `font-mono`                                    | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`                    |
| `text-xs` / `sm` / `base` / `md` / `lg` / `xl` | 12 / 13 / **15 (body)** / 16 (inputs on phones) / 18 (h2) / 24 px (h1)                                      |
| line height                                    | 1.5 for body text (`html`); headings `leading-tight` (1.25); `text-xs` / `sm` 16 / 20 px (whole pixels)     |
| `tracking-tight` / `tracking-title`            | -0.011em (headings) / -0.02em (h1)                                                                          |
| `font-medium` / `font-semibold`                | 500 (labels, buttons) / 600 (headings)                                                                      |
| spacing                                        | Tailwind's 4 px scale (`gap-2` = 8 px, `p-6` = 24 px...)                                                    |
| `rounded-sm` / `md` / `lg` / `xl` / `full`     | 4 / 6 / **8 (controls, `--radius`)** / 12 (cards, panels) / pill (chips, switch)                            |
| control heights                                | 40 px (`h-10`); small controls 32 px from 640 px up, 40 px below (touch targets)                            |
| `shadow-xs` / `shadow-sm` / `shadow-md`        | hairline (buttons) / card / interactive card hover; stronger alpha in dark                                  |
| `duration-120` + `ease-standard`               | 120 ms, `cubic-bezier(0.2, 0, 0, 1)`                                                                        |
| layout (web)                                   | header 56 px (`h-14`); content 1040 px between 24 px gutters (16 px below 640 px); account cards 400 px     |

The fonts are plain `@theme` variables, so an MCP Apps host's `--font-sans`
(set on the View's root) reaches the components; the weights and shadows
are pinned in `@theme inline`, so a host's `--font-weight-*` or `--shadow-*`
cannot restyle them. Dates and numbers use tabular figures (`time`
elements, `tabular-nums`).

## 2. Base rules

- **Preflight.** Tailwind's preflight resets margins, borders, headings and
  lists: spacing comes from layout gaps (`flex`/`grid` + `gap-*`), never
  from element margins. It sets `svg { display: block }` and makes `img`
  and `video` fluid; the notation SVG is not shrunk, its container scrolls
  instead.
- **theme.css base.** Every element's border color is `--border`; `html`
  sets 100 % font size and 1.5 line height; under
  `prefers-reduced-motion: reduce` animations and transitions end at once
  (spinners become a static ring, skeletons stop pulsing).
- **Web (`app.css`).** Body 15 px on the background; `#root` is a column
  that fills the viewport, so `main` pushes the footer down; `h1` 24 px,
  `h2` 18 px, `h3`/`h4` 15 px, all semibold with tight tracking and balanced
  wrapping; `p` wraps pretty; `time` is tabular; a stable scrollbar gutter.
- **View (`view.css`).** `html` and `body` are transparent (the host's
  background shows through). Text drawn straight on the host's background
  (title, meta, credits) prefers the host's `--color-text-*` variables,
  made for that background; text on the View's own surfaces uses the
  tokens. `#root`'s padding stays in `view/index.html` (MCP_VIEW.md §5).
- **Focus.** Every component draws the `focus-ring` utility: a 2 px solid
  `--ring` outline at 2 px offset on `:focus-visible` (shadcn's 50 % alpha
  ring fails the 3:1 non-text contrast). Inputs use a 1 px offset and a
  primary border. The web base layer gives the same ring to every focusable
  element. Nothing removes a focus style without a replacement.
- **Forced colors** (Windows High Contrast removes background colors).
  Every Button has a 1 px border, transparent except `outline`'s, which
  forced colors paints as its boundary, so a primary or ghost button does
  not turn into plain text. The slider track and the switch get
  system-color borders and the slider range the `Highlight` color. An icon
  that carries a token color on its own (the consent page's checks) takes
  `CanvasText` (`forced-colors:text-[CanvasText]`); an icon in
  `currentColor` follows its parent.

## 3. Components (`@sheet-music/ui`)

Import each from its own path, `@sheet-music/ui/components/<name>` (there is
no barrel); `cn` is `@sheet-music/ui/lib/utils`. Compose them with Tailwind
utilities; merge a caller's `className` last through `cn`. The Radix
primitives are imported only inside `packages/ui` (dependency-cruiser rule
`radix-only-in-ui-package`).

### 3.1 Catalogue

| Component                                                  | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                                   | 13 px medium label (20 px line), 8 px radius, 1 px border (transparent but for `outline`). `variant`: `outline` (**default**: bordered, card surface), `default` (primary fill), `ghost`, `link`. `size`: `default` (40 px), `sm` (40 px on phones, 32 px from 640 px), `block` (full width), `icon`, `icon-sm`, `inline` (no height or padding, with `link`). `asChild` renders a router `Link` or `<a>`. `type="button"` unless `asChild` |
| `Input`                                                    | 40 px, `--input` border (3:1), card surface; 16 px text below 640 px (iOS zoom), 15 px above; invalid through `aria-invalid="true"` (destructive border and ring); keeps `id` and `aria-*`                                                                                                                                                                                                                                                  |
| `Label`                                                    | Radix Label, 13 px medium, `htmlFor`; dims next to a disabled `peer` control                                                                                                                                                                                                                                                                                                                                                                |
| `Card`                                                     | card surface, border, 12 px radius, `shadow-sm`, padded 16 px (24 px from 640 px). `asChild` makes the card an `<li>` or a `<section>`; the page lays out its content                                                                                                                                                                                                                                                                       |
| `Badge`                                                    | neutral 24 px pill (muted surface, 12 px medium muted text); the base of `Chip`                                                                                                                                                                                                                                                                                                                                                             |
| `Chip` (project-owned)                                     | a tag, `asChild` on an `<li>` (static) or a `<button>` (a filter: 32 px below 640 px with an invisible `::after` extending the target to 40 px, 24 px above). `selected`: primary soft surface                                                                                                                                                                                                                                              |
| `Alert` + `AlertDescription`                               | a row (icon, message, action) on a soft surface, 14 px. `variant`: `default` (neutral), `info`, `error`, `success`. **No role on the root**: put `role="alert"` on the message or on your own element                                                                                                                                                                                                                                       |
| `Empty` + `EmptyMedia`, `EmptyDescription`, `EmptyContent` | centered muted block of an empty, loading or failed state. `variant="bordered"`: dashed 12 px frame. `EmptyMedia` `icon` / `danger`: 44 px round icon. No title part: the page keeps its own heading and status line; `EmptyDescription` is a `div` that wraps pretty                                                                                                                                                                       |
| `Skeleton`                                                 | pulsing placeholder bar in `--border` (1.3:1 light, 1.2:1 dark on a card, still visible when reduced motion stops the pulse), `aria-hidden` by default                                                                                                                                                                                                                                                                                      |
| `Spinner` (project-owned)                                  | ring in `--border-control` with a primary arc, 20 px (`sm`: 14 px); always `aria-hidden`, no role (not shadcn's, which adds `role="status"`)                                                                                                                                                                                                                                                                                                |
| `Slider`                                                   | Radix Slider, one thumb: 40 px target, 4 px track, primary range, 16 px thumb. The **thumb** is the `role="slider"` element: pass its name and `aria-valuetext` in `thumbProps`; disabled also sets its `aria-disabled`. `value` is an array                                                                                                                                                                                                |
| `Switch`                                                   | Radix Switch, 34 x 20 px: a `<button role="switch" aria-checked>`; off track `--input`, on track primary. Label it with `<Label htmlFor>`; Space, Enter and a click on the label toggle it                                                                                                                                                                                                                                                  |

A rule that separates content is a plain `<hr>` (border color `--border`);
shadcn's Separator and the unused parts of Card, Empty and Alert are not
kept, because theme.css scans every file of `packages/ui/src/components`
and unused classes would still reach both stylesheets.

Class functions for styling an existing element without the component:
`buttonVariants`, `badgeVariants`, `chipVariants`, `alertVariants`,
`emptyVariants`, `emptyMediaVariants`, `spinnerVariants` (the library keeps
ONE status line element across its states that way, rather than remounting
the live region).

Conventions:

- **Live regions.** One `role="status"` line per page or player; containers
  (`Alert`, `Empty`, `Spinner`, `Skeleton`) carry no role of their own, so
  the caller decides what is announced, and an icon or a Dismiss button
  next to a message stays outside it.
- **Decorative glyphs** (`♪`, `←`, `×`, icons) go in markup with
  `aria-hidden="true"`, never in CSS `content`, so accessible names and the
  texts tests assert stay unchanged. The project draws its own SVG icons
  (`apps/web/src/shell/icons.tsx`, the View's and the player's); there is
  no icon library.
- **Touch targets** (below 640 px): every control is at least 40 px tall.
  Small buttons, nav links and the brand grow to 40 px; the back link and
  footer link grow with a negative block margin; filter chips keep 32 px
  with the `::after` extension (rows keep 8 px apart, so targets do not
  overlap). Links inside running text keep their size (WCAG 2.5.8 inline
  exception).
- **Disabled** controls fade to 50 % and show `not-allowed`;
  `aria-disabled="true"` also disables pointer events on a Button. A
  filter chip that is already active is a disabled button: it fades to
  55 % and keeps the default cursor.

### 3.2 Web patterns

Shared class strings (`apps/web/src/shell/classes.ts`): `CONTAINER` (the
1040 px content column), `AUTH_COLUMN` (the centered account column),
`STANDALONE_LINK` (primary, medium, underline on hover), `TEXT_LINK` (a
link in running text: faint underline, solid on hover) and `CODE` (inline
code, a small mono chip that wraps inside itself).

- **Failed requests** (`ApiFailureAlert`) are a bordered `Empty` with
  `role="alert"`, the `danger` icon, the message as its title (body color,
  not red), one regular-size action (`Try again`, `Sign in again` or, for a
  missing score, `Back to your library`, the page then drops its own back
  link) and the support reference in small muted print: the same shape as
  the empty and no-match states.
- **Account errors** (a failed sign-out) show as an `Alert` at the top of
  the page, in the flow, with a Dismiss button; never floating over
  content.
- **No repetition.** The header hides the account email on pages that show
  it (library, OAuth consent) and the action of the current page (`Sign in`
  on sign-in, `Create account` on sign-up). The library shows its count in
  the status line only, and an empty library shows its empty state without
  the search form.
- **Score page.** The player sits on the page without a card: the notation
  paper and the controls bar are the only frames. The score ID is a quiet
  row under a divider, its code one box that wraps inside itself.

## 4. The ScorePlayer's styling

score-ui ships **no stylesheet**. The player is built from
`@sheet-music/ui` (Button, Slider, Switch, Label, Alert, Spinner, `cn`) and
Tailwind classes, and every host compiles them. The host contract, which
both hosts follow:

1. compile Tailwind CSS v4 (`@tailwindcss/vite`) from an entry that does
   `@import 'tailwindcss' source(none)`;
2. import `@sheet-music/ui/styles/theme.css` (it adds the ui components to
   Tailwind's sources itself);
3. add `@source` for `packages/score-ui/src`.

A missing `@source` builds without error and leaves the player unstyled
while every role and name still works. Both hosts catch it:

- the View in the MCP-UI suite: MCP-UI-01 checks computed styles (the Play
  button's and controls bar's backgrounds, the Play button's border, the
  paper's inset edge, which only score-ui uses) and MCP-UI-03 that the
  controls bar and the document's `.light` / `.dark` class change with the
  host theme (MCP_VIEW.md §6);
- the web in `apps/web/test/stylesheet-sources.test.ts` (`pnpm test`): it
  builds `app.css` with the web's Vite configuration and checks that a
  class used by only one source (the web, score-ui, the ui components)
  reached the CSS. The file sits outside `src/`, which the web scans.

- **Theme.** The `theme` prop is also a class on the player's section
  (`light` / `dark`), which re-scopes the tokens, so the chrome follows the
  prop whatever the page's theme. The player has no theming variables of
  its own: host and player share the `theme.css` tokens. The paper and ink
  come from the same prop (§5).
- **Geometry stays inline**, where the controller and the tests read it:
  the scroll container (`position: relative; overflow-x: auto; width:
100%`, marked `data-player-viewport`), the annotation overlay and its
  stacks (`left`, `width`, `bottom`, `visibility`) and each label's
  `paddingLeft` and `color`.
- The notation takes the player's full width: nothing between the player's
  edge and the scroll container has horizontal padding or border (the
  paper's edge is an inset shadow; the renderer keeps its own 12 px
  margins). The MCP-UI suite checks `svg width = root width - root padding`
  (the View's `#root` has 16 px side padding, 8 px at 400 px and below).
- **Blank paper.** While nothing is drawn, the paper (`data-blank`) shows
  faint staff lines.
- **Sideways scrolling cue.** When the notation is wider than its pane (a
  score's minimum engraving width on a phone), the paper gets
  `data-overflow-start` / `data-overflow-end` from the scroll position and
  shows a 32 px fade to the paper color (`--paper`, set inline) on that
  side; annotation stacks keep to the visible width (`placeAnnotations`'
  `visibleWidth`), so their text wraps where it can be read.
- **Playback band.** Behind the sounding notes, one rectangle per system
  (`placePlaybackBands`, `playback-band.ts`): from the notes' x/width,
  across the system's staves, padded 6 / 8 px, `primary-soft` with a faint
  `primary-border` edge, 6 px radius. It is painted before the notation
  (the notation element is positioned), unanimated, and carries
  `data-playback-band`. The notehead recolor stays: position reads by
  shape, not by hue alone, even when teaching colors are close to the
  primary.
- **Annotation labels.** 14 px text in the paper's ink (inline `color`, AA
  on the paper whatever the teaching color), medium weight, after an 8 px
  round `aria-hidden` swatch in the teaching color (inline
  `backgroundColor`); a wrapped label hangs after its swatch. Noteheads and
  marks keep the stored teaching color.
- **Controls position.** `controlsPosition="top"` puts the controls bar,
  status line and problems above the notation (in the DOM too, so focus
  order follows); the MCP View uses it because its host grows the frame to
  the content, which would leave Play below the fold. The web keeps the
  default `bottom`.

Controls, in a `role="group"` named "Playback controls" (a bordered, muted,
12 px radius bar; Loop sits at its end). The bar wraps: one row at 1040 px,
three rows at 375 px. Its texts (Play, Tempo, the readout, Loop) and the
status line are 13 px (`text-sm`), like every control label of the app.

- **Play/Pause**: `Button variant="default"` with a decorative SVG icon
  (`aria-hidden`), so the name stays `Play` / `Pause`.
- **Tempo**: a `Slider` from 25 to 200 % in steps of 5, named by the
  "Tempo" text through `aria-labelledby` on its thumb, with
  `aria-valuetext` such as `100% (132 BPM)`. Arrow keys move 5 %, Page
  Up/Down 50 %, Home/End go to the ends. The visual readout follows in
  tabular muted text (`aria-hidden`: the slider says it). The "Tempo" text
  is not a `<label>`: clicking it does not focus the slider.
- **Loop**: a `Switch` with a 40 px `Label`, so the role is `switch`
  (`aria-checked`).
- Before the engine exists (the first frame), Tempo and Loop are disabled:
  the thumb is `aria-disabled` and not focusable, the switch is disabled,
  and their texts dim.
- **Status line**: `p role="status"` with a dot (`data-state` `idle`,
  `playing` in primary, `problem` in destructive; a small `Spinner` while
  loading).
- **Problems**: an error `Alert` with `role="alert"`, always in the tree
  (it is the live region) and boxed only when it has content; `Retry
audio` is an outline small Button.

## 5. Decision: the notation surface follows the theme

The notation "paper" and its ink are one pair taken from the player's
`theme` prop, never from host CSS (`PALETTES` in `theme.ts`):

| `theme` | Paper (inline background) | Ink (`RenderTheme.ink`) | Playback highlight |
| ------- | ------------------------- | ----------------------- | ------------------ |
| `light` | `#ffffff`                 | `#18181b`               | `#4f46e5` + band   |
| `dark`  | `#1c1c20`                 | `#f4f4f5`               | `#818cf8` + band   |

They equal the `--card`, `--foreground` and `--primary` tokens of the same
theme (`packages/score-ui/test/palette-tokens.test.ts` reads `theme.css`
and compares). The highlight recolors the sounding noteheads and the
playback band (§4) is drawn behind them in `primary-soft`.

Why dark paper in dark mode rather than white paper everywhere:

- It keeps the renderer theme contract (RENDER_PLAYBACK_PORTS.md §2.6: the UI
  maps the host's light or dark theme to `ink`; UI-05 checks that the dark
  ink differs), and the View already passes the host theme.
- A white block inside a dark conversation glares; the dark paper equals the
  dark card surface, so the player reads as one card.
- Teaching colors are drawn as stored in both themes (unchanged).

Why the paper is not a CSS token the host could restyle: the ink is a
JavaScript value given to the renderer, so a host that restyled only the
paper could put dark ink on dark paper. Tying both to `theme` keeps the
notation readable whatever the host styles; `score-ui` provides the paper
(the "page provides the background" of §2.6).

Consequence for the web app: `ScorePage` passes
`theme={prefersDark ? 'dark' : 'light'}` (`usePrefersDark`, from the same
`(prefers-color-scheme: dark)` query that sets the page's class), like the
View's initial theme. The View: host theme in, same paper rule.
