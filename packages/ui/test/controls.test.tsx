/**
 * The accessibility contract of the interactive controls of @sheet-music/ui
 * (Button, Slider, Switch with Label), in jsdom: roles, accessible names,
 * values, keyboard and disabled states. The ScorePlayer's Tempo and Loop are
 * built from Slider and Switch, so these are the facts its tests rely on.
 */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { type JSX, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Button } from '../src/components/button';
import { Label } from '../src/components/label';
import { Slider } from '../src/components/slider';
import { Switch } from '../src/components/switch';

// Radix measures the slider thumb and the switch; jsdom has no ResizeObserver.
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Button', () => {
  test('is type="button" by default, so it never submits its form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent)}>
        <Button>Clear search</Button>
        <Button type="submit" variant="default">
          Search
        </Button>
      </form>,
    );

    expect(screen.getByRole('button', { name: 'Clear search' })).toHaveAttribute('type', 'button');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test('asChild renders the child link with the button look and no type', () => {
    render(
      <Button asChild variant="default">
        <a href="/library">Go to your library</a>
      </Button>,
    );

    const link = screen.getByRole('link', { name: 'Go to your library' });
    expect(link).toHaveAttribute('href', '/library');
    expect(link).toHaveAttribute('data-slot', 'button');
    expect(link).not.toHaveAttribute('type');
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('disabled is a native disabled button that ignores clicks', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Show more
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Show more' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

/** A tempo slider as the player builds it: labelled by a visible label, 50-150 % by 5. */
function Tempo({
  disabled = false,
  onTempo = () => undefined,
}: {
  disabled?: boolean;
  onTempo?: (percent: number) => void;
}): JSX.Element {
  const [percent, setPercent] = useState(100);
  return (
    <>
      <span id="tempo-label">Tempo</span>
      <Slider
        min={50}
        max={150}
        step={5}
        value={[percent]}
        disabled={disabled}
        onValueChange={([next = percent]) => {
          setPercent(next);
          onTempo(next);
        }}
        thumbProps={{ 'aria-labelledby': 'tempo-label', 'aria-valuetext': `${percent}%` }}
      />
    </>
  );
}

describe('Slider', () => {
  test('the thumb is the slider: named by its label, with value, range and valuetext', () => {
    render(<Tempo />);

    const slider = screen.getByRole('slider', { name: 'Tempo' });
    expect(slider).toHaveAttribute('aria-valuenow', '100');
    expect(slider).toHaveAttribute('aria-valuemin', '50');
    expect(slider).toHaveAttribute('aria-valuemax', '150');
    expect(slider).toHaveAttribute('aria-valuetext', '100%');
    expect(slider).toHaveAttribute('aria-orientation', 'horizontal');
    expect(slider).toHaveAttribute('tabindex', '0');
    expect(slider).not.toHaveAttribute('aria-disabled');
  });

  test('arrow keys step it, Home and End jump to the bounds', async () => {
    const user = userEvent.setup();
    const onTempo = vi.fn();
    render(<Tempo onTempo={onTempo} />);
    const slider = screen.getByRole('slider', { name: 'Tempo' });
    slider.focus();

    await user.keyboard('{ArrowRight}');
    expect(slider).toHaveAttribute('aria-valuenow', '105');
    await user.keyboard('{ArrowLeft>3/}');
    expect(slider).toHaveAttribute('aria-valuenow', '90');
    expect(slider).toHaveAttribute('aria-valuetext', '90%');
    await user.keyboard('{Home}');
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    await user.keyboard('{End}');
    expect(slider).toHaveAttribute('aria-valuenow', '150');
    expect(onTempo.mock.calls).toEqual([[105], [100], [95], [90], [50], [150]]);
  });

  test('a press on the track moves the thumb (pointer capture is polyfilled for jsdom)', async () => {
    const user = userEvent.setup();
    const onTempo = vi.fn();
    const { container } = render(<Tempo onTempo={onTempo} />);
    const root = container.querySelector<HTMLElement>('[data-slot="slider"]');
    if (root === null) throw new Error('No slider root');
    // jsdom lays nothing out: a 200 px wide track starting at x = 0.
    root.getBoundingClientRect = () => new DOMRect(0, 0, 200, 40);

    await user.pointer([
      { keys: '[MouseLeft>]', target: root, coords: { clientX: 50, clientY: 20 } },
      { keys: '[/MouseLeft]' },
    ]);

    expect(screen.getByRole('slider', { name: 'Tempo' })).toHaveAttribute('aria-valuenow', '75');
    expect(onTempo).toHaveBeenCalledWith(75);
  });

  test('disabled: the thumb says aria-disabled, leaves the tab order and ignores keys', async () => {
    const user = userEvent.setup();
    const onTempo = vi.fn();
    render(<Tempo disabled onTempo={onTempo} />);

    const slider = screen.getByRole('slider', { name: 'Tempo' });
    expect(slider).toHaveAttribute('aria-disabled', 'true');
    expect(slider).not.toHaveAttribute('tabindex');
    slider.focus();
    await user.keyboard('{End}');
    expect(slider).toHaveAttribute('aria-valuenow', '100');
    expect(onTempo).not.toHaveBeenCalled();
  });
});

/** A Loop switch as the player builds it: a Switch named by a Label. */
function Loop({
  disabled = false,
  onLoop = () => undefined,
}: {
  disabled?: boolean;
  onLoop?: (loop: boolean) => void;
}): JSX.Element {
  const [loop, setLoop] = useState(false);
  return (
    <div>
      <Switch
        id="loop"
        checked={loop}
        disabled={disabled}
        onCheckedChange={(next) => {
          setLoop(next);
          onLoop(next);
        }}
      />
      <Label htmlFor="loop">Loop</Label>
    </div>
  );
}

describe('Switch', () => {
  test('is a switch named by its label, off by default, not a checkbox', () => {
    render(<Loop />);

    const loop = screen.getByRole('switch', { name: 'Loop' });
    expect(loop.tagName).toBe('BUTTON');
    expect(loop).toHaveAttribute('aria-checked', 'false');
    expect(loop).not.toBeChecked();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  test('Space, Enter and a click on its label toggle it', async () => {
    const user = userEvent.setup();
    const onLoop = vi.fn();
    render(<Loop onLoop={onLoop} />);
    const loop = screen.getByRole('switch', { name: 'Loop' });
    loop.focus();

    await user.keyboard(' ');
    expect(loop).toBeChecked();
    await user.keyboard('{Enter}');
    expect(loop).not.toBeChecked();
    await user.click(screen.getByText('Loop'));
    expect(loop).toHaveAttribute('aria-checked', 'true');
    expect(onLoop.mock.calls).toEqual([[true], [false], [true]]);
  });

  test('disabled: a disabled button that ignores clicks and keys', async () => {
    const user = userEvent.setup();
    const onLoop = vi.fn();
    render(<Loop disabled onLoop={onLoop} />);

    const loop = screen.getByRole('switch', { name: 'Loop' });
    expect(loop).toBeDisabled();
    await user.click(loop);
    await user.click(screen.getByText('Loop'));
    loop.focus();
    await user.keyboard(' ');
    expect(loop).not.toBeChecked();
    expect(onLoop).not.toHaveBeenCalled();
  });
});
