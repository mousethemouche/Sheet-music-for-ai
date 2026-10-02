/**
 * The accessibility contract of the non-interactive parts of @sheet-music/ui
 * that pages compose: an Alert announces only what the caller marks as the
 * live region, the Spinner and Skeleton stay out of the accessibility tree,
 * and asChild parts (Card, Chip, Badge) keep the semantics of the element
 * they render. Pages rely on these for their one status line and their
 * `role="alert"` counts.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Alert, AlertDescription } from '../src/components/alert';
import { Button } from '../src/components/button';
import { Card } from '../src/components/card';
import { Chip } from '../src/components/chip';
import { Empty, EmptyMedia } from '../src/components/empty';
import { Skeleton } from '../src/components/skeleton';
import { Spinner } from '../src/components/spinner';

describe('Alert', () => {
  test('has no role of its own: only the message the caller marks is announced', () => {
    render(
      <Alert variant="error" data-testid="alert">
        <svg aria-hidden="true" />
        <AlertDescription role="alert">We could not sign you out.</AlertDescription>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss">
          <span aria-hidden="true">×</span>
        </Button>
      </Alert>,
    );

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('We could not sign you out.');
    expect(within(alerts[0] as HTMLElement).queryByRole('button')).toBeNull();
    expect(screen.getByTestId('alert')).not.toHaveAttribute('role');
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });
});

describe('loading placeholders', () => {
  test('the Spinner is hidden from assistive technology, even if asked otherwise', () => {
    render(
      <p role="status">
        <Spinner aria-hidden={false} data-testid="spinner" />
        Loading your library…
      </p>,
    );

    expect(screen.getByTestId('spinner')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading your library…');
  });

  test('a Skeleton is aria-hidden by default', () => {
    render(<Skeleton data-testid="bar" />);

    expect(screen.getByTestId('bar')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('asChild parts keep the semantics of their element', () => {
  test('a Card rendered as a labelled section is a region with that name', () => {
    render(
      <Card asChild>
        <section aria-labelledby="title">
          <h1 id="title">Sign in</h1>
        </section>
      </Card>,
    );

    const region = screen.getByRole('region', { name: 'Sign in' });
    expect(region.tagName).toBe('SECTION');
    expect(region).toHaveAttribute('data-slot', 'card');
  });

  test('Chips are list items or buttons with their own names; selected is marked', () => {
    render(
      <ul aria-label="Tags">
        <Chip asChild>
          <li>jazz</li>
        </Chip>
        <li>
          <Chip asChild selected>
            <button type="button" aria-label="Remove tag filter beginner">
              beginner <span aria-hidden="true">×</span>
            </button>
          </Chip>
        </li>
        <li>
          <Chip asChild>
            <button type="button" aria-label="Filter by tag blues" disabled>
              blues
            </button>
          </Chip>
        </li>
      </ul>,
    );

    const list = screen.getByRole('list', { name: 'Tags' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    const remove = screen.getByRole('button', { name: 'Remove tag filter beginner' });
    expect(remove).toHaveAttribute('data-selected');
    expect(remove).toHaveAttribute('data-slot', 'chip');
    const filter = screen.getByRole('button', { name: 'Filter by tag blues' });
    expect(filter).toBeDisabled();
    expect(filter).not.toHaveAttribute('data-selected');
  });

  test('an Empty block can carry the role of the state it shows', () => {
    render(
      <Empty variant="bordered" role="alert">
        <EmptyMedia variant="danger">
          <svg aria-hidden="true" />
        </EmptyMedia>
        <p>Your library could not be loaded.</p>
      </Empty>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Your library could not be loaded.');
  });
});
