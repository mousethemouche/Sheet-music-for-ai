import { PIANO_SOUNDFONT } from '@sheet-music/playback-spessasynth';
import type { JSX } from 'react';

export interface SoundCreditsProps {
  /** The published LICENSE.txt of the SoundFont; null when no asset origin is configured. */
  readonly licenseUrl: string | null;
  /** Opens a URL through the host: a sandboxed iframe may not open windows itself. */
  readonly openLink: (url: string) => void;
}

/**
 * The disclosure's summary: its own chevron (an empty box drawn with borders,
 * no text content) instead of the list marker, turned when open. A little
 * inline padding, cancelled by the margin, so the focus ring does not hug the
 * chevron while the text stays aligned with the content above.
 */
const SUMMARY_CLASS = [
  '-mx-1 inline-flex min-h-6 cursor-pointer list-none items-center gap-1.5 rounded-sm px-1 select-none focus-ring',
  'hover:text-(--sv-on-host-text) [&::-webkit-details-marker]:hidden',
  "before:size-0 before:flex-none before:border-y-4 before:border-l-[5px] before:border-y-transparent before:border-l-current before:content-['']",
  'before:transition-transform before:duration-120 before:ease-standard group-open:before:rotate-90',
].join(' ');

/**
 * Credits the piano sound as its license requires (docs/assets/SOUNDFONT.md §2).
 * Small muted text on the host's background (`--sv-on-host-*`, view.css).
 */
export function SoundCredits({ licenseUrl, openLink }: SoundCreditsProps): JSX.Element {
  return (
    <details
      data-testid="sound-credits"
      className="group mt-1 text-xs leading-normal text-(--sv-on-host-muted)"
    >
      <summary className={SUMMARY_CLASS}>Sound credits</summary>
      <p className="mt-0.5 max-w-[72ch]">{PIANO_SOUNDFONT.attribution}</p>
      {licenseUrl === null ? null : (
        <a
          href={licenseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 inline-block rounded-xs underline decoration-from-font underline-offset-2 focus-ring hover:text-(--sv-on-host-text)"
          onClick={(event) => {
            event.preventDefault();
            openLink(licenseUrl);
          }}
        >
          License ({PIANO_SOUNDFONT.license.spdx})
        </a>
      )}
    </details>
  );
}
