import type { JSX, ReactNode } from 'react';

/**
 * A centered "something is loading" block: a decorative spinner (static under
 * reduced motion) and the message as the page's one `role="status"` line.
 */
export function LoadingState(props: { children: ReactNode }): JSX.Element {
  return (
    <div className="ui-state">
      <span className="ui-spinner" aria-hidden="true" />
      <p role="status">{props.children}</p>
    </div>
  );
}
