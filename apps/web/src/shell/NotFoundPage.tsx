import type { JSX } from 'react';
import { Link } from 'react-router';

export function NotFoundPage(): JSX.Element {
  return (
    <section aria-labelledby="not-found-title">
      <h1 id="not-found-title">Page not found</h1>
      <p>
        <Link to="/">Go to the home page</Link>
      </p>
    </section>
  );
}
