import type { JSX, ReactNode } from 'react';
import { Icon, type IconName } from './icons';

/** Only errors are announced this way today (`.ui-alert--info/--success` exist in CSS). */
type AlertTone = 'error';

const ICONS: Readonly<Record<AlertTone, IconName>> = {
  error: 'alert-circle',
};

/**
 * A message on a soft tinted background, with a decorative icon (the MCP
 * View's notices have the same) and, when `onDismiss` is given, a close
 * button. Only the message is the live region (`role="alert"`): the icon and
 * the button are not part of what is announced.
 */
export function Alert(props: {
  tone: AlertTone;
  className?: string;
  onDismiss?: () => void;
  children: ReactNode;
}): JSX.Element {
  const { tone, onDismiss } = props;
  const className = ['ui-alert', `ui-alert--${tone}`, props.className].filter(Boolean).join(' ');
  return (
    <div className={className}>
      <Icon name={ICONS[tone]} className="ui-alert__icon" />
      <div role="alert" className="ui-alert__body">
        {props.children}
      </div>
      {onDismiss && (
        <button
          type="button"
          className="ui-button ui-button--ghost ui-button--sm ui-alert__dismiss"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <Icon name="close" className="app-icon app-icon--sm" />
        </button>
      )}
    </div>
  );
}
