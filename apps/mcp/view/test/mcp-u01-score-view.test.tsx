/**
 * MCP-U01 (#11), rendered: the ScorePlayer slot is mounted only with a
 * validated artifact, and a rejected edit leaves the mounted score in place
 * with a visible, recoverable error.
 */
import { act, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { describe, expect, it } from 'vitest';
import type { ScoreMountProps } from '../src/score-mount';
import { ScoreView } from '../src/ScoreView';
import { createViewStore } from '../src/view-state';
import {
  COLOR_CONFLICT_TEXT,
  FIXTURE_ID,
  FIXTURE_REVISION,
  draftArtifactJson,
  errorResult,
  successResult,
} from './support/tool-results';

function renderView() {
  const mounted: ScoreMountProps[] = [];
  function RecordingMount(props: ScoreMountProps): JSX.Element {
    mounted.push(props);
    return <p>mounted {props.artifact.scoreId}</p>;
  }
  const store = createViewStore();
  render(<ScoreView store={store} ScoreMount={RecordingMount} />);
  const deliver = (result: unknown): void => {
    act(() => store.dispatch({ type: 'tool-result', result }));
  };
  return { mounted, deliver };
}

describe('MCP-U01 ScoreView', () => {
  it('never mounts the score slot for an invalid result', () => {
    const { mounted, deliver } = renderView();
    deliver(successResult(draftArtifactJson({}, { version: 2 })));
    expect(mounted).toEqual([]);
    expect(screen.queryByTestId('score-mount')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('cannot display');
  });

  it('mounts a valid artifact and keeps it when a later edit is rejected', () => {
    const { mounted, deliver } = renderView();
    deliver(successResult(draftArtifactJson()));
    deliver(errorResult(COLOR_CONFLICT_TEXT));

    expect(mounted.every(({ artifact }) => artifact.scoreId === FIXTURE_ID)).toBe(true);
    const slot = screen.getByTestId('score-mount');
    expect(slot).toHaveAttribute('data-score-id', FIXTURE_ID);
    expect(slot).toHaveAttribute('data-revision', String(FIXTURE_REVISION));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The request was rejected (SCORE_VALIDATION_FAILED)',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The score shown is unchanged.');
  });
});
