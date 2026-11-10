-- Clipping: teachers, classes and homework in notebooks (November 2026)
--
-- Teachers can now put work straight into their students' notebooks
-- ("clipping"), set it as homework with a due date, and mark it.
--
--   1. Classes: a teacher makes a class; students join it with a code and
--      each gets a class notebook (their own) that the teacher can reach.
--   2. One student (1:1 tutoring): a teacher makes a notebook for a student
--      and sends an invite link; when the student opens it, it becomes theirs.
--   3. A student can share one of their notebooks with a teacher (by the
--      teacher's email or a class code), letting them look, or look, add
--      work and mark it. The teacher accepts; the student can remove them.
--   4. Clips: pages a teacher sends into notebooks (a worksheet, part of a
--      board, pages of their own notebook). A clip is a resource, or
--      homework with a due date that the student hands in.
--   5. Marking: the teacher writes on the student's pages (their marks are
--      locked for the student), gives a score and a comment, and returns it.
--
-- The student always owns their notebook. A teacher reaches it only while
-- they are linked to it (notebook_teachers); the student can see and remove
-- that link. The new tables can't be read or changed directly: everything
-- goes through the functions below, which check who is asking.
--
-- Run after 2026-11-notebooks.sql and 2026-11-notebooks-sharing.sql.
-- Safe to run more than once. Supabase: SQL Editor, New query, paste, Run.

begin;

-- 0. Helpers -------------------------------------------------------------------

