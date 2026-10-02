import { Button } from '@sheet-music/ui/components/button';
import {
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  emptyVariants,
} from '@sheet-music/ui/components/empty';
import type { JSX } from 'react';
import { Link } from 'react-router';
import { Icon } from './icons';

export function NotFoundPage(): JSX.Element {
  return (
    // The Empty state's look on the page's own labelled section.
    <section aria-labelledby="not-found-title" className={emptyVariants()}>
      <EmptyMedia variant="icon" aria-hidden="true">
        <Icon name="compass" />
      </EmptyMedia>
      <h1 id="not-found-title" className="text-foreground">
        Page not found
      </h1>
      <EmptyDescription>The link may be wrong, or the page may have moved.</EmptyDescription>
      <EmptyContent>
        <Button asChild variant="default">
          <Link to="/">Go to the home page</Link>
        </Button>
      </EmptyContent>
    </section>
  );
}
