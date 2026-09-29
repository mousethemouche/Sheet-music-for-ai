/**
 * Read-only probe of the View document, run INSIDE the View frame by
 * Playwright (`frame.evaluate`) because the host page cannot read a
 * cross-origin frame. It reads the stable hooks of MCP_VIEW.md §6 (test IDs,
 * ARIA roles and labels, `data-*` attributes of the notation), never CSS
 * classes, and the audio probe the sandbox proxy installed. The player's
 * `styling` is read as computed styles of elements found through those hooks.
 *
 * Playwright sends the function as source: it must stay self-contained (no
 * import, no outer variable).
 */
import type { AudioTap, ViewSnapshot } from './protocol';

export function snapshotViewDocument(): ViewSnapshot {
  const textOf = (element: Element | null | undefined): string =>
    (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const distinct = (values: readonly (string | null)[]): string[] => [
    ...new Set(values.filter((value): value is string => value !== null)),
  ];

  const shell = document.querySelector('[data-testid="score-view"]');
  const mount = document.querySelector('[data-testid="score-mount"]');
  const notice = document.querySelector('[data-testid="view-notice"]');
  const player = document.querySelector<HTMLElement>('section[aria-label^="Score player"]');
  const controls = player?.querySelector('[role="group"][aria-label="Playback controls"]');
  // The Loop switch is a <button role="switch">: Play/Pause is the button without a role.
  const button = controls?.querySelector<HTMLButtonElement>('button:not([role])');
  // Radix Slider: the thumb carries role="slider" and its ARIA state.
  const tempo = controls?.querySelector<HTMLElement>('[role="slider"]');
  const loop = controls?.querySelector<HTMLButtonElement>('[role="switch"]');
  // The notation paper wraps the player's scroll viewport.
  const paper = player?.querySelector('[data-player-viewport]')?.parentElement;
  const svg = player?.querySelector('[role="img"][aria-label^="Music notation"] svg');
  const heads = svg ? [...svg.querySelectorAll('[data-note-id]:not([data-scale-degree-id])')] : [];
  const credits = document.querySelector('[data-testid="sound-credits"]');
  const root = document.getElementById('root');
  const instrumented = window as Window & {
    __mcpUiAudio?: () => AudioTap[];
    __mcpUiTeardownAnswer?: ViewSnapshot['teardownAnswer'];
  };
  const probe = instrumented.__mcpUiAudio;

  return {
    present: true,
    connection: shell?.getAttribute('data-connection') ?? null,
    mount:
      mount === null
        ? null
        : {
            scoreId: mount.getAttribute('data-score-id'),
            revision: mount.getAttribute('data-revision'),
            theme: mount.getAttribute('data-theme'),
          },
    notice:
      notice === null
        ? null
        : {
            kind: notice.getAttribute('data-notice-kind'),
            code: notice.getAttribute('data-error-code'),
            text: textOf(notice),
          },
    player:
      player === null
        ? null
        : {
            label: player.getAttribute('aria-label'),
            status: textOf(player.querySelector('[role="status"]')),
            alert: textOf(player.querySelector('[role="alert"]')),
            playButton:
              button === null || button === undefined
                ? null
                : { name: textOf(button), disabled: button.disabled },
            tempo:
              tempo === null || tempo === undefined
                ? null
                : {
                    valueText: tempo.getAttribute('aria-valuetext'),
                    disabled: tempo.getAttribute('aria-disabled') === 'true',
                  },
            loop:
              loop === null || loop === undefined
                ? null
                : {
                    checked: loop.getAttribute('aria-checked') === 'true',
                    disabled: loop.disabled,
                  },
            text: player.innerText.replace(/\s+/g, ' ').trim(),
            styling: {
              playBackground:
                button === null || button === undefined
                  ? null
                  : getComputedStyle(button).backgroundColor,
              playBorder:
                button === null || button === undefined
                  ? null
                  : `${getComputedStyle(button).borderTopStyle} ${getComputedStyle(button).borderTopWidth}`,
              controlsBackground:
                controls === null || controls === undefined
                  ? null
                  : getComputedStyle(controls).backgroundColor,
              paperEdge:
                paper === null || paper === undefined ? null : getComputedStyle(paper).boxShadow,
            },
          },
    notation:
      svg === null || svg === undefined
        ? null
        : {
            width: svg.hasAttribute('width') ? Number(svg.getAttribute('width')) : null,
            noteIds: distinct(heads.map((head) => head.getAttribute('data-note-id'))),
            highlighted: distinct(
              heads
                .filter((head) => head.querySelector('[style*="fill"]') !== null)
                .map((head) => head.getAttribute('data-note-id')),
            ),
            harmonyLabels: [...svg.querySelectorAll('[data-harmony-id]')].map(textOf),
            scaleDegreeLabels: [...svg.querySelectorAll('[data-scale-degree-id]')].map(
              (label) => [label.getAttribute('data-note-id') ?? '', textOf(label)] as const,
            ),
          },
    documentTheme: document.documentElement.getAttribute('data-theme'),
    documentThemeClass: [...document.documentElement.classList]
      .filter((name) => name === 'light' || name === 'dark')
      .join(' '),
    rootWidth: root === null ? null : root.getBoundingClientRect().width,
    rootPaddingX:
      root === null
        ? null
        : Number.parseFloat(getComputedStyle(root).paddingLeft) +
          Number.parseFloat(getComputedStyle(root).paddingRight),
    loadedFonts: [...document.fonts]
      .filter((face) => face.status === 'loaded')
      .map((face) => face.family.replace(/["']/g, '')),
    audio: probe === undefined ? [] : probe(),
    credits:
      credits === null
        ? null
        : {
            text: textOf(credits),
            licenseHref: credits.querySelector('a')?.getAttribute('href') ?? null,
          },
    teardownAnswer: instrumented.__mcpUiTeardownAnswer ?? null,
  };
}

/** The snapshot of a View frame that does not exist. */
export const ABSENT_VIEW: ViewSnapshot = Object.freeze({
  present: false,
  connection: null,
  mount: null,
  notice: null,
  player: null,
  notation: null,
  documentTheme: null,
  documentThemeClass: '',
  rootWidth: null,
  rootPaddingX: null,
  loadedFonts: [],
  audio: [],
  credits: null,
  teardownAnswer: null,
});
