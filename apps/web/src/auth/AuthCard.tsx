import type { JSX, ReactNode } from 'react';
import { Icon, type IconName } from '../shell/icons';

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
  icon?: { name: IconName; tone?: 'accent' | 'success' | 'danger' };
  /** Secondary links under the content (centered, small). */
  links?: ReactNode;
  children?: ReactNode;
}): JSX.Element {
  const { icon } = props;
  return (
    <div className="ui-auth">
      <section aria-labelledby={props.titleId} className="ui-card ui-auth__card">
        <div className="ui-auth__header">
          {icon && (
            <span className={`app-auth-icon app-auth-icon--${icon.tone ?? 'accent'}`}>
              <Icon name={icon.name} />
            </span>
          )}
          <h1 id={props.titleId}>{props.title}</h1>
          {props.subtitle && <p className="ui-auth__subtitle">{props.subtitle}</p>}
        </div>
        {props.children && <div className="ui-stack">{props.children}</div>}
        {props.links && <div className="ui-auth__links">{props.links}</div>}
      </section>
    </div>
  );
}
