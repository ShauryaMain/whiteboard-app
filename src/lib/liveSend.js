// Sending on a live channel while its connection may be down.
//
// When the connection has dropped (Wi-Fi blip, a tablet waking up) and is
// joining again, Supabase's library sends each message as a separate web
// request instead. Those can arrive out of order, or not at all: someone
// could get the points of a line before its start (and throw them away),
// and the line was missing for them while it showed fine for the writer.
//
// So while the channel isn't connected:
//   • messages that only matter right now (the line as it is being drawn,
//     a box being dragged) are skipped: what they show is sent whole later;
//   • everything else (a finished line, things added or removed…) waits,
//     in order, and goes as soon as the channel is back.
// Messages that replace the previous one of the same kind (the graphs, the
// page) only keep the latest while waiting.

const LIVE_ONLY = new Set([
  "stroke-start", "stroke-points", "stroke-straight", "stroke-shape",
  "text-move", "text-transform", "person-where",
  "teacher-ink-start", "teacher-ink-points",
  // the reference document: a laser pointer moving
  "ref-laser",
  // answers to "what's on you?": whoever asked asks again
  "classroom-state-snapshot", "classroom-state-piece", "classroom-state-done",
]);
const LATEST_ONLY = new Set(["grid-set", "background-set", "sim-embeds-set", "class-state", "reference-update", "ref-view"]);
const MAX_WAITING = 400;

export function isConnected(channel) {
  if (!channel) return false;
  // (stand-in channels in the demo don't say: they are always "connected")
  if (channel.state === undefined) return true;
  if (channel.state !== "joined") return false;
  const socket = channel.socket;
  return !socket || typeof socket.isConnected !== "function" || socket.isConnected();
}

// Wraps a channel: .send() as usual, .flush() once it has (re)joined.
export function createSender(channel) {
  const waiting = [];
  const sender = {
    channel,
    send(message) {
      if (isConnected(channel)) return channel.send(message);
      const event = message && message.event;
      if (message && message.type === "broadcast" && LIVE_ONLY.has(event)) return Promise.resolve("skipped");
      if (LATEST_ONLY.has(event)) {
        const at = waiting.findIndex((m) => m.event === event);
        if (at >= 0) waiting.splice(at, 1);
      }
      waiting.push(message);
      if (waiting.length > MAX_WAITING) waiting.shift();
      return Promise.resolve("queued");
    },
    // Sends what waited, in order (call when the channel has joined).
    flush() {
      while (waiting.length && isConnected(channel)) {
        const message = waiting.shift();
        try {
          channel.send(message);
        } catch (err) {
          // gone again: the rest keeps waiting
          waiting.unshift(message);
          return;
        }
      }
    },
    waitingCount() {
      return waiting.length;
    },
    on(...args) {
      return channel.on(...args);
    },
  };
  return sender;
}

// A finished line, whole, for the "stroke-end" message (so whoever missed
// any of the live messages still gets it). Left out when it's enormous.
const WHOLE_STROKE_CHARS = 200000;
export function wholeStroke(stroke) {
  if (!stroke || !stroke.id || !Array.isArray(stroke.points) || stroke.points.length < 2) return null;
  try {
    if (JSON.stringify(stroke.points).length > WHOLE_STROKE_CHARS) return null;
  } catch (err) {
    return null;
  }
  const out = { id: stroke.id, tool: stroke.tool, color: stroke.color, width: stroke.width, opacity: stroke.opacity, points: stroke.points };
  if (stroke.dash) out.dash = stroke.dash;
  return out;
}

// A finished line that arrived from someone else: checked before it is used.
export function cleanIncomingStroke(s) {
  if (!s || typeof s !== "object" || typeof s.id !== "string" || !Array.isArray(s.points) || s.points.length < 2) return null;
  const points = [];
  for (const p of s.points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    points.push(Number.isFinite(p.w) ? { x: p.x, y: p.y, w: p.w } : { x: p.x, y: p.y });
  }
  const out = {
    id: s.id,
    tool: typeof s.tool === "string" ? s.tool : "pen",
    color: typeof s.color === "string" ? s.color : "#1a1a1a",
    width: Number.isFinite(s.width) ? s.width : 3,
    opacity: Number.isFinite(s.opacity) ? s.opacity : 1,
    points,
  };
  if (s.dash) out.dash = s.dash;
  return out;
}
