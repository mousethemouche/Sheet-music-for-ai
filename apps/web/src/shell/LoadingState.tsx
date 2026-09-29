import { Empty } from '@sheet-music/ui/components/empty';
import { Spinner } from '@sheet-music/ui/components/spinner';
import type { JSX, ReactNode } from 'react';

/**
 * A centered "something is loading" block: a decorative spinner (static under
 * reduced motion) and the message as the page's one `role="status"` line.
 */
export function LoadingState(props: { children: ReactNode }): JSX.Element {
  return (
    <Empty>
      <Spinner />
      <p role="status">{props.children}</p>
    </Empty>
  );
}
