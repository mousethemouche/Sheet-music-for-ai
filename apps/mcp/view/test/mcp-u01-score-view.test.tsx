/**
 * MCP-U01 (#11), rendered: the ScorePlayer slot is mounted only with a
 * validated artifact, and a rejected edit leaves the mounted score in place
 * with a visible, recoverable error.
 */
import { act, render, screen, within } from '@testing-library/react';
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
    const alert = screen.getByRole('alert');
    // The message and the details the message refers to; the code is data, not text.
    expect(alert).toHaveTextContent(
      'The request was rejected: The score breaks ScoreSpec v1 rules; see details. Nothing was stored. The score shown is unchanged.',
    );
    expect(
      within(within(alert).getByRole('list', { name: 'Details' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Note rich-rh-n3 has two teaching colors.']);
    expect(alert).not.toHaveTextContent('SCORE_VALIDATION_FAILED');
    expect(alert).toHaveAttribute('data-error-code', 'SCORE_VALIDATION_FAILED');
  });

  it('shows a rejection without details as its message alone', () => {
    const { deliver } = renderView();
    deliver(errorResult(JSON.stringify({ code: 'RATE_LIMITED', message: 'Too many requests.' })));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The request was rejected: Too many requests.');
    expect(within(alert).queryByRole('list')).toBeNull();
    expect(alert).toHaveAttribute('data-error-code', 'RATE_LIMITED');
  });
});
