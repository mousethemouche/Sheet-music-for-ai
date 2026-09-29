import type { JSX } from 'react';
import { Link } from 'react-router';
import { Icon } from './icons';

export function NotFoundPage(): JSX.Element {
  return (
    <section aria-labelledby="not-found-title" className="ui-state app-page-state">
      <span className="ui-state__icon" aria-hidden="true">
        <Icon name="compass" />
      </span>
      <h1 id="not-found-title">Page not found</h1>
      <p className="ui-state__text">The link may be wrong, or the page may have moved.</p>
      <p className="ui-state__actions">
        <Link className="ui-button ui-button--primary" to="/">
          Go to the home page
        </Link>
      </p>
    </section>
  );
}
