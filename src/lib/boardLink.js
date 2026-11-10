// A board's own link, /b/<token> (see supabase/2026-11-security.sql):
// "anyone with the link can edit" is a switch the owner turns on. Boards
// made before November 2026 also still work by their plain address until
// the owner switches the link off.

import { supabase } from "./supabaseClient";

function missing(error) {
  return !!error && (error.code === "PGRST202" || error.code === "42883" || /function .* does not exist|could not find the function/i.test(error.message || ""));
}

// { on, token, legacy } | { missing: true } (the SQL hasn't been run) |
// { error }. on: true/false switches it, null just asks. fresh: a new
// link (the old one stops working).
export async function boardLink(boardId, on = null, fresh = false) {
  try {
    const { data, error } = await supabase.rpc("board_link", { p_board: boardId, p_on: on, p_new: fresh });
    if (error) return missing(error) ? { missing: true } : { error };
    if (!data) return { error: new Error("not yours") };
    return data;
  } catch (error) {
    return { error };
  }
}

export function boardLinkUrl(token) {
  return `${window.location.origin}/b/${token}`;
}

// Copies text, even when getting it takes a moment (Safari only lets a
// page copy straight after a tap, so the text is handed over as a promise).
// Resolves true when it was copied.
export async function copyLater(textPromise) {
  try {
    if (typeof window.ClipboardItem === "function" && navigator.clipboard && navigator.clipboard.write) {
      const blob = Promise.resolve(textPromise).then((t) => {
        if (!t) throw new Error("nothing to copy");
        return new Blob([t], { type: "text/plain" });
      });
      await navigator.clipboard.write([new window.ClipboardItem({ "text/plain": blob })]);
      return true;
    }
  } catch (err) {
    // fall through to the plain way
  }
  try {
    const text = await textPromise;
    if (!text) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    return false;
  }
}
