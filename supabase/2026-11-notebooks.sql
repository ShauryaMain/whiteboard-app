-- Notebooks (November 2026)
--
-- A notebook is a board laid out as paper pages (see src/lib/notebook.js).
-- This file adds:
--   1. subjects: folders on the home screen (Maths, Physics…), each
--      person's own;
--   2. boards.kind ('board' or 'notebook'), boards.notebook (its pages and
--      cover) and boards.subject_id;
--   3. compact ink: notebooks save strokes packed ({ o, pk } instead of a
--      list of points), so moving things understands both kinds;
--   4. notebook_relayout: adding, removing or reordering pages moves what's
--      on them, in one go;
--   5. open_board / list_boards return the new fields, and the boards list
--      leaves notebooks out (they have a shelf of their own: list_notebooks).
-- Notebooks are never cleaned up automatically (the clean-up job skips
-- them: src/lib/boardCleanup.js).
--
-- Run after 2026-10-18-speed-and-privacy.sql and 2026-10-19-reference-docs.sql.
-- Safe to run more than once. Supabase: SQL Editor, New query, paste, Run.

begin;

-- 1. Subjects -------------------------------------------------------------------
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subjects_owner_idx on public.subjects (owner_id, position, created_at);
alter table public.subjects enable row level security;
drop policy if exists "subjects: own" on public.subjects;
create policy "subjects: own" on public.subjects for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and not (select public.is_anon_user()));
grant select, insert, update, delete on public.subjects to authenticated;
drop trigger if exists subjects_set_updated_at on public.subjects;
create trigger subjects_set_updated_at before update on public.subjects
  for each row execute function public.set_updated_at();

