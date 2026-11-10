// Limits counted in the database (rate_take in supabase/2026-11-security.sql),
// so they hold across every copy of the server, not just the one a request
// happens to land on. Server only: it needs the service-role client.
//
// Keys are hashed before they're stored: the database never sees an email
// address or an IP address.

import crypto from "node:crypto";

export function rateKey(kind, value) {
  const hash = crypto.createHash("sha256").update(`${kind}:${String(value || "").toLowerCase()}`).digest("base64url").slice(0, 32);
  return `${kind}:${hash}`;
}

// rules: [{ key, max, seconds }]. Resolves to:
//   { ok: true }
//   { ok: false, key, retryAfter }   key: the rule that was full
//   { ok: true, unchecked: true }    the database couldn't say (the SQL
//                                    hasn't been run, or it's unreachable):
//                                    the in-memory limits still apply then
export async function takeRate(admin, rules) {
  if (!admin || !rules || !rules.length) return { ok: true, unchecked: true };
  try {
    const { data, error } = await admin.rpc("rate_take", { p_rules: rules });
    if (error || !data) return { ok: true, unchecked: true };
    if (data.ok) return { ok: true };
    return { ok: false, key: String(data.key || ""), retryAfter: Number(data.retry_after) || 60 };
  } catch (err) {
    return { ok: true, unchecked: true };
  }
}
