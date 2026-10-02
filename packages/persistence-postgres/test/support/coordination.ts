/**
 * Real database coordination for the race and failure tests, without timers.
 *
 * A test stops a transaction at an exact point with a temporary row trigger
 * that waits on an advisory lock the test holds (`pause`), observes the lock
 * waits of this database's backends in pg_stat_activity (`lockWaiters`), then
 * lets the transaction continue (`Gate.open`). Other temporary triggers inject
 * a failure at a chosen point. Everything is created through the privileged
 * pool in schema `private` and dropped by `reset()` (call it in afterEach).
 */
import { type Pool, type PoolClient, escapeLiteral } from 'pg';

export type ScoreTable = 'score_drafts' | 'scores';

/**
 * - `after update`: the writer has written the new row version and still holds its lock;
 * - `before delete`: the deleter holds the row lock (a promotion has already
 *   inserted the saved score) and the delete has not happened yet.
 */
export type PausePoint = 'after update' | 'before delete';

export interface Gate {
  /** Lets the paused transaction continue. */
  open(): Promise<void>;
}

interface Holder {
  readonly client: PoolClient;
  readonly key: number;
}

/** How many times the lock-wait view is polled before a test gives up. */
const MAX_POLLS = 5_000;

let sequence = 7_000;

export class Coordinator {
  private readonly functions: string[] = [];
  private readonly holders: Holder[] = [];

  constructor(private readonly admin: Pool) {}

  /** Transactions reaching `point` on the row `id` of `table` wait until the gate opens. */
  async pause(table: ScoreTable, point: PausePoint, id: string): Promise<Gate> {
    const key = (sequence += 1);
    const client = await this.admin.connect();
    await client.query('select pg_advisory_lock($1)', [key]);
    const holder: Holder = { client, key };
    this.holders.push(holder);
    await this.rowTrigger(table, point, id, `perform pg_advisory_xact_lock(${String(key)});`);
    return { open: () => this.unlock(holder) };
  }

  /**
   * Makes a promotion fail between its two writes: when the draft `id` is
   * deleted by a transaction that already sees a saved score with the same ID
   * (the promotion's own insert), the delete raises.
   */
  async failDraftDeleteAfterSavedInsert(id: string): Promise<void> {
    await this.rowTrigger(
      'score_drafts',
      'before delete',
      id,
      `if exists (select 1 from public.scores s where s.id = old.id) then
         raise exception 'injected failure between insert and delete';
       end if;`,
    );
  }

  /** Makes every transaction that updated the row `id` of `table` fail at COMMIT. */
  async failCommitAfterUpdate(table: ScoreTable, id: string): Promise<void> {
    const name = await this.triggerFunction(`raise exception 'injected commit failure';`);
    await this.admin.query(
      `create constraint trigger ${name} after update on public.${table}
         deferrable initially deferred
         for each row when (new.id = ${escapeLiteral(id)})
         execute function private.${name}()`,
    );
  }

  /** Resolves with their PIDs once at least `count` backends of this database wait on a lock. */
  async lockWaiters(count: number): Promise<number[]> {
    for (let poll = 0; poll < MAX_POLLS; poll += 1) {
      const { rows } = await this.admin.query<{ pid: number }>(
        `select pid from pg_stat_activity
         where datname = current_database() and wait_event_type = 'Lock'
         order by pid`,
      );
      if (rows.length >= count) {
        return rows.map((row) => row.pid);
      }
    }
    throw new Error(`Fewer than ${String(count)} backends ever waited on a lock.`);
  }

  /** Opens every gate, then drops every temporary trigger (cascade) and function. */
  async reset(): Promise<void> {
    for (const holder of [...this.holders]) {
      await this.unlock(holder);
    }
    for (const name of this.functions.splice(0)) {
      await this.admin.query(`drop function if exists private.${name}() cascade`);
    }
  }

  private async rowTrigger(
    table: ScoreTable,
    point: PausePoint,
    id: string,
    body: string,
  ): Promise<void> {
    const name = await this.triggerFunction(body);
    const row = point === 'before delete' ? 'old' : 'new';
    await this.admin.query(
      `create trigger ${name} ${point} on public.${table}
         for each row when (${row}.id = ${escapeLiteral(id)})
         execute function private.${name}()`,
    );
  }

  /** Creates a trigger function that runs `body`, then lets the row operation proceed. */
  private async triggerFunction(body: string): Promise<string> {
    const name = `test_hook_${String((sequence += 1))}`;
    await this.admin.query(
      `create function private.${name}() returns trigger language plpgsql as $$
       begin
         ${body}
         if tg_op = 'DELETE' then
           return old;
         end if;
         return new;
       end
       $$`,
    );
    this.functions.push(name);
    return name;
  }

  private async unlock(holder: Holder): Promise<void> {
    const index = this.holders.indexOf(holder);
    if (index === -1) {
      return;
    }
    this.holders.splice(index, 1);
    await holder.client.query('select pg_advisory_unlock($1)', [holder.key]);
    holder.client.release();
  }
}
