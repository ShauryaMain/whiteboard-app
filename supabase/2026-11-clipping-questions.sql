-- Clipping, part 2: marking by question (November 2026)
--
-- A teacher can mark out the questions on a piece of homework (boxes on its
-- pages: Q1, Q2…, each worth some marks), then mark one question across
-- every student side by side.
--
--   1. clip_set_questions: the teacher saves the boxes (and the most marks).
--   2. clip_question_ink: what each student wrote on the homework's pages
--      (only those pages, not the rest of their notebook), for the
--      side-by-side view.
--
-- Run after 2026-11-clipping.sql. Safe to run more than once.
-- Supabase: SQL Editor, New query, paste, Run.

begin;

-- 1. The questions --------------------------------------------------------------
-- p_questions: [{ id, label, page, x, y, w, h, marks }]: page is which of the
-- clip's pages (from 0); x, y, w, h are fractions of that page (0 to 1);
-- marks may be empty. p_max: the most marks for the whole piece (empty:
-- unchanged, unless every question has marks: then their total).
create or replace function public.clip_set_questions(p_clip uuid, p_questions jsonb, p_max numeric default null)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  c record;
  q jsonb;
  n int := 0;
  total numeric := 0;
  all_marked boolean := true;
  clean jsonb := '[]'::jsonb;
begin
  select * into c from public.clips where id = p_clip and teacher_id = auth.uid() for update;
  if not found then
    return null;
  end if;
  if coalesce(jsonb_typeof(p_questions), '') <> 'array' or jsonb_array_length(p_questions) > 60 then
    raise exception 'Up to 60 questions';
  end if;
  for q in select value from jsonb_array_elements(p_questions) loop
    n := n + 1;
    if coalesce((q ->> 'page')::int, -1) < 0 or (q ->> 'page')::int >= jsonb_array_length(c.pages)
       or coalesce((q ->> 'x')::numeric, -1) < 0 or coalesce((q ->> 'y')::numeric, -1) < 0
       or coalesce((q ->> 'w')::numeric, 0) <= 0 or coalesce((q ->> 'h')::numeric, 0) <= 0
       or (q ->> 'x')::numeric + (q ->> 'w')::numeric > 1.0001 or (q ->> 'y')::numeric + (q ->> 'h')::numeric > 1.0001
       or ((q ->> 'marks') is not null and ((q ->> 'marks')::numeric < 0 or (q ->> 'marks')::numeric > 1000)) then
      raise exception 'Bad question box';
    end if;
    if (q ->> 'marks') is null then
      all_marked := false;
    else
      total := total + (q ->> 'marks')::numeric;
    end if;
    clean := clean || jsonb_build_array(jsonb_build_object(
      'id', left(coalesce(nullif(q ->> 'id', ''), 'q' || n), 20),
      'label', left(coalesce(nullif(btrim(q ->> 'label'), ''), 'Q' || n), 20),
      'page', (q ->> 'page')::int,
      'x', round((q ->> 'x')::numeric, 4), 'y', round((q ->> 'y')::numeric, 4),
      'w', round((q ->> 'w')::numeric, 4), 'h', round((q ->> 'h')::numeric, 4),
      'marks', case when (q ->> 'marks') is null then null else (q ->> 'marks')::numeric end));
  end loop;
  update public.clips set
    questions = clean,
    max_score = case
      when p_max is not null and p_max > 0 and p_max <= 1000 then p_max
      when all_marked and n > 0 and total > 0 then least(total, 1000)
      else max_score end,
    updated_at = now()
  where id = p_clip
  returning max_score into total;
  return jsonb_build_object('questions', clean, 'max_score', total);
end;
$$;

