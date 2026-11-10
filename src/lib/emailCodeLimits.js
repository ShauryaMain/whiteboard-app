// Limits on sending sign-in codes by email (see
// src/app/api/auth/email-code/route.js), so the form can't be used to
// flood someone's inbox or the support Gmail account.
//
// Counted here per server instance (a quick first brake), and again in the
// database across every instance (src/lib/rateLimit.js), so the limits
// hold however many copies of the server are running. Gmail's own daily
// sending cap (about 500) is the last line: allPerDay stays well under it,
// leaving room for feedback and the clean-up emails.

export const LIMITS = {
  perEmailGapMs: 45 * 1000, // one code per address every 45 seconds
  perEmailPerHour: 5,
  perIpPerHour: 12,
  perInstancePerDay: 100,
  allPerDay: 300, // every sign-in code, all servers together
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function createLimiter(limits = LIMITS) {
  const byEmail = new Map(); // email -> [times]
  const byIp = new Map(); // ip -> [times]
  let all = []; // every send in the last day

  const recent = (list, now, span) => (list || []).filter((t) => now - t < span);

  // { ok: true } or { ok: false, retryAfter: seconds, reason }
  function check(email, ip, now = Date.now()) {
    const e = recent(byEmail.get(email), now, HOUR);
    const i = recent(byIp.get(ip), now, HOUR);
    all = recent(all, now, DAY);
    if (e.length && now - e[e.length - 1] < limits.perEmailGapMs) {
      return { ok: false, reason: "too_soon", retryAfter: Math.ceil((limits.perEmailGapMs - (now - e[e.length - 1])) / 1000) };
    }
    if (e.length >= limits.perEmailPerHour) return { ok: false, reason: "too_many", retryAfter: Math.ceil((HOUR - (now - e[0])) / 1000) };
    if (ip && i.length >= limits.perIpPerHour) return { ok: false, reason: "too_many", retryAfter: Math.ceil((HOUR - (now - i[0])) / 1000) };
    if (all.length >= limits.perInstancePerDay) return { ok: false, reason: "busy", retryAfter: 3600 };
    return { ok: true };
  }

  function record(email, ip, now = Date.now()) {
    byEmail.set(email, [...recent(byEmail.get(email), now, HOUR), now]);
    if (ip) byIp.set(ip, [...recent(byIp.get(ip), now, HOUR), now]);
    all.push(now);
    // keep the maps from growing for ever
    if (byEmail.size > 5000) byEmail.clear();
    if (byIp.size > 5000) byIp.clear();
  }

  // Checks and, if allowed, counts the send straight away (before any
  // waiting), so many requests at once can't all slip through. A send that
  // later fails still counts.
  function take(email, ip, now = Date.now()) {
    const allowed = check(email, ip, now);
    if (allowed.ok) record(email, ip, now);
    return allowed;
  }

  return { check, record, take };
}

// A plain email address check (the real check is that the code arrives).
export function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  if (!/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i.test(email)) return null;
  return email;
}
