-- Notebooks, part 2: share by link (November 2026)
--
-- A notebook can now be shared with a link (see src/components/NotebookShare.js
-- and src/app/n/[token]/page.js):
--   - "Anyone with the link can look": the link opens a read-only copy for
--     anyone, with no account (open_shared_notebook);
--   - "…and write on it": someone signed in who opens the link is added to
--     the notebook (join_notebook_link), the same as being added by email;
--   - the owner can turn the link off, or swap it for a new one, any time.
-- This file adds:
--   1. boards.share_token and boards.share_mode ('off', 'view' or 'edit');
--   2. join_board_via_link no longer adds people to a *notebook* just for
--      opening its address (a notebook is private unless shared by email or
--      by its link; ordinary boards work exactly as before);
--   3. notebook_link (the owner turns the link on, off, or makes a new one);
--   4. open_shared_notebook / shared_notebook_stamp (reading it by link, no
--      account needed) and join_notebook_link (writing on it by link);
--   5. list_notebooks also says whether each notebook's link is on.
--
-- Run after 2026-11-notebooks.sql. Safe to run more than once.
-- Supabase: SQL Editor, New query, paste, Run.

begin;

-- 1. The link -------------------------------------------------------------------
alter table public.boards add column if not exists share_token text;
alter table public.boards add column if not exists share_mode text not null default 'off';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'boards_share_mode_check') then
    alter table public.boards add constraint boards_share_mode_check check (share_mode in ('off', 'view', 'edit'));
  end if;
end $$;
create unique index if not exists boards_share_token_idx on public.boards (share_token) where share_token is not null;

-- 2. Opening a notebook's address doesn't add you to it ---------------------------
create or replace function public.join_board_via_link(board_id uuid)
returns void language plpgsql security definer set search_path = public
as $function$
declare
  caller_email text;
begin
  caller_email := lower(auth.jwt() ->> 'email');
  if caller_email is null then
    raise exception 'Not authenticated';
  end if;
  update boards set shared_with = array(select distinct unnest(shared_with || array[caller_email]))
   where id = board_id and owner_id <> auth.uid() and coalesce(kind, 'board') <> 'notebook';
end;
$function$;

-- 3. The owner turns the link on or off ------------------------------------------
-- p_mode: 'off', 'view' or 'edit'. p_new: replace the link with a new one
-- (the old one stops working). Returns { mode, token }, or null if this
-- isn't your notebook.
create or replace function public.notebook_link(p_board uuid, p_mode text, p_new boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  b record;
  tok text;
begin
  if auth.uid() is null or p_mode not in ('off', 'view', 'edit') then
    return null;
  end if;
  select id, share_token into b from public.boards
   where id = p_board and owner_id = auth.uid() and kind = 'notebook'
   for update;
  if not found then
    return null;
  end if;
  tok := b.share_token;
  if (tok is null or p_new) and p_mode <> 'off' then
    -- 32 random letters and digits (gen_random_uuid is built in)
    tok := replace(gen_random_uuid()::text, '-', '');
  end if;
  update public.boards set share_mode = p_mode, share_token = tok where id = b.id;
  return jsonb_build_object('mode', p_mode, 'token', tok);
end;
$$;
revoke all on function public.notebook_link(uuid, text, boolean) from public;
grant execute on function public.notebook_link(uuid, text, boolean) to authenticated;

-- 4a. Reading a notebook by its link (anyone) ---------------------------------------
-- Everything on it, in one go, or null when the link is off or unknown.
create or replace function public.open_shared_notebook(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  b record;
  me uuid := auth.uid();
  em text := lower(auth.jwt() ->> 'email');
begin
  if p_token is null or length(p_token) < 16 or length(p_token) > 64 then
    return null;
  end if;
  select id, name, owner_id, notebook, background, grid_config, share_mode, shared_with
    into b from public.boards
   where share_token = p_token and share_mode in ('view', 'edit') and kind = 'notebook';
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', b.id, 'name', b.name, 'notebook', b.notebook, 'background', b.background,
    'grid_config', b.grid_config, 'mode', b.share_mode,
    'mine', me is not null and b.owner_id = me,
    'member', me is not null and (b.owner_id = me or (em is not null and b.shared_with @> array[em])),
    'stamp', public.shared_notebook_stamp(p_token),
    'strokes', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'data', s.data) order by s.created_at, s.id)
                         from public.strokes s where s.board_id = b.id), '[]'::jsonb),
    'texts', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'x', t.x, 'y', t.y, 'text', t.text, 'color', t.color,
                                                           'font_size', t.font_size, 'width', t.width, 'rotation', t.rotation)
                                        order by t.created_at, t.id)
                       from public.texts t where t.board_id = b.id), '[]'::jsonb),
    'images', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'x', i.x, 'y', i.y, 'width', i.width,
                                                            'height', i.height, 'src', i.src) order by i.created_at, i.id)
                        from public.images i where i.board_id = b.id), '[]'::jsonb));