-- 2. Notebooks are boards -------------------------------------------------------
alter table public.boards add column if not exists kind text not null default 'board';
alter table public.boards add column if not exists notebook jsonb;
alter table public.boards add column if not exists subject_id uuid references public.subjects(id) on delete set null;
alter table public.boards add column if not exists last_activity_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'boards_kind_check') then
    alter table public.boards add constraint boards_kind_check check (kind in ('board', 'notebook'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'boards_notebook_size_check') then
    alter table public.boards add constraint boards_notebook_size_check
      check (notebook is null or (jsonb_typeof(notebook) = 'object' and octet_length(notebook::text) <= 400000));
  end if;
end $$;
create index if not exists boards_owner_kind_idx on public.boards (owner_id, kind, created_at desc);
create index if not exists boards_subject_idx on public.boards (subject_id) where subject_id is not null;

-- A board can only go in a subject that belongs to the board's owner.
create or replace function public.boards_check_subject()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.subject_id is not null and not exists (
    select 1 from public.subjects s where s.id = new.subject_id and s.owner_id = new.owner_id
  ) then
    raise exception 'That subject belongs to someone else' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists boards_check_subject on public.boards;
create trigger boards_check_subject before insert or update of subject_id, owner_id on public.boards
  for each row execute function public.boards_check_subject();

-- 3. Moving ink, plain or packed --------------------------------------------------
-- Where a stroke starts (packed strokes keep it in "o").
create or replace function public.stroke_anchor_y(d jsonb)
returns double precision language sql immutable
as $$
  select case
    when jsonb_typeof(d -> 'o') = 'array' then (d -> 'o' ->> 1)::double precision
    when jsonb_typeof(d -> 'points') = 'array' and jsonb_array_length(d -> 'points') > 0
      then (d -> 'points' -> 0 ->> 'y')::double precision
    else 0 end
$$;

create or replace function public.shift_stroke_data(d jsonb, p_dx double precision, p_dy double precision)
returns jsonb language sql immutable
as $$
  select case
    when jsonb_typeof(d -> 'o') = 'array' then
      jsonb_set(d, '{o}', jsonb_build_array(
        round(((d -> 'o' ->> 0)::double precision + p_dx)::numeric, 1),
        round(((d -> 'o' ->> 1)::double precision + p_dy)::numeric, 1)))
    when jsonb_typeof(d -> 'points') = 'array' then
      jsonb_set(d, '{points}', (
        select coalesce(jsonb_agg(
                 case when jsonb_typeof(e.p) = 'object' and e.p ? 'x' and e.p ? 'y'
                      then e.p || jsonb_build_object('x', (e.p ->> 'x')::double precision + p_dx, 'y', (e.p ->> 'y')::double precision + p_dy)
                      else e.p end
                 order by e.o), '[]'::jsonb)
        from jsonb_array_elements(d -> 'points') with ordinality as e(p, o)))
    else d end
$$;

create or replace function public.move_objects(
  p_board uuid, p_strokes uuid[], p_texts uuid[], p_images text[], p_dx double precision, p_dy double precision)
returns int language plpgsql volatile security invoker set search_path = public
as $$
declare
  n int := 0;
  k int;
begin
  if p_board is null or p_dx is null or p_dy is null or (p_dx = 0 and p_dy = 0) then
    return 0;
  end if;
  if coalesce(array_length(p_strokes, 1), 0) > 0 then
    update public.strokes s set data = public.shift_stroke_data(s.data, p_dx, p_dy)
    where s.board_id = p_board and s.id = any (p_strokes);
    get diagnostics k = row_count;
    n := n + k;
  end if;
  if coalesce(array_length(p_texts, 1), 0) > 0 then
    update public.texts set x = x + p_dx, y = y + p_dy where board_id = p_board and id = any (p_texts);
    get diagnostics k = row_count;
    n := n + k;
  end if;
  if coalesce(array_length(p_images, 1), 0) > 0 then
    update public.images set x = x + p_dx, y = y + p_dy where board_id = p_board and id = any (p_images);
    get diagnostics k = row_count;
    n := n + k;
  end if;
  return n;
end;
$$;
revoke all on function public.move_objects(uuid, uuid[], uuid[], text[], double precision, double precision) from public;
grant execute on function public.move_objects(uuid, uuid[], uuid[], text[], double precision, double precision) to authenticated;

-- 4. Changing a notebook's pages ----------------------------------------------------
-- p_bands: [{ lo, hi, dx, dy, del }], each a stretch of the notebook (by
-- where things start) that moves by dx, dy or goes. Worked out from the
-- pages before the change, so nothing is moved twice. p_rev: which change
-- the caller's copy of the pages is at; a copy that's out of date (the
-- pages were changed somewhere else meanwhile) is refused, so bands are
-- never applied to the wrong pages. The owner only, like every other
-- change to a board's settings.
drop function if exists public.notebook_relayout(uuid, jsonb, jsonb);
create or replace function public.notebook_relayout(p_board uuid, p_notebook jsonb, p_bands jsonb, p_rev int)
returns jsonb language plpgsql volatile security invoker set search_path = public
as $$
declare
  moved int := 0;
  gone int := 0;
  k int;
  cur int;
begin
  if p_board is null or auth.uid() is null then
    return null;
  end if;
  if jsonb_typeof(p_notebook) <> 'object' or jsonb_typeof(p_notebook -> 'pages') <> 'array'
     or jsonb_array_length(p_notebook -> 'pages') < 1 or jsonb_array_length(p_notebook -> 'pages') > 500 then
    raise exception 'Not a notebook';
  end if;
  if coalesce(jsonb_typeof(p_bands), 'null') <> 'array' or jsonb_array_length(p_bands) > 501 then
    raise exception 'Bad page changes';
  end if;
  select coalesce((notebook ->> 'rev')::int, 0) into cur
    from public.boards where id = p_board and owner_id = auth.uid() and kind = 'notebook'
    for update;
  if not found then
    raise exception 'Only the notebook''s owner can change its pages' using errcode = '42501';
  end if;
  if cur is distinct from coalesce(p_rev, 0) then
    raise exception 'stale: the pages were changed somewhere else' using errcode = '40001';
  end if;

  -- what was on pages that went (where each stroke starts is worked out
  -- once per statement: a materialized list)
  with a as materialized (select s.id, public.stroke_anchor_y(s.data) as y from public.strokes s where s.board_id = p_board),
       b as (select * from jsonb_to_recordset(p_bands) as x(lo double precision, hi double precision, dx double precision, dy double precision, del boolean))
  delete from public.strokes s using a, b
    where s.board_id = p_board and a.id = s.id and coalesce(b.del, false) and a.y >= b.lo and a.y < b.hi;
  get diagnostics k = row_count; gone := gone + k;
  with b as (select * from jsonb_to_recordset(p_bands) as x(lo double precision, hi double precision, dx double precision, dy double precision, del boolean))
  delete from public.texts t using b
    where t.board_id = p_board and coalesce(b.del, false) and t.y >= b.lo and t.y < b.hi;
  get diagnostics k = row_count; gone := gone + k;
  with b as (select * from jsonb_to_recordset(p_bands) as x(lo double precision, hi double precision, dx double precision, dy double precision, del boolean))
  delete from public.images i using b
    where i.board_id = p_board and coalesce(b.del, false) and i.y >= b.lo and i.y < b.hi;
  get diagnostics k = row_count; gone := gone + k;

  -- everything else moves with its page (matched by where it was before
  -- anything moved)
  with a as materialized (select s.id, public.stroke_anchor_y(s.data) as y from public.strokes s where s.board_id = p_board),
       b as (select * from jsonb_to_recordset(p_bands) as x(lo double precision, hi double precision, dx double precision, dy double precision, del boolean))
  update public.strokes s set data = public.shift_stroke_data(s.data, coalesce(b.dx, 0), coalesce(b.dy, 0))
    from a, b
    where s.board_id = p_board and a.id = s.id and not coalesce(b.del, false) and (coalesce(b.dx, 0) <> 0 or coalesce(b.dy, 0) <> 0)
      and a.y >= b.lo and a.y < b.hi;
  get diagnostics k = row_count; moved := moved + k;
  with b as (select * from jsonb_to_recordset(p_bands) as x(lo double precision, hi double precision, dx double precision, dy double precision, del boolean))
  update public.texts t set x = t.x + coalesce(b.dx, 0), y = t.y + coalesce(b.dy, 0)
    from b
    where t.board_id = p_board and not coalesce(b.del, false) and (coalesce(b.dx, 0) <> 0 or coalesce(b.dy, 0) <> 0) and t.y >= b.lo and t.y < b.hi;
  get diagnostics k = row_count; moved := moved + k;
  with b as (select * from jsonb_to_recordset(p_bands) as x(lo double precision, hi double precision, dx double precision, dy double precision, del boolean))
  update public.images i set x = i.x + coalesce(b.dx, 0), y = i.y + coalesce(b.dy, 0)
    from b
    where i.board_id = p_board and not coalesce(b.del, false) and (coalesce(b.dx, 0) <> 0 or coalesce(b.dy, 0) <> 0) and i.y >= b.lo and i.y < b.hi;
  get diagnostics k = row_count; moved := moved + k;

  update public.boards set notebook = p_notebook || jsonb_build_object('rev', cur + 1) where id = p_board;
  return jsonb_build_object('moved', moved, 'removed', gone, 'rev', cur + 1, 'now', now());
end;
$$;
revoke all on function public.notebook_relayout(uuid, jsonb, jsonb, int) from public;
grant execute on function public.notebook_relayout(uuid, jsonb, jsonb, int) to authenticated;

-- A notebook's name and cover, without touching its pages.
create or replace function public.notebook_set_cover(p_board uuid, p_name text, p_cover jsonb)
returns boolean language plpgsql volatile security invoker set search_path = public
as $$
begin
  if p_board is null or auth.uid() is null or jsonb_typeof(p_cover) <> 'object' or octet_length(p_cover::text) > 200 then
    return false;
  end if;
  update public.boards
    set name = coalesce(nullif(btrim(left(coalesce(p_name, ''), 80)), ''), name),
        notebook = jsonb_set(coalesce(notebook, '{}'::jsonb), '{cover}', p_cover)
    where id = p_board and owner_id = auth.uid() and kind = 'notebook';
  return found;
end;
$$;
revoke all on function public.notebook_set_cover(uuid, text, jsonb) from public;
grant execute on function public.notebook_set_cover(uuid, text, jsonb) to authenticated;

-- 5. Opening and listing ----------------------------------------------------------
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
  select id, name, owner_id, grid_config, sim_embeds, background, reference_doc, kind, notebook, subject_id,
         case when thumbnail is null then null when thumbnail like 'data:%' then 'legacy' else thumbnail end as thumb
    into b
    from public.boards where id = p_board;
  if not found then
    return jsonb_build_object('found', false, 'now', now());
  end if;
  return jsonb_build_object(
    'found', true, 'now', now(), 'id', b.id, 'name', b.name, 'owner_id', b.owner_id,
    'grid_config', b.grid_config, 'sim_embeds', b.sim_embeds, 'background', b.background, 'thumbnail', b.thumb,
    'reference_doc', b.reference_doc, 'kind', b.kind, 'notebook', b.notebook, 'subject_id', b.subject_id);
end;
$$;
revoke all on function public.open_board(uuid) from public;
grant execute on function public.open_board(uuid) to authenticated;

-- The boards list: as before, plus kind; your own notebooks aren't in it
-- (they're on the notebook shelf). Notebooks shared with you are.
create or replace function public.list_boards(
  p_kind text default 'mine', p_search text default null, p_before timestamptz default null, p_limit int default 30,
  p_before_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public
as $$
declare
  me uuid := auth.uid();
  em text := public.my_email();
  lim int := least(greatest(coalesce(p_limit, 30), 1), 100);
  q text := nullif(btrim(coalesce(p_search, '')), '');
  pattern text;
  found jsonb;
  total int;
begin
  if me is null then
    return null;
  end if;
  if q is not null then
    pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  if p_kind = 'shared' then
    if em is null then
      return jsonb_build_object('rows', '[]'::jsonb, 'more', false, 'total', 0);
    end if;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc), '[]'::jsonb) into found from (
      select id, name, created_at, owner_id, shared_with, background, thumbnail, kind,
             case when kind = 'notebook' then jsonb_build_object('cover', notebook -> 'cover', 'pages', jsonb_array_length(coalesce(notebook -> 'pages', '[]'::jsonb))) end as notebook
      from public.boards
      where shared_with @> array[em] and owner_id is distinct from me
        and (pattern is null or coalesce(name, 'Untitled board') ilike pattern)
        and (p_before is null or (created_at, id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by created_at desc, id desc
      limit lim + 1) x;
    total := null;
  else
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc), '[]'::jsonb) into found from (
      select id, name, created_at, owner_id, shared_with, background, thumbnail, kind, null::jsonb as notebook
      from public.boards
      where owner_id = me and kind = 'board'
        and (pattern is null or coalesce(name, 'Untitled board') ilike pattern)
        and (p_before is null or (created_at, id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by created_at desc, id desc
      limit lim + 1) x;
    select count(*) into total from public.boards where owner_id = me and kind = 'board'
      and (pattern is null or coalesce(name, 'Untitled board') ilike pattern);
  end if;
  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(found) with ordinality as a(e, i) where i <= lim) y),
    'more', jsonb_array_length(found) > lim,
    'total', total);