-- Your name as others see it: the name in Settings, else the start of
-- your email.
create or replace function public.my_display_name()
returns text language sql stable security definer set search_path = public
as $$
  select coalesce(
    nullif(btrim(left(u.raw_user_meta_data ->> 'display_name', 60)), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Someone')
  from auth.users u where u.id = auth.uid()
$$;
revoke all on function public.my_display_name() from public;
grant execute on function public.my_display_name() to authenticated;

create or replace function public.signed_in_for_real()
returns boolean language sql stable
as $$ select auth.uid() is not null and not public.is_anon_user() $$;

-- 1. Tables --------------------------------------------------------------------

create table if not exists public.class_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  code text not null,
  teacher_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists class_groups_code_idx on public.class_groups (code);
create index if not exists class_groups_owner_idx on public.class_groups (owner_id, created_at);

create table if not exists public.class_group_members (
  class_id uuid not null references public.class_groups(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  board_id uuid references public.boards(id) on delete set null,
  name text,
  email text,
  joined_at timestamptz not null default now(),
  primary key (class_id, student_id)
);
create index if not exists class_group_members_student_idx on public.class_group_members (student_id);

-- A teacher linked to a notebook. teacher_id is empty while a student's
-- request waits for a teacher who hasn't signed up yet (teacher_email).
create table if not exists public.notebook_teachers (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  teacher_id uuid references auth.users(id) on delete cascade,
  teacher_email text,
  class_id uuid references public.class_groups(id) on delete cascade,
  permission text not null default 'assign' check (permission in ('view', 'assign')),
  status text not null default 'active' check (status in ('requested', 'active')),
  teacher_name text,
  student_name text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (teacher_id is not null or teacher_email is not null)
);
create unique index if not exists notebook_teachers_board_teacher_idx on public.notebook_teachers (board_id, teacher_id) where teacher_id is not null;
create unique index if not exists notebook_teachers_board_email_idx on public.notebook_teachers (board_id, teacher_email) where teacher_id is null;
create index if not exists notebook_teachers_teacher_idx on public.notebook_teachers (teacher_id, status);
create index if not exists notebook_teachers_email_idx on public.notebook_teachers (teacher_email) where teacher_id is null;

-- A notebook a teacher made for one student, until the student claims it.
create table if not exists public.notebook_invites (
  token text primary key,
  board_id uuid not null references public.boards(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  student_label text,
  created_at timestamptz not null default now(),
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz
);
create unique index if not exists notebook_invites_board_idx on public.notebook_invites (board_id);

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid references public.class_groups(id) on delete set null,
  kind text not null default 'homework' check (kind in ('resource', 'homework')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  note text check (note is null or char_length(note) <= 2000),
  due_at timestamptz,
  max_score numeric check (max_score is null or (max_score > 0 and max_score <= 1000)),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array' and octet_length(questions::text) <= 20000),
  pages jsonb not null check (jsonb_typeof(pages) = 'array' and octet_length(pages::text) <= 40000),
  teacher_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists clips_teacher_idx on public.clips (teacher_id, created_at desc);
create index if not exists clips_class_idx on public.clips (class_id, created_at desc) where class_id is not null;

create table if not exists public.clip_submissions (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips(id) on delete cascade,
  board_id uuid references public.boards(id) on delete set null,
  student_id uuid references auth.users(id) on delete set null,
  student_name text,
  page_ids text[] not null default '{}',
  status text not null default 'assigned' check (status in ('assigned', 'handed_in', 'returned')),
  handed_in_at timestamptz,
  edited_after boolean not null default false,
  returned_at timestamptz,
  score numeric check (score is null or (score >= 0 and score <= 1000)),
  comment text check (comment is null or char_length(comment) <= 2000),
  question_scores jsonb not null default '{}'::jsonb check (jsonb_typeof(question_scores) = 'object' and octet_length(question_scores::text) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists clip_submissions_clip_board_idx on public.clip_submissions (clip_id, board_id);
create index if not exists clip_submissions_board_idx on public.clip_submissions (board_id);
create index if not exists clip_submissions_student_idx on public.clip_submissions (student_id, status);

-- Nobody reads or changes these tables directly (no rules = no access):
-- only through the functions below.
alter table public.class_groups enable row level security;
alter table public.class_group_members enable row level security;
alter table public.notebook_teachers enable row level security;
alter table public.notebook_invites enable row level security;
alter table public.clips enable row level security;
alter table public.clip_submissions enable row level security;
revoke all on public.class_groups, public.class_group_members, public.notebook_teachers,
  public.notebook_invites, public.clips, public.clip_submissions from anon, authenticated;

-- 2. Who wrote what -----------------------------------------------------------------
-- Every new stroke, text box and picture remembers who added it. A teacher's
-- marks on a student's notebook can't be moved, changed or rubbed out by
-- anyone else (the rules in section 4).
alter table public.strokes add column if not exists author_id uuid default auth.uid();
alter table public.texts add column if not exists author_id uuid default auth.uid();
alter table public.images add column if not exists author_id uuid default auth.uid();

-- 3. Teachers can open the notebooks they're linked to -----------------------------

create or replace function public.my_teacher_board_ids()
returns setof uuid language sql stable security definer set search_path = public
as $$ select board_id from public.notebook_teachers where teacher_id = auth.uid() and status = 'active' $$;

-- the ones where you may only look
create or replace function public.my_view_only_board_ids()
returns setof uuid language sql stable security definer set search_path = public
as $$
  select nt.board_id from public.notebook_teachers nt
  where nt.teacher_id = auth.uid() and nt.status = 'active' and nt.permission = 'view'
    and not exists (select 1 from public.boards b where b.id = nt.board_id and b.owner_id = auth.uid())
$$;

-- the ones you reach only as a teacher (not yours, not shared with you):
-- there you change only what you added yourself
create or replace function public.my_teach_only_board_ids()
returns setof uuid language sql stable security definer set search_path = public
as $$
  select nt.board_id from public.notebook_teachers nt
  where nt.teacher_id = auth.uid() and nt.status = 'active'
    and not exists (select 1 from public.boards b where b.id = nt.board_id
                    and (b.owner_id = auth.uid() or (public.my_email() is not null and b.shared_with @> array[public.my_email()])))
$$;

-- Is this person a teacher linked to this notebook?
create or replace function public.is_notebook_teacher(p_board uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select p_board is not null and p_user is not null and exists (
    select 1 from public.notebook_teachers where board_id = p_board and teacher_id = p_user and status = 'active')
$$;

-- Every board the signed-in person may use: their own, the ones shared
-- with their email, and notebooks they teach.
create or replace function public.my_board_ids()
returns setof uuid language sql stable security definer set search_path = public
as $$
  select id from public.boards where owner_id = auth.uid()
  union
  select id from public.boards where public.my_email() is not null and shared_with @> array[public.my_email()]
  union
  select board_id from public.notebook_teachers where teacher_id = auth.uid() and status = 'active'
$$;

revoke all on function public.my_teacher_board_ids() from public;
revoke all on function public.my_view_only_board_ids() from public;
revoke all on function public.my_teach_only_board_ids() from public;
revoke all on function public.is_notebook_teacher(uuid, uuid) from public;
revoke all on function public.my_board_ids() from public;
grant execute on function public.my_teacher_board_ids() to authenticated;
grant execute on function public.my_view_only_board_ids() to authenticated;
grant execute on function public.my_teach_only_board_ids() to authenticated;
grant execute on function public.is_notebook_teacher(uuid, uuid) to authenticated;
grant execute on function public.my_board_ids() to authenticated;

drop policy if exists "boards: read own or shared" on public.boards;
create policy "boards: read own or shared" on public.boards for select to authenticated
  using (owner_id = (select auth.uid()) or shared_with @> array[(select public.my_email())]
         or id in (select public.my_teacher_board_ids()));

-- 4. Rules on top of the usual ones (all of them have to pass) ------------------------
-- (a) a teacher who may only look can't add, change or remove anything;
-- (b) nobody adds things under someone else's name;
-- (c) a teacher's marks are only changed or removed by that teacher;
-- (d) a teacher only changes or removes what they added themselves (never
--     the student's own work).
do $$
declare
  t text;
begin
  foreach t in array array['strokes', 'texts', 'images'] loop
    execute format('drop policy if exists %I on public.%I', t || ': only as yourself', t);
    execute format('drop policy if exists %I on public.%I', t || ': teacher marks stay', t);
    execute format('drop policy if exists %I on public.%I', t || ': teacher marks stay (remove)', t);
    execute format($p$create policy %I on public.%I as restrictive for insert to authenticated
      with check ((author_id is null or author_id = (select auth.uid()))
                  and board_id not in (select public.my_view_only_board_ids()))$p$, t || ': only as yourself', t);
    execute format($p$create policy %I on public.%I as restrictive for update to authenticated
      using (board_id not in (select public.my_view_only_board_ids())
             and (author_id = (select auth.uid())
                  or (board_id not in (select public.my_teach_only_board_ids())
                      and (author_id is null or not public.is_notebook_teacher(board_id, author_id)))))
      with check (author_id is null or author_id = (select auth.uid()) or not public.is_notebook_teacher(board_id, author_id))$p$,
      t || ': teacher marks stay', t);
    execute format($p$create policy %I on public.%I as restrictive for delete to authenticated
      using (board_id not in (select public.my_view_only_board_ids())
             and (author_id = (select auth.uid())
                  or (board_id not in (select public.my_teach_only_board_ids())
                      and (author_id is null or not public.is_notebook_teacher(board_id, author_id)))))$p$,
      t || ': teacher marks stay (remove)', t);
  end loop;
end $$;

-- Changing a notebook's pages moves everything on them, teachers' marks
-- too: it works as the database itself (it checks the owner first).
alter function public.notebook_relayout(uuid, jsonb, jsonb, int) security definer;

-- 5. Storage: a teacher's clip pages ---------------------------------------------------
-- They go in clips/<teacher>/… in board-images (the teacher's own folder).
drop policy if exists "board images: upload my clips" on storage.objects;
create policy "board images: upload my clips" on storage.objects for insert to authenticated
  with check (bucket_id = 'board-images' and not (select public.is_anon_user())
              and (storage.foldername(name))[1] = 'clips' and (storage.foldername(name))[2] = (select auth.uid())::text);
drop policy if exists "board images: read my clips" on storage.objects;
create policy "board images: read my clips" on storage.objects for select to authenticated
  using (bucket_id = 'board-images' and not (select public.is_anon_user())
         and (storage.foldername(name))[1] = 'clips' and (storage.foldername(name))[2] = (select auth.uid())::text);

-- 6. Classes -----------------------------------------------------------------------------

create or replace function public.class_new_code()
returns text language plpgsql volatile
as $$
declare
  abc text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
  i int;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(abc, 1 + floor(random() * length(abc))::int, 1);
    end loop;
    exit when not exists (select 1 from public.class_groups where code = c);
  end loop;
  return c;
end;
$$;
revoke all on function public.class_new_code() from public;

-- A new class: { id, code }.
create or replace function public.class_create(p_name text, p_color text default null)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  nm text := btrim(left(coalesce(p_name, ''), 60));
  c record;
begin
  if not public.signed_in_for_real() then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if nm = '' then
    raise exception 'A class needs a name';
  end if;
  if (select count(*) from public.class_groups where owner_id = auth.uid()) >= 100 then
    raise exception 'You have 100 classes already';
  end if;
  insert into public.class_groups (owner_id, name, color, code, teacher_name)
  values (auth.uid(), nm, case when p_color ~ '^#[0-9a-fA-F]{6}$' then lower(p_color) end, public.class_new_code(), public.my_display_name())
  returning id, code into c;
  return jsonb_build_object('id', c.id, 'code', c.code);
end;
$$;

-- Rename, recolour, or a new code (the old one stops working).
create or replace function public.class_update(p_class uuid, p_name text default null, p_color text default null, p_new_code boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  c record;
begin
  update public.class_groups set
    name = coalesce(nullif(btrim(left(coalesce(p_name, ''), 60)), ''), name),
    color = case when p_color ~ '^#[0-9a-fA-F]{6}$' then lower(p_color) else color end,
    code = case when p_new_code then public.class_new_code() else code end,
    teacher_name = public.my_display_name(),
    updated_at = now()
  where id = p_class and owner_id = auth.uid()
  returning id, name, color, code into c;
  if not found then
    return null;
  end if;
  return jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color, 'code', c.code);
end;
$$;

-- The teacher deletes a class: they lose access to its notebooks. The
-- students keep their notebooks and everything in them.
create or replace function public.class_delete(p_class uuid)
returns boolean language plpgsql volatile security definer set search_path = public
as $$
begin
  delete from public.notebook_teachers where class_id = p_class and teacher_id = auth.uid()
    and exists (select 1 from public.class_groups where id = p_class and owner_id = auth.uid());
  delete from public.class_groups where id = p_class and owner_id = auth.uid();
  return found;
end;
$$;

-- What a join code is (before joining): { name, teacher, member, mine }.
create or replace function public.class_peek(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  c record;
begin
  select id, name, color, teacher_name, owner_id into c from public.class_groups
   where code = upper(btrim(coalesce(p_code, '')));
  if not found then
    return null;
  end if;
  return jsonb_build_object('name', c.name, 'color', c.color, 'teacher', c.teacher_name,
    'mine', c.owner_id = auth.uid(),
    'member', exists (select 1 from public.class_group_members m where m.class_id = c.id and m.student_id = auth.uid()));
end;
$$;

-- A student joins a class with its code. They get a class notebook (their
-- own, in a subject named after the class) that the teacher can reach.
-- Returns { board, class, name }. Joining again just returns it.
create or replace function public.class_join(p_code text, p_size text default 'a4')
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c record;
  m record;
  b uuid;
  subj uuid;
  nm text := public.my_display_name();
  page_id text := 'p' || substr(md5(random()::text), 1, 10);
begin
  if not public.signed_in_for_real() then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.class_groups where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then
    return jsonb_build_object('board', null, 'reason', 'code');
  end if;
  if c.owner_id = me then
    return jsonb_build_object('board', null, 'reason', 'yours', 'class', c.id);
  end if;
  select * into m from public.class_group_members where class_id = c.id and student_id = me;
  if found and m.board_id is not null and exists (select 1 from public.boards where id = m.board_id and owner_id = me) then
    return jsonb_build_object('board', m.board_id, 'class', c.id, 'name', c.name);
  end if;
  if (select count(*) from public.class_group_members where class_id = c.id) >= 300 then
    return jsonb_build_object('board', null, 'reason', 'full');
  end if;
  -- the subject (made if they haven't one with this name)
  select id into subj from public.subjects where owner_id = me and lower(name) = lower(c.name) limit 1;
  if subj is null then
    insert into public.subjects (owner_id, name, color, position)
    values (me, c.name, coalesce(c.color, '#2f5bea'), coalesce((select max(position) + 1 from public.subjects where owner_id = me), 0))
    returning id into subj;
  end if;
  insert into public.boards (owner_id, name, kind, background, subject_id, notebook)
  values (me, left(c.name || ' · ' || coalesce(c.teacher_name, 'Teacher'), 80), 'notebook', 'blank', subj,
    jsonb_build_object('v', 1, 'rev', 0, 'size', case when p_size = 'letter' then 'letter' else 'a4' end,
      'cover', jsonb_build_object('color', coalesce(c.color, '#2f5bea'), 'emoji', ''),
      'pages', jsonb_build_array(jsonb_build_object('id', page_id, 'paper', 'lined'))))
  returning id into b;
  insert into public.class_group_members (class_id, student_id, board_id, name, email)
  values (c.id, me, b, nm, public.my_email())
  on conflict (class_id, student_id) do update set board_id = excluded.board_id, name = excluded.name, email = excluded.email;
  insert into public.notebook_teachers (board_id, teacher_id, class_id, permission, status, teacher_name, student_name, created_by)
  values (b, c.owner_id, c.id, 'assign', 'active', c.teacher_name, nm, me)
  on conflict (board_id, teacher_id) where teacher_id is not null do update set status = 'active', class_id = excluded.class_id;
  return jsonb_build_object('board', b, 'class', c.id, 'name', c.name);
end;
$$;

-- A student leaves, or the teacher removes a student. The student keeps
-- their notebook; the teacher can't reach it any more.
create or replace function public.class_remove(p_class uuid, p_student uuid default null)
returns boolean language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  who uuid := coalesce(p_student, me);
  is_owner boolean;
begin
  select owner_id = me into is_owner from public.class_groups where id = p_class;
  if not found or (who <> me and not coalesce(is_owner, false)) then
    return false;
  end if;
  delete from public.notebook_teachers nt using public.class_group_members m
   where m.class_id = p_class and m.student_id = who and nt.board_id = m.board_id and nt.class_id = p_class;
  delete from public.class_group_members where class_id = p_class and student_id = who;
  return found;
end;
$$;

-- 7. A notebook for one student (1:1) ------------------------------------------------------

-- The teacher makes it (theirs until the student claims it): { board, token }.
create or replace function public.student_notebook_create(p_label text, p_size text default 'a4', p_color text default null)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  b uuid;
  tok text := replace(gen_random_uuid()::text, '-', '');
  lbl text := btrim(left(coalesce(p_label, ''), 60));
  page_id text := 'p' || substr(md5(random()::text), 1, 10);
begin
  if not public.signed_in_for_real() then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if lbl = '' then
    raise exception 'Who is it for?';
  end if;
  if (select count(*) from public.notebook_invites where teacher_id = me and claimed_by is null) >= 200 then
    raise exception 'Too many notebooks waiting for students';
  end if;
  insert into public.boards (owner_id, name, kind, background, notebook)
  values (me, left(lbl, 80), 'notebook', 'blank',
    jsonb_build_object('v', 1, 'rev', 0, 'size', case when p_size = 'letter' then 'letter' else 'a4' end,
      'cover', jsonb_build_object('color', case when p_color ~ '^#[0-9a-fA-F]{6}$' then lower(p_color) else '#2f5bea' end, 'emoji', ''),
      'pages', jsonb_build_array(jsonb_build_object('id', page_id, 'paper', 'lined'))))
  returning id into b;
  insert into public.notebook_invites (token, board_id, teacher_id, student_label) values (tok, b, me, lbl);
  return jsonb_build_object('board', b, 'token', tok);
end;
$$;

-- The invite link again, or a new one (the old one stops working).
create or replace function public.student_notebook_link(p_board uuid, p_new boolean default false)
returns text language plpgsql volatile security definer set search_path = public
as $$
declare
  tok text;
begin
  if p_new then
    update public.notebook_invites set token = replace(gen_random_uuid()::text, '-', '')
     where board_id = p_board and teacher_id = auth.uid() and claimed_by is null
     returning token into tok;
  else
    select token into tok from public.notebook_invites where board_id = p_board and teacher_id = auth.uid() and claimed_by is null;
  end if;
  return tok;
end;
$$;

-- What an invite is: { name, teacher, claimed, mine }.
create or replace function public.student_notebook_peek(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  i record;
begin
  if p_token is null or length(p_token) < 16 or length(p_token) > 64 then
    return null;
  end if;
  select ni.*, b.name as board_name, (select coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''), split_part(u.email, '@', 1))
          from auth.users u where u.id = ni.teacher_id) as teacher
    into i from public.notebook_invites ni join public.boards b on b.id = ni.board_id where ni.token = p_token;
  if not found then
    return null;
  end if;
  return jsonb_build_object('name', i.board_name, 'teacher', i.teacher, 'claimed', i.claimed_by is not null,
    'mine', i.claimed_by = auth.uid(), 'yours', i.teacher_id = auth.uid());
end;
$$;

-- The student opens the invite: the notebook becomes theirs, and the
-- teacher stays linked to it. { board } or { board: null, reason }.
create or replace function public.student_notebook_claim(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  i record;
  tname text;
  nm text := public.my_display_name();
begin
  if not public.signed_in_for_real() then
    return jsonb_build_object('board', null, 'reason', 'signin');
  end if;
  select * into i from public.notebook_invites where token = p_token for update;
  if not found then
    return jsonb_build_object('board', null, 'reason', 'gone');
  end if;
  if i.claimed_by = me then
    return jsonb_build_object('board', i.board_id);
  end if;
  if i.claimed_by is not null then
    return jsonb_build_object('board', null, 'reason', 'taken');
  end if;
  if i.teacher_id = me then
    return jsonb_build_object('board', null, 'reason', 'yours');
  end if;
  select coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''), split_part(u.email, '@', 1))
    into tname from auth.users u where u.id = i.teacher_id;
  update public.boards set owner_id = me, subject_id = null,
         shared_with = array(select e from unnest(coalesce(shared_with, '{}')) e where e <> public.my_email())
   where id = i.board_id;
  update public.notebook_invites set claimed_by = me, claimed_at = now() where token = p_token;
  insert into public.notebook_teachers (board_id, teacher_id, permission, status, teacher_name, student_name, created_by)
  values (i.board_id, i.teacher_id, 'assign', 'active', tname, nm, me)
  on conflict (board_id, teacher_id) where teacher_id is not null do update set status = 'active', permission = 'assign';
  update public.clip_submissions set student_id = me, student_name = nm where board_id = i.board_id;
  return jsonb_build_object('board', i.board_id);
end;
$$;

-- 8. A student shares a notebook with a teacher ---------------------------------------------

-- p_who: the teacher's email, or a class code. p_permission: 'view' or
-- 'assign'. The teacher accepts it from their Teaching page (even if they
-- sign up later, by that email). { ok, teacher } or { ok: false, reason }.
create or replace function public.teacher_request(p_board uuid, p_who text, p_permission text default 'assign')
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  who text := lower(btrim(coalesce(p_who, '')));
  perm text := case when p_permission = 'view' then 'view' else 'assign' end;
  t uuid;
  tname text;
  cls uuid;
  em text;
begin
  if not public.signed_in_for_real() then
    return jsonb_build_object('ok', false, 'reason', 'signin');
  end if;
  if not exists (select 1 from public.boards where id = p_board and owner_id = me and kind = 'notebook') then
    return jsonb_build_object('ok', false, 'reason', 'notyours');
  end if;
  if who ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    em := who;
    select id into t from auth.users where lower(email) = em and not coalesce(is_anonymous, false) limit 1;
  else
    select owner_id, id, teacher_name into t, cls, tname from public.class_groups where code = upper(who);
    if t is null then
      return jsonb_build_object('ok', false, 'reason', 'code');
    end if;
  end if;
  if t = me or em = public.my_email() then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;
  if (select count(*) from public.notebook_teachers where board_id = p_board) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'many');
  end if;
  if t is not null then
    if exists (select 1 from public.notebook_teachers where board_id = p_board and teacher_id = t and status = 'active') then
      update public.notebook_teachers set permission = perm where board_id = p_board and teacher_id = t;
      return jsonb_build_object('ok', true, 'already', true);
    end if;
    insert into public.notebook_teachers (board_id, teacher_id, class_id, permission, status, teacher_name, student_name, created_by)
    values (p_board, t, cls, perm, 'requested', tname, public.my_display_name(), me)
    on conflict (board_id, teacher_id) where teacher_id is not null do update set permission = excluded.permission;
  else
    insert into public.notebook_teachers (board_id, teacher_email, permission, status, student_name, created_by)
    values (p_board, em, perm, 'requested', public.my_display_name(), me)
    on conflict (board_id, teacher_email) where teacher_id is null do update set permission = excluded.permission;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- The teacher says yes (p_accept) or no to a request.
create or replace function public.teacher_answer(p_link uuid, p_accept boolean)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  l record;
begin
  if not public.signed_in_for_real() then
    return null;
  end if;
  select * into l from public.notebook_teachers
   where id = p_link and status = 'requested' and (teacher_id = me or (teacher_id is null and teacher_email = public.my_email()))
   for update;
  if not found then
    return null;
  end if;
  if not p_accept then
    delete from public.notebook_teachers where id = p_link;
    return jsonb_build_object('board', null);
  end if;
  -- (one link per teacher per notebook)
  delete from public.notebook_teachers where board_id = l.board_id and teacher_id = me and id <> p_link;
  update public.notebook_teachers set teacher_id = me, teacher_email = null, status = 'active', teacher_name = public.my_display_name()
   where id = p_link;
  return jsonb_build_object('board', l.board_id);
end;
$$;

-- The student removes a teacher from their notebook, or a teacher lets go
-- of it. (A class's link goes with leaving the class: class_remove.)
create or replace function public.notebook_teacher_remove(p_link uuid)
returns boolean language plpgsql volatile security definer set search_path = public
as $$
begin
  delete from public.notebook_teachers nt
   where nt.id = p_link
     and (nt.teacher_id = auth.uid()
          or exists (select 1 from public.boards b where b.id = nt.board_id and b.owner_id = auth.uid()));
  return found;
end;
$$;

-- The student changes what a teacher may do ('view' or 'assign').
create or replace function public.notebook_teacher_permission(p_link uuid, p_permission text)
returns boolean language plpgsql volatile security definer set search_path = public
as $$
begin
  update public.notebook_teachers nt set permission = case when p_permission = 'view' then 'view' else 'assign' end
   where nt.id = p_link and exists (select 1 from public.boards b where b.id = nt.board_id and b.owner_id = auth.uid());
  return found;
end;
$$;

-- 9. Clips --------------------------------------------------------------------------------

-- May I put pages into this notebook? (A teacher linked to it who may add
-- work, or its owner while it's still waiting for its student.)
create or replace function public.can_clip_into(p_board uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.notebook_teachers where board_id = p_board and teacher_id = auth.uid()
                   and status = 'active' and permission = 'assign')
      or exists (select 1 from public.notebook_invites where board_id = p_board and teacher_id = auth.uid() and claimed_by is null)
$$;
revoke all on function public.can_clip_into(uuid) from public;
grant execute on function public.can_clip_into(uuid) to authenticated;

-- Send a clip: its pages are added to the end of each notebook (nothing
-- already there moves). p_class: a class (its students' notebooks, or just
-- p_boards among them). p_pages: [{ url, path, w, h, pw, ph }]: each page's
-- picture (already uploaded to clips/<you>/…) and the page's size.
-- Returns { clip, sent, skipped }.
create or replace function public.clip_send(
  p_class uuid, p_boards uuid[], p_kind text, p_title text, p_note text, p_due timestamptz,
  p_max numeric, p_questions jsonb, p_pages jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  targets uuid[];
  clip uuid;
  b record;
  pg jsonb;
  newpages jsonb;
  ids text[];
  pid text;
  sent int := 0;
  skipped int := 0;
  nm text := public.my_display_name();
  ckind text := case when p_kind = 'resource' then 'resource' else 'homework' end;
  pre text := 'board-images/clips/' || me::text || '/';
begin
  if not public.signed_in_for_real() then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_pages), '') <> 'array' or jsonb_array_length(p_pages) < 1 or jsonb_array_length(p_pages) > 60 then
    raise exception 'A clip has 1 to 60 pages';
  end if;
  -- every page picture must be one of yours, in your clips folder
  for pg in select value from jsonb_array_elements(p_pages) loop
    if coalesce(pg ->> 'path', '') !~ ('^clips/' || me::text || '/[A-Za-z0-9/_.-]{1,200}$')
       or coalesce(pg ->> 'url', '') !~ '^https://'
       or right(pg ->> 'url', length('board-images/' || (pg ->> 'path'))) <> 'board-images/' || (pg ->> 'path')
       or coalesce((pg ->> 'w')::numeric, 0) <= 0 or coalesce((pg ->> 'h')::numeric, 0) <= 0
       or coalesce((pg ->> 'pw')::numeric, 0) not between 200 and 5000 or coalesce((pg ->> 'ph')::numeric, 0) not between 200 and 5000 then
      raise exception 'Bad clip page';
    end if;
  end loop;
  if p_class is not null then
    if not exists (select 1 from public.class_groups where id = p_class and owner_id = me) then
      raise exception 'Not your class' using errcode = '42501';
    end if;
    select array_agg(m.board_id) into targets from public.class_group_members m
     where m.class_id = p_class and m.board_id is not null and (p_boards is null or m.board_id = any(p_boards));
  else
    targets := p_boards;
  end if;
  if targets is null or array_length(targets, 1) is null then
    raise exception 'Nobody to send it to';
  end if;
  if array_length(targets, 1) > 300 then
    raise exception 'Too many notebooks at once';
  end if;
  insert into public.clips (teacher_id, class_id, kind, title, note, due_at, max_score, questions, pages, teacher_name)
  values (me, p_class, ckind, btrim(left(coalesce(p_title, ''), 120)), nullif(btrim(left(coalesce(p_note, ''), 2000)), ''),
          case when ckind = 'homework' then p_due end, case when ckind = 'homework' then p_max end,
          case when jsonb_typeof(p_questions) = 'array' then p_questions else '[]'::jsonb end,
          (select jsonb_agg(jsonb_build_object('url', value ->> 'url', 'path', value ->> 'path', 'w', round((value ->> 'w')::numeric),
                  'h', round((value ->> 'h')::numeric), 'pw', round((value ->> 'pw')::numeric), 'ph', round((value ->> 'ph')::numeric)))
             from jsonb_array_elements(p_pages)), nm)
  returning id into clip;
  for b in select id, owner_id, notebook from public.boards bb where bb.id = any(targets) and bb.kind = 'notebook' order by bb.id for update loop
    if not public.can_clip_into(b.id)
       or jsonb_array_length(coalesce(b.notebook -> 'pages', '[]'::jsonb)) + jsonb_array_length(p_pages) > 500 then
      skipped := skipped + 1;
      continue;
    end if;
    newpages := '[]'::jsonb;
    ids := '{}';
    for pg in select value from jsonb_array_elements(p_pages) loop
      pid := 'c' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
      ids := ids || pid;
      newpages := newpages || jsonb_build_array(jsonb_build_object(
        'id', pid, 'paper', 'blank', 'clip', clip,
        'w', round((pg ->> 'pw')::numeric), 'h', round((pg ->> 'ph')::numeric),
        'bg', jsonb_build_object('url', pg ->> 'url', 'path', pg ->> 'path', 'w', round((pg ->> 'w')::numeric), 'h', round((pg ->> 'h')::numeric))));
    end loop;
    update public.boards
       set notebook = jsonb_set(notebook, '{pages}', coalesce(notebook -> 'pages', '[]'::jsonb) || newpages)
                      || jsonb_build_object('rev', coalesce((notebook ->> 'rev')::int, 0) + 1)
     where id = b.id;
    insert into public.clip_submissions (clip_id, board_id, student_id, student_name, page_ids)
    values (clip, b.id, case when b.owner_id = me then null else b.owner_id end,
            (select nt.student_name from public.notebook_teachers nt where nt.board_id = b.id and nt.teacher_id = me limit 1), ids)
    on conflict (clip_id, board_id) do nothing;
    sent := sent + 1;
  end loop;
  if sent = 0 then
    raise exception 'None of those notebooks could take it';
  end if;
  return jsonb_build_object('clip', clip, 'sent', sent, 'skipped', skipped);
end;
$$;

-- The teacher changes a clip's title, note, due date or most marks, or
-- takes it back (p_delete: it stops being homework; the pages stay in the
-- notebooks, which belong to the students).
create or replace function public.clip_update(p_clip uuid, p_title text default null, p_note text default null,
  p_due timestamptz default null, p_clear_due boolean default false, p_max numeric default null, p_delete boolean default false)
returns boolean language plpgsql volatile security definer set search_path = public
as $$
begin
  update public.clips set
    title = coalesce(nullif(btrim(left(coalesce(p_title, ''), 120)), ''), title),
    note = case when p_note is null then note else nullif(btrim(left(p_note, 2000)), '') end,
    due_at = case when p_clear_due then null else coalesce(p_due, due_at) end,
    max_score = coalesce(p_max, max_score),
    deleted_at = case when p_delete then now() else deleted_at end,
    updated_at = now()
  where id = p_clip and teacher_id = auth.uid();
  return found;
end;
$$;

-- What's been clipped into a notebook, for whoever has it open (its owner
-- or a teacher of it): { role, me, clips: [...], teachers: [...], invite }.
create or replace function public.notebook_clips(p_board uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  owner uuid;
  role text;
begin
  select owner_id into owner from public.boards where id = p_board;
  if not found or me is null then
    return null;
  end if;
  if owner = me then
    role := 'owner';
  elsif public.is_notebook_teacher(p_board, me) then
    role := 'teacher';
  elsif p_board in (select public.my_board_ids()) then
    role := 'shared';
  else
    return null;
  end if;
  return jsonb_build_object(
    'role', role,
    'me', me,
    'clips', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'title', c.title, 'note', c.note, 'due_at', c.due_at, 'max_score', c.max_score,
        'questions', c.questions, 'teacher', c.teacher_name, 'teacher_id', c.teacher_id, 'mine', c.teacher_id = me,
        'created_at', c.created_at, 'deleted', c.deleted_at is not null,
        'sub', jsonb_build_object('id', s.id, 'status', s.status, 'page_ids', to_jsonb(s.page_ids), 'handed_in_at', s.handed_in_at,
               'returned_at', s.returned_at, 'edited_after', s.edited_after, 'score', s.score, 'comment', s.comment,
               'question_scores', s.question_scores))
        order by c.created_at)
      from public.clip_submissions s join public.clips c on c.id = s.clip_id
      where s.board_id = p_board), '[]'::jsonb),
    'teachers', coalesce((
      select jsonb_agg(jsonb_build_object('id', nt.id, 'teacher_id', nt.teacher_id, 'name', coalesce(nt.teacher_name, nt.teacher_email),
        'email', nt.teacher_email, 'permission', nt.permission, 'status', nt.status,
        'class', (select g.name from public.class_groups g where g.id = nt.class_id)) order by nt.created_at)
      from public.notebook_teachers nt where nt.board_id = p_board and (role = 'owner' or nt.teacher_id = me)), '[]'::jsonb),
    'invite', (select jsonb_build_object('token', ni.token, 'label', ni.student_label)
               from public.notebook_invites ni where ni.board_id = p_board and ni.teacher_id = me and ni.claimed_by is null),
    'teacher_ids', coalesce((select jsonb_agg(nt.teacher_id) from public.notebook_teachers nt
                             where nt.board_id = p_board and nt.status = 'active' and nt.teacher_id is not null), '[]'::jsonb));
end;
$$;

-- The student hands it in, or takes it back (until it's returned).
create or replace function public.submission_hand_in(p_sub uuid, p_undo boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  s record;
begin
  select cs.* into s from public.clip_submissions cs join public.boards b on b.id = cs.board_id
   where cs.id = p_sub and b.owner_id = auth.uid() for update of cs;
  if not found then
    return null;
  end if;
  if s.status = 'returned' then
    return jsonb_build_object('status', s.status);
  end if;
  if p_undo then
    update public.clip_submissions set status = 'assigned', handed_in_at = null, edited_after = false, updated_at = now() where id = p_sub;
    return jsonb_build_object('status', 'assigned');
  end if;
  update public.clip_submissions set status = 'handed_in', handed_in_at = now(), edited_after = false, updated_at = now() where id = p_sub;
  return jsonb_build_object('status', 'handed_in', 'handed_in_at', now());
end;
$$;

-- The student changed it after handing it in (the teacher sees a note).
create or replace function public.submission_edited(p_sub uuid)
returns boolean language plpgsql volatile security definer set search_path = public
as $$
begin
  update public.clip_submissions cs set edited_after = true, updated_at = now()
   from public.boards b
   where cs.id = p_sub and b.id = cs.board_id and b.owner_id = auth.uid() and cs.status = 'handed_in' and not cs.edited_after;
  return found;
end;
$$;

-- The teacher marks it: a score, a comment, scores per question, and
-- (p_return) hands it back. p_return false keeps it as a draft.
create or replace function public.submission_mark(p_sub uuid, p_score numeric, p_comment text, p_qscores jsonb, p_return boolean)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  s record;
begin
  select cs.*, c.max_score into s from public.clip_submissions cs join public.clips c on c.id = cs.clip_id
   where cs.id = p_sub and c.teacher_id = auth.uid() for update of cs;
  if not found then
    return null;
  end if;
  if p_score is not null and (p_score < 0 or (s.max_score is not null and p_score > s.max_score)) then
    raise exception 'That score is out of range';
  end if;
  update public.clip_submissions set
    score = p_score,
    comment = nullif(btrim(left(coalesce(p_comment, ''), 2000)), ''),
    question_scores = case when jsonb_typeof(p_qscores) = 'object' then p_qscores else question_scores end,
    status = case when p_return then 'returned' else status end,
    returned_at = case when p_return then now() else returned_at end,
    updated_at = now()
  where id = p_sub;
  return jsonb_build_object('status', case when p_return then 'returned' else s.status end);
end;
$$;

-- 10. Lists -----------------------------------------------------------------------------

-- A student's homework (the Homework panel and the badges on the shelf):
-- [{ sub, clip, title, due_at, status, score, max_score, board, board_name, page_id, teacher, late }].
create or replace function public.student_homework()
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'sub', s.id, 'clip', c.id, 'title', c.title, 'note', c.note, 'due_at', c.due_at, 'status', s.status, 'score', s.score,
      'max_score', c.max_score, 'comment', s.comment, 'board', b.id, 'board_name', b.name, 'page_id', s.page_ids[1],
      'teacher', c.teacher_name, 'handed_in_at', s.handed_in_at, 'returned_at', s.returned_at,
      'late', c.due_at is not null and coalesce(s.handed_in_at, now()) > c.due_at)
    order by c.due_at nulls last, c.created_at), '[]'::jsonb)
  from public.clip_submissions s
  join public.clips c on c.id = s.clip_id
  join public.boards b on b.id = s.board_id
  where b.owner_id = auth.uid() and c.kind = 'homework' and c.deleted_at is null
    and (s.status <> 'returned' or s.returned_at > now() - interval '30 days')
$$;

-- A teacher's page: classes, 1:1 notebooks, requests waiting, and how much
-- is waiting to be marked.
create or replace function public.teacher_home()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  em text := public.my_email();
begin
  if not public.signed_in_for_real() then
    return null;
  end if;
  return jsonb_build_object(
    'name', public.my_display_name(),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.name, 'color', g.color, 'code', g.code, 'created_at', g.created_at,
        'students', (select count(*) from public.class_group_members m where m.class_id = g.id),
        'to_mark', (select count(*) from public.clip_submissions s join public.clips c on c.id = s.clip_id
                    where c.class_id = g.id and c.deleted_at is null and s.status = 'handed_in'),
        'next_due', (select min(c.due_at) from public.clips c where c.class_id = g.id and c.deleted_at is null and c.due_at > now()))
        order by g.created_at)
      from public.class_groups g where g.owner_id = me), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(x order by x ->> 'name') from (
        select jsonb_build_object('link', nt.id, 'board', nt.board_id, 'name', coalesce(nt.student_name, b.name),
          'notebook', b.name, 'permission', nt.permission, 'pending', false,
          'to_mark', (select count(*) from public.clip_submissions s join public.clips c on c.id = s.clip_id
                      where s.board_id = nt.board_id and c.teacher_id = me and c.deleted_at is null and s.status = 'handed_in')) as x
        from public.notebook_teachers nt join public.boards b on b.id = nt.board_id
        where nt.teacher_id = me and nt.status = 'active' and nt.class_id is null
        union all
        select jsonb_build_object('link', null, 'board', ni.board_id, 'name', coalesce(ni.student_label, b.name),
          'notebook', b.name, 'permission', 'assign', 'pending', true, 'token', ni.token, 'to_mark', 0)
        from public.notebook_invites ni join public.boards b on b.id = ni.board_id
        where ni.teacher_id = me and ni.claimed_by is null) y), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('link', nt.id, 'board', nt.board_id, 'student', nt.student_name, 'notebook', b.name,
        'permission', nt.permission, 'created_at', nt.created_at) order by nt.created_at)
      from public.notebook_teachers nt join public.boards b on b.id = nt.board_id
      where nt.status = 'requested' and (nt.teacher_id = me or (nt.teacher_id is null and em is not null and nt.teacher_email = em))), '[]'::jsonb),
    'to_mark', (select count(*) from public.clip_submissions s join public.clips c on c.id = s.clip_id
                where c.teacher_id = me and c.deleted_at is null and s.status = 'handed_in'),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'kind', c.kind, 'due_at', c.due_at, 'class', c.class_id,
        'created_at', c.created_at,
        'sent', (select count(*) from public.clip_submissions s where s.clip_id = c.id),
        'handed_in', (select count(*) from public.clip_submissions s where s.clip_id = c.id and s.status = 'handed_in'),
        'returned', (select count(*) from public.clip_submissions s where s.clip_id = c.id and s.status = 'returned'))
        order by c.created_at desc)
      from (select * from public.clips where teacher_id = me and deleted_at is null order by created_at desc limit 30) c), '[]'::jsonb));
