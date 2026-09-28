import type { JSX } from 'react';
import type { ScoreMountProps } from './score-mount';

/**
 * Placeholder mount: identifies the accepted score until the shared
 * ScorePlayer (packages/score-ui, #7) is plugged into the ScoreView slot.
 */
export function ScoreSummary({ artifact }: ScoreMountProps): JSX.Element {
  const { score } = artifact;
  const bars = score.staves[0]?.measures.length ?? 0;
  return (
    <article aria-label="Score">
      <h1>{score.metadata.title ?? 'Untitled score'}</h1>
      <p>
        {artifact.state === 'saved' ? 'Saved' : 'Draft'} · revision {artifact.revision} · {bars}{' '}
        {bars === 1 ? 'bar' : 'bars'} · {score.tempo.bpm} BPM
      </p>
    </article>
  );
}
