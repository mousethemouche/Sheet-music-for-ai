import type { ScoreArtifact } from '@sheet-music/music-contracts';
import { Chip } from '@sheet-music/ui/components/chip';
import type { JSX } from 'react';

/** Shown when neither the library nor the score document names the score. */
export const UNTITLED_SCORE = 'Untitled score';

/**
 * The compact header above the player: the score's title, its tags and, in
 * muted text, whether it is a draft or saved and its revision. A saved score
 * shows its library title and tags; a draft, those of its document.
 *
 * Title and meta are drawn on the host's background, so they use the host's
 * text colors when it gives them (`--sv-on-host-*`, view.css); the tag chips
 * are the View's own surface (tokens). A tag too long for the frame is cut
 * with an ellipsis (tags have up to 40 characters).
 */
export function ScoreHeader({ artifact }: { readonly artifact: ScoreArtifact }): JSX.Element {
  const { metadata } = artifact.score;
  const title = (artifact.state === 'saved' ? artifact.title : metadata.title) || UNTITLED_SCORE;
  const tags = artifact.state === 'saved' ? artifact.tags : (metadata.tags ?? []);
  return (
    <header className="mb-3 flex flex-col gap-1.5">
      <h1 className="text-md leading-[1.3] font-semibold tracking-tight text-balance wrap-anywhere">
        {title}
      </h1>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        {tags.length === 0 ? null : (
          <ul aria-label="Tags" className="flex max-w-full min-w-0 flex-wrap gap-1.5">
            {tags.map((tag, index) => (
              <Chip asChild key={`${index}:${tag}`}>
                <li>
                  <span className="min-w-0 truncate">{tag}</span>
                </li>
              </Chip>
            ))}
          </ul>
        )}
        <p className="text-xs leading-normal whitespace-nowrap text-(--sv-on-host-muted) tabular-nums">
          {artifact.state === 'saved' ? 'Saved' : 'Draft'}
          <span aria-hidden="true"> · </span>
          Revision {artifact.revision}
        </p>
      </div>
    </header>
  );
}
