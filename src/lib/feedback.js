// Client-side helpers for the feedback dialog: shrinking screenshots so
// they fit in one upload, collecting device details, and sending it all to
// /api/feedback (which emails the Clean Slate team).

import { supabase } from "./supabaseClient";
import { getPencilOnly, getPenSeen } from "./pencilPrefs";

export const SUPPORT_EMAIL = "cleanslatesupportoffical@gmail.com";
export const MAX_SCREENSHOTS = 5;
const TARGET_BYTES = 850 * 1024;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("unreadable"));
    img.src = src;
  });
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => (canvas.toBlob ? canvas.toBlob((b) => resolve(b), type, quality) : resolve(null)));
}

async function encode(img, maxSide, type, quality) {
  const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
  const ctx = canvas.getContext("2d");
  if (type === "image/jpeg") {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return toBlob(canvas, type, quality);
}

// Keeps screenshots sharp enough to read but small enough to send: PNG
// when that's small, otherwise JPEG, shrinking further only if needed.
// Resolves to { file, url } or null if the image can't be read.
export async function prepareScreenshot(file) {
  const src = URL.createObjectURL(file);
  try {
    const img = await loadImage(src);
    const attempts = [
      [1920, "image/png"],
      [1920, "image/jpeg", 0.86],
      [1440, "image/jpeg", 0.8],
      [1100, "image/jpeg", 0.75],
    ];
    let blob = null;
    for (const [side, type, q] of attempts) {
      blob = await encode(img, side, type, q);
      if (blob && blob.size <= TARGET_BYTES) break;
    }
    if (!blob) return null;
    const ext = blob.type === "image/jpeg" ? "jpg" : "png";
    const out = new File([blob], `screenshot.${ext}`, { type: blob.type });
    return { file: out, url: URL.createObjectURL(out) };
  } catch (err) {
    return null;
  } finally {
    URL.revokeObjectURL(src);
  }
}

export function imageFiles(list) {
  return Array.from(list || []).filter((f) => f && f.type && f.type.indexOf("image/") === 0);
}

export function collectDeviceDetails(extra = {}) {
  if (typeof window === "undefined") return {};
  const mq = (q) => {
    try {
      return window.matchMedia(q).matches;
    } catch (err) {
      return false;
    }
  };
  let timeZone = "";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch (err) {
    timeZone = "";
  }
  const input = [
    mq("(pointer: coarse)") ? "touch screen" : "mouse/trackpad",
    navigator.maxTouchPoints ? `${navigator.maxTouchPoints} touch points` : "",
    getPenSeen() ? "stylus used" : "",
  ].filter(Boolean).join(", ");
  return {
    page: window.location.pathname,
    userAgent: navigator.userAgent,
    screen: `${window.screen.width}×${window.screen.height} @${window.devicePixelRatio || 1}x`,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    input,
    pencilOnly: getPenSeen() ? (getPencilOnly() ? "on" : "off") : "",
    language: navigator.language || "",
    timeZone,
    ...extra,
  };
}

// Sends the feedback. Resolves to { ok: true } or { ok: false, code, message }.
export async function sendFeedback({ type, message, area, impact, replyOk, tech, screenshots }) {
  const form = new FormData();
  form.append("type", type);
  form.append("message", message);
  if (area) form.append("area", area);
  if (impact) form.append("impact", impact);
  form.append("replyOk", replyOk ? "1" : "0");
  if (tech) form.append("tech", JSON.stringify(tech));
  for (const shot of screenshots || []) form.append("screenshots", shot.file, shot.file.name);

  let token = "";
  try {
    const { data } = await supabase.auth.getSession();
    token = (data && data.session && data.session.access_token) || "";
  } catch (err) {
    token = "";
  }

  let response;
  try {
    response = await fetch("/api/feedback", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
  } catch (err) {
    return { ok: false, code: "offline", message: "You seem to be offline. Check your connection and try again." };
  }
  let body = null;
  try {
    body = await response.json();
  } catch (err) {
    body = null;
  }
  if (response.ok && body && body.ok) return { ok: true };
  if (body && body.detail) console.warn("Feedback not sent:", body.error, body.detail);
  if (response.status === 413) {
    return { ok: false, code: "too_big", message: "The screenshots are too large together — try removing one." };
  }
  return {
    ok: false,
    code: (body && body.error) || `http_${response.status}`,
    message: (body && body.message) || "We couldn't send that just now.",
  };
}

export function mailtoLink({ type, message }) {
  const label = type === "bug" ? "Bug report" : type === "improvement" ? "Improvement" : "Feedback";
  const subject = `[${label}] ${String(message || "").split("\n")[0].slice(0, 60)}`;
  const body = `${message || ""}\n\n(Attach any screenshots to this email.)`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// What was typed survives closing the dialog by accident (until the page
// is reloaded or the feedback is sent).
let savedDraft = null;
export function getFeedbackDraft() {
  return savedDraft;
}
export function setFeedbackDraft(draft) {
  savedDraft = draft;
}

let shotCounter = 0;
export function nextShotId() {
  shotCounter += 1;
  return shotCounter;
}
