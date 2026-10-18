-- Clean Slate: inactive-board clean-up
-- ------------------------------------------------------------------
-- Run this once in Supabase → SQL Editor → New query → paste → Run.
-- It's safe to run again (every step checks whether it's already done).
--
-- What it adds:
--   boards.last_activity_at    when the board was last drawn on, written
--                              on or opened
--   boards.deletion_warned_at  when the owner was emailed that it will be
--                              deleted (cleared again as soon as it's used)
--   triggers that keep last_activity_at up to date whenever strokes,
--   text boxes or images are added, changed or removed
--   touch_board(), which the app calls when a board is opened
--
-- Nothing is deleted by this file. Deleting happens in the daily job
-- (/api/cron/board-cleanup), and only 7+ days after the warning email.

-- 1. New columns -----------------------------------------------------

alter table public.boards add column if not exists last_activity_at timestamptz;
alter table public.boards add column if not exists deletion_warned_at timestamptz;

-- 2. Fill in last_activity_at for existing boards from their newest
--    stroke / text / image (or when the board was made). Only touches
--    boards that don't have a value yet.

update public.boards b
set last_activity_at = greatest(
  b.created_at,
  (select max(s.created_at) from public.strokes s where s.board_id = b.id),
  (select max(t.created_at) from public.texts t where t.board_id = b.id)
)
where b.last_activity_at is null;

-- Images live in a newer table that some projects may not have yet.
do $$
begin
  if to_regclass('public.images') is not null then
    update public.boards b
    set last_activity_at = greatest(
      b.last_activity_at,
      (select max(i.created_at) from public.images i where i.board_id = b.id)
    );
  end if;
end $$;

alter table public.boards alter column last_activity_at set default now();
update public.boards set last_activity_at = coalesce(last_activity_at, created_at, now()) where last_activity_at is null;

create index if not exists boards_last_activity_at_idx on public.boards (last_activity_at);

-- 3. Keep it up to date ----------------------------------------------
-- Runs once per change to strokes, text boxes or images (a whole cleared
-- board is one change), but only actually writes to the board at most once
-- an hour (or straight away if the board had been warned about deletion),
-- so it adds almost no load.

create or replace function public.note_board_activity_batch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  claims text;
begin
  -- Never let this get in the way of saving a stroke: any problem in here
  -- is ignored.
  begin
    -- The clean-up job itself (service role) doesn't count as activity.
    claims := current_setting('request.jwt.claims', true);
    if claims is not null and claims <> '' and (claims::jsonb ->> 'role') = 'service_role' then
      return null;
    end if;
    update public.boards
    set last_activity_at = now(),
        deletion_warned_at = null
    where id in (select distinct board_id from changed_rows where board_id is not null)
      and (
        last_activity_at is null
        or last_activity_at < now() - interval '1 hour'
        or deletion_warned_at is not null
      );
  exception when others then
    null;
  end;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['strokes', 'texts', 'images'] loop
    if to_regclass('public.' || t) is not null then
      -- (the older once-per-row version, if it's there)
      execute format('drop trigger if exists %I on public.%I', t || '_note_board_activity', t);
      execute format('drop trigger if exists %I on public.%I', t || '_activity_insert', t);
      execute format('drop trigger if exists %I on public.%I', t || '_activity_update', t);
      execute format('drop trigger if exists %I on public.%I', t || '_activity_delete', t);
      execute format('create trigger %I after insert on public.%I referencing new table as changed_rows for each statement execute function public.note_board_activity_batch()', t || '_activity_insert', t);
      execute format('create trigger %I after update on public.%I referencing new table as changed_rows for each statement execute function public.note_board_activity_batch()', t || '_activity_update', t);
      execute format('create trigger %I after delete on public.%I referencing old table as changed_rows for each statement execute function public.note_board_activity_batch()', t || '_activity_delete', t);
    end if;
  end loop;
end $$;

-- 4. Opening a board counts as using it -------------------------------

create or replace function public.touch_board(p_board_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_board_id is null
     or p_board_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return;
  end if;
  -- (compared as a uuid, so the board is found by its index)
  update public.boards
  set last_activity_at = now(),
      deletion_warned_at = null
  where id = p_board_id::uuid
    and (
      last_activity_at is null
      or last_activity_at < now() - interval '10 minutes'
      or deletion_warned_at is not null
    );
end;
$$;

revoke all on function public.touch_board(text) from public;
grant execute on function public.touch_board(text) to authenticated;

-- 5. Check it worked: boards by how long they've been unused ---------
-- (just a report — change nothing)

select
  count(*) filter (where last_activity_at >= now() - interval '23 days') as active,
  count(*) filter (where last_activity_at < now() - interval '23 days'
                     and last_activity_at >= now() - interval '30 days') as "unused 23-30 days",
  count(*) filter (where last_activity_at < now() - interval '30 days') as "unused 30+ days"
from public.boards;