end;
$$;

-- One class: its students and its clips with how far each has got.
create or replace function public.class_overview(p_class uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  g record;
begin
  select * into g from public.class_groups where id = p_class and owner_id = auth.uid();
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', g.id, 'name', g.name, 'color', g.color, 'code', g.code,
    'students', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.student_id, 'name', m.name, 'email', m.email, 'board', m.board_id,
        'joined_at', m.joined_at,
        'linked', exists (select 1 from public.notebook_teachers nt where nt.board_id = m.board_id and nt.teacher_id = g.owner_id and nt.status = 'active'))
        order by lower(coalesce(m.name, m.email, '')))
      from public.class_group_members m where m.class_id = g.id), '[]'::jsonb),
    'clips', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'kind', c.kind, 'due_at', c.due_at, 'max_score', c.max_score,
        'created_at', c.created_at, 'pages', jsonb_array_length(c.pages),
        'sent', (select count(*) from public.clip_submissions s where s.clip_id = c.id),
        'handed_in', (select count(*) from public.clip_submissions s where s.clip_id = c.id and s.status = 'handed_in'),
        'returned', (select count(*) from public.clip_submissions s where s.clip_id = c.id and s.status = 'returned'))
        order by c.created_at desc)
      from public.clips c where c.class_id = g.id and c.deleted_at is null), '[]'::jsonb));
