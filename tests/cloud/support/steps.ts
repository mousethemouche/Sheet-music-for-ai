/**
 * Ordered steps of a cloud flow. A step names the earlier steps it needs;
 * when one of them failed (or never ran) the step is reported as skipped
 * with the reason, instead of failing again for a cause already reported.
 * A step blocked by the provider (supabase/auth#2820, a missing hook) thus
 * shows up once, as a failure with its diagnosis, and everything that
 * depends on it says why it did not run.
 */
import { type TestContext, it } from 'vitest';

export type StepOutcome =
  { readonly passed: true } | { readonly passed: false; readonly failedIn: string };

/** Why a step with these prerequisites cannot run, or null when it can. */
export function blockedReason(
  needs: readonly string[],
  outcomes: ReadonlyMap<string, StepOutcome>,
  suiteBlock: string | null,
): string | null {
  if (suiteBlock !== null) return `blocked: ${suiteBlock}`;
  for (const need of needs) {
    const outcome = outcomes.get(need);
    if (outcome === undefined) return `blocked: "${need}" did not pass (its step did not run)`;
    if (!outcome.passed) return `blocked: "${need}" failed in "${outcome.failedIn}"`;
  }
  return null;
}

export interface StepOptions {
  readonly needs?: readonly string[];
  /** The name later steps use to need this one. */
  readonly provides?: string;
}

export interface Steps {
  readonly step: (
    title: string,
    options: StepOptions,
    body: (context: TestContext) => Promise<void>,
  ) => void;
}

export function createSteps(suiteBlock: string | null): Steps {
  const outcomes = new Map<string, StepOutcome>();
  return {
    step: (title, options, body) => {
      it(title, async (context) => {
        const reason = blockedReason(options.needs ?? [], outcomes, suiteBlock);
        if (reason !== null) {
          setEvidence(context, 'skipped', reason);
          context.skip(reason);
        }
        try {
          await body(context);
        } catch (error) {
          if (options.provides) outcomes.set(options.provides, { passed: false, failedIn: title });
          throw error;
        }
        if (options.provides) outcomes.set(options.provides, { passed: true });
      });
    },
  };
}

/**
 * Records a non-secret observation of a step (a status, a claim, a yes/no):
 * shown as an annotation by the reporter and kept in the task meta, which the
 * JSON report and tools/release/cloud-smoke.ts carry into the evidence block.
 */
export async function recordEvidence(
  context: TestContext,
  key: string,
  value: string,
): Promise<void> {
  setEvidence(context, key, value);
  await context.annotate(`${key}: ${value}`);
}

function setEvidence(context: TestContext, key: string, value: string): void {
  const meta = context.task.meta as { evidence?: Record<string, string> };
  meta.evidence = { ...meta.evidence, [key]: value };
}
