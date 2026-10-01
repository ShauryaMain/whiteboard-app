// The daily inactive-board clean-up. Server-only; runs with the Supabase
// service-role key from /api/cron/board-cleanup.
//
//   day 23 without use  -> the owner gets one email listing those boards
//   day 30 without use  -> boards that were warned 7+ days ago and haven't
//                          been touched since are deleted (strokes, text,
//                          pictures and uploaded files included)
//
// Opening or drawing on a board resets its clock and cancels the warning
// (see supabase/board-cleanup.sql). Every step re-checks the database, so
// running twice in a day, or missing a day, is harmless.

import { buildCleanupEmail } from "./cleanupEmail";
import { keepUrl } from "./keepToken";
import { BRAND_MARK_PNG_BASE64 } from "./emailBrandMark";

const DAY = 86400000;

export const RULES = {
  warnAfterDays: 23,
  deleteAfterDays: 30,
  minNoticeDays: 7,
  maxEmailsPerRun: 60, // Gmail allows ~500 a day; the feedback form shares it
  maxDeletesPerRun: 150,
  maxBoardsScanned: 1000,
  cardsPerEmail: 10,
  previewsPerEmail: 6,
};

const iso = (ms) => new Date(ms).toISOString();

function dataUrlToBuffer(url) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(url || "");
  if (!match) return null;
  return { contentType: match[1], content: Buffer.from(match[2], "base64") };
}

async function emptyFolder(admin, bucket, folder) {
  let removed = 0;
  for (let round = 0; round < 20; round++) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
    if (error || !data || !data.length) break;
    const paths = data.filter((f) => f && f.name).map((f) => `${folder}/${f.name}`);
    if (!paths.length) break;
    const { error: removeError } = await admin.storage.from(bucket).remove(paths);
    if (removeError) break;
    removed += paths.length;
  }
  return removed;
}

// Deletes one board if it still qualifies. Returns "deleted", "kept" or
// an error message.
async function deleteBoard(admin, board, cutoffs) {
  const guarded = () =>
    admin
      .from("boards")
      .delete()
      .eq("id", board.id)
      .not("deletion_warned_at", "is", null)
      .lte("deletion_warned_at", cutoffs.notice)
      .lte("last_activity_at", cutoffs.inactive)
      .select("id");

  let result = await guarded();
  if (result.error && result.error.code === "23503") {
    // The child tables don't cascade: clear them first, then retry.
    for (const table of ["strokes", "texts", "images"]) await admin.from(table).delete().eq("board_id", board.id);
    result = await guarded();
  }
  if (result.error) return `delete failed: ${result.error.message || result.error.code}`;
  if (!result.data || !result.data.length) return "kept";

  // Leftovers if the tables don't cascade (harmless no-ops if they do).
  for (const table of ["strokes", "texts", "images"]) await admin.from(table).delete().eq("board_id", board.id);
  await emptyFolder(admin, "board-images", String(board.id));
  await emptyFolder(admin, "reference-docs", String(board.id));
  return "deleted";
}

async function ownerDetails(admin, ownerId) {
  try {
    const { data, error } = await admin.auth.admin.getUserById(ownerId);
    if (error || !data || !data.user) return null;
    const u = data.user;
    const meta = u.user_metadata || {};
    const full = meta.full_name || meta.name || "";
    return { email: u.email, firstName: String(full).trim().split(/\s+/)[0] || "" };
  } catch (err) {
    return null;
  }
}

