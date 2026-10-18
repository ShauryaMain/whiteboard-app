-- Clean Slate: faster database, fewer requests, private live channels
-- ------------------------------------------------------------------
-- Run this once in Supabase → SQL Editor → New query → paste → Run.
-- It is safe to run again: every step checks whether it's already done.
-- Everything happens in one go: if any part fails, nothing is changed.
--
-- Before running it:
--   • Authentication → Sign In / Providers → turn on "Allow anonymous
--     sign-ins" (students get an invisible sign-in so the live class
--     channels can be private);
--   • Authentication → Rate Limits → raise the limit for anonymous sign-ins
--     (it starts at 30 an hour per internet address, and a whole school
--     usually shares one) to 1000.
-- The app switches to private live channels by itself once this file has
-- been run. After the app is updated: Realtime → Settings → turn off
-- "Allow public access", and refresh any board left open from before.
--
-- What it does:
--   1. Board access rules, written so Postgres can use indexes (same
--      people can see and change the same boards as before).
--   2. Indexes for loading boards, the boards list and sharing.
--   3. touch_board() uses the board's index; the "board was used" trigger
--      runs once per change instead of once per row.
--   4. Catching up after a reconnect: an updated_at column, a short log of
--      what was deleted, and board_changes() which returns only what
--      changed since a given moment.
--   5. open_board(): opening a board in one request.
--   6. list_boards(): the boards list a page at a time, with search.
--   7. move_objects(): moving things sends "moved by x, y", not every point.
--   8. user_settings: settings and graph presets out of the sign-in token.
--   9. Live classes: who is in which class, and private live channels.
--  10. Storage: uploads only into folders of boards you can use (and your
--      own fonts folder); nothing for students' invisible sign-ins.
--  11. Share suggestions without being able to list everyone's email.
--
-- Nothing on any board is deleted or changed by this file.

begin;

-- 0. Small helpers ------------------------------------------------------

create or replace function public.my_email()
returns text language sql stable
as $$ select nullif(lower(auth.jwt() ->> 'email'), '') $$;

create or replace function public.is_anon_user()
returns boolean language sql stable
as $$ select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) $$;

-- Every board the signed-in person may use: their own and the ones shared
-- with their email. (Security definer: it reads boards directly, so the
-- rules below don't have to check boards' own rules row by row.)
create or replace function public.my_board_ids()
returns setof uuid language sql stable security definer set search_path = public
as $$
  select id from public.boards where owner_id = auth.uid()
  union
  select id from public.boards where public.my_email() is not null and shared_with @> array[public.my_email()]
$$;

create or replace function public.can_use_board(p_board uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select p_board is not null and p_board in (select public.my_board_ids()) $$;

-- The same for a board id written as text (a storage folder name).
create or replace function public.can_use_board_folder(p_folder text)
returns boolean language plpgsql stable security definer set search_path = public
as $$
begin
  if p_folder is null or p_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.can_use_board(p_folder::uuid);
end;
$$;

revoke all on function public.my_board_ids() from public;
revoke all on function public.can_use_board(uuid) from public;
revoke all on function public.can_use_board_folder(text) from public;
grant execute on function public.my_email() to anon, authenticated;
grant execute on function public.is_anon_user() to anon, authenticated;
grant execute on function public.my_board_ids() to authenticated;
grant execute on function public.can_use_board(uuid) to authenticated;
grant execute on function public.can_use_board_folder(text) to authenticated;

-- 1. Indexes ---------------------------------------------------------------

create index if not exists strokes_board_created_idx on public.strokes (board_id, created_at, id);
create index if not exists texts_board_created_idx on public.texts (board_id, created_at, id);
create index if not exists images_board_created_idx on public.images (board_id, created_at, id);
-- (the new ones cover everything the old single-column ones did)
drop index if exists public.strokes_board_id_idx;
drop index if exists public.texts_board_id_idx;
drop index if exists public.images_board_id_idx;
create index if not exists boards_owner_created_idx on public.boards (owner_id, created_at desc);
create index if not exists boards_shared_with_idx on public.boards using gin (shared_with);

-- 2. Access rules ----------------------------------------------------------
-- Same people, same boards as before. The old rules looked up the board for
-- every row; these work out "my boards" once per request.

-- every rule on boards and profiles goes (they are replaced below)
do $$
declare
  p record;
begin
  for p in select tablename, policyname from pg_policies where schemaname = 'public' and tablename in ('boards', 'profiles') loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

create policy "boards: read own or shared" on public.boards for select to authenticated
  using (owner_id = (select auth.uid()) or shared_with @> array[(select public.my_email())]);
create policy "boards: create own" on public.boards for insert to authenticated
  with check (owner_id = (select auth.uid()) and not (select public.is_anon_user()));
create policy "boards: owner updates" on public.boards for update to authenticated
  using (owner_id = (select auth.uid()));
create policy "boards: owner deletes" on public.boards for delete to authenticated
  using (owner_id = (select auth.uid()));

do $$
declare
  t text;
  p record;
begin
  foreach t in array array['strokes', 'texts', 'images'] loop
    -- every rule on these tables goes (they are replaced below)
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for select to authenticated using (board_id in (select public.my_board_ids()))', t || ': read on my boards', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (board_id in (select public.my_board_ids()))', t || ': add on my boards', t);
    execute format('create policy %I on public.%I for update to authenticated using (board_id in (select public.my_board_ids())) with check (board_id in (select public.my_board_ids()))', t || ': change on my boards', t);
    execute format('create policy %I on public.%I for delete to authenticated using (board_id in (select public.my_board_ids()))', t || ': remove on my boards', t);
  end loop;
