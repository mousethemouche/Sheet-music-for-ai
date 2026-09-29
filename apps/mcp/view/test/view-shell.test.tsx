/**
 * The View shell around the player:
 * - the compact header above it: title, tags and, muted, draft/saved state
 *   and revision, taken from the accepted artifact (a saved score shows its
 *   library title and tags, a draft those of its document);
 * - the waiting state, shown only while a score can still arrive.
 */
import { act, render, screen, within } from '@testing-library/react';
import type { JSX } from 'react';
import { describe, expect, it } from 'vitest';
import { ScoreView } from '../src/ScoreView';
import { type ViewStore, createViewStore } from '../src/view-state';
import { FIXTURE_REVISION, draftArtifactJson, successResult } from './support/tool-results';

function Mount(): JSX.Element {
  return <p>player</p>;
}

function renderShell(): ViewStore {
  const store = createViewStore();
  render(<ScoreView store={store} ScoreMount={Mount} />);
  return store;
}

function showArtifact(artifact: Record<string, unknown>): void {
  const store = renderShell();
  act(() => store.dispatch({ type: 'tool-result', result: successResult(artifact) }));
}

function savedArtifactJson(title: string, tags: string[]): Record<string, unknown> {
  // A saved artifact has no expiry (strict schema).
  const artifact: Record<string, unknown> = { ...draftArtifactJson(), state: 'saved', title, tags };
  delete artifact['expiresAt'];
  return artifact;
}

describe('View header', () => {
  it("shows a draft's title, tags and revision from its document", () => {
    showArtifact(draftArtifactJson());

    const header = within(screen.getByTestId('score-mount'));
    expect(header.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Rich wire fixture: ii-V-I in G',
    );
    const tags = header.getByRole('list', { name: 'Tags' });
    expect(
      within(tags)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['jazz', 'ii-v-i', 'fixture']);
    expect(screen.getByTestId('score-mount')).toHaveTextContent(
      `Draft · Revision ${FIXTURE_REVISION}`,
    );
  });

  it("shows a saved score's library title and tags", () => {
    showArtifact(savedArtifactJson('Autumn Leaves voicings', ['voicings']));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Autumn Leaves voicings');
    const tags = screen.getByRole('list', { name: 'Tags' });
    expect(
      within(tags)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['voicings']);
    expect(screen.getByTestId('score-mount')).toHaveTextContent(
      `Saved · Revision ${FIXTURE_REVISION}`,
    );
  });

  it('names an untitled score and shows no tag list without tags', () => {
    showArtifact(draftArtifactJson({}, { metadata: {} }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Untitled score');
    expect(screen.queryByRole('list', { name: 'Tags' })).toBeNull();
  });
});

describe('View waiting state', () => {
  it('waits for the score while connecting and once connected', () => {
    const store = renderShell();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the score…');

    act(() => store.dispatch({ type: 'connected' }));

    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the score…');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stops waiting when the connection to the host failed', () => {
    const store = renderShell();

    act(() => store.dispatch({ type: 'connection-failed' }));

    expect(screen.getByRole('alert')).toHaveTextContent('This view could not connect to its host.');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
