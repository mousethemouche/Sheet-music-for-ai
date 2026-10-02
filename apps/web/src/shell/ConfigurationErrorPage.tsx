import { Card } from '@sheet-music/ui/components/card';
import type { JSX } from 'react';
import { Alert } from './Alert';
import { AUTH_COLUMN, CONTAINER } from './classes';

/** Shown instead of the app when the build has no valid auth configuration. */
export function ConfigurationErrorPage(props: { problem: string }): JSX.Element {
  return (
    <main className="flex-[1_0_auto] pt-8 pb-12">
      <div className={CONTAINER}>
        <div className={AUTH_COLUMN}>
          <Card className="flex w-full max-w-[400px] flex-col gap-4">
            <h1>Sheet Music for AI is not configured</h1>
            <Alert tone="error">{props.problem}</Alert>
          </Card>
        </div>
      </div>
    </main>
  );
}