end;
$$;

-- One clip, for marking: everyone it went to and where they've got to.
create or replace function public.clip_overview(p_clip uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  c record;
begin
  select * into c from public.clips where id = p_clip and teacher_id = auth.uid();
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', c.id, 'title', c.title, 'kind', c.kind, 'note', c.note, 'due_at', c.due_at, 'max_score', c.max_score,
    'questions', c.questions, 'pages', c.pages, 'class', c.class_id, 'created_at', c.created_at, 'deleted', c.deleted_at is not null,
    'class_name', (select g.name from public.class_groups g where g.id = c.class_id),
    'subs', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'board', s.board_id, 'student', coalesce(s.student_name, b.name),
        'status', s.status, 'handed_in_at', s.handed_in_at, 'returned_at', s.returned_at, 'edited_after', s.edited_after,
        'score', s.score, 'comment', s.comment, 'question_scores', s.question_scores, 'page_ids', to_jsonb(s.page_ids),
        'late', c.due_at is not null and coalesce(s.handed_in_at, now()) > c.due_at,
        'reachable', s.board_id is not null and public.is_notebook_teacher(s.board_id, auth.uid()) or b.owner_id = auth.uid())
        order by lower(coalesce(s.student_name, b.name, '')))
      from public.clip_submissions s left join public.boards b on b.id = s.board_id
      where s.clip_id = c.id), '[]'::jsonb));
