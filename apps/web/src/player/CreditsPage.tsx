import type { JSX } from 'react';
import type { SoundCredits } from './webPlayer';

/**
 * Public "About and credits" page. Shows the SoundFont attribution the MIT
 * license requires, linked to the published license and notice
 * (docs/assets/SOUNDFONT.md §2).
 */
export function CreditsPage(props: { credits: SoundCredits }): JSX.Element {
  const { credits } = props;
  return (
    <section aria-labelledby="about-title" className="ui-prose">
      <h1 id="about-title">About Sheet Music for AI</h1>
      <p>
        An AI assistant writes piano scores you can read and play in the conversation, and you
        choose which ones to keep in your private library.
      </p>
      <h2>Credits</h2>
      <h3>Piano sound</h3>
      <p>{credits.attribution}</p>
      <p>
        <a href={credits.licenseUrl}>License (MIT)</a> · <a href={credits.noticeUrl}>Notice</a>
      </p>
      <p className="ui-muted">
        MuseScore is named only as the source of this sound; it does not endorse this app.
      </p>
    </section>
  );
}
