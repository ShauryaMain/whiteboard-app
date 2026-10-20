-- Fix: pictures, clips, board previews and fonts not uploading (20 Oct 2026)
--
-- Since 2026-10-18-speed-and-privacy.sql, every upload to the board-images
-- bucket was refused with "new row violates row-level security policy for
-- table objects". That file replaced the old upload rules with an "upload"
-- and a "replace" rule, but the old rule it removed had also let people
-- read their files back, and Supabase Storage reads each file back as it
-- saves it. Without that, every upload is refused.
--
-- Nothing looked broken because the app quietly falls back: pictures and
-- PDF clips are kept inside the board's data instead (bigger and slower to
-- load), and board previews on the boards page stop updating.
--
-- This adds the missing "read" rule, for the same folders as the other two:
-- the folders of boards you can use, and your own fonts folder. (Anyone can
-- still view the pictures by their link, as before: the bucket is public.)
--
-- Safe to run more than once. Run it in Supabase: SQL Editor, New query,
-- paste, Run.

begin;

drop policy if exists "board images: read on my boards" on storage.objects;
create policy "board images: read on my boards" on storage.objects for select to authenticated
  using (
    bucket_id = 'board-images' and not (select public.is_anon_user()) and (
      ((storage.foldername(name))[1] = 'fonts' and (storage.foldername(name))[2] = (select auth.uid())::text)
      or public.can_use_board_folder((storage.foldername(name))[1])));

commit;

-- Check it worked (just a report, changes nothing). Expect 1, 1, 1.
select
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'board images: upload to my boards') as "upload rule (1)",
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'board images: replace on my boards') as "replace rule (1)",
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'board images: read on my boards') as "read rule (1)";
