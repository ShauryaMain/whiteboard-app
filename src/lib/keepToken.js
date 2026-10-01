// Signed "Keep this board" links for the clean-up warning email, so the
// button works without signing in but can't be guessed for other boards.
// Server-only (uses Node's crypto).

import crypto from "node:crypto";

export function keepSecret() {
  return process.env.BOARD_KEEP_SECRET || process.env.CRON_SECRET || "";
}

export function signKeep(boardId, secret = keepSecret()) {
  return crypto.createHmac("sha256", secret).update(`keep:${boardId}`).digest("base64url").slice(0, 32);
}

export function verifyKeep(boardId, token, secret = keepSecret()) {
  if (!secret || !boardId || typeof token !== "string") return false;
  const expected = Buffer.from(signKeep(boardId, secret));
  const given = Buffer.from(token);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function keepUrl(appUrl, boardId, secret = keepSecret()) {
  const params = new URLSearchParams({ b: String(boardId), t: signKeep(boardId, secret) });
  return `${appUrl}/api/boards/keep?${params.toString()}`;
}
