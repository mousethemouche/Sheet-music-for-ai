import { AlertDescription, Alert as AlertSurface } from '@sheet-music/ui/components/alert';
import { Button } from '@sheet-music/ui/components/button';
import type { JSX, ReactNode } from 'react';
import { Icon, type IconName } from './icons';

/** Only errors are announced this way today (the ui Alert also has info and success). */
type AlertTone = 'error';

const ICONS: Readonly<Record<AlertTone, IconName>> = {
  error: 'alert-circle',
};

/**
 * A message on a soft tinted background (@sheet-music/ui Alert), with a
 * decorative icon (the MCP View's notices have the same) and, when
 * `onDismiss` is given, a close button. Only the message is the live region
 * (`role="alert"`): the icon and the button are not part of what is announced.
 */
export function Alert(props: {
  tone: AlertTone;
  className?: string;
  onDismiss?: () => void;
  children: ReactNode;
}): JSX.Element {
  const { tone, onDismiss } = props;
  return (
    <AlertSurface variant={tone} className={props.className}>
      <Icon name={ICONS[tone]} />
      <AlertDescription role="alert">{props.children}</AlertDescription>
      {onDismiss && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="-my-1.5 -mr-2 text-inherit"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <Icon name="close" className="size-4" />
        </Button>
      )}
    </AlertSurface>
  );
}
