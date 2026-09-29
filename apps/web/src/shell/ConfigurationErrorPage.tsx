import type { JSX } from 'react';
import { Alert } from './Alert';

/** Shown instead of the app when the build has no valid auth configuration. */
export function ConfigurationErrorPage(props: { problem: string }): JSX.Element {
  return (
    <main className="ui-main">
      <div className="ui-container">
        <div className="ui-auth">
          <div className="ui-card ui-auth__card ui-stack">
            <h1>Sheet Music for AI is not configured</h1>
            <Alert tone="error">{props.problem}</Alert>
          </div>
        </div>
      </div>
    </main>
  );
}
