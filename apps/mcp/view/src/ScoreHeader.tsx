import type { ScoreArtifact } from '@sheet-music/music-contracts';
import type { JSX } from 'react';

/** Shown when neither the library nor the score document names the score. */
export const UNTITLED_SCORE = 'Untitled score';

/**
 * The compact header above the player: the score's title, its tags and, in
 * muted text, whether it is a draft or saved and its revision. A saved score
 * shows its library title and tags; a draft, those of its document.
 */
export function ScoreHeader({ artifact }: { readonly artifact: ScoreArtifact }): JSX.Element {
  const { metadata } = artifact.score;
  const title = (artifact.state === 'saved' ? artifact.title : metadata.title) || UNTITLED_SCORE;
  const tags = artifact.state === 'saved' ? artifact.tags : (metadata.tags ?? []);
  return (
    <header className="sv-header">
      <h1 className="sv-title">{title}</h1>
      <div className="sv-meta-row">
        {tags.length === 0 ? null : (
          <ul aria-label="Tags" className="sv-tags">
            {tags.map((tag, index) => (
              <li key={`${index}:${tag}`} className="sv-tag">
                {tag}
              </li>
            ))}
          </ul>
        )}
        <p className="sv-meta">
          {artifact.state === 'saved' ? 'Saved' : 'Draft'}
          <span aria-hidden="true"> · </span>
          Revision {artifact.revision}
        </p>
      </div>
    </header>
  );
}
