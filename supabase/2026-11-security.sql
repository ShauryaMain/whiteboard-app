-- Security overhaul (November 2026)
--
--   1. Limits on sign-in emails and feedback, counted in the database
--      (they used to be counted separately by each copy of the server).
--   2. Board links:
--        - each board has a link switch ("anyone with the link can edit"),
--          used through a link of its own: /b/<token>;
--        - boards made before this keep working by their plain address
--          until the owner switches the link off (or a live class is run
--          on them: students in a live class see the board's address);
--        - new boards are private until the owner copies the link;
--        - a board's owner can't hand it to someone else's account.
--   3. Live classes: only the teacher can send on the class's teacher
--      channel; students can watch the teacher's board but not send on
--      it; a student's own board takes messages only from that student
--      and the teacher.
--   4. Private files: file_access() says which stored files (pictures,
--      PDFs, homework pages, previews, fonts) someone may open. The app's
--      /api/files/sign route asks it, then hands out links that expire.
--
-- Run after the November clipping files. Safe to run more than once.
-- Run it when no live class is on (teachers reload their board after).
-- Supabase: SQL Editor, New query, paste, Run.
--
-- After it has run AND the new app version is live: Storage, the
-- board-images and reference-docs buckets, Edit bucket, turn "Public
-- bucket" off (see claude/security-overhaul-status.md).

begin;

-- 1. Rate limits ------------------------------------------------------------------
-- One row per counted action. The key is a hash (no email addresses or IP
-- addresses are kept). Only the server (service role) can use it.
create table if not exists public.rate_hits (
  key text not null,
  at timestamptz not null default now()
);
create index if not exists rate_hits_key_idx on public.rate_hits (key, at desc);
alter table public.rate_hits enable row level security;
revoke all on public.rate_hits from anon, authenticated;

-- p_rules: [{ "key": "...", "max": 5, "seconds": 3600 }, ...]
-- All of them must have room; then each is counted once. Returns
-- { ok: true } or { ok: false, key, retry_after (seconds) }.
create or replace function public.rate_take(p_rules jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  r jsonb;
  k text;
  lim int;
  secs int;
  used int;
  oldest timestamptz;
begin
  if coalesce(jsonb_typeof(p_rules), '') <> 'array' or jsonb_array_length(p_rules) = 0 or jsonb_array_length(p_rules) > 10 then
    raise exception 'Bad rules';
  end if;
  for r in select value from jsonb_array_elements(p_rules) loop
    k := left(coalesce(r ->> 'key', ''), 200);
    lim := greatest(coalesce((r ->> 'max')::int, 0), 0);
    secs := least(greatest(coalesce((r ->> 'seconds')::int, 60), 1), 7 * 86400);
    if k = '' then
      raise exception 'Bad rule';
    end if;
    -- one at a time per key, so many requests at once can't all slip through
    perform pg_advisory_xact_lock(hashtextextended('rate:' || k, 0));
    select count(*), min(at) into used, oldest from public.rate_hits where key = k and at > now() - make_interval(secs => secs);
    if used >= lim then
      return jsonb_build_object('ok', false, 'key', k,
        'retry_after', greatest(1, ceil(extract(epoch from (coalesce(oldest, now()) + make_interval(secs => secs) - now())))::int));
    end if;
  end loop;
  insert into public.rate_hits (key) select value ->> 'key' from jsonb_array_elements(p_rules);
  -- tidy up now and then
  if random() < 0.02 then
    delete from public.rate_hits where at < now() - interval '8 days';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.rate_take(jsonb) from public, anon, authenticated;
grant execute on function public.rate_take(jsonb) to service_role;

-- 2. Board links ------------------------------------------------------------------
-- link_legacy: the board still works by its plain address (/board/<id>),
-- as every board did before this file. True for boards that already
-- exist when this is first run; new boards start without it.
do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'boards' and column_name = 'link_legacy') then
    alter table public.boards add column link_legacy boolean not null default false;
    update public.boards set link_legacy = true where coalesce(kind, 'board') <> 'notebook';
  end if;
end $$;

-- An owner changes their own board, and it stays theirs.
drop policy if exists "boards: owner updates" on public.boards;
create policy "boards: owner updates" on public.boards for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Opening a board's plain address adds you only when the board is an
-- old one whose link is still on, and it has never had a live class.
create or replace function public.join_board_via_link(board_id uuid)
returns void language plpgsql security definer set search_path = public
as $function$
declare
  caller_email text;
begin
  caller_email := lower(auth.jwt() ->> 'email');
  if caller_email is null or public.is_anon_user() then
    raise exception 'Not authenticated';
  end if;
  update boards set shared_with = array(select distinct unnest(shared_with || array[caller_email]))
   where id = board_id and owner_id <> auth.uid() and coalesce(kind, 'board') <> 'notebook'
     and link_legacy;
end;
$function$;

-- The owner's link switch. p_on: true (on), false (off) or null (just
-- say how it is). p_new: a new link (the old one stops working).
-- Returns { on, token, legacy }, or null if this isn't your board.
create or replace function public.board_link(p_board uuid, p_on boolean default null, p_new boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  b record;
  tok text;
begin
  if not public.signed_in_for_real() then
    return null;
  end if;
  select id, share_token, share_mode, link_legacy into b from public.boards
   where id = p_board and owner_id = auth.uid() and coalesce(kind, 'board') <> 'notebook'
   for update;
  if not found then
    return null;
  end if;
  if p_on is null then
    return jsonb_build_object('on', b.share_mode = 'edit' or b.link_legacy, 'token', case when b.share_mode = 'edit' then b.share_token end,
                              'legacy', b.link_legacy);
  end if;
  if not p_on then
    update public.boards set share_mode = 'off', link_legacy = false where id = b.id;
    return jsonb_build_object('on', false, 'token', null, 'legacy', false);
  end if;
  tok := b.share_token;
  if tok is null or p_new then
    tok := replace(gen_random_uuid()::text, '-', '');
  end if;
  update public.boards set share_mode = 'edit', share_token = tok,
         link_legacy = case when p_new then false else link_legacy end
   where id = b.id;
  return jsonb_build_object('on', true, 'token', tok, 'legacy', case when p_new then false else b.link_legacy end);
end;
$$;
revoke all on function public.board_link(uuid, boolean, boolean) from public;
grant execute on function public.board_link(uuid, boolean, boolean) to authenticated;

-- What a board link is (for its page, before signing in): the board's
-- name, and whether you're already on it. Null when the link is off.
create or replace function public.board_link_peek(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  b record;
  me uuid := auth.uid();
  em text := public.my_email();
begin
  if p_token is null or length(p_token) < 16 or length(p_token) > 64 then
    return null;
  end if;
  select id, name, owner_id, shared_with into b from public.boards
   where share_token = p_token and share_mode = 'edit' and coalesce(kind, 'board') <> 'notebook';
  if not found then
    return null;
  end if;
  return jsonb_build_object('name', coalesce(nullif(btrim(b.name), ''), 'Untitled board'),
    'member', me is not null and (b.owner_id = me or (em is not null and b.shared_with @> array[em])));
end;
$$;
revoke all on function public.board_link_peek(text) from public;
grant execute on function public.board_link_peek(text) to anon, authenticated;

-- Writing on a board from its link. { board } or { board: null, reason:
-- 'signin' | 'off' }.
create or replace function public.join_board_link(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  b record;
  me uuid := auth.uid();
  em text := public.my_email();
begin
  if not public.signed_in_for_real() or em is null then
    return jsonb_build_object('board', null, 'reason', 'signin');
  end if;
  if p_token is null or length(p_token) < 16 or length(p_token) > 64 then
    return jsonb_build_object('board', null, 'reason', 'off');
  end if;
  select id, owner_id, shared_with into b from public.boards
   where share_token = p_token and share_mode = 'edit' and coalesce(kind, 'board') <> 'notebook'
   for update;
  if not found then
    return jsonb_build_object('board', null, 'reason', 'off');
  end if;
  if b.owner_id <> me and not (b.shared_with @> array[em]) then
    update public.boards set shared_with = array(select distinct unnest(shared_with || array[em])) where id = b.id;
  end if;
  return jsonb_build_object('board', b.id);
end;
$$;
revoke all on function public.join_board_link(text) from public;
grant execute on function public.join_board_link(text) to authenticated;

-- A live class shows its board's address to every student, so running
-- one ends joining that board by its plain address (its /b/ link still
-- works, if it's on).
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
  update public.boards set link_legacy = false where id = p_board and link_legacy;
  delete from public.live_classes where opened_at < now() - interval '30 days' and code <> c;
  return 'ok';
end;
$$;
revoke all on function public.open_class(text, uuid) from public;
grant execute on function public.open_class(text, uuid) to authenticated;

-- 3. Live classes: who can send where ----------------------------------------------
--   board-<board id>                  people who can use the board (students
--                                     in a live class on it only listen)
--   classroom-<code>                  the teacher and the students
--   classroom-<code>-teacher          the teacher only
--   board-student-<code>-<student>    that student, and the teacher
create or replace function public.can_send_channel(p_topic text)
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
    return public.can_use_board(m[1]::uuid);
  end if;
  m := regexp_match(p_topic, '^classroom-([A-Z0-9]{4,12})-teacher$');
  if m is not null then
    return exists (select 1 from public.live_classes c where c.code = m[1] and c.teacher_id = me);
  end if;
  m := regexp_match(p_topic, '^classroom-([A-Z0-9]{4,12})$');
  if m is not null then
    return exists (select 1 from public.live_classes c where c.code = m[1] and c.teacher_id = me)
      or exists (select 1 from public.class_members cm where cm.code = m[1] and cm.user_id = me);
  end if;
  m := regexp_match(p_topic, '^board-student-([A-Z0-9]{4,12})-(.+)$');
  if m is not null then
    return exists (select 1 from public.live_classes c where c.code = m[1] and c.teacher_id = me)
      or exists (select 1 from public.class_members cm where cm.code = m[1] and cm.user_id = me and cm.student_id = m[2]);
  end if;
  return false;
end;
$$;
revoke all on function public.can_send_channel(text) from public;
grant execute on function public.can_send_channel(text) to authenticated;

drop policy if exists "clean slate: send on live channels" on realtime.messages;
create policy "clean slate: send on live channels" on realtime.messages for insert to authenticated
  with check (public.can_send_channel((select realtime.topic())));

-- version 2: the app puts the teacher's class messages on the teacher channel
create or replace function public.live_config()
returns jsonb language sql stable
as $$ select jsonb_build_object('private', true, 'version', 2) $$;
grant execute on function public.live_config() to anon, authenticated;

-- 4. Private files ------------------------------------------------------------------
-- p_files: 'bucket/path' strings (up to 300). p_token: a notebook's
-- reading link, for someone reading it by link. Returns the ones this
-- person may open:
--   board-images/<board>/…, reference-docs/<board>/…
--       you can use the board; or it's the notebook whose link you have;
--       or you're a student in a live class running on it
--   board-images/clips/<teacher>/…
--       you sent it; or it's in a notebook you can open (or have the link to)
--   board-images/fonts/<user>/…
--       anyone (uploaded fonts, used in text anyone on a board can see)
create or replace function public.file_access(p_files text[], p_token text default null)
returns text[] language plpgsql stable security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  link_board uuid;
  f text;
  bucket text;
  path text;
  parts text[];
  ok boolean;
  allowed text[] := '{}';
  checked jsonb := '{}'::jsonb; -- board id -> true/false, so each board is checked once
  key text;
begin
  if p_files is null or cardinality(p_files) = 0 then
    return allowed;
  end if;
  if cardinality(p_files) > 300 then
    raise exception 'Up to 300 files at a time';
  end if;
  if p_token is not null and length(p_token) between 16 and 64 then
    select id into link_board from public.boards
     where share_token = p_token and share_mode in ('view', 'edit') and kind = 'notebook';
  end if;
  foreach f in array p_files loop
    ok := false;
    bucket := split_part(f, '/', 1);
    path := substr(f, length(bucket) + 2);
    if bucket not in ('board-images', 'reference-docs') or path = '' or length(path) > 400 or path ~ '(^|/)\.\.(/|$)' then
      continue;
    end if;
    parts := string_to_array(path, '/');
    if bucket = 'board-images' and parts[1] = 'fonts' then
      ok := cardinality(parts) >= 3;
    elsif bucket = 'board-images' and parts[1] = 'clips' then
      if cardinality(parts) >= 3 then
        ok := me is not null and parts[2] = me::text;
        if not ok then
          ok := exists (
            select 1 from public.clips c
              join public.clip_submissions s on s.clip_id = c.id
             where c.teacher_id::text = parts[2]
               and exists (select 1 from jsonb_array_elements(c.pages) pg where pg ->> 'path' = path)
               and s.board_id is not null
               and (s.board_id = link_board or (me is not null and public.can_use_board(s.board_id))));
        end if;
      end if;
    elsif parts[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and cardinality(parts) >= 2 then
      key := lower(parts[1]);
      if checked ? key then
        ok := (checked ->> key)::boolean;
      else
        ok := (link_board is not null and link_board = key::uuid)
          or (me is not null and public.can_use_board(key::uuid))
          or (me is not null and exists (
                select 1 from public.live_classes c join public.class_members cm on cm.code = c.code
                 where c.board_id = key::uuid and c.ended_at is null and c.opened_at > now() - interval '1 day' and cm.user_id = me));
        checked := checked || jsonb_build_object(key, ok);
      end if;
    end if;
    if ok then
      allowed := allowed || f;
    end if;
  end loop;
  return allowed;
end;
$$;
revoke all on function public.file_access(text[], text) from public;
grant execute on function public.file_access(text[], text) to anon, authenticated;

-- Uploading a worksheet reads the file back as it's saved (as board-images
-- does): the board's people can read its folder.
drop policy if exists "reference docs: read on my boards" on storage.objects;
create policy "reference docs: read on my boards" on storage.objects for select to authenticated
  using (bucket_id = 'reference-docs' and not (select public.is_anon_user()) and public.can_use_board_folder((storage.foldername(name))[1]));

commit;

-- Check it worked (just a report, changes nothing).
-- Expect: true, 5, 2, true, true, 2
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'boards' and column_name = 'link_legacy') as "link column",
  (select count(*) from pg_proc where proname in ('rate_take', 'board_link', 'board_link_peek', 'join_board_link', 'file_access')) as "new functions (5)",
  (select count(*) from pg_policies where (schemaname = 'realtime' and policyname = 'clean slate: send on live channels' and with_check like '%can_send_channel%')
     or (schemaname = 'storage' and policyname = 'reference docs: read on my boards')) as "new rules (2)",
  (select with_check is not null from pg_policies where schemaname = 'public' and tablename = 'boards' and policyname = 'boards: owner updates') as "boards stay their owner's",
  position('link_legacy' in (select prosrc from pg_proc where proname = 'open_class' limit 1)) > 0 as "live class boards private",
  (select (public.live_config() ->> 'version')::int) as "live version (2)";
