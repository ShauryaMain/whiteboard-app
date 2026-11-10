// Opening stored files (pictures, PDFs, homework pages, previews, fonts).
//
// The storage buckets are private, so a file's plain address (the one kept
// on the board, ".../storage/v1/object/public/<bucket>/<path>") doesn't
// open it. This asks /api/files/sign for a link that works for a few hours,
// for every file the person is allowed to open, many at a time, and keeps
// the answers until they're nearly out of date.
//
// Everything else (data: and blob: addresses, the app's own files) passes
// straight through. If the links can't be had (the server isn't set up for
// it, or is unreachable), the plain address is used: that still works for
// as long as the buckets are public.
//
//   fileUrl(url)       Promise of an address to load (always resolves)
//   fileUrlNow(url)    the address to load right now, or null while it's
//                      being fetched (asks for it); for <img src>
//   useFileUrls()      re-renders a component when new links arrive
//   setFileLinkToken() someone reading a notebook by its link: send the
//                      link along, so its files open for them too

import { useSyncExternalStore } from "react";
import { supabase, getRealClient } from "./supabaseClient";

const MARK = "/storage/v1/object/public/";
const BUCKETS = new Set(["board-images", "reference-docs"]);
const BATCH = 250;
const WAIT_MS = 20;
const RETRY_AFTER_MS = 60 * 1000; // a file that couldn't be signed: plain address for a minute, then ask again

const HOST = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin;
  } catch (err) {
    return null;
  }
})();

const cache = new Map(); // "bucket/path" -> { url, until } (url null: use the plain address)
const waiting = new Map(); // "bucket/path" -> [resolve, …]
let timer = null;
let linkToken = null;
let version = 0;
const listeners = new Set();

function tell() {
  version += 1;
  listeners.forEach((l) => l());
}

// "bucket/path" for a stored file's plain address, else null.
export function storedFile(url) {
  if (typeof url !== "string" || !HOST || !url.startsWith(HOST + MARK)) return null;
  let rest = url.slice(HOST.length + MARK.length);
  const q = rest.search(/[?#]/);
  if (q >= 0) rest = rest.slice(0, q);
  try {
    rest = decodeURIComponent(rest);
  } catch (err) {
    return null;
  }
  const bucket = rest.slice(0, rest.indexOf("/"));
  if (!BUCKETS.has(bucket) || rest.length <= bucket.length + 1 || rest.includes("..")) return null;
  return rest;
}

export function setFileLinkToken(token) {
  const next = typeof token === "string" && /^[A-Za-z0-9]{16,64}$/.test(token) ? token : null;
  if (next === linkToken) return;
  linkToken = next;
  // what was refused without the link may open with it
  for (const [key, hit] of cache) if (!hit.url) cache.delete(key);
}

function fresh(hit) {
  return hit && hit.until > Date.now();
}

async function signInToken() {
  try {
    const client = supabase && supabase.__demo ? getRealClient() : supabase;
    const { data } = await client.auth.getSession();
    return data && data.session ? data.session.access_token : null;
  } catch (err) {
    return null;
  }
}

async function ask(files, retried = false) {
  const token = await signInToken();
  const res = await fetch("/api/files/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ files, ...(linkToken ? { token: linkToken } : {}) }),
  });
  if (res.status === 401 && !retried) {
    // the sign-in had run out: refresh it, then once more
    try {
      await supabase.auth.refreshSession();
    } catch (err) {
      // signed out: asked as nobody
    }
    return ask(files, true);
  }
  if (!res.ok) throw new Error(`sign ${res.status}`);
  return res.json();
}

async function flush() {
  timer = null;
  const keys = [...waiting.keys()];
  for (let i = 0; i < keys.length; i += BATCH) {
    const some = keys.slice(i, i + BATCH);
    let urls = {};
    let life = 0;
    try {
      const out = await ask(some);
      urls = (out && out.urls) || {};
      life = Number(out && out.expiresIn) || 0;
    } catch (err) {
      urls = {};
    }
    const now = Date.now();
    for (const key of some) {
      const url = typeof urls[key] === "string" ? urls[key] : null;
      // kept until most of its life is used up
      cache.set(key, { url, until: url && life ? now + life * 800 : now + RETRY_AFTER_MS });
      const list = waiting.get(key) || [];
      waiting.delete(key);
      list.forEach((resolve) => resolve());
    }
  }
  tell();
}

function request(key) {
  return new Promise((resolve) => {
    if (!waiting.has(key)) waiting.set(key, []);
    waiting.get(key).push(resolve);
    if (!timer) timer = setTimeout(flush, WAIT_MS);
  });
}

// The address to load for `url` (resolves with the plain one if no link
// can be had).
export async function fileUrl(url) {
  const key = storedFile(url);
  if (!key) return url;
  let hit = cache.get(key);
  if (!fresh(hit)) {
    await request(key);
    hit = cache.get(key);
  }
  return (hit && hit.url) || url;
}

// For <img src>: the address now, or null while it's on its way (the
// component re-renders when it arrives, with useFileUrls). Pass the number
// useFileUrls gave, so a memoised render asks again when it changes.
export function fileUrlNow(url, version) {
  const key = storedFile(url);
  if (!key) return url;
  const hit = cache.get(key);
  if (fresh(hit)) return hit.url || url;
  if (!waiting.has(key)) request(key);
  return hit && hit.url && hit.until > Date.now() - 60 * 60 * 1000 ? hit.url : null;
}

// Asks for many at once, ahead of drawing them.
export function prefetchFiles(urls) {
  for (const url of urls || []) {
    const key = storedFile(url);
    if (key && !fresh(cache.get(key)) && !waiting.has(key)) request(key);
  }
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function snapshot() {
  return version;
}
function serverSnapshot() {
  return 0;
}

export function useFileUrls() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
