// Deleting a teacher's account (Settings → Account → Delete my account).
// Server-only; runs with the Supabase service-role key from
// /api/account/delete, after that route has checked who is asking.
//
// Removes, in this order:
//   1. every board they own: its ink, text, pictures and uploaded files
//      (worksheets), then the board itself (the same steps as the daily
//      clean-up, boardCleanup.js)
//   2. their email from the share list of other people's boards
//   3. their sign-in account (and with it their settings and graph presets,
//      which live in the account), then any profile row
// If a step fails it stops and says so. The account is only removed once
// all their boards are gone, so nothing is left without an owner. Every
// step can safely run again, so trying again finishes the job.

import { emptyFolder } from "./boardCleanup";

const PAGE = 500;
const BATCH = 100; // boards per request when clearing ink, text and pictures
const PARALLEL = 6; // storage folders emptied at once

async function ownedBoards(admin, userId) {
  const ids = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from("boards").select("id").eq("owner_id", userId).range(from, from + PAGE - 1);
    if (error) throw new Error(`couldn't list boards: ${error.message || error.code}`);
    (data || []).forEach((b) => ids.push(b.id));
    if (!data || data.length < PAGE) break;
  }
  return ids;
}

async function clearRows(admin, ids) {
  for (let i = 0; i < ids.length; i += BATCH) {
    const some = ids.slice(i, i + BATCH);
    for (const table of ["strokes", "texts", "images"]) {
      const { error } = await admin.from(table).delete().in("board_id", some);
      if (error && error.code !== "42P01") throw new Error(`couldn't clear ${table}: ${error.message || error.code}`);
    }
  }
}

async function clearFiles(admin, ids) {
  const jobs = [];
  for (const id of ids) for (const bucket of ["board-images", "reference-docs"]) jobs.push([bucket, String(id)]);
  for (let i = 0; i < jobs.length; i += PARALLEL) {
    await Promise.all(jobs.slice(i, i + PARALLEL).map(([bucket, folder]) => emptyFolder(admin, bucket, folder, { strict: true })));
  }
}

async function deleteBoards(admin, ids) {
  for (let i = 0; i < ids.length; i += BATCH) {
    const { error } = await admin.from("boards").delete().in("id", ids.slice(i, i + BATCH));
    if (error) throw new Error(`couldn't delete boards: ${error.message || error.code}`);
  }
}

async function leaveSharedBoards(admin, email) {
  if (!email) return 0;
  const address = String(email).toLowerCase();
  const { data, error } = await admin.from("boards").select("id, shared_with").contains("shared_with", [address]);
  if (error) return 0; // not worth stopping for: they can no longer sign in to see them
  let n = 0;
  for (const b of data || []) {
    const list = (b.shared_with || []).filter((e) => String(e).toLowerCase() !== address);
    const { error: upErr } = await admin.from("boards").update({ shared_with: list }).eq("id", b.id);
    if (!upErr) n++;
  }
  return n;
}

// Resolves to { boards, unshared } or throws.
export async function deleteAccount({ admin, userId, email }) {
  if (!admin || !userId) throw new Error("missing account");
  const ids = await ownedBoards(admin, userId);
  await clearRows(admin, ids);
  await clearFiles(admin, ids);
  await deleteBoards(admin, ids);
  const unshared = await leaveSharedBoards(admin, email);
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`couldn't delete the account: ${error.message || error.code}`);
  // a profiles row, if this project keeps one (usually it goes with the
  // account anyway; an error here just means there isn't one)
  await admin.from("profiles").delete().eq("id", userId);
  return { boards: ids.length, unshared };
}
