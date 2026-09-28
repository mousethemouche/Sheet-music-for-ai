-- Fixed-window rate-limit counters shared by every server instance (issue #24,
-- SEC-03). private.rate_limit_hit implements the RateLimitStore contract:
--
--   hit(key, windowMs, now) -> { count, windowStartedAt, resetAt }
--
-- It atomically increments the counter of the fixed window that contains
-- p_now for p_key and returns the post-increment count. Windows are aligned
-- on the Unix epoch: window_started_at = floor(now_ms / window_ms) * window_ms,
-- reset_at = window_started_at + window_ms. Concurrent hits on the same key and
-- window serialize on the primary key (INSERT ... ON CONFLICT DO UPDATE), so
-- no increment is lost. Each hit also deletes the key's windows that have
-- ended, so a key keeps at most its current window (plus a late one).
-- p_window_ms is a bigint: any positive whole number of milliseconds that the
-- server-common rules accept (30 days is 2,592,000,000 ms, past int4).
--
-- A key must always be used with the same window length: callers namespace
-- keys by limit (for example "mcp:<user id>").
--
-- Keys that are never hit again (a per-IP rule sees each client address, and
-- a client can rotate IPv6 addresses) keep their last, ended window until
-- private.prune_rate_limit_windows deletes it; the pg_cron job of
-- 20260928210300_schedule_maintenance.sql runs it every minute.
--
-- Privileged path only: the server calls rate_limit_hit over its own database
-- connection. Neither the table nor the functions are reachable by anon,
-- authenticated, service_role or score_owner.

create table private.rate_limit_windows (
  key text not null,
  window_started_at timestamptz not null,
  reset_at timestamptz not null,
  count integer not null,
  primary key (key, window_started_at),
  constraint rate_limit_windows_key_length check (char_length(key) between 1 and 200),
  constraint rate_limit_windows_window_positive check (reset_at > window_started_at),
  constraint rate_limit_windows_count_positive check (count >= 1)
);

comment on table private.rate_limit_windows is
  'Fixed-window request counters for rate limiting (issue #24). Server-only.';

-- Global pruning of ended windows (private.prune_rate_limit_windows).
create index rate_limit_windows_reset_at_idx on private.rate_limit_windows (reset_at);

-- Defense in depth: no policy, so a role granted access by mistake still sees no row.
alter table private.rate_limit_windows enable row level security;

revoke all on table private.rate_limit_windows from public, anon, authenticated, service_role;

create function private.rate_limit_hit(p_key text, p_window_ms bigint, p_now timestamptz)
returns table (count integer, window_started_at timestamptz, reset_at timestamptz)
language sql
volatile
set search_path = ''
as $$
  delete from private.rate_limit_windows w
  where w.key = p_key
    and w.reset_at <= p_now;

  with bounds as (
    select 'epoch'::timestamptz
      + floor(extract(epoch from p_now) * 1000 / p_window_ms) * p_window_ms
        * interval '1 millisecond' as started_at
  )
  insert into private.rate_limit_windows as w (key, window_started_at, reset_at, count)
  select p_key, b.started_at, b.started_at + p_window_ms * interval '1 millisecond', 1
  from bounds b
  on conflict (key, window_started_at) do update set count = w.count + 1
  returning w.count, w.window_started_at, w.reset_at;
$$;

revoke all on function private.rate_limit_hit(text, bigint, timestamptz)
  from public, anon, authenticated, service_role;

-- Deletes at most p_batch_size windows of any key that have ended at p_now
-- (reset_at <= p_now) and returns how many it deleted. An ended window no
-- longer counts: the next hit of its key starts a new window, so pruning never
-- changes a limiting decision. Rows locked by a concurrent hit are skipped,
-- and a later run deletes them. Idempotent.
create function private.prune_rate_limit_windows(p_now timestamptz, p_batch_size integer)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if p_now is null or p_batch_size is null or p_batch_size < 1 then
    raise exception 'prune_rate_limit_windows needs an instant and a positive batch size.'
      using errcode = '22023';
  end if;

  with ended as (
    select w.key, w.window_started_at
    from private.rate_limit_windows w
    where w.reset_at <= p_now
    order by w.reset_at
    limit p_batch_size
    for update skip locked
  )
  delete from private.rate_limit_windows w
  using ended
  where w.key = ended.key
    and w.window_started_at = ended.window_started_at;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function private.prune_rate_limit_windows(timestamptz, integer)
  from public, anon, authenticated, service_role;
