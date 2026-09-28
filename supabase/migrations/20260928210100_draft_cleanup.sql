-- Expired-draft cleanup (ADR-006 "Cleanup", issue #22 DRAFT-03).
--
-- Deletes at most p_batch_size drafts that are expired at p_now and returns how
-- many it deleted. A draft is expired from its expires_at on (expires_at <= now),
-- the boundary of the application's DraftExpiryPolicy, so cleanup never removes
-- a draft the application still treats as live. It never touches saved scores
-- and is idempotent.
--
-- Concurrency with normal draft activity:
-- - rows locked by an in-flight edit or promotion are skipped (SKIP LOCKED),
--   not waited for; a later run deletes them if they are still expired;
-- - a row refreshed by an edit that committed after this statement started is
--   re-evaluated on its latest version when locked, and the DELETE re-checks
--   expires_at, so a refreshed draft survives;
-- - if cleanup deletes the row first, the concurrent edit matches no row and
--   reports a lost compare-and-swap ('stale'), never a phantom success.
--
-- Privileged path only: executed by the table owner (the pg_cron job, see
-- 20260928210300_schedule_maintenance.sql) or a trusted server connection.
-- No client role can execute it, and it is SECURITY INVOKER.

create function private.cleanup_expired_drafts(p_now timestamptz, p_batch_size integer)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if p_now is null or p_batch_size is null or p_batch_size < 1 then
    raise exception 'cleanup_expired_drafts needs an instant and a positive batch size.'
      using errcode = '22023';
  end if;

  with expired as (
    select d.id
    from public.score_drafts d
    where d.expires_at <= p_now
    order by d.expires_at
    limit p_batch_size
    for update skip locked
  )
  delete from public.score_drafts d
  using expired
  where d.id = expired.id
    and d.expires_at <= p_now;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function private.cleanup_expired_drafts(timestamptz, integer)
  from public, anon, authenticated, service_role;