end $$;

-- Profiles: only your own (the share box suggests people you already share
-- with instead: see share_suggestions below).
create policy "profiles: read own" on public.profiles for select to authenticated
  using (id = (select auth.uid()));

-- Students' invisible sign-ins don't get a profile.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

-- 3. "This board was used" -------------------------------------------------

create or replace function public.touch_board(p_board_id text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or p_board_id is null
     or p_board_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return;
  end if;
  update public.boards
  set last_activity_at = now(), deletion_warned_at = null
  where id = p_board_id::uuid
    and (last_activity_at is null or last_activity_at < now() - interval '10 minutes' or deletion_warned_at is not null);
end;
$$;
revoke all on function public.touch_board(text) from public;
grant execute on function public.touch_board(text) to authenticated;

-- Once per change (a whole cleared board is one change), not once per row.
create or replace function public.note_board_activity_batch()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  claims text;
begin
  begin
    claims := current_setting('request.jwt.claims', true);
    if claims is not null and claims <> '' and (claims::jsonb ->> 'role') = 'service_role' then
      return null;
    end if;
    update public.boards
    set last_activity_at = now(), deletion_warned_at = null
    where id in (select distinct board_id from changed_rows where board_id is not null)
      and (last_activity_at is null or last_activity_at < now() - interval '1 hour' or deletion_warned_at is not null);
  exception when others then
    null;
  end;
  return null;
end;
$$;

-- 4. Catching up after a reconnect -----------------------------------------

alter table public.strokes add column if not exists updated_at timestamptz not null default now();
alter table public.texts add column if not exists updated_at timestamptz not null default now();
alter table public.images add column if not exists updated_at timestamptz not null default now();
create index if not exists strokes_board_updated_idx on public.strokes (board_id, updated_at);
create index if not exists texts_board_updated_idx on public.texts (board_id, updated_at);
create index if not exists images_board_updated_idx on public.images (board_id, updated_at);

create or replace function public.set_updated_at()
returns trigger language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- What was rubbed out, kept a week (so someone coming back can catch up).
create table if not exists public.board_deletions (
  board_id uuid not null,
  kind text not null,
  item_id text not null,
  deleted_at timestamptz not null default now()
);
create index if not exists board_deletions_board_idx on public.board_deletions (board_id, deleted_at);
create index if not exists board_deletions_age_idx on public.board_deletions (deleted_at);
alter table public.board_deletions enable row level security;
drop policy if exists "board_deletions: read on my boards" on public.board_deletions;
create policy "board_deletions: read on my boards" on public.board_deletions for select to authenticated
  using (board_id in (select public.my_board_ids()));
grant select on public.board_deletions to authenticated;

create or replace function public.log_board_deletions()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  begin
    -- (not when the whole board is being deleted: nobody can catch up on it)
    insert into public.board_deletions (board_id, kind, item_id)
    select d.board_id, tg_table_name, d.id::text
    from changed_rows d
    where d.board_id is not null and exists (select 1 from public.boards b where b.id = d.board_id);
    if random() < 0.02 then
      delete from public.board_deletions where deleted_at < now() - interval '7 days';
    end if;
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
    execute format('drop trigger if exists %I on public.%I', t || '_note_board_activity', t);
    execute format('drop trigger if exists %I on public.%I', t || '_activity_insert', t);
    execute format('drop trigger if exists %I on public.%I', t || '_activity_update', t);
    execute format('drop trigger if exists %I on public.%I', t || '_activity_delete', t);
    execute format('drop trigger if exists %I on public.%I', t || '_log_deletions', t);
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I after insert on public.%I referencing new table as changed_rows for each statement execute function public.note_board_activity_batch()', t || '_activity_insert', t);
    execute format('create trigger %I after update on public.%I referencing new table as changed_rows for each statement execute function public.note_board_activity_batch()', t || '_activity_update', t);
    execute format('create trigger %I after delete on public.%I referencing old table as changed_rows for each statement execute function public.note_board_activity_batch()', t || '_activity_delete', t);
    execute format('create trigger %I after delete on public.%I referencing old table as changed_rows for each statement execute function public.log_board_deletions()', t || '_log_deletions', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
end $$;

-- Only what changed on a board since `p_since` (with "full" when it is
-- quicker to load the whole board again).
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
      select jsonb_agg(jsonb_build_object('id', i.id, 'x', i.x, 'y', i.y, 'width', i.width, 'height', i.height, 'src', i.src) order by i.created_at, i.id)
      from public.images i where i.board_id = p_board and i.updated_at > p_since), '[]'::jsonb),
    'deleted', coalesce((
      select jsonb_agg(jsonb_build_object('kind', d.kind, 'id', d.item_id))
      from public.board_deletions d where d.board_id = p_board and d.deleted_at > p_since), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.board_changes(uuid, timestamptz) from public;
grant execute on function public.board_changes(uuid, timestamptz) to authenticated;

-- 5. Opening a board: join (if opened from a link), mark it used, and its
--    settings, all in one request. (The preview picture isn't sent back:
--    only whether there is one.)
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
  select id, name, owner_id, grid_config, sim_embeds, background,
         case when thumbnail is null then null when thumbnail like 'data:%' then 'legacy' else thumbnail end as thumb
    into b
    from public.boards where id = p_board;
  if not found then
    return jsonb_build_object('found', false, 'now', now());
  end if;
  return jsonb_build_object(
    'found', true, 'now', now(), 'id', b.id, 'name', b.name, 'owner_id', b.owner_id,
    'grid_config', b.grid_config, 'sim_embeds', b.sim_embeds, 'background', b.background, 'thumbnail', b.thumb);
end;
$$;
revoke all on function public.open_board(uuid) from public;
grant execute on function public.open_board(uuid) to authenticated;

-- 6. The boards list, a page at a time --------------------------------------
drop function if exists public.list_boards(text, text, timestamptz, int);
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
      select id, name, created_at, owner_id, shared_with, background, thumbnail
      from public.boards
      where shared_with @> array[em] and owner_id is distinct from me
        and (pattern is null or coalesce(name, 'Untitled board') ilike pattern)
        and (p_before is null or (created_at, id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by created_at desc, id desc
      limit lim + 1) x;
    total := null;
  else
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc), '[]'::jsonb) into found from (
      select id, name, created_at, owner_id, shared_with, background, thumbnail
      from public.boards
      where owner_id = me
        and (pattern is null or coalesce(name, 'Untitled board') ilike pattern)
        and (p_before is null or (created_at, id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by created_at desc, id desc
      limit lim + 1) x;
    select count(*) into total from public.boards where owner_id = me
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

-- 7. Moving things ------------------------------------------------------------
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
    update public.strokes s
    set data = jsonb_set(s.data, '{points}', (
      select coalesce(jsonb_agg(
               case when jsonb_typeof(e.p) = 'object' and e.p ? 'x' and e.p ? 'y'
                    then e.p || jsonb_build_object('x', (e.p ->> 'x')::double precision + p_dx, 'y', (e.p ->> 'y')::double precision + p_dy)
                    else e.p end
               order by e.o), '[]'::jsonb)
      from jsonb_array_elements(s.data -> 'points') with ordinality as e(p, o)))
    where s.board_id = p_board and s.id = any (p_strokes) and jsonb_typeof(s.data -> 'points') = 'array';
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

-- 8. Settings out of the sign-in token ---------------------------------------
create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  settings jsonb,
  graph_presets jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
drop policy if exists "user_settings: own row" on public.user_settings;
create policy "user_settings: own row" on public.user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and not (select public.is_anon_user()));
grant select, insert, update on public.user_settings to authenticated;
drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

-- 9. Live classes and private live channels ----------------------------------
create table if not exists public.live_classes (
  code text primary key check (code ~ '^[A-Z0-9]{4,12}$'),
  board_id uuid not null references public.boards(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  opened_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists live_classes_board_idx on public.live_classes (board_id);
create index if not exists live_classes_teacher_idx on public.live_classes (teacher_id);
create table if not exists public.class_members (
  code text not null references public.live_classes(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  student_id text,
  name text,
  joined_at timestamptz not null default now(),
  primary key (code, user_id)
);
create index if not exists class_members_user_idx on public.class_members (user_id);
alter table public.live_classes enable row level security;
alter table public.class_members enable row level security;
-- (no rules: only the functions below read or change them)

-- The teacher opens a class for their board. 'ok', 'taken' (that code is
-- someone else's class: pick another) or 'denied'.
create or replace function public.open_class(p_code text, p_board uuid)
returns text language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c text := upper(btrim(coalesce(p_code, '')));
  n int;
begin
  if me is null or public.is_anon_user() or c !~ '^[A-Z0-9]{4,12}$' then
    return 'denied';
  end if;
  if not exists (select 1 from public.boards where id = p_board and owner_id = me) then
    return 'denied';
  end if;
  insert into public.live_classes (code, board_id, teacher_id) values (c, p_board, me)
  on conflict (code) do update set ended_at = null, opened_at = now(), board_id = excluded.board_id
    where public.live_classes.teacher_id = excluded.teacher_id;
  get diagnostics n = row_count;
  if n = 0 then
    return 'taken';
  end if;
  delete from public.live_classes where opened_at < now() - interval '30 days' and code <> c;
  return 'ok';
end;
$$;

create or replace function public.close_class(p_code text)
returns void language plpgsql volatile security definer set search_path = public
as $$
begin
  update public.live_classes set ended_at = now()
  where code = upper(btrim(coalesce(p_code, ''))) and teacher_id = auth.uid() and ended_at is null;
end;
$$;

-- A student (signed in invisibly) joins a class by its code.
create or replace function public.join_class(p_code text, p_student_id text, p_name text)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c text := upper(btrim(coalesce(p_code, '')));
  cls record;
begin
  if me is null then
    return jsonb_build_object('status', 'signed_out');
  end if;
  select code, board_id, ended_at, opened_at into cls from public.live_classes where code = c;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if cls.ended_at is not null or cls.opened_at < now() - interval '1 day' then
    return jsonb_build_object('status', 'ended');
  end if;
  insert into public.class_members (code, user_id, student_id, name)
  values (c, me, left(coalesce(p_student_id, ''), 80), left(coalesce(p_name, 'Student'), 60))
  on conflict (code, user_id) do update set student_id = excluded.student_id, name = excluded.name;
  return jsonb_build_object('status', 'ok', 'board_id', cls.board_id);
end;
$$;

-- May the signed-in person use this live channel? (Checked by Supabase when
-- a channel is joined, through the two rules on realtime.messages below.)
--   board-<board id>                  people who can use the board, and
--                                     students in a live class on it
--   classroom-<code>                  the class's teacher and students
--   board-student-<code>-<student>    a student's own board in that class
create or replace function public.can_use_channel(p_topic text)
returns boolean language plpgsql stable security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  m text[];
begin
  if me is null or p_topic is null then
    return false;
  end if;
  m := regexp_match(p_topic, '^board-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$');
  if m is not null then
    return public.can_use_board(m[1]::uuid)
      or exists (
        select 1 from public.live_classes c join public.class_members cm on cm.code = c.code
        where c.board_id = m[1]::uuid and c.ended_at is null and c.opened_at > now() - interval '1 day' and cm.user_id = me);
  end if;
  m := regexp_match(p_topic, '^(?:classroom|board-student)-([A-Z0-9]{4,12})(?:-.+)?$');
  if m is not null then
    return exists (select 1 from public.live_classes c where c.code = m[1] and c.teacher_id = me)
      or exists (select 1 from public.class_members cm where cm.code = m[1] and cm.user_id = me);
  end if;
  return false;
end;
$$;

revoke all on function public.open_class(text, uuid) from public;
revoke all on function public.close_class(text) from public;
revoke all on function public.join_class(text, text, text) from public;
revoke all on function public.can_use_channel(text) from public;
grant execute on function public.open_class(text, uuid) to authenticated;
grant execute on function public.close_class(text) to authenticated;
grant execute on function public.join_class(text, text, text) to authenticated;
grant execute on function public.can_use_channel(text) to authenticated;

drop policy if exists "clean slate: listen on live channels" on realtime.messages;
drop policy if exists "clean slate: send on live channels" on realtime.messages;
create policy "clean slate: listen on live channels" on realtime.messages for select to authenticated
  using (public.can_use_channel((select realtime.topic())));
create policy "clean slate: send on live channels" on realtime.messages for insert to authenticated
  with check (public.can_use_channel((select realtime.topic())));

-- The app asks this to know the private channels are set up.
create or replace function public.live_config()
returns jsonb language sql stable
as $$ select jsonb_build_object('private', true, 'version', 1) $$;
grant execute on function public.live_config() to anon, authenticated;

-- 10. Storage -------------------------------------------------------------------
-- board-images: pictures, previews and fonts go in a board's own folder
-- (boards you can use) or your own fonts folder. Students' invisible
-- sign-ins can't upload.
-- (every rule that lets people add or change files in board-images goes:
-- they are replaced below)
do $$
declare
  p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and cmd in ('INSERT', 'UPDATE', 'ALL')
             and (coalesce(qual, '') like '%board-images%' or coalesce(with_check, '') like '%board-images%') loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;
create policy "board images: upload to my boards" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'board-images' and not (select public.is_anon_user()) and (
      ((storage.foldername(name))[1] = 'fonts' and (storage.foldername(name))[2] = (select auth.uid())::text)
      or public.can_use_board_folder((storage.foldername(name))[1])));
create policy "board images: replace on my boards" on storage.objects for update to authenticated
  using (
    bucket_id = 'board-images' and not (select public.is_anon_user()) and (
      ((storage.foldername(name))[1] = 'fonts' and (storage.foldername(name))[2] = (select auth.uid())::text)
      or public.can_use_board_folder((storage.foldername(name))[1])));

-- 11. Share suggestions: only people you already share boards with ------------
create or replace function public.share_suggestions(p_query text)
returns setof text language sql stable security definer set search_path = public
as $$
  with me as (select auth.uid() as uid, public.my_email() as em),
  people as (
    select unnest(b.shared_with) as e from public.boards b, me where b.owner_id = me.uid
    union
    select unnest(b.shared_with) from public.boards b, me where me.em is not null and b.shared_with @> array[me.em]
    union
    select p.email from public.boards b join public.profiles p on p.id = b.owner_id, me
    where me.em is not null and b.shared_with @> array[me.em]
  )
  select distinct lower(e) from people, me
  where e is not null and lower(e) is distinct from me.em
    and length(btrim(coalesce(p_query, ''))) >= 1
    and lower(e) like '%' || replace(replace(replace(lower(btrim(p_query)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  limit 5
$$;
revoke all on function public.share_suggestions(text) from public;
grant execute on function public.share_suggestions(text) to authenticated;

commit;

-- Check it worked (just a report — changes nothing):
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('strokes', 'texts', 'images')) as "board content rules (12 expected)",
  (select count(*) from pg_policies where schemaname = 'realtime' and policyname like 'clean slate:%') as "live channel rules (2 expected)",
  (select count(*) from pg_indexes where schemaname = 'public' and indexname like '%board_created_idx') as "new board indexes (3 expected)",
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'boards') as "board rules (4 expected)",
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles') as "profile rules (1 expected)",
  (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'board images:%') as "picture upload rules (2 expected)",
  (select public.live_config() ->> 'private') as "private live channels ready";
