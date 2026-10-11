// The "your sign-in code" email, in the same style as the board clean-up
// email (cleanupEmail.js): tables and inline styles, Clean Slate's colours,
// the logo attached inline.

import { esc } from "./cleanupEmail";

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
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";

// "123456" → "123 456" (easier to read and type); longer codes in threes.
export function spacedCode(code) {
  const digits = String(code || "").replace(/\D/g, "");
  return digits.replace(/(\d{3})(?=\d)/g, "$1 ");
}

export function signInCodeEmail({ code, appUrl, logoCid }) {
  const shown = spacedCode(code);
  const subject = `${shown} is your Clean Slate code`;
  const preheader = `Type ${shown} to sign in. It only works for a short while.`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg}">
<tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">

<tr><td style="padding:0 4px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:10px"><img src="cid:${esc(logoCid)}" width="32" height="32" alt="" style="display:block;border-radius:9px"></td>
<td valign="middle" style="font-family:${FONT};font-size:17px;font-weight:700;color:${C.ink};letter-spacing:-0.01em">Clean Slate</td>
</tr></table>
</td></tr>

<tr><td bgcolor="${C.surface}" style="background:${C.surface};border:1px solid ${C.border};border-radius:14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:26px 28px 6px;font-family:${FONT}">
<h1 style="margin:0 0 10px;font-size:21px;line-height:1.3;font-weight:700;color:${C.ink}">Your sign-in code</h1>
<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:${C.muted}">Type this code on the Clean Slate page that asked for it.</p>
</td></tr>
<tr><td align="center" style="padding:0 28px 18px">
<div style="display:inline-block;padding:14px 22px;border-radius:12px;background:${C.accentSoft};border:1px solid ${C.border};font-family:${MONO};font-size:30px;font-weight:700;letter-spacing:0.12em;color:${C.ink}">${esc(shown)}</div>
</td></tr>
<tr><td style="padding:0 28px 24px;font-family:${FONT}">
<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:${C.muted}">It only works for a short while. If it has run out, ask for a new one on the same page.</p>
<p style="margin:0;font-size:14px;line-height:1.6;color:${C.muted}"><strong style="color:${C.ink}">On a laptop or iPad later?</strong> Open <a href="${esc(appUrl)}" style="color:${C.accent};font-weight:600">${esc(appUrl.replace(/^https?:\/\//, ""))}</a> and sign in with this email address. Your boards will be there.</p>
</td></tr>
</table>
</td></tr>

<tr><td style="padding:18px 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.faint};text-align:center">
Someone asked to sign in to Clean Slate with this email address. If it wasn't you, you can ignore this email: nothing happens without the code.
</td></tr>

</table>
</td></tr>
</table>
</body></html>`;
  const text = [
    "Clean Slate",
    "",
    `Your sign-in code: ${shown}`,
    "",
    "Type it on the Clean Slate page that asked for it. It only works for a short while; if it has run out, ask for a new one on the same page.",
    "",
    `On a laptop or iPad later? Open ${appUrl} and sign in with this email address. Your boards will be there.`,
    "",
    "Someone asked to sign in to Clean Slate with this email address. If it wasn't you, you can ignore this email: nothing happens without the code.",
  ].join("\n");
  return { subject, html, text };
}
