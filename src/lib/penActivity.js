// Tracks when a stylus (Apple Pencil, S Pen...) last touched any drawing
// surface, so toolbar buttons can ignore the palm/finger contacts that land
// in the moments right after a pen stroke — the classic "my palm hit the
// toolbar between strokes" problem. Plain module state: every drawing
// surface calls notePenActivity() on pen pointer events, and PalmSafeButton
// reads msSincePenActivity() when a touch lands on it.

let lastPenActivity = 0;

export function notePenActivity() {
  lastPenActivity = Date.now();
}

export function msSincePenActivity() {
  return Date.now() - lastPenActivity;
}