end;
$$;
revoke all on function public.list_boards(text, text, timestamptz, int, uuid) from public;
grant execute on function public.list_boards(text, text, timestamptz, int, uuid) to authenticated;

-- Your notebooks and subjects, for the shelf: most recently used first.
create or replace function public.list_notebooks()
returns jsonb language sql stable security invoker set search_path = public
as $$
  select jsonb_build_object(
    'notebooks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'name', b.name, 'created_at', b.created_at, 'used_at', coalesce(b.last_activity_at, b.created_at),
               'subject_id', b.subject_id, 'shared_with', b.shared_with, 'thumbnail', b.thumbnail, 'background', b.background,
               'cover', b.notebook -> 'cover', 'size', b.notebook ->> 'size',
               'pages', jsonb_array_length(coalesce(b.notebook -> 'pages', '[]'::jsonb)))
             order by coalesce(b.last_activity_at, b.created_at) desc, b.id)
      from (select * from public.boards where owner_id = auth.uid() and kind = 'notebook' limit 1000) b), '[]'::jsonb),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'color', s.color, 'position', s.position)
             order by s.position, s.created_at, s.id)
      from public.subjects s where s.owner_id = auth.uid()), '[]'::jsonb))
$$;
revoke all on function public.list_notebooks() from public;
grant execute on function public.list_notebooks() to authenticated;

commit;

-- Check it worked (just a report, changes nothing). Expect true, true, 4, 1, 1.
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'boards' and column_name = 'notebook') as "notebook column",
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'subjects') as "subjects table",
  (select count(*) from pg_proc where proname in ('notebook_relayout', 'list_notebooks', 'shift_stroke_data', 'notebook_set_cover')) as "new functions (4)",
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'subjects') as "subject rule (1)",
  (select count(*) from pg_trigger where tgname = 'boards_check_subject') as "subject check (1)";
