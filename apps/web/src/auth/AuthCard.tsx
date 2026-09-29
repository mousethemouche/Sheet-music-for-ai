import { Card } from '@sheet-music/ui/components/card';
import { cn } from '@sheet-music/ui/lib/utils';
import type { JSX, ReactNode } from 'react';
import { AUTH_COLUMN } from '../shell/classes';
import { Icon, type IconName } from '../shell/icons';

type IconTone = 'accent' | 'success' | 'danger';

const ICON_TONES: Readonly<Record<IconTone, string>> = {
  accent: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success',
  danger: 'bg-destructive-soft text-destructive',
};

/**
 * Layout of the account pages (sign in, sign up, password reset, OAuth
 * consent): a centered card with the page's h1, an optional short subtitle
 * and icon, the content, then the secondary links. The section keeps the
 * `aria-labelledby` its h1 gives it.
 */
export function AuthCard(props: {
  titleId: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Decorative icon above the title, for confirmation and error states. */
  icon?: { name: IconName; tone?: IconTone };
  /** Secondary links under the content (centered, small). */
  links?: ReactNode;
  children?: ReactNode;
}): JSX.Element {
  const { icon } = props;
  return (
    <div className={AUTH_COLUMN}>
      <Card asChild className="w-full max-w-[400px]">
        <section aria-labelledby={props.titleId}>
          <div className="mb-6 flex flex-col gap-1">
            {icon && (
              <span
                className={cn(
                  'mb-3 grid size-10 place-items-center rounded-full',
                  ICON_TONES[icon.tone ?? 'accent'],
                )}
              >
                <Icon name={icon.name} />
              </span>
            )}
            <h1 id={props.titleId}>{props.title}</h1>
            {props.subtitle && <p className="text-muted-foreground">{props.subtitle}</p>}
          </div>
          {props.children && (
            <div className="flex flex-col gap-4 [&_strong]:font-semibold [&_strong]:wrap-anywhere">
              {props.children}
            </div>
          )}
          {props.links && (
            <div className="mt-6 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
              {props.links}
            </div>
          )}
        </section>
      </Card>
    </div>
  );
}