end;
$$;

-- 4b. Has it changed? (a few characters, asked every so often by someone
-- reading it, so the whole notebook is only fetched again when it has)
create or replace function public.shared_notebook_stamp(p_token text)
returns text language sql stable security definer set search_path = public
as $$
  select coalesce(b.notebook ->> 'rev', '0') || ':' || coalesce(md5(b.name || coalesce(b.background, '') || coalesce(b.grid_config::text, '')), '') || ':' ||
         coalesce((select max(updated_at)::text from public.strokes where board_id = b.id), '') || ':' ||
         coalesce((select count(*)::text from public.strokes where board_id = b.id), '') || ':' ||
         coalesce((select max(updated_at)::text from public.texts where board_id = b.id), '') || ':' ||
         coalesce((select count(*)::text from public.texts where board_id = b.id), '') || ':' ||
         coalesce((select max(updated_at)::text from public.images where board_id = b.id), '') || ':' ||
         coalesce((select count(*)::text from public.images where board_id = b.id), '')
  from public.boards b
  where b.share_token = p_token and b.share_mode in ('view', 'edit') and b.kind = 'notebook'
$$;

-- (created after 4b, which 4a uses)
revoke all on function public.shared_notebook_stamp(text) from public;
grant execute on function public.shared_notebook_stamp(text) to anon, authenticated;
revoke all on function public.open_shared_notebook(text) from public;
grant execute on function public.open_shared_notebook(text) to anon, authenticated;

-- 4c. Writing on it by link (signed in, not a student's invisible sign-in) ---------
-- Returns { board } once you can open it (you're added when the link lets
-- people write), or { board: null, reason: 'off' | 'view' | 'signin' }.
create or replace function public.join_notebook_link(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  b record;
  me uuid := auth.uid();
  em text := lower(auth.jwt() ->> 'email');
begin
  if me is null or em is null or public.is_anon_user() then
    return jsonb_build_object('board', null, 'reason', 'signin');
  end if;
  if p_token is null or length(p_token) < 16 or length(p_token) > 64 then
    return jsonb_build_object('board', null, 'reason', 'off');
  end if;
  select id, owner_id, share_mode, shared_with into b from public.boards
   where share_token = p_token and share_mode in ('view', 'edit') and kind = 'notebook'
   for update;
  if not found then
    return jsonb_build_object('board', null, 'reason', 'off');
  end if;
  if b.owner_id = me or b.shared_with @> array[em] then
    return jsonb_build_object('board', b.id);
  end if;
  if b.share_mode <> 'edit' then
    return jsonb_build_object('board', null, 'reason', 'view');
  end if;
  update public.boards set shared_with = array(select distinct unnest(shared_with || array[em])) where id = b.id;
  return jsonb_build_object('board', b.id);
end;
$$;
revoke all on function public.join_notebook_link(text) from public;
grant execute on function public.join_notebook_link(text) to authenticated;

-- 5. The shelf shows which notebooks have their link on ------------------------------
create or replace function public.list_notebooks()
returns jsonb language sql stable security invoker set search_path = public
as $$
  select jsonb_build_object(
    'notebooks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'name', b.name, 'created_at', b.created_at, 'used_at', coalesce(b.last_activity_at, b.created_at),
               'subject_id', b.subject_id, 'shared_with', b.shared_with, 'thumbnail', b.thumbnail, 'background', b.background,
               'cover', b.notebook -> 'cover', 'size', b.notebook ->> 'size', 'share_mode', b.share_mode,
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

-- Check it worked (just a report, changes nothing). Expect true, 4, true.
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'boards' and column_name = 'share_mode') as "link column",
  (select count(*) from pg_proc where proname in ('notebook_link', 'open_shared_notebook', 'shared_notebook_stamp', 'join_notebook_link')) as "new functions (4)",
  position('notebook' in (select prosrc from pg_proc where proname = 'join_board_via_link' limit 1)) > 0 as "notebook addresses private";
