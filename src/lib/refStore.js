// Keeping the reference document and its markings with the board (see
// supabase/2026-10-19-reference-docs.sql): the document in
// boards.reference_doc, each marking as a row of reference_marks.
// Until that file has been run, everything still works live, it just
// isn't kept.

import { fetchAllRows } from "./boardSync";
import { normalizeDoc, normalizeMark } from "./refDoc";

export const MARKS_TABLE = "reference_marks";

export function isMissing(error) {
  const code = String((error && error.code) || "");
  const msg = String((error && error.message) || "");
  return (
    code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205" ||
    /does not exist|could not find the|schema cache/i.test(msg)
  );
}

export function markRow(boardId, m) {
  const { id, ...data } = m;
  return { id, board_id: boardId, data };
}

export function rowToMark(r) {
  return normalizeMark({ ...(r.data || {}), id: r.id });
}

// -> { doc, marks, docSaved, marksSaved }
//    docSaved / marksSaved: whether the database can keep them.
//    null when it couldn't be asked just now.
// `known`: { doc } when the document has already come with the board
// (open_board), so only its markings are fetched.
export async function loadReference(client, boardId, known = null) {
  if (!client || !boardId) return null;
  let doc = null;
  let docSaved = true;
  if (known) {
    doc = normalizeDoc(known.doc);
  } else {
    let result;
    try {
      result = await client.from("boards").select("reference_doc").eq("id", boardId).maybeSingle();
    } catch (err) {
      return null;
    }
    if (result.error) {
      if (!isMissing(result.error)) return null;
      docSaved = false;
    } else {
      doc = normalizeDoc(result.data && result.data.reference_doc);
    }
  }
  let marks = [];
  let marksSaved = true;
  if (doc) {
    const { rows, error } = await fetchAllRows((withCount) =>
      client
        .from(MARKS_TABLE)
        .select("id, data", withCount ? { count: "exact" } : undefined)
        .eq("board_id", boardId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
    );
    if (error) {
      if (!isMissing(error)) return null;
      marksSaved = false;
    } else {
      marks = rows.map(rowToMark).filter(Boolean);
    }
  } else {
    // (the markings' table comes with the document's column)
    marksSaved = docSaved;
  }
  return { doc, marks, docSaved, marksSaved };
}

// "saved", "missing" (the database can't keep it yet) or "failed".
export async function saveReferenceDoc(client, boardId, doc) {
  let result;
  try {
    result = await client.from("boards").update({ reference_doc: doc || null }).eq("id", boardId);
  } catch (err) {
    result = { error: err };
  }
  if (!result.error) return "saved";
  if (isMissing(result.error)) return "missing";
  console.error("Could not save the reference document:", result.error);
  return "failed";
}

export async function deleteMarkRows(client, ids) {
  if (!ids.length) return null;
  try {
    const { error } = await client.from(MARKS_TABLE).delete().in("id", ids);
    return error || null;
  } catch (err) {
    return err;
  }
}

export async function deleteAllMarks(client, boardId) {
  try {
    const { error } = await client.from(MARKS_TABLE).delete().eq("board_id", boardId);
    return error || null;
  } catch (err) {
    return err;
  }
}


