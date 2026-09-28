-- Database maintenance jobs with pg_cron (ADR-006, issues #22 and #24). The
-- schedules are database jobs, not HTTP routes: nothing outside the database
-- can trigger the deletions.
--
-- - sheet-music-cleanup-expired-drafts, at minute 17 of every hour: deletes at
--   most 1000 expired drafts; a backlog drains over the next runs. Expired
--   drafts are unreachable from their expires_at on anyway, so the delay only
--   affects storage.
-- - sheet-music-prune-rate-limit-windows, every minute: deletes at most 10000
--   ended rate-limit windows of any key. Windows are typically one minute
--   long, so the counter table stays close to the number of keys active in
--   the current window, whatever the number of distinct client addresses.
--
-- Supabase ships pg_cron (preloaded); the jobs run as the migration role (the
-- table owner) in this database. Plain PostgreSQL without pg_cron (local and
-- CI test databases) skips this migration with a notice; tests call the
-- functions directly. If pg_cron is installed but not preloaded, CREATE
-- EXTENSION fails and so does the migration, on purpose.

do $$
begin
  if not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available: the maintenance jobs are not scheduled.';
    return;
  end if;

  create extension if not exists pg_cron with schema pg_catalog;

  -- Scheduling an existing job name updates that job, so this is repeatable.
  perform cron.schedule(
    'sheet-music-cleanup-expired-drafts',
    '17 * * * *',
    'select private.cleanup_expired_drafts(now(), 1000)'
  );
  perform cron.schedule(
    'sheet-music-prune-rate-limit-windows',
    '* * * * *',
    'select private.prune_rate_limit_windows(now(), 10000)'
  );
end
$$;
