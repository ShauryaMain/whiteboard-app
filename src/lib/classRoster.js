// Who is in a live class, and what each student has signalled.
//
// Two things come over the class's live connection:
//   • "presence": each student's page announces itself once when it joins
//     ({ studentId, name, joinedAt }) and is taken off automatically when
//     it leaves. That is the list of who is here.
//   • "student-status" messages: a student's page says when its hand goes
//     up or down, or it is marked done ({ studentId, hand, handAt, done }).
//
// Why the hand isn't simply part of the presence announcement: changing an
// announcement that is already there trips a fault in the live-connection
// library (it loses track of the announcement, and the student then never
// drops off the list when they leave). Announcing once and sending the
// signals separately avoids it.

// ---------- who is here ----------
//
// The live-connection library keeps its own list of announcements
// (presenceState()), but the same fault can leave someone on that list
// after they have gone: it happens when one announcement is swapped for
// another in a single step, which is what the server reports when a
// student moves from the "You're in!" screen to the lesson, or a teacher
// from the class-code screen to the board. So the board keeps its own
// record, built from the "joined" and "left" events themselves (which are
// reported correctly), and uses the library's list only to notice people
// who vanished while this device was offline.
//
// One more wrinkle: when this device has been offline and reconnects, the
// library goes through its whole list again, and for anything it had
// already lost track of it reports a "left" with no id on it. That event
// can't say who left, but it does mean "this person's entry was re-read",
// so the record for them is cut back to the announcements that the same
// re-read confirmed (see attendanceLeave).
//
// An attendance record: { here, recent }.
//   here    key -> Map(announcement id -> announcement): who is in the class
//   recent  key -> Set(announcement ids) reported since the last "sync"

export function createAttendance() {
  return { here: new Map(), recent: new Map() };
}

export function attendanceHas(attendance, key) {
  return attendance.here.has(key);
}

function idsOf(list) {
  return (list || []).filter((a) => a && a.presence_ref !== undefined).map((a) => a.presence_ref);
}

// From a presence "join" event: { key, newPresences, currentPresences }.
export function attendanceJoin(attendance, key, newPresences, currentPresences) {
  if (!key) return;
  const mine = attendance.here.get(key) || new Map();
  for (const a of newPresences || []) {
    if (a && a.presence_ref !== undefined) mine.set(a.presence_ref, a);
  }
  if (mine.size) attendance.here.set(key, mine);
  const recent = attendance.recent.get(key) || new Set();
  idsOf(newPresences).forEach((id) => recent.add(id));
  idsOf(currentPresences).forEach((id) => recent.add(id));
  attendance.recent.set(key, recent);
}

// From a presence "leave" event: { key, leftPresences, currentPresences }.
export function attendanceLeave(attendance, key, leftPresences, currentPresences) {
  const mine = attendance.here.get(key);
  if (!mine) return;
  const left = idsOf(leftPresences);
  left.forEach((id) => mine.delete(id));
  // A "left" with no id: the re-read after a reconnection (see above). Keep
  // only what that re-read has vouched for.
  if ((leftPresences || []).some((a) => a && a.presence_ref === undefined)) {
    const keep = new Set([...(attendance.recent.get(key) || []), ...idsOf(currentPresences)]);
    left.forEach((id) => keep.delete(id));
    for (const id of [...mine.keys()]) {
      if (!keep.has(id)) mine.delete(id);
    }
  }
  if (mine.size === 0) attendance.here.delete(key);
}

// From a presence "sync" event, with the library's own list: anyone it no
// longer has at all is gone (they left while this device was offline).
// Nobody is ever added from it.
export function attendanceSync(attendance, state) {
  for (const key of [...attendance.here.keys()]) {
    if (!state || !state[key]) attendance.here.delete(key);
  }
  attendance.recent.clear();
}

// The record in the same shape presenceState() uses: { key: [announcement, …] }.
export function attendanceState(attendance) {
  const state = {};
  for (const [key, mine] of attendance.here) state[key] = [...mine.values()];
  return state;
}

// { key: [announcement, …] }; a student has one (the newest, if ever two).
function latest(announcements) {
  const list = (announcements || []).filter(Boolean);
  return list.length ? list[list.length - 1] : null;
}

// What a "student-status" message says, tidied.
export function readStatus(payload) {
  return { hand: !!payload.hand, handAt: payload.hand ? Number(payload.handAt) || 0 : 0, done: !!payload.done };
}

// The class list: hands that are up come first (whoever has waited longest
// at the top), then everyone else in the order they joined. `statuses` is
// a Map of studentId -> { hand, handAt, done }.
export function rosterFromPresence(state, statuses) {
  const students = [];
  for (const key in state || {}) {
    if (key === "teacher") continue;
    const a = latest(state[key]);
    if (!a || !a.studentId) continue;
    const status = (statuses && statuses.get(a.studentId)) || {};
    students.push({
      studentId: a.studentId,
      name: a.name || "Student",
      joinedAt: a.joinedAt || 0,
      hand: !!status.hand,
      handAt: status.hand ? status.handAt || 0 : 0,
      done: !!status.done,
    });
  }
  students.sort((a, b) => {
    if (a.hand !== b.hand) return a.hand ? -1 : 1;
    if (a.hand && a.handAt !== b.handAt) return a.handAt - b.handAt;
    return a.joinedAt - b.joinedAt || String(a.studentId).localeCompare(String(b.studentId));
  });
  return students;
}

export function rosterSummary(roster) {
  let hands = 0, done = 0;
  for (const s of roster || []) {
    if (s.hand) hands++;
    if (s.done) done++;
  }
  return { hands, done, total: (roster || []).length };
}

// What the teacher is told when hands go up (null when none are new).
// `announced` is a Map of studentId -> the moment that hand went up, for
// hands the teacher has already been told about; it is brought up to date
// here. A hand stays "told" until it comes down, so a student whose page
// reloads with their hand still up isn't announced a second time.
export function newHandsNotice(roster, announced, statuses) {
  if (statuses) {
    for (const id of [...announced.keys()]) {
      const status = statuses.get(id);
      if (status && !status.hand) announced.delete(id);
    }
  }
  const fresh = (roster || []).filter((s) => s.hand && announced.get(s.studentId) !== s.handAt);
  fresh.forEach((s) => announced.set(s.studentId, s.handAt));
  if (fresh.length === 0) return null;
  if (fresh.length === 1) return `${fresh[0].name} has a hand up`;
  if (fresh.length === 2) return `${fresh[0].name} and ${fresh[1].name} have their hands up`;
  return `${fresh.length} students have their hands up`;
}
