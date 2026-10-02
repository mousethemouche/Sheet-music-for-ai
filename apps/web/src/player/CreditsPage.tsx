import { cn } from '@sheet-music/ui/lib/utils';
import type { JSX } from 'react';
import { TEXT_LINK } from '../shell/classes';
import type { SoundCredits } from './webPlayer';

/** Links in running text: primary and underlined. */
const PROSE_LINK = cn(TEXT_LINK, 'text-primary hover:text-primary-hover');

/**
 * Public "About and credits" page. Shows the SoundFont attribution the MIT
 * license requires, linked to the published license and notice
 * (docs/assets/SOUNDFONT.md §2).
 */
export function CreditsPage(props: { credits: SoundCredits }): JSX.Element {
  const { credits } = props;
  return (
    // Long text: 68ch wide, 12 px between blocks, more above the headings.
    <section
      aria-labelledby="about-title"
      className="flex max-w-[68ch] flex-col gap-3 [&>h2]:mt-5 [&>h3]:mt-3"
    >
      <h1 id="about-title">About Sheet Music for AI</h1>
      <p>
        An AI assistant writes piano scores you can read and play in the conversation, and you
        choose which ones to keep in your private library.
      </p>
      <h2>Credits</h2>
      <h3>Piano sound</h3>
      <p>{credits.attribution}</p>
      <p>
        <a className={PROSE_LINK} href={credits.licenseUrl}>
          License (MIT)
        </a>{' '}
        ·{' '}
        <a className={PROSE_LINK} href={credits.noticeUrl}>
          Notice
        </a>
      </p>
      <p className="text-muted-foreground">
        MuseScore is named only as the source of this sound; it does not endorse this app.
      </p>
    </section>
  );
}
