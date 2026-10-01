// The "your unused boards will be deleted" email. Built with tables and
// inline styles (what email apps reliably understand), in Clean Slate's
// colours: warm paper background, white card, ink text, blue buttons.

const C = {
  bg: "#F4F3EF",
  surface: "#FFFFFF",
  soft: "#F8F7F4",
  border: "#E4E2DC",
  ink: "#18191C",
  muted: "#5F5E5A",
  faint: "#9C9B97",
  accent: "#2451D6",
  accentSoft: "#EAF0FF",
  accentInk: "#1F46B8",
  warnSoft: "#FDF1E3",
  warnInk: "#A35A00",
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatDate(date) {
  return new Date(date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

function daysAgo(date, now) {
  const days = Math.max(0, Math.floor((now - new Date(date).getTime()) / 86400000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function button(href, label, primary) {
  const bg = primary ? C.accent : C.surface;
  const fg = primary ? "#FFFFFF" : C.ink;
  const border = primary ? C.accent : C.border;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:0 8px 8px 0"><tr><td bgcolor="${bg}" style="border-radius:10px;border:1px solid ${border};background:${bg}"><a href="${esc(href)}" target="_blank" style="display:inline-block;padding:10px 16px;font-family:${FONT};font-size:14px;font-weight:600;line-height:18px;color:${fg};text-decoration:none;border-radius:10px">${esc(label)}</a></td></tr></table>`;
}

function boardCard(board, now) {
  const preview = board.thumbCid
    ? `<img src="cid:${esc(board.thumbCid)}" width="200" height="125" alt="Preview of ${esc(board.name)}" style="display:block;width:200px;max-width:100%;height:auto;border:1px solid ${C.border};border-radius:8px;background:${C.surface}">`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="200"><tr><td height="125" align="center" valign="middle" style="height:125px;border:1px dashed ${C.border};border-radius:8px;background:${C.surface};font-family:${FONT};font-size:12px;color:${C.faint}">No preview</td></tr></table>`;
  return `<tr><td style="padding:0 0 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.soft};border:1px solid ${C.border};border-radius:12px">
<tr><td style="padding:14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="stack" width="214" valign="top" style="padding:0 14px 0 0">${preview}</td>
<td class="stack" valign="top" style="font-family:${FONT}">
<div style="font-size:16px;font-weight:650;color:${C.ink};line-height:1.35;margin:2px 0 4px">${esc(board.name || "Untitled board")}</div>
<div style="font-size:13px;color:${C.muted};margin:0 0 12px">Last used ${esc(daysAgo(board.lastActive, now))}</div>
${button(board.keepUrl, "Keep this board", true)}${button(board.openUrl, "Open board", false)}
</td></tr></table>
</td></tr></table>
</td></tr>`;
}

// boards: [{ id, name, lastActive, thumbCid?, openUrl, keepUrl }]
export function buildCleanupEmail({ firstName, boards, moreCount = 0, deleteOn, appUrl, logoCid, now = Date.now() }) {
  const count = boards.length + moreCount;
  const when = formatDate(deleteOn);
  const subject =
    count === 1
      ? `Your Clean Slate board “${boards[0].name || "Untitled board"}” will be deleted on ${when}`
      : `${count} of your Clean Slate boards will be deleted on ${when}`;
  const preheader =
    count === 1
      ? "It hasn't been used in a while. Keep it with one tap, or let it go."
      : "They haven't been used in a while. Keep the ones you need with one tap.";
  const helloText = firstName ? `Hi ${firstName},` : "Hi there,";
  const hello = esc(helloText);
  const intro =
    count === 1
      ? "This board hasn't been opened or drawn on for over three weeks. To keep Clean Slate fast and tidy, boards that go unused for 30 days are cleared away."
      : `These ${count} boards haven't been opened or drawn on for over three weeks. To keep Clean Slate fast and tidy, boards that go unused for 30 days are cleared away.`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<style>
@media (max-width:520px){ .stack{display:block!important;width:100%!important;padding:0 0 12px 0!important} .pad{padding-left:18px!important;padding-right:18px!important} }
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg}">
<tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">

<tr><td style="padding:0 4px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:10px"><img src="cid:${esc(logoCid)}" width="32" height="32" alt="" style="display:block;border-radius:9px"></td>
<td valign="middle" style="font-family:${FONT};font-size:17px;font-weight:700;color:${C.ink};letter-spacing:-0.01em">Clean Slate</td>
</tr></table>
</td></tr>

<tr><td bgcolor="${C.surface}" style="background:${C.surface};border:1px solid ${C.border};border-radius:14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="pad" style="padding:26px 28px 8px;font-family:${FONT}">
<div style="display:inline-block;padding:4px 10px;border-radius:999px;background:${C.warnSoft};color:${C.warnInk};font-size:12px;font-weight:600">Deleting on ${esc(when)}</div>
<h1 style="margin:14px 0 10px;font-size:22px;line-height:1.3;font-weight:700;color:${C.ink}">${count === 1 ? "Still need this board?" : "Still need these boards?"}</h1>
<p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:${C.ink}">${hello}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${C.muted}">${esc(intro)}</p>
</td></tr>
<tr><td class="pad" style="padding:0 28px 6px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${boards.map((b) => boardCard(b, now)).join("\n")}
</table>
${moreCount > 0 ? `<p style="margin:0 0 14px;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.muted}">…and ${moreCount} more ${moreCount === 1 ? "board" : "boards"} you haven't used in a while. <a href="${esc(appUrl)}" style="color:${C.accent};font-weight:600">See them all on your boards page</a> — opening one keeps it.</p>` : ""}
</td></tr>
<tr><td class="pad" style="padding:6px 28px 26px;font-family:${FONT}">
<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:${C.muted}"><strong style="color:${C.ink}">Want to keep ${count === 1 ? "it" : "one"}?</strong> Tap <em>Keep this board</em>, or just open it — anything opened or drawn on before ${esc(when)} stays.</p>
<p style="margin:0;font-size:14px;line-height:1.6;color:${C.muted}"><strong style="color:${C.ink}">Done with ${count === 1 ? "it" : "them"}?</strong> You don't need to do anything. ${count === 1 ? "It" : "They"}'ll be deleted for good, along with any pictures on ${count === 1 ? "it" : "them"}.</p>
</td></tr>
</table>
</td></tr>

<tr><td style="padding:18px 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.faint};text-align:center">
You're getting this because you own ${count === 1 ? "this board" : "these boards"} on <a href="${esc(appUrl)}" style="color:${C.muted};text-decoration:underline">Clean Slate</a>.<br>
Questions? Just reply to this email.
</td></tr>

</table>
</td></tr>
</table>
</body></html>`;

  const text = [
    helloText,
    "",
    intro,
    "",
    ...boards.flatMap((b) => [
      `• ${b.name || "Untitled board"} (last used ${daysAgo(b.lastActive, now)})`,
      `  Keep it: ${b.keepUrl}`,
      `  Open it: ${b.openUrl}`,
      "",
    ]),
    moreCount > 0 ? `…and ${moreCount} more. See them all at ${appUrl}\n` : "",
    `Anything opened or drawn on before ${when} stays. If you're done with ${count === 1 ? "it" : "them"}, you don't need to do anything.`,
    "",
    "— Clean Slate",
    appUrl,
  ].join("\n");

  return { subject, html, text };
}