export async function runBoardCleanup({ admin, sendMail, from, appUrl, secret, now = Date.now(), dry = false }) {
  const report = { dry, deleted: [], kept: [], emailed: [], skipped: [], errors: [] };
  const cutoffs = {
    inactive: iso(now - RULES.deleteAfterDays * DAY),
    notice: iso(now - RULES.minNoticeDays * DAY),
    warn: iso(now - RULES.warnAfterDays * DAY),
  };

  // ---- 1. delete boards whose warning has run out ----
  const due = await admin
    .from("boards")
    .select("id, name, owner_id, last_activity_at, deletion_warned_at")
    .not("deletion_warned_at", "is", null)
    .lte("deletion_warned_at", cutoffs.notice)
    .lte("last_activity_at", cutoffs.inactive)
    .order("last_activity_at", { ascending: true })
    .limit(RULES.maxDeletesPerRun);
  if (due.error) {
    const missing = due.error.code === "42703" || /last_activity_at|deletion_warned_at/.test(due.error.message || "");
    report.errors.push(missing ? "not_set_up: run supabase/board-cleanup.sql first" : `listing boards: ${due.error.message}`);
    return report;
  }
  for (const board of due.data || []) {
    const entry = { id: board.id, name: board.name };
    if (dry) {
      report.deleted.push(entry);
      continue;
    }
    const outcome = await deleteBoard(admin, board, cutoffs);
    if (outcome === "deleted") report.deleted.push(entry);
    else if (outcome === "kept") report.kept.push(entry);
    else report.errors.push(`${board.id}: ${outcome}`);
  }

  // ---- 2. warn owners of boards unused for 23+ days ----
  const toWarn = await admin
    .from("boards")
    .select("id, name, owner_id, last_activity_at, thumbnail")
    .is("deletion_warned_at", null)
    .lte("last_activity_at", cutoffs.warn)
    .order("owner_id", { ascending: true })
    .order("last_activity_at", { ascending: true })
    .limit(RULES.maxBoardsScanned);
  if (toWarn.error) {
    report.errors.push(`listing boards to warn: ${toWarn.error.message}`);
    return report;
  }

  const byOwner = new Map();
  for (const b of toWarn.data || []) {
    if (!b.owner_id) continue;
    if (!byOwner.has(b.owner_id)) byOwner.set(b.owner_id, []);
    byOwner.get(b.owner_id).push(b);
  }

  const deleteOn = now + RULES.minNoticeDays * DAY;
  const logoCid = "clean-slate-mark@cleanslate";
  let sent = 0;
  for (const [ownerId, boards] of byOwner) {
    if (sent >= RULES.maxEmailsPerRun) {
      report.skipped.push({ owner: ownerId, reason: "daily email limit — next run" });
      continue;
    }
    const owner = await ownerDetails(admin, ownerId);
    if (!owner || !owner.email) {
      // Never delete without a warning: these stay un-warned (and kept).
      report.skipped.push({ owner: ownerId, reason: "no email address" });
      continue;
    }

    const attachments = [
      { filename: "clean-slate.png", content: Buffer.from(BRAND_MARK_PNG_BASE64, "base64"), contentType: "image/png", cid: logoCid },
    ];
    const shown = boards.slice(0, RULES.cardsPerEmail).map((b, i) => {
      let thumbCid = null;
      if (i < RULES.previewsPerEmail) {
        const img = dataUrlToBuffer(b.thumbnail);
        if (img) {
          thumbCid = `board-${i + 1}@cleanslate`;
          attachments.push({ filename: `board-${i + 1}.${img.contentType === "image/png" ? "png" : "jpg"}`, cid: thumbCid, ...img });
        }
      }
      return {
        id: b.id,
        name: b.name,
        lastActive: b.last_activity_at,
        thumbCid,
        openUrl: `${appUrl}/board/${b.id}`,
        keepUrl: keepUrl(appUrl, b.id, secret),
      };
    });
    const email = buildCleanupEmail({
      firstName: owner.firstName,
      boards: shown,
      moreCount: boards.length - shown.length,
      deleteOn,
      appUrl,
      logoCid,
      now,
    });

    const entry = { owner: owner.email, boards: boards.map((b) => b.name || b.id), subject: email.subject };
    if (dry) {
      report.emailed.push(entry);
      sent += 1;
      continue;
    }
    try {
      await sendMail({ from, to: owner.email, replyTo: from, subject: email.subject, html: email.html, text: email.text, attachments });
    } catch (err) {
      report.errors.push(`email to ${owner.email} failed: ${(err && (err.code || err.message)) || "unknown"}`);
      // A rejected login will fail for everyone — stop here.
      if (err && (err.code === "EAUTH" || err.responseCode === 535)) break;
      continue;
    }
    sent += 1;
    const ids = boards.map((b) => b.id);
    const marked = await admin
      .from("boards")
      .update({ deletion_warned_at: iso(now) })
      .in("id", ids)
      .is("deletion_warned_at", null);
    if (marked.error) report.errors.push(`marking warned for ${owner.email}: ${marked.error.message}`);
    report.emailed.push(entry);
  }

  return report;
}
