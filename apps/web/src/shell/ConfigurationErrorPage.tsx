import type { JSX } from 'react';

/** Shown instead of the app when the build has no valid auth configuration. */
export function ConfigurationErrorPage(props: { problem: string }): JSX.Element {
  return (
    <main>
      <h1>Sheet Music for AI is not configured</h1>
      <p role="alert">{props.problem}</p>
    </main>
  );
}
