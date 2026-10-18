-- Clean Slate: reference documents that stay with the board
-- ------------------------------------------------------------------
-- Run this once in Supabase → SQL Editor → New query → paste → Run,
-- AFTER 2026-10-18-speed-and-privacy.sql (it uses that file's helpers).
-- It is safe to run again: every step checks whether it's already done.
-- Everything happens in one go: if any part fails, nothing is changed.
--
-- What it does:
--   1. boards.reference_doc: the PDF (or picture) beside a board, the pages
--      picked from it, and any blank / lined / graph pages added.
--   2. reference_marks: every pen line, highlight, text box and piece of
--      tape on that document, one row each (same access as the board's own
--      lines: the owner and the people it's shared with).
--   3. images.source: for a clip cut out of the document onto the board,
--      which page and which part it came from ("Show in PDF").
--   4. board_changes() also returns where a clip came from, and
--      open_board() the document (so opening a board is still one request).
--
-- Nothing on any board is deleted or changed by this file.

begin;

-- 1. The document ----------------------------------------------------------
alter table public.boards add column if not exists reference_doc jsonb;

-- 2. Markings on it ----------------------------------------------------------
create table if not exists public.reference_marks (
  id uuid primary key,
  board_id uuid not null references public.boards (id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reference_marks_board_created_idx on public.reference_marks (board_id, created_at, id);
alter table public.reference_marks enable row level security;
grant select, insert, update, delete on public.reference_marks to authenticated;

do $$
declare
  p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'reference_marks' loop
    execute format('drop policy %I on public.reference_marks', p.policyname);
  end loop;
end $$;
create policy "reference_marks: read on my boards" on public.reference_marks for select to authenticated
  using (board_id in (select public.my_board_ids()));
create policy "reference_marks: add on my boards" on public.reference_marks for insert to authenticated
  with check (board_id in (select public.my_board_ids()));
create policy "reference_marks: change on my boards" on public.reference_marks for update to authenticated
  using (board_id in (select public.my_board_ids())) with check (board_id in (select public.my_board_ids()));
create policy "reference_marks: remove on my boards" on public.reference_marks for delete to authenticated
  using (board_id in (select public.my_board_ids()));

-- marking up the document counts as using the board (so it isn't tidied
-- away as unused), and changes note when they happened
drop trigger if exists reference_marks_activity_insert on public.reference_marks;
drop trigger if exists reference_marks_activity_update on public.reference_marks;
drop trigger if exists reference_marks_set_updated_at on public.reference_marks;
create trigger reference_marks_activity_insert after insert on public.reference_marks
  referencing new table as changed_rows for each statement execute function public.note_board_activity_batch();
create trigger reference_marks_activity_update after update on public.reference_marks
  referencing new table as changed_rows for each statement execute function public.note_board_activity_batch();
create trigger reference_marks_set_updated_at before update on public.reference_marks
  for each row execute function public.set_updated_at();

-- 3. Where a clip came from ------------------------------------------------------
alter table public.images add column if not exists source jsonb;

-- 4. Catching up after a reconnect: clips keep where they came from ----------------
create or replace function public.board_changes(p_board uuid, p_since timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = public
as $$
declare
  v_now timestamptz := now();
  n int;
begin
  if p_board is null or p_since is null or auth.uid() is null then
    return null;
  end if;
  if p_since < v_now - interval '6 days' then
    return jsonb_build_object('now', v_now, 'full', true);
  end if;
  select count(*) into n from (
    select 1 from public.strokes where board_id = p_board and updated_at > p_since limit 3001
  ) x;
  if n > 3000 then
    return jsonb_build_object('now', v_now, 'full', true);
  end if;
  select count(*) into n from (
    select 1 from public.board_deletions where board_id = p_board and deleted_at > p_since limit 3001
  ) x;
  if n > 3000 then
    return jsonb_build_object('now', v_now, 'full', true);
  end if;
  return jsonb_build_object(
    'now', v_now,
    'strokes', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'data', s.data) order by s.created_at, s.id)
      from public.strokes s where s.board_id = p_board and s.updated_at > p_since), '[]'::jsonb),
    'texts', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'x', t.x, 'y', t.y, 'text', t.text, 'color', t.color,
                                          'font_size', t.font_size, 'width', t.width, 'rotation', t.rotation) order by t.created_at, t.id)
      from public.texts t where t.board_id = p_board and t.updated_at > p_since), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'x', i.x, 'y', i.y, 'width', i.width, 'height', i.height,
                                          'src', i.src, 'source', i.source) order by i.created_at, i.id)
      from public.images i where i.board_id = p_board and i.updated_at > p_since), '[]'::jsonb),
    'deleted', coalesce((
      select jsonb_agg(jsonb_build_object('kind', d.kind, 'id', d.item_id))
      from public.board_deletions d where d.board_id = p_board and d.deleted_at > p_since), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.board_changes(uuid, timestamptz) from public;
grant execute on function public.board_changes(uuid, timestamptz) to authenticated;

-- 5. Opening a board also brings its document (no extra request) ------------
create or replace function public.open_board(p_board uuid)
returns jsonb language plpgsql volatile security invoker set search_path = public
as $$
declare
  b record;
begin
  if p_board is null or auth.uid() is null then
    return null;
  end if;
  if public.my_email() is not null then
    perform public.join_board_via_link(p_board);
  end if;
  perform public.touch_board(p_board::text);
  select id, name, owner_id, grid_config, sim_embeds, background, reference_doc,
         case when thumbnail is null then null when thumbnail like 'data:%' then 'legacy' else thumbnail end as thumb
    into b
    from public.boards where id = p_board;
  if not found then
    return jsonb_build_object('found', false, 'now', now());
  end if;
  return jsonb_build_object(
    'found', true, 'now', now(), 'id', b.id, 'name', b.name, 'owner_id', b.owner_id,
    'grid_config', b.grid_config, 'sim_embeds', b.sim_embeds, 'background', b.background, 'thumbnail', b.thumb,
    'reference_doc', b.reference_doc);
end;
$$;
revoke all on function public.open_board(uuid) from public;
grant execute on function public.open_board(uuid) to authenticated;

commit;

-- Check it worked (just a report — changes nothing):
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'boards' and column_name = 'reference_doc') as "document column (1 expected)",
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'reference_marks') as "marking rules (4 expected)",
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'images' and column_name = 'source') as "clip column (1 expected)",
  (select count(*) from pg_trigger where tgrelid = 'public.reference_marks'::regclass and not tgisinternal) as "marking triggers (3 expected)";
