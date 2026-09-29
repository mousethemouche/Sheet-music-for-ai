import { PIANO_SOUNDFONT } from '@sheet-music/playback-spessasynth';
import type { JSX } from 'react';

export interface SoundCreditsProps {
  /** The published LICENSE.txt of the SoundFont; null when no asset origin is configured. */
  readonly licenseUrl: string | null;
  /** Opens a URL through the host: a sandboxed iframe may not open windows itself. */
  readonly openLink: (url: string) => void;
}

/** Credits the piano sound as its license requires (docs/assets/SOUNDFONT.md §2). */
export function SoundCredits({ licenseUrl, openLink }: SoundCreditsProps): JSX.Element {
  return (
    <details data-testid="sound-credits" className="sv-credits">
      <summary>Sound credits</summary>
      <p>{PIANO_SOUNDFONT.attribution}</p>
      {licenseUrl === null ? null : (
        <a
          href={licenseUrl}
          target="_blank"
          rel="noopener noreferrer"
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