end;
$$;

-- Every function: signed in only.
do $$
declare
  f text;
begin
  foreach f in array array[
    'class_create(text, text)', 'class_update(uuid, text, text, boolean)', 'class_delete(uuid)', 'class_peek(text)',
    'class_join(text, text)', 'class_remove(uuid, uuid)', 'student_notebook_create(text, text, text)',
    'student_notebook_link(uuid, boolean)', 'student_notebook_peek(text)', 'student_notebook_claim(text)',
    'teacher_request(uuid, text, text)', 'teacher_answer(uuid, boolean)', 'notebook_teacher_remove(uuid)',
    'notebook_teacher_permission(uuid, text)',
    'clip_send(uuid, uuid[], text, text, text, timestamptz, numeric, jsonb, jsonb)',
    'clip_update(uuid, text, text, timestamptz, boolean, numeric, boolean)', 'notebook_clips(uuid)',
    'submission_hand_in(uuid, boolean)', 'submission_edited(uuid)', 'submission_mark(uuid, numeric, text, jsonb, boolean)',
    'student_homework()', 'teacher_home()', 'class_overview(uuid)', 'clip_overview(uuid)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
-- (the two "what is this code / link" questions also work before signing in)
grant execute on function public.class_peek(text) to anon;
grant execute on function public.student_notebook_peek(text) to anon;

commit;

-- Check it worked (just a report, changes nothing). Expect 6, 3, true, 24.
select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('class_groups', 'class_group_members', 'notebook_teachers', 'notebook_invites', 'clips', 'clip_submissions')) as "new tables (6)",
  (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'author_id'
     and table_name in ('strokes', 'texts', 'images')) as "author columns (3)",
  position('notebook_teachers' in (select prosrc from pg_proc where proname = 'my_board_ids' limit 1)) > 0 as "teachers can open notebooks",
  (select count(*) from pg_proc where proname in ('class_create', 'class_update', 'class_delete', 'class_peek', 'class_join', 'class_remove',
     'student_notebook_create', 'student_notebook_link', 'student_notebook_peek', 'student_notebook_claim', 'teacher_request',
     'teacher_answer', 'notebook_teacher_remove', 'notebook_teacher_permission', 'clip_send', 'clip_update', 'notebook_clips',
     'submission_hand_in', 'submission_edited', 'submission_mark', 'student_homework', 'teacher_home', 'class_overview', 'clip_overview')) as "functions (24)";
