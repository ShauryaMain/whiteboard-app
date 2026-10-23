// Compact ink for notebooks.
//
// A board saves each stroke as a list of { x, y } numbers, about 25 bytes
// a point. Notebooks are kept for good, so their strokes are saved packed:
//
//   { f: 1, o: [x0, y0], pk: "dx,dy,dx,dy,…", pw?: "w,w,…", …style }
//
// - every position is rounded to a tenth of a board unit (a tenth of a
//   pixel at 100%), and stored as the step from the point before;
// - points that add nothing (on a straight-enough run) are dropped first;
// - `o` is where the stroke starts, so moving a stroke only changes `o`
//   (the database can do that without unpacking: see move_objects);
// - `pw`: the eraser's width at each point (only eraser strokes have it).
//
// On screen a stroke is always the plain { points: [{ x, y }] } form.
// Packed strokes only ever come from notebooks, which older copies of the
// app never open.

const Q = 10; // steps per board unit
const SIMPLIFY = 0.15; // board units a dropped point may be off the line

// Ramer–Douglas–Peucker, iterative (no recursion): keeps the points that
// matter for the shape, always the first and the last.
export function simplifyPoints(points, tolerance = SIMPLIFY) {
  const n = points.length;
  if (n <= 2) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = points[a].x, ay = points[a].y;
    const dx = points[b].x - ax, dy = points[b].y - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = tol2;
    for (let i = a + 1; i < b; i++) {
      const px = points[i].x - ax, py = points[i].y - ay;
      let d2;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx, ey = py - t * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > worstD) {
        worstD = d2;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

const q = (v) => Math.round(Number(v) * Q);

// A stroke's saved data, packed. `stroke` is the on-screen form.
export function packStroke(stroke) {
  const { points, id, ...style } = stroke || {};
  const list = Array.isArray(points) ? points.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
  if (!list.length) return { ...style, points: [] };
  const eraser = list.some((p) => p.w !== undefined);
  const pts = eraser ? list : simplifyPoints(list);
  let px = q(pts[0].x), py = q(pts[0].y);
  const steps = [];
  for (let i = 1; i < pts.length; i++) {
    const x = q(pts[i].x), y = q(pts[i].y);
    steps.push(x - px, y - py);
    px = x;
    py = y;
  }
  const data = { ...style, f: 1, o: [q(pts[0].x) / Q, q(pts[0].y) / Q], pk: steps.join(",") };
  if (eraser) data.pw = pts.map((p) => (p.w === undefined ? "" : String(Math.round(p.w * Q) / Q))).join(",");
  return data;
}

export function isPacked(data) {
  return !!data && data.f === 1 && Array.isArray(data.o) && typeof data.pk === "string";
}

// Saved data (packed or plain) -> the on-screen form's fields.
export function unpackStroke(data) {
  if (!isPacked(data)) return data;
  const { f, o, pk, pw, ...style } = data;
  let x = Math.round(Number(o[0]) * Q);
  let y = Math.round(Number(o[1]) * Q);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ...style, points: [] };
  const points = [{ x: x / Q, y: y / Q }];
  if (pk) {
    const nums = pk.split(",");
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const dx = parseInt(nums[i], 10), dy = parseInt(nums[i + 1], 10);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) break;
      x += dx;
      y += dy;
      points.push({ x: x / Q, y: y / Q });
    }
  }
  if (typeof pw === "string") {
    const ws = pw.split(",");
    for (let i = 0; i < points.length && i < ws.length; i++) {
      const w = parseFloat(ws[i]);
      if (Number.isFinite(w)) points[i].w = w;
    }
  }
  return { ...style, points };
}