-- 2. What each student wrote on the homework's pages ---------------------------
-- [{ sub, board, pages: { <page id>: { top, w, h } }, strokes, texts, images }]
-- Only the homework's pages, worked out from where they are in each
-- notebook (as src/lib/notebook.js lays them out: one under another,
-- 48 apart).
create or replace function public.clip_question_ink(p_clip uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  c record;
  s record;
  nb jsonb;
  pg jsonb;
  y double precision;
  w double precision;
  h double precision;
  base_w double precision;
  base_h double precision;
  pages jsonb;
  out jsonb := '[]'::jsonb;
begin
  select * into c from public.clips where id = p_clip and teacher_id = auth.uid();
  if not found then
    return null;
  end if;
  for s in select cs.* from public.clip_submissions cs where cs.clip_id = p_clip and cs.board_id is not null order by cs.created_at loop
    if not (public.is_notebook_teacher(s.board_id, auth.uid())
            or exists (select 1 from public.boards b where b.id = s.board_id and b.owner_id = auth.uid())) then
      continue;
    end if;
    select notebook into nb from public.boards where id = s.board_id;
    if nb is null then
      continue;
    end if;
    base_w := case when nb ->> 'size' = 'letter' then 816 else 794 end;
    base_h := case when nb ->> 'size' = 'letter' then 1056 else 1123 end;
    y := 0;
    pages := '{}'::jsonb;
    for pg in select value from jsonb_array_elements(coalesce(nb -> 'pages', '[]'::jsonb)) loop
      if (pg ->> 'w') is not null and (pg ->> 'h') is not null then
        w := (pg ->> 'w')::double precision;
        h := (pg ->> 'h')::double precision;
      elsif coalesce((pg ->> 'landscape')::boolean, false) then
        w := base_h;
        h := base_w;
      else
        w := base_w;
        h := base_h;
      end if;
      if (pg ->> 'id') = any(s.page_ids) then
        pages := pages || jsonb_build_object(pg ->> 'id', jsonb_build_object('top', y, 'w', w, 'h', h));
      end if;
      y := y + h + 48;
    end loop;
    out := out || jsonb_build_array(jsonb_build_object(
      'sub', s.id, 'board', s.board_id, 'pages', pages,
      'strokes', coalesce((
        select jsonb_agg(jsonb_build_object('id', k.id, 'data', k.data, 'author_id', k.author_id) order by k.created_at, k.id)
        from public.strokes k
        where k.board_id = s.board_id and exists (
          select 1 from jsonb_each(pages) p
          where public.stroke_anchor_y(k.data) >= (p.value ->> 'top')::double precision - 24
            and public.stroke_anchor_y(k.data) < (p.value ->> 'top')::double precision + (p.value ->> 'h')::double precision + 24)), '[]'::jsonb),
      'texts', coalesce((
        select jsonb_agg(jsonb_build_object('id', t.id, 'x', t.x, 'y', t.y, 'text', t.text, 'color', t.color, 'font_size', t.font_size,
                                            'width', t.width, 'rotation', t.rotation, 'author_id', t.author_id) order by t.created_at, t.id)
        from public.texts t
        where t.board_id = s.board_id and exists (
          select 1 from jsonb_each(pages) p
          where t.y >= (p.value ->> 'top')::double precision - 24
            and t.y < (p.value ->> 'top')::double precision + (p.value ->> 'h')::double precision + 24)), '[]'::jsonb),
      'images', coalesce((
        select jsonb_agg(jsonb_build_object('id', i.id, 'x', i.x, 'y', i.y, 'width', i.width, 'height', i.height, 'src', i.src,
                                            'author_id', i.author_id) order by i.created_at, i.id)
        from public.images i
        where i.board_id = s.board_id and exists (
          select 1 from jsonb_each(pages) p
          where i.y >= (p.value ->> 'top')::double precision - 24
            and i.y < (p.value ->> 'top')::double precision + (p.value ->> 'h')::double precision + 24)), '[]'::jsonb)));
  end loop;
  return out;
end;
$$;

revoke all on function public.clip_set_questions(uuid, jsonb, numeric) from public;
revoke all on function public.clip_question_ink(uuid) from public;
grant execute on function public.clip_set_questions(uuid, jsonb, numeric) to authenticated;
grant execute on function public.clip_question_ink(uuid) to authenticated;

commit;

-- Check it worked (just a report, changes nothing). Expect 2.
select (select count(*) from pg_proc where proname in ('clip_set_questions', 'clip_question_ink')) as "new functions (2)";
