// Signing in with a code sent by email: the page's side (the server side
// is src/app/api/auth/email-code/route.js). Kept out of the components so
// they stay simple.

let availability = null;

// Whether this site can send sign-in codes (asked once per page).
export function emailCodesAvailable() {
  if (!availability) {
    availability = fetch("/api/auth/email-code", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((body) => Boolean(body && body.available))
      .catch(() => false);
  }
  return availability;
}

// Sends a code. Resolves to { ok } or { error, message }.
export async function sendEmailCode(email) {
  try {
    const res = await fetch("/api/auth/email-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) return { ok: true };
    if (body.error === "bad_email") return { error: "bad_email", message: "That doesn't look like an email address. Check it and try again." };
    if (body.error === "rate_limited") {
      const wait = Math.max(1, Number(body.retryAfter) || 60);
      const when = wait < 90 ? `${wait} seconds` : `${Math.ceil(wait / 60)} minutes`;
      const message =
        body.reason === "too_soon"
          ? `A code was sent a moment ago. You can ask for another in ${when}.`
          : body.reason === "busy"
            ? "Clean Slate is sending a lot of codes right now. Please sign in with Google, or try again later."
            : `That's a lot of codes in a short time. You can ask for another in ${when}.`;
      return { error: "rate_limited", message };
    }
    if (body.error === "not_configured") return { error: "not_configured", message: "Email codes aren't set up on this site yet. Please sign in with Google." };
    return { error: "send_failed", message: "The email couldn't be sent just now. Try again in a minute." };
  } catch (err) {
    return { error: "offline", message: "Couldn't reach Clean Slate. Check your connection and try again." };
  }
}

// Checks the code with Supabase, which signs the person in.
// Resolves to { ok } or { error, message }.
export async function verifyEmailCode(client, email, code) {
  const token = String(code || "").replace(/\D/g, "");
  if (token.length < 6) return { error: "short", message: "That code looks too short. Check the email and try again." };
  try {
    const address = String(email || "").trim().toLowerCase();
    const { data, error } = await client.auth.verifyOtp({ email: address, token, type: "email" });
    if (error || !data || !data.session) {
      // (Supabase gives the same answer for a wrong code and an old one)
      return { error: "wrong", message: "That code didn't work, or it has run out. Check it, or ask for a new one." };
    }
    return { ok: true, user: data.user };
  } catch (err) {
    return { error: "offline", message: "Couldn't reach Clean Slate. Check your connection and try again." };
  }
}
